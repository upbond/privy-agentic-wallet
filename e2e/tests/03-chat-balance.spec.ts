import { test, expect } from "@playwright/test";
import { seedLogin3Session, mockPrivyNetwork } from "../fixtures/auth-helpers";
import { mockAgentRoute, mockBaseSepoliaRPC } from "../fixtures/api-mocks";

test.describe("Section 3: Chat — Check Balance", () => {
  test("3-1: 'Check my balance' returns formatted response", async ({
    page,
  }) => {
    await mockPrivyNetwork(page);
    await mockBaseSepoliaRPC(page);
    await seedLogin3Session(page);
    await mockAgentRoute(page, [
      {
        message:
          "Your wallet balance is **0.002 ETH** on Base Sepolia.\n\nWallet address: `0x1234567890abcdef1234567890abcdef12345678`",
      },
    ]);
    await page.goto("/");

    // Wait for chat UI to load
    await expect(
      page.getByTestId("chat-input")
    ).toBeVisible({ timeout: 15000 });

    // Click suggestion or type
    await page.getByTestId("suggestion-0").click();

    // Wait for response
    await expect(
      page.getByText("0.002 ETH", { exact: false })
    ).toBeVisible({ timeout: 10000 });
  });
});
