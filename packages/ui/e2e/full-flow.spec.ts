import { test, expect } from "@playwright/test";

test.describe("Full Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should complete a full composition workflow across tabs", async ({ page }) => {
    // Step 1: Start in compose tab - verify piano roll is visible
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="piano-roll-canvas"]')).toBeVisible();
    await expect(page.locator('[data-testid="arrangement-view"]').first()).toBeVisible();

    // Step 2: Switch to arrange tab - verify arranger panel
    await page.locator('[data-testid="tab-arrange"]').click();
    await expect(page.locator('[data-testid="arrange-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="arranger-panel"]')).toBeVisible();

    // Step 3: Switch to orchestrate tab - verify orchestrator panel
    await page.locator('[data-testid="tab-orchestrate"]').click();
    await expect(page.locator('[data-testid="orchestrate-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="orchestrator-panel"]')).toBeVisible();

    // Step 4: Switch to mixer tab - verify mixer console
    await page.locator('[data-testid="tab-mixer"]').click();
    await expect(page.locator('[data-testid="mixer-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="mixer-console"]')).toBeVisible();

    // Step 5: Switch to score tab - verify score panel
    await page.locator('[data-testid="tab-score"]').click();
    await expect(page.locator('[data-testid="score-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="score-panel"]')).toBeVisible();

    // Step 6: Switch to taste tab - verify taste panels
    await page.locator('[data-testid="tab-taste"]').click();
    await expect(page.locator('[data-testid="taste-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="taste-timeline"]')).toBeVisible();
    await expect(page.locator('[data-testid="taste-library"]')).toBeVisible();

    // Step 7: Switch to teaching tab - verify teaching panel
    await page.locator('[data-testid="tab-teaching"]').click();
    await expect(page.locator('[data-testid="teaching-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="teaching-panel"]')).toBeVisible();

    // Step 8: Switch to agent tab - verify chat and panel
    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="agent-chat"]')).toBeVisible();
    await expect(page.locator('[data-testid="agent-panel"]')).toBeVisible();

    // Step 9: Switch to graph tab - verify graph canvas
    await page.locator('[data-testid="tab-graph"]').click();
    await expect(page.locator('[data-testid="graph-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="graph-canvas"]')).toBeVisible();
  });

  test("should send a message in agent tab", async ({ page }) => {
    await page.locator('[data-testid="tab-agent"]').click();
    const input = page.locator('[data-testid="agent-chat-input"]');
    await input.fill("Create a new melody");
    await page.locator('[data-testid="agent-chat-send"]').click();
    await expect(page.locator('[data-testid="agent-chat-messages"]')).toContainText("Create a new melody");
  });

  test("should interact with mixer controls across the flow", async ({ page }) => {
    // Go to mixer
    await page.locator('[data-testid="tab-mixer"]').click();

    // Mute first track
    const muteBtn = page.locator('[data-testid^="mixer-mute-"]').first();
    await muteBtn.click();
    await expect(muteBtn).toHaveClass(/active/i);

    // Solo second track
    const soloBtn = page.locator('[data-testid^="mixer-solo-"]').nth(1);
    if (await soloBtn.isVisible()) {
      await soloBtn.click();
      await expect(soloBtn).toHaveClass(/active/i);
    }
  });

  test("should switch teaching levels", async ({ page }) => {
    await page.locator('[data-testid="tab-teaching"]').click();

    await page.locator('[data-testid="teaching-level-beginner"]').click();
    await expect(page.locator('[data-testid="teaching-level-beginner"]')).toHaveClass(/active/i);

    await page.locator('[data-testid="teaching-level-professional"]').click();
    await expect(page.locator('[data-testid="teaching-level-professional"]')).toHaveClass(/active/i);
  });

  test("should navigate back to compose after visiting other tabs", async ({ page }) => {
    // Visit several tabs
    await page.locator('[data-testid="tab-mixer"]').click();
    await page.locator('[data-testid="tab-agent"]').click();
    await page.locator('[data-testid="tab-graph"]').click();

    // Go back to compose
    await page.locator('[data-testid="tab-compose"]').click();
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="piano-roll-canvas"]')).toBeVisible();
  });
});
