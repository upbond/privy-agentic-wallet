import { test, expect } from "@playwright/test";
import { seedLogin3Session, mockPrivyNetwork } from "../fixtures/auth-helpers";
import {
  mockAgentRoute,
  mockBaseSepoliaRPC,
  MOCK_SIGNATURE,
} from "../fixtures/api-mocks";

test.describe("Section 5: Chat — Sign Message", () => {
  test("5-1: 'Sign message' returns signature response", async ({ page }) => {
    await mockPrivyNetwork(page);
    await mockBaseSepoliaRPC(page);
    await seedLogin3Session(page);
    await mockAgentRoute(page, [
      {
        message: `I've signed the message "Hello Privy!" with your wallet.\n\nSignature: \`${MOCK_SIGNATURE}\``,
      },
    ]);
    await page.goto("/");

    await expect(
      page.getByTestId("chat-input")
    ).toBeVisible({ timeout: 15000 });

    // Click the "Sign the message" suggestion
    await page.getByTestId("suggestion-1").click();

    // Wait for response with signature
    await expect(
      page.getByText(MOCK_SIGNATURE.slice(0, 10), { exact: false })
    ).toBeVisible({ timeout: 10000 });
  });
});
