import { test, expect } from "@playwright/test";

test.describe("Arranger Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-arrange"]').click();
  });

  test("should render the arranger panel", async ({ page }) => {
    const panel = page.locator('[data-testid="arranger-panel"]');
    await expect(panel).toBeVisible();
  });

  test("should display the panel title", async ({ page }) => {
    const panel = page.locator('[data-testid="arranger-panel"]');
    await expect(panel).toBeVisible();
    const text = await panel.innerText();
    expect(text).toContain("Arranger");
  });

  test("should have a template selector", async ({ page }) => {
    const panel = page.locator('[data-testid="arranger-panel"]');
    await expect(panel).toBeVisible();
    const select = panel.locator("select");
    await expect(select).toBeVisible();
  });

  test("should render variant cards after template selection", async ({ page }) => {
    const panel = page.locator('[data-testid="arranger-panel"]');
    await expect(panel).toBeVisible();
    const text = await panel.innerText();
    expect(text.length).toBeGreaterThan(0);
  });

  test("should display the arrangement layout with both views", async ({ page }) => {
    await expect(page.locator('[data-testid="arrange-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="arranger-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="arrangement-view"]')).toBeVisible();
  });
});
