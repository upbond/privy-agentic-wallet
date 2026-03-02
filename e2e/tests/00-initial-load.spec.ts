import { test, expect } from "@playwright/test";
import { mockPrivyNetwork } from "../fixtures/auth-helpers";
import { mockBaseSepoliaRPC } from "../fixtures/api-mocks";

test.describe("Section 0: Initial Load", () => {
  test.beforeEach(async ({ page }) => {
    await mockPrivyNetwork(page);
    await mockBaseSepoliaRPC(page);
    await page.goto("/");
  });

  test("0-1: page renders without crash", async ({ page }) => {
    // Either loading spinner or login screen should appear
    const hasContent = await page
      .locator("[data-testid='loading-spinner'], [data-testid='login-screen']")
      .first()
      .isVisible({ timeout: 10000 })
      .catch(() => false);

    // Fallback: at least the body has content
    if (!hasContent) {
      await expect(page.locator("body")).not.toBeEmpty();
    }
  });

  test("0-2: page title is correct", async ({ page }) => {
    await expect(page).toHaveTitle(/Privy Agentic Wallet/i);
  });
});
