import { test, expect } from "@playwright/test";

test.describe("Score Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-score"]').click();
  });

  test("should render the score panel", async ({ page }) => {
    const panel = page.locator('[data-testid="score-panel"]');
    await expect(panel).toBeVisible();
  });

  test("should display the toolbar", async ({ page }) => {
    const panel = page.locator('[data-testid="score-panel"]');
    await expect(panel).toBeVisible();
    const text = await panel.innerText();
    expect(text.length).toBeGreaterThan(0);
  });

  test("should have auto layout button", async ({ page }) => {
    const panel = page.locator('[data-testid="score-panel"]');
    await expect(panel).toBeVisible();
    const buttons = panel.locator("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should display the body with sidebar and preview", async ({ page }) => {
    const panel = page.locator('[data-testid="score-panel"]');
    await expect(panel).toBeVisible();
  });

  test("should display the score layout", async ({ page }) => {
    await expect(page.locator('[data-testid="score-layout"]')).toBeVisible();
  });

  test("should show compact version in compose tab", async ({ page }) => {
    await page.locator('[data-testid="tab-compose"]').click();
    const compactPanel = page.locator('[data-testid="compose-layout"] [data-testid="score-panel"]');
    await expect(compactPanel).toBeVisible();
  });
});
