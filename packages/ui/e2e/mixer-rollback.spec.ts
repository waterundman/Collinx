import { test, expect } from "@playwright/test";

/**
 * E2E-C: Mixer proposal rollback (v1.10.0 Stage 3).
 *
 * Locks the Stage 0 mixer rollback contract end to end:
 *  1. "AI 建议 FX 链" (mixer-suggest-fx) runs the real MixingAgent via
 *     actions.suggestMixingChain(), enqueues a mixer proposal into
 *     pendingDiffs and jumps to the Agent tab (handleSuggestFxChain).
 *  2. Applying the proposal routes through APPLY_DIFF's isMixerDiff branch:
 *     diffToMixer rewrites gainDb/pan and installs FX chains, and a pre-apply
 *     mixer snapshot is stored under the diff's rollbackToken
 *     (mixerRollbackSnapshots).
 *  3. The Agent Panel history renders diff-rollback-* for applied cards;
 *     ROLLBACK_DIFF restores the mixer snapshot exactly, so gains AND FX go
 *     back to the pre-proposal state.
 *
 * Selectors follow the repo data-testid convention. The first channel strip
 * is the melody track (createDemoMixer order): the MixingAgent targets it at
 * -3.0 dB, so the value goes +0.0 -> -3.0 on apply and back to +0.0 on
 * rollback.
 */
test.describe("E2E-C: Mixer proposal rollback", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-mixer"]').click();
    await expect(page.locator('[data-testid="mixer-layout"]')).toBeVisible();
  });

  test("apply then rollback of a mixer proposal restores the mixer", async ({
    page,
  }) => {
    const strips = page.locator('[data-testid="mixer-strips"]');
    const firstGain = page.locator('[data-testid^="mixer-gain-"]').first();

    // Baseline: unity gain on the first strip (melody), no FX slots.
    await expect(firstGain).toHaveText("+0.0");
    await expect(strips).not.toContainText("EQ");

    // 1. Trigger the Mixing Agent proposal from the mixer header.
    await page.locator('[data-testid="mixer-suggest-fx"]').click();

    // The provider jumps to the Agent tab automatically.
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();

    // 2. The pending list gains the mixer proposal (2 demo + 1 mixer).
    const pending = page.locator('[data-testid="agent-panel-pending"]');
    const pendingCards = pending.locator('[data-testid^="diff-card-"]');
    await expect(pendingCards).toHaveCount(3);

    const mixerCard = pendingCards.filter({ hasText: "Mix suggestion" });
    await expect(mixerCard).toHaveCount(1);

    // 3. Apply the proposal: it leaves pending and lands in history.
    await mixerCard.locator('[data-testid^="diff-apply-"]').click();
    await expect(pendingCards).toHaveCount(2);
    await expect(
      pendingCards.filter({ hasText: "Mix suggestion" }),
    ).toHaveCount(0);

    const history = page.locator('[data-testid="agent-panel-history"]');
    const historyCards = history.locator('[data-testid^="diff-card-"]');
    await expect(historyCards).toHaveCount(1);
    await expect(historyCards.first()).toContainText("applied");

    // 4. The mixer visibly changed: melody gain -3.0 dB, FX chains installed.
    await page.locator('[data-testid="tab-mixer"]').click();
    await expect(page.locator('[data-testid="mixer-layout"]')).toBeVisible();
    await expect(firstGain).toHaveText("-3.0");
    await expect(strips).toContainText("EQ");

    // 5. Roll back from the Agent Panel history.
    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();
    await historyCards
      .first()
      .locator('[data-testid^="diff-rollback-"]')
      .click();
    await expect(historyCards).toHaveCount(0);

    // 6. Mixer restored to the pre-proposal state.
    await page.locator('[data-testid="tab-mixer"]').click();
    await expect(page.locator('[data-testid="mixer-layout"]')).toBeVisible();
    await expect(firstGain).toHaveText("+0.0");
    await expect(strips).not.toContainText("EQ");
  });
});
