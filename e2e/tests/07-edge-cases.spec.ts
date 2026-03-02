import { test, expect } from "@playwright/test";
import { seedLogin3Session, mockPrivyNetwork } from "../fixtures/auth-helpers";
import { mockAgentRoute, mockBaseSepoliaRPC } from "../fixtures/api-mocks";

test.describe("Section 7: Edge Cases", () => {
  test.beforeEach(async ({ page }) => {
    await mockPrivyNetwork(page);
    await mockBaseSepoliaRPC(page);
    await seedLogin3Session(page);
  });

  test("7-1: empty input — submit button is disabled", async ({ page }) => {
    await mockAgentRoute(page, []);
    await page.goto("/");

    await expect(
      page.getByTestId("chat-submit")
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("chat-submit")).toBeDisabled();
  });

  test("7-2: input clears after sending message", async ({ page }) => {
    await mockAgentRoute(page, [{ message: "Hello!" }]);
    await page.goto("/");

    await expect(
      page.getByTestId("chat-input")
    ).toBeVisible({ timeout: 15000 });

    await page.getByTestId("chat-input").fill("Test message");
    await page.getByTestId("chat-submit").click();

    await expect(page.getByTestId("chat-input")).toHaveValue("");
  });

  test("7-3: suggestions disappear after first message", async ({ page }) => {
    await mockAgentRoute(page, [{ message: "Sure!" }]);
    await page.goto("/");

    await expect(
      page.getByTestId("suggestions-container")
    ).toBeVisible({ timeout: 15000 });

    await page.getByTestId("chat-input").fill("Hello");
    await page.getByTestId("chat-submit").click();

    await expect(
      page.getByTestId("suggestions-container")
    ).not.toBeVisible({ timeout: 10000 });
  });

  test("7-4: network error shows error message", async ({ page }) => {
    // Mock agent to fail with network error
    await page.route("**/api/agent", async (route) => {
      await route.abort("connectionfailed");
    });
    await page.goto("/");

    await expect(
      page.getByTestId("chat-input")
    ).toBeVisible({ timeout: 15000 });

    await page.getByTestId("chat-input").fill("Hello");
    await page.getByTestId("chat-submit").click();

    await expect(
      page.getByText("Network error", { exact: false })
    ).toBeVisible({ timeout: 10000 });
  });

  test("7-5: API error shows error message", async ({ page }) => {
    await mockAgentRoute(page, [
      { error: "Internal server error", status: 500 },
    ]);
    await page.goto("/");

    await expect(
      page.getByTestId("chat-input")
    ).toBeVisible({ timeout: 15000 });

    await page.getByTestId("chat-input").fill("Hello");
    await page.getByTestId("chat-submit").click();

    await expect(
      page.getByText("Error:", { exact: false })
    ).toBeVisible({ timeout: 10000 });
  });
});
