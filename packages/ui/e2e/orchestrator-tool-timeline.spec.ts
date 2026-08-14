import { test, expect } from "@playwright/test";

/**
 * E2E-I + E2E-J: Orchestrator panel real tool call + upsert merge (v1.13.0
 * Stage 3).
 *
 * Locks two v1.13.0 behaviors in a real browser session:
 *  - E2E-I: the Orchestrator panel's "编排" button routes through the real
 *    toolRegistry.call("orchestrator.voicingPlan") (Stage 0), so the agent
 *    tool-call timeline on the Agent tab gains a card whose tool-call-name is
 *    exactly "orchestrator.voicingPlan".
 *  - E2E-J: the running -> success pair of that call shares one correlationId
 *    (Stage 2), so RECORD_TOOL_CALL upserts them into a single timeline card:
 *    tool-call-count is exactly "1", never "2".
 *
 * Trigger path (recorded during Stage 3 survey):
 *  1. tab-orchestrate -> orchestrate-layout + orchestrator-panel visible.
 *  2. The panel starts with no players selected (selectedPlayers is empty), so
 *     the "编排" button is hidden until a preset is picked. Clicking a preset
 *     button (orchestrator-preset-<key>) fills selectedPlayers and reveals
 *     orchestrator-run. (data-testids added to OrchestratorPanel in v1.13.0
 *     Stage 3; the preset defaults to string_quartet but is NOT applied until
 *     clicked.)
 *  3. Clicking orchestrator-run calls handleOrchestrate -> actions.runOrchestrator
 *     -> toolRegistry.call("orchestrator.voicingPlan", ...). Unlike the mixer
 *     flow, this does NOT auto-jump to the Agent tab, so the test navigates to
 *     tab-agent and asserts the timeline there.
 *  4. The timeline then contains exactly one card for the call.
 *
 * Selectors follow the repo data-testid convention and are locale-independent
 * (toolName "orchestrator.voicingPlan" and the numeric tool-call-count).
 */
test.describe("E2E-I/E2E-J: Orchestrator panel tool timeline + upsert", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  /**
   * E2E-I: the orchestrate button runs the real orchestrator.voicingPlan tool
   * and the resulting call is visible on the agent tool timeline.
   */
  test("orchestrate panel triggers a real orchestrator.voicingPlan timeline call", async ({
    page,
  }) => {
    // 1. Open the Orchestrator tab and confirm the panel renders.
    await page.locator('[data-testid="tab-orchestrate"]').click();
    await expect(page.locator('[data-testid="orchestrate-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="orchestrator-panel"]')).toBeVisible();

    // 2. A fresh panel has no players selected, so the run button is hidden.
    await expect(page.locator('[data-testid="orchestrator-run"]')).toHaveCount(0);

    // 3. Pick a preset to fill the player list; the run button appears.
    await page.locator('[data-testid="orchestrator-preset-string_quartet"]').click();
    await expect(page.locator('[data-testid="orchestrator-run"]')).toBeVisible();

    // 4. Fire the orchestration.
    await page.locator('[data-testid="orchestrator-run"]').click();

    // 5. The orchestrate flow does not auto-switch tabs; the timeline lives on
    //    the Agent tab, so navigate there.
    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="tool-call-timeline"]')).toBeVisible();

    // 6. The real orchestrator.voicingPlan call lands on the timeline (the
    //    handler resolves asynchronously, so poll for the card).
    const items = page.locator('[data-testid="tool-call-item"]');
    await expect.poll(async () => items.count()).toBeGreaterThanOrEqual(1);
    await expect(
      items.first().locator('[data-testid="tool-call-name"]'),
    ).toHaveText("orchestrator.voicingPlan");
    await expect(page.locator('[data-testid="tool-call-empty"]')).toHaveCount(0);
  });

  /**
   * E2E-J: the running -> success pair of one orchestrate call is upserted by
   * correlationId into a single timeline card (tool-call-count exactly "1").
   */
  test("running+success of one orchestrate call merge into a single timeline card", async ({
    page,
  }) => {
    // 1. Fresh session: confirm the timeline starts empty BEFORE triggering
    //    the call (toolCalls are not persisted across reloads).
    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="tool-call-timeline"]')).toBeVisible();
    await expect(page.locator('[data-testid="tool-call-count"]')).toHaveText("0");

    // 2. Trigger exactly one orchestration on the Orchestrator tab.
    await page.locator('[data-testid="tab-orchestrate"]').click();
    await expect(page.locator('[data-testid="orchestrator-panel"]')).toBeVisible();
    await page.locator('[data-testid="orchestrator-preset-string_quartet"]').click();
    await expect(page.locator('[data-testid="orchestrator-run"]')).toBeVisible();
    await page.locator('[data-testid="orchestrator-run"]').click();

    // 3. Back to the Agent tab: the running record was dispatched
    //    synchronously, so the count is already 1; the success record
    //    upserts in place. Wait until the success summary replaces the
    //    hardcoded "执行中" running summary, proving the pair has merged.
    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="tool-call-timeline"]')).toBeVisible();
    const items = page.locator('[data-testid="tool-call-item"]');
    await expect
      .poll(async () => items.count())
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(async () =>
        page.locator('[data-testid="tool-call-summary"]').first().innerText(),
      )
      .not.toContain("执行中");

    // 4. Upsert guarantee: exactly ONE card for the single invocation (a
    //    broken append-only timeline would show two).
    await expect(page.locator('[data-testid="tool-call-count"]')).toHaveText("1");
    await expect(items).toHaveCount(1);
    await expect(
      items.first().locator('[data-testid="tool-call-name"]'),
    ).toHaveText("orchestrator.voicingPlan");
  });
});
