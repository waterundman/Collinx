import { test, expect } from "@playwright/test";

test.describe("Taste Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-taste"]').click();
  });

  test("should render the taste layout", async ({ page }) => {
    await expect(page.locator('[data-testid="taste-layout"]')).toBeVisible();
  });

  test("should render the taste timeline", async ({ page }) => {
    const timeline = page.locator('[data-testid="taste-timeline"]');
    await expect(timeline).toBeVisible();
  });

  test("should render the taste library", async ({ page }) => {
    const library = page.locator('[data-testid="taste-library"]');
    await expect(library).toBeVisible();
  });

  test("should display the analyze export button", async ({ page }) => {
    const btn = page.locator('[data-testid="taste-analyze-export"]');
    await expect(btn).toBeVisible();
  });

  test("should click analyze export button", async ({ page }) => {
    const btn = page.locator('[data-testid="taste-analyze-export"]');
    await btn.click();
    await expect(btn).toBeVisible();
  });

  test("should display domain items in the library", async ({ page }) => {
    const library = page.locator('[data-testid="taste-library"]');
    await expect(library).toBeVisible();
    const text = await library.innerText();
    expect(text.length).toBeGreaterThan(0);
  });
});
