import { test, expect } from "@playwright/test";
import { seedLogin3Session, mockPrivyNetwork } from "../fixtures/auth-helpers";
import { mockAgentRoute, mockBaseSepoliaRPC } from "../fixtures/api-mocks";

test.describe("Section 6: Chat — Buy Product", () => {
  test("6-1: 'Buy a product' returns product response", async ({ page }) => {
    await mockPrivyNetwork(page);
    await mockBaseSepoliaRPC(page);
    await seedLogin3Session(page);
    await mockAgentRoute(page, [
      {
        message:
          "I've purchased the **Premium Weather Data** for 0.00001 ETH!\n\nProduct details:\n- Temperature: 23°C\n- Condition: Partly Cloudy\n- Humidity: 62%\n\nPayment verified on Base Sepolia.",
      },
    ]);
    await page.goto("/");

    await expect(
      page.getByTestId("chat-input")
    ).toBeVisible({ timeout: 15000 });

    // Click the "Buy a product" suggestion
    await page.getByTestId("suggestion-2").click();

    // Wait for response with product info
    await expect(
      page.getByText("Premium Weather Data", { exact: false })
    ).toBeVisible({ timeout: 10000 });
  });
});
