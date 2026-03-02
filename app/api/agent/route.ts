import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { TOOLS, handleTool } from "@/lib/tools";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an agentic wallet assistant powered by Privy server wallets on Base Sepolia testnet.

You can help users:
- Create new wallets with spending-limit policies
- List existing wallets
- Check ETH balances
- Send ETH (max 0.001 ETH per transaction, enforced by on-chain policy)
- Sign messages

Always be clear about what you're doing before calling a tool.
When displaying wallet addresses or tx hashes, show them in full.
Format amounts clearly (e.g. "0.0005 ETH").
Never proceed with a send_eth if the amount exceeds 0.001 ETH — warn the user instead.`;

export async function POST(req: NextRequest) {
  try {
    const { messages } = (await req.json()) as {
      messages: Anthropic.MessageParam[];
    };

    const agentMessages: Anthropic.MessageParam[] = [...messages];
    let response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: agentMessages,
    });

    // Agentic loop: keep running until no more tool calls
    while (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      // Add assistant response to messages
      agentMessages.push({ role: "assistant", content: response.content });

      // Execute all tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (block) => {
          try {
            const result = await handleTool(
              block.name,
              block.input as Record<string, unknown>
            );
            return {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: JSON.stringify(result, null, 2),
            };
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Unknown error";
            return {
              type: "tool_result" as const,
              tool_use_id: block.id,
              content: `Error: ${message}`,
              is_error: true,
            };
          }
        })
      );

      agentMessages.push({ role: "user", content: toolResults });

      response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: agentMessages,
      });
    }

    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return NextResponse.json({ message: textContent });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
