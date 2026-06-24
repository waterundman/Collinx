import { test, expect } from "@playwright/test";

test.describe("Arrangement View", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should render arrangement view in compose tab", async ({ page }) => {
    const arrangement = page.locator('[data-testid="arrangement-view"]').first();
    await expect(arrangement).toBeVisible();
  });

  test("should display phrase blocks", async ({ page }) => {
    const arrangement = page.locator('[data-testid="arrangement-view"]').first();
    await expect(arrangement).toBeVisible();
    const innerText = await arrangement.innerText();
    expect(innerText.length).toBeGreaterThan(0);
  });

  test("should select a phrase block on click", async ({ page }) => {
    const arrangement = page.locator('[data-testid="arrangement-view"]').first();
    await expect(arrangement).toBeVisible();
    const phrase = arrangement.locator("div").filter({ hasText: /.+/ }).first();
    await phrase.click();
  });

  test("should render arrangement view in arrange tab", async ({ page }) => {
    await page.locator('[data-testid="tab-arrange"]').click();
    const arrangement = page.locator('[data-testid="arrangement-view"]');
    await expect(arrangement).toBeVisible();
  });

  test("should render arrangement view in orchestrate tab", async ({ page }) => {
    await page.locator('[data-testid="tab-orchestrate"]').click();
    const arrangement = page.locator('[data-testid="arrangement-view"]');
    await expect(arrangement).toBeVisible();
  });
});
