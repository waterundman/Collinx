import { test, expect } from "@playwright/test";

/**
 * E2E-H: Real mixing tool call visible in the timeline (v1.12.0 Stage 3).
 *
 * Locks the Stage 1 ToolRegistry wiring in a real browser session:
 *  1. A fresh session starts with an empty tool timeline.
 *  2. Clicking "AI 建议 FX 链" (mixer-suggest-fx) runs actions.suggestMixingChain,
 *     which enqueues a mixer proposal into pendingDiffs AND routes the real
 *     `mixing.suggestChain` tool call through the shared ToolRegistry
 *     (registerBuiltinTools), then jumps to the Agent tab
 *     (handleSuggestFxChain -> setActiveTab("agent")).
 *  3. ToolRegistry.call emits a "running" record synchronously and a
 *     "success" record once the handler resolves. Both share one
 *     correlationId (v1.13.0 Stage 2), so RECORD_TOOL_CALL upserts them into a
 *     single timeline card — the trace shows exactly ONE mixing.suggestChain
 *     entry, not two.
 *
 * Selectors follow the repo data-testid convention and are locale-independent
 * (toolName "mixing.suggestChain" and the numeric tool-call-count, not
 * localized status text).
 */
test.describe("E2E-H: Mixer suggest-fx tool timeline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("mixing.suggestChain appears as a real tool call in the timeline", async ({
    page,
  }) => {
    // 1. Fresh session: the timeline is empty before any tool call.
    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();
    await expect(page.locator('[data-testid="tool-call-timeline"]')).toBeVisible();
    await expect(page.locator('[data-testid="tool-call-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="tool-call-count"]')).toHaveText("0");

    // 2. Trigger the Mixing Agent proposal from the mixer header.
    await page.locator('[data-testid="tab-mixer"]').click();
    await expect(page.locator('[data-testid="mixer-layout"]')).toBeVisible();
    await page.locator('[data-testid="mixer-suggest-fx"]').click();

    // 3. The provider jumps to the Agent tab automatically.
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();

    // 4. The pending list gains the mixer proposal (2 demo + 1 mixer).
    const pendingCards = page
      .locator('[data-testid="agent-panel-pending"]')
      .locator('[data-testid^="diff-card-"]');
    await expect(pendingCards).toHaveCount(3);
    await expect(
      pendingCards.filter({ hasText: "Mix suggestion" }),
    ).toHaveCount(1);

    // 5. The real mixing.suggestChain call is on the timeline. The "running"
    //    record is recorded synchronously, the "success" record once the
    //    handler resolves; both share one correlationId, so v1.13.0 Stage 2
    //    upserts them into a single card (count stays exactly 1, never 2).
    const items = page.locator('[data-testid="tool-call-item"]');
    await expect
      .poll(async () => items.count())
      .toBeGreaterThanOrEqual(1);
    await expect(page.locator('[data-testid="tool-call-count"]')).toHaveText("1");
    await expect(page.locator('[data-testid="tool-call-empty"]')).toHaveCount(0);

    // Every card must carry the real tool name (no empty-state card mixed in).
    for (let i = 0; i < (await items.count()); i++) {
      await expect(
        items.nth(i).locator('[data-testid="tool-call-name"]'),
      ).toHaveText("mixing.suggestChain");
    }
  });
});
