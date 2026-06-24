import { test, expect } from "@playwright/test";

const TABS = [
  "compose",
  "arrange",
  "orchestrate",
  "mixer",
  "score",
  "taste",
  "teaching",
  "agent",
  "graph",
] as const;

test.describe("Tab Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should render the app with compose tab active by default", async ({ page }) => {
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
  });

  test("should render all 9 tab buttons", async ({ page }) => {
    const tabBar = page.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible();

    for (const tab of TABS) {
      await expect(page.locator(`[data-testid="tab-${tab}"]`)).toBeVisible();
    }
  });

  for (const tab of TABS) {
    test(`should switch to ${tab} tab when clicked`, async ({ page }) => {
      await page.locator(`[data-testid="tab-${tab}"]`).click();

      if (tab === "compose") {
        await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
      } else if (tab === "arrange") {
        await expect(page.locator('[data-testid="arrange-layout"]')).toBeVisible();
      } else if (tab === "orchestrate") {
        await expect(page.locator('[data-testid="orchestrate-layout"]')).toBeVisible();
      } else if (tab === "mixer") {
        await expect(page.locator('[data-testid="mixer-layout"]')).toBeVisible();
      } else if (tab === "score") {
        await expect(page.locator('[data-testid="score-layout"]')).toBeVisible();
      } else if (tab === "taste") {
        await expect(page.locator('[data-testid="taste-layout"]')).toBeVisible();
      } else if (tab === "teaching") {
        await expect(page.locator('[data-testid="teaching-layout"]')).toBeVisible();
      } else if (tab === "agent") {
        await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();
      } else if (tab === "graph") {
        await expect(page.locator('[data-testid="graph-layout"]')).toBeVisible();
      }
    });
  }

  test("should display the app brand name", async ({ page }) => {
    await expect(page.locator("text=Collinx").first()).toBeVisible();
  });

  test("should switch between multiple tabs sequentially", async ({ page }) => {
    await page.locator('[data-testid="tab-mixer"]').click();
    await expect(page.locator('[data-testid="mixer-layout"]')).toBeVisible();

    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();

    await page.locator('[data-testid="tab-compose"]').click();
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
  });
});
