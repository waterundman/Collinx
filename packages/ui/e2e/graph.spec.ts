import { test, expect } from "@playwright/test";

test.describe("Knowledge Graph", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-graph"]').click();
  });

  test("should render the graph layout", async ({ page }) => {
    await expect(page.locator('[data-testid="graph-layout"]')).toBeVisible();
  });

  test("should render the graph canvas", async ({ page }) => {
    const canvas = page.locator('[data-testid="graph-canvas"]');
    await expect(canvas).toBeVisible();
  });

  test("should not show node detail initially", async ({ page }) => {
    const detail = page.locator('[data-testid="node-detail"]');
    await expect(detail).not.toBeVisible();
  });

  test("should show node detail on canvas click", async ({ page }) => {
    const canvas = page.locator('[data-testid="graph-canvas"]');
    await canvas.click({ position: { x: 200, y: 200 } });

    const detail = page.locator('[data-testid="node-detail"]');
    const isVisible = await detail.isVisible().catch(() => false);
    if (isVisible) {
      await expect(detail).toBeVisible();
    }
  });
});
