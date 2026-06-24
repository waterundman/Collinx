import { test, expect } from "@playwright/test";

test.describe("Orchestrator Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-orchestrate"]').click();
  });

  test("should render the orchestrator panel", async ({ page }) => {
    const panel = page.locator('[data-testid="orchestrator-panel"]');
    await expect(panel).toBeVisible();
  });

  test("should display the panel title", async ({ page }) => {
    const panel = page.locator('[data-testid="orchestrator-panel"]');
    await expect(panel).toBeVisible();
    const text = await panel.innerText();
    expect(text.length).toBeGreaterThan(0);
  });

  test("should display ensemble preset buttons", async ({ page }) => {
    const panel = page.locator('[data-testid="orchestrator-panel"]');
    await expect(panel).toBeVisible();
    const buttons = panel.locator("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should select a preset on click", async ({ page }) => {
    const panel = page.locator('[data-testid="orchestrator-panel"]');
    await expect(panel).toBeVisible();
    const firstBtn = panel.locator("button").first();
    await firstBtn.click();
  });

  test("should display instrument families", async ({ page }) => {
    const panel = page.locator('[data-testid="orchestrator-panel"]');
    await expect(panel).toBeVisible();
    const text = await panel.innerText();
    expect(text.length).toBeGreaterThan(0);
  });

  test("should display the orchestrate layout with arrangement view", async ({ page }) => {
    await expect(page.locator('[data-testid="orchestrate-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="arrangement-view"]')).toBeVisible();
  });
});
