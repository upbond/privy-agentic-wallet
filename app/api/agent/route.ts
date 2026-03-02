import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { DELEGATED_TOOLS, handleDelegatedTool } from "@/lib/delegated-tools";
import { authenticateRequest } from "@/lib/auth";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY!,
  baseURL: process.env.ANTHROPIC_BASE_URL ?? undefined,
});

function buildSystemPrompt(stripeCustomerId?: string): string {
  const stripeSection = stripeCustomerId
    ? `The user has a Stripe payment method set up. Their Stripe Customer ID is: ${stripeCustomerId}
When they ask to buy something with a card, Stripe, or credit card, use this customer ID directly with the buy_with_stripe tool — do not ask them for it.`
    : `The user has NOT set up a Stripe payment method yet.
If they ask to pay with a card or use Stripe, inform them they need to click the "Add Card" button in the chat header to set up their card first.`;

  return `You are an agentic wallet assistant powered by Privy delegated wallets on Base Sepolia testnet.

The user has already authenticated via Login 3.0 and delegated their embedded wallet to you.
You operate on their behalf using their own wallet — not an app-owned server wallet.

You can help the user:
- Check their ETH balance
- Send ETH (max 0.001 ETH per transaction, enforced by policy)
- Sign messages
- Buy products using ETH on Base Sepolia (buy_product tool, price: 0.00001 ETH)
- Buy a premium AI market report using Stripe card payment (buy_with_stripe tool, price: $1.00 USD)

${stripeSection}

Always be clear about what you're doing before calling a tool.
When displaying wallet addresses or tx hashes, show them in full.
Format amounts clearly (e.g. "0.0005 ETH" or "$1.00 USD").
Never proceed with a send_eth if the amount exceeds 0.001 ETH — warn the user instead.
For Stripe payments, always check if the customer has a saved card using stripe_check_setup before attempting buy_with_stripe if you are uncertain.`;
}

export async function POST(req: NextRequest) {
  // JWT authentication
  const authHeader = req.headers.get("authorization");
  const user = await authenticateRequest(authHeader);

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized. Please sign in with Login 3.0." },
      { status: 401 }
    );
  }

  try {
    const { messages, stripe_customer_id } = (await req.json()) as {
      messages: Anthropic.MessageParam[];
      stripe_customer_id?: string;
    };

    const agentMessages: Anthropic.MessageParam[] = [...messages];

    // Capture any requires_stripe_action result from tool calls
    let requiresStripeAction = false;
    let stripeClientSecret: string | undefined;
    let stripePaymentIntentId: string | undefined;

    let response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system: buildSystemPrompt(stripe_customer_id),
      tools: DELEGATED_TOOLS,
      messages: agentMessages,
    });

    // Agentic loop: keep running until no more tool calls
    while (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      agentMessages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (block) => {
          try {
            const result = await handleDelegatedTool(
              block.name,
              block.input as Record<string, unknown>,
              user.walletAddress
            );

            // Surface Stripe 3DS action to the response
            if (
              result &&
              typeof result === "object" &&
              "requires_stripe_action" in result &&
              result.requires_stripe_action === true
            ) {
              requiresStripeAction = true;
              stripeClientSecret = (result as Record<string, string>).client_secret;
              stripePaymentIntentId = (result as Record<string, string>).payment_intent_id;
            }

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
        system: buildSystemPrompt(stripe_customer_id),
        tools: DELEGATED_TOOLS,
        messages: agentMessages,
      });
    }

    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    const responseBody: Record<string, unknown> = { message: textContent };
    if (requiresStripeAction) {
      responseBody.requires_stripe_action = true;
      responseBody.stripe_client_secret = stripeClientSecret;
      responseBody.stripe_payment_intent_id = stripePaymentIntentId;
    }

    return NextResponse.json(responseBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
