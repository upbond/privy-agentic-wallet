import { test, expect } from "@playwright/test";
import { seedLogin3Session, mockPrivyNetwork } from "../fixtures/auth-helpers";
import { mockAgentRoute, mockBaseSepoliaRPC } from "../fixtures/api-mocks";

test.describe("Section 2: Chat UI (Authenticated)", () => {
  test.beforeEach(async ({ page }) => {
    await mockPrivyNetwork(page);
    await mockBaseSepoliaRPC(page);
    await seedLogin3Session(page);
    await mockAgentRoute(page, []);
    await page.goto("/");
  });

  test("2-1: app header is visible", async ({ page }) => {
    await expect(
      page.getByTestId("app-header")
    ).toBeVisible({ timeout: 15000 });
  });

  test("2-2: testnet badge is visible", async ({ page }) => {
    await expect(
      page.getByTestId("testnet-badge")
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("testnet-badge")).toHaveText("Testnet");
  });

  test("2-3: suggestion buttons are visible", async ({ page }) => {
    await expect(
      page.getByTestId("suggestions-container")
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("suggestion-0")).toBeVisible();
    await expect(page.getByTestId("suggestion-1")).toBeVisible();
    await expect(page.getByTestId("suggestion-2")).toBeVisible();
  });

  test("2-4: chat input and submit button are visible", async ({ page }) => {
    await expect(
      page.getByTestId("chat-input")
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("chat-submit")).toBeVisible();
  });

  test("2-5: welcome message is shown", async ({ page }) => {
    await expect(
      page.getByTestId("messages-container")
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByText("I'm your Privy agentic wallet assistant", { exact: false })
    ).toBeVisible();
  });
});
