import { test, expect } from "@playwright/test";
import { mockPrivyNetwork } from "../fixtures/auth-helpers";
import { mockBaseSepoliaRPC } from "../fixtures/api-mocks";

test.describe("Section 1: Login Screen", () => {
  test.beforeEach(async ({ page }) => {
    await mockPrivyNetwork(page);
    await mockBaseSepoliaRPC(page);
    // Don't seed Login3 session — user is unauthenticated
    await page.goto("/");
  });

  test("1-1: sign-in button is visible", async ({ page }) => {
    await expect(
      page.getByTestId("login-button")
    ).toBeVisible({ timeout: 15000 });
  });

  test("1-2: app name is visible on login screen", async ({ page }) => {
    await expect(
      page.getByText("Privy Agentic Wallet")
    ).toBeVisible({ timeout: 15000 });
  });
});
