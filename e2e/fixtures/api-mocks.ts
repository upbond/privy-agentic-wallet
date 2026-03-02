import type { Page } from "@playwright/test";

export const MOCK_WALLET_ADDRESS =
  "0x1234567890abcdef1234567890abcdef12345678";
export const MOCK_TX_HASH =
  "0xabc123def456789012345678901234567890123456789012345678901234abcd";
export const MOCK_SIGNATURE =
  "0xsig123456789012345678901234567890123456789012345678901234567890ab";

/**
 * Queue-based agent response mocking.
 * Each call to `/api/agent` dequeues the next response.
 */
export interface AgentResponse {
  message?: string;
  error?: string;
  status?: number;
}

/**
 * Mock `/api/agent` POST endpoint with queued responses.
 */
export async function mockAgentRoute(
  page: Page,
  responses: AgentResponse[]
) {
  const queue = [...responses];

  await page.route("**/api/agent", async (route, request) => {
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }

    const next = queue.shift() ?? {
      message: "Default mock response",
    };

    await route.fulfill({
      status: next.status ?? (next.error ? 500 : 200),
      contentType: "application/json",
      body: JSON.stringify(
        next.error ? { error: next.error } : { message: next.message }
      ),
    });
  });
}

/**
 * Mock `/api/shop` GET endpoint.
 */
export async function mockShopRoute(page: Page) {
  await page.route("**/api/shop", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        product: "Premium Weather Data",
        data: { temperature: "23°C", condition: "Partly Cloudy" },
        message: "Payment verified!",
      }),
    });
  });
}

/**
 * Mock Base Sepolia RPC calls (eth_getBalance).
 */
export async function mockBaseSepoliaRPC(
  page: Page,
  balanceWei = "0x71afd498d0000" // ~0.002 ETH
) {
  await page.route("**/sepolia.base.org", async (route, request) => {
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }

    const body = await request.postDataJSON();

    if (body.method === "eth_getBalance") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: balanceWei,
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: null,
        }),
      });
    }
  });
}
