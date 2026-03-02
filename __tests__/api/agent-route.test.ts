import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to ensure mocks are available before vi.mock hoisting
const { mockAuthenticateRequest, mockHandleDelegatedTool, mockCreate } = vi.hoisted(() => ({
  mockAuthenticateRequest: vi.fn(),
  mockHandleDelegatedTool: vi.fn(),
  mockCreate: vi.fn(),
}));

// Mock authenticateRequest
vi.mock("@/lib/auth", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

// Mock handleDelegatedTool
vi.mock("@/lib/delegated-tools", () => ({
  DELEGATED_TOOLS: [
    { name: "get_balance", description: "Get balance", input_schema: { type: "object", properties: {}, required: [] } },
  ],
  handleDelegatedTool: (...args: unknown[]) => mockHandleDelegatedTool(...args),
}));

// Mock Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

import { POST } from "@/app/api/agent/route";
import { NextRequest } from "next/server";

function makeRequest(body: object, authHeader?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authHeader) headers["Authorization"] = authHeader;

  return new NextRequest("http://localhost:3000/api/agent", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/agent", () => {
  it("returns 401 without auth header", async () => {
    mockAuthenticateRequest.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ messages: [] }));
    expect(res.status).toBe(401);

    const data = await res.json();
    expect(data.error).toContain("Unauthorized");
  });

  it("returns text response when no tool use", async () => {
    mockAuthenticateRequest.mockResolvedValueOnce({
      userId: "user-1",
      walletAddress: "0xWallet",
      walletId: "wallet-id",
    });

    mockCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Your balance is 0.5 ETH" }],
    });

    const res = await POST(
      makeRequest(
        { messages: [{ role: "user", content: "Check my balance" }] },
        "Bearer valid-token"
      )
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe("Your balance is 0.5 ETH");
  });

  it("executes tool loop: tool_use → handleDelegatedTool → final text", async () => {
    mockAuthenticateRequest.mockResolvedValueOnce({
      userId: "user-1",
      walletAddress: "0xWallet",
      walletId: "wallet-id",
    });

    // First Anthropic call returns tool_use
    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Let me check your balance." },
        {
          type: "tool_use",
          id: "tool-1",
          name: "get_balance",
          input: {},
        },
      ],
    });

    // handleDelegatedTool returns balance
    mockHandleDelegatedTool.mockResolvedValueOnce({
      asset: "eth",
      raw_value: "500000000000000",
    });

    // Second Anthropic call returns final text
    mockCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "You have 0.0005 ETH." }],
    });

    const res = await POST(
      makeRequest(
        { messages: [{ role: "user", content: "Check my balance" }] },
        "Bearer valid-token"
      )
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe("You have 0.0005 ETH.");
    expect(mockHandleDelegatedTool).toHaveBeenCalledWith(
      "get_balance",
      {},
      "0xWallet",
      "wallet-id"
    );
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("returns is_error to Anthropic when tool throws", async () => {
    mockAuthenticateRequest.mockResolvedValueOnce({
      userId: "user-1",
      walletAddress: "0xWallet",
      walletId: "wallet-id",
    });

    mockCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "tool-err", name: "get_balance", input: {} },
      ],
    });

    mockHandleDelegatedTool.mockRejectedValueOnce(new Error("RPC failed"));

    // After error, Anthropic gets tool_result with is_error and responds
    mockCreate.mockResolvedValueOnce({
      stop_reason: "end_turn",
      content: [
        { type: "text", text: "Sorry, I couldn't check your balance." },
      ],
    });

    const res = await POST(
      makeRequest(
        { messages: [{ role: "user", content: "balance" }] },
        "Bearer valid-token"
      )
    );

    expect(res.status).toBe(200);
    // Verify the second Anthropic call received tool_result with is_error
    const secondCallMessages = mockCreate.mock.calls[1][0].messages;
    const toolResultMsg = secondCallMessages[secondCallMessages.length - 1];
    expect(toolResultMsg.content[0].is_error).toBe(true);
    expect(toolResultMsg.content[0].content).toContain("RPC failed");
  });

  it("enforces max 10 tool rounds", async () => {
    mockAuthenticateRequest.mockResolvedValueOnce({
      userId: "user-1",
      walletAddress: "0xWallet",
      walletId: "wallet-id",
    });

    // Return tool_use for every call (11 times)
    for (let i = 0; i < 11; i++) {
      mockCreate.mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: `tool-${i}`, name: "get_balance", input: {} },
        ],
      });
      mockHandleDelegatedTool.mockResolvedValueOnce({ asset: "eth" });
    }

    const res = await POST(
      makeRequest(
        { messages: [{ role: "user", content: "loop" }] },
        "Bearer valid-token"
      )
    );

    expect(res.status).toBe(200);
    // Should stop at 10 rounds + 1 initial call = 11 total Anthropic calls
    expect(mockCreate).toHaveBeenCalledTimes(11);
  });

  it("returns 500 on Anthropic error", async () => {
    mockAuthenticateRequest.mockResolvedValueOnce({
      userId: "user-1",
      walletAddress: "0xWallet",
      walletId: "wallet-id",
    });

    mockCreate.mockRejectedValueOnce(new Error("API rate limit"));

    const res = await POST(
      makeRequest(
        { messages: [{ role: "user", content: "hi" }] },
        "Bearer valid-token"
      )
    );

    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain("API rate limit");
  });
});
