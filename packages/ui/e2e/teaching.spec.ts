import { test, expect } from "@playwright/test";

test.describe("Teaching Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-teaching"]').click();
  });

  test("should render the teaching panel", async ({ page }) => {
    const panel = page.locator('[data-testid="teaching-panel"]');
    await expect(panel).toBeVisible();
  });

  test("should display the level selector", async ({ page }) => {
    const levelGroup = page.locator('[data-testid="teaching-level-group"]');
    await expect(levelGroup).toBeVisible();
  });

  test("should have all four level buttons", async ({ page }) => {
    for (const level of ["beginner", "intermediate", "advanced", "professional"]) {
      await expect(page.locator(`[data-testid="teaching-level-${level}"]`)).toBeVisible();
    }
  });

  test("should switch to beginner level", async ({ page }) => {
    const btn = page.locator('[data-testid="teaching-level-beginner"]');
    await btn.click();
    await expect(btn).toHaveClass(/active/i);
  });

  test("should switch to professional level", async ({ page }) => {
    const btn = page.locator('[data-testid="teaching-level-professional"]');
    await btn.click();
    await expect(btn).toHaveClass(/active/i);
  });

  test("should display the teaching layout", async ({ page }) => {
    await expect(page.locator('[data-testid="teaching-layout"]')).toBeVisible();
  });
});
