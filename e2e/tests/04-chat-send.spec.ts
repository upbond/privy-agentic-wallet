import { test, expect } from "@playwright/test";
import { seedLogin3Session, mockPrivyNetwork } from "../fixtures/auth-helpers";
import {
  mockAgentRoute,
  mockBaseSepoliaRPC,
  MOCK_TX_HASH,
} from "../fixtures/api-mocks";

test.describe("Section 4: Chat — Send ETH", () => {
  test("4-1: 'Send ETH' returns tx hash response", async ({ page }) => {
    await mockPrivyNetwork(page);
    await mockBaseSepoliaRPC(page);
    await seedLogin3Session(page);
    await mockAgentRoute(page, [
      {
        message: `I've sent **0.0005 ETH** to the recipient.\n\nTransaction hash: \`${MOCK_TX_HASH}\`\nExplorer: https://sepolia.basescan.org/tx/${MOCK_TX_HASH}`,
      },
    ]);
    await page.goto("/");

    await expect(
      page.getByTestId("chat-input")
    ).toBeVisible({ timeout: 15000 });

    await page.getByTestId("chat-input").fill("Send 0.0005 ETH to 0xabcd");
    await page.getByTestId("chat-submit").click();

    // Wait for response with tx hash
    await expect(
      page.getByText(MOCK_TX_HASH.slice(0, 10), { exact: false })
    ).toBeVisible({ timeout: 10000 });
  });
});
