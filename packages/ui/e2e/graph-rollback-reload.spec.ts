import { test, expect, type Page } from "@playwright/test";

const PERSISTENCE_KEY = "collinx.project.v1";

/**
 * E2E-G: Graph rollback survives a page reload (v1.12.0 Stage 3).
 *
 * Locks the Stage 0 persistence of the DiffEngine rollback chain in a real
 * browser session:
 *  1. Applying the pre-seeded "Add a bass fill in bar 2" proposal
 *     (one add_note_group op) increases the note count in the compose header.
 *  2. The debounced (500ms) localStorage write lands with the applied diff
 *     AND the DiffEngine rollback snapshot (rollbackToken -> graph JSON),
 *     so the rollback chain survives the refresh.
 *  3. After reload the graph still carries the bass note (applied state is
 *     restored) and the Agent Panel history renders the applied card WITH a
 *     rollback button (DiffCard shows it for status "applied" whenever
 *     diff.rollbackToken exists - the envelope field persists with
 *     appliedDiffs).
 *  4. Clicking the rollback button routes through ROLLBACK_DIFF ->
 *     diffEngine.rollback, which rehydrates the pre-apply snapshot imported
 *     from persisted.rollbackSnapshots, so the note disappears again.
 *
 * Selectors follow the repo data-testid convention and are locale-independent
 * (numbers parsed out of header-status, diff-rollback-* prefix match).
 */
test.describe("E2E-G: Graph rollback across reload", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  /** Reads the leading number from the app header status text. */
  async function headerCount(page: Page): Promise<number> {
    const text =
      (await page.locator('[data-testid="header-status"]').textContent()) ?? "";
    const m = text.match(/\d+/);
    return m ? Number(m[0]) : -1;
  }

  /**
   * Waits until the debounced persistence write contains both the applied
   * diff history and at least one DiffEngine rollback snapshot. Stage 0
   * guarantees the snapshot map is exported alongside appliedDiffs, so this
   * is the precondition for a successful post-reload rollback.
   */
  async function waitForRollbackPersisted(page: Page): Promise<void> {
    await page.waitForFunction(
      ({ key }: { key: string }) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        try {
          const data = JSON.parse(raw) as {
            appliedDiffs?: unknown[];
            rollbackSnapshots?: Record<string, unknown>;
          };
          return (
            (data.appliedDiffs?.length ?? 0) >= 1 &&
            Object.keys(data.rollbackSnapshots ?? {}).length >= 1
          );
        } catch {
          return false;
        }
      },
      { key: PERSISTENCE_KEY },
    );
  }

  test("applied graph diff is still rollable-back after a reload", async ({
    page,
  }) => {
    // 1. Baseline note count on the compose tab.
    await page.locator('[data-testid="tab-compose"]').click();
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
    const notesBefore = await headerCount(page);
    expect(notesBefore).toBeGreaterThan(0);

    // 2. Apply the bass-fill proposal (pending card #2, one add_note_group).
    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();
    const pendingCards = page
      .locator('[data-testid="agent-panel-pending"]')
      .locator('[data-testid^="diff-card-"]');
    await expect(pendingCards).toHaveCount(2);
    await pendingCards.nth(1).locator('[data-testid^="diff-apply-"]').click();
    await expect(pendingCards).toHaveCount(1);

    // 3. The compose view shows one more note.
    await page.locator('[data-testid="tab-compose"]').click();
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
    await expect.poll(async () => headerCount(page)).toBe(notesBefore + 1);

    // 4. Let the debounced localStorage write (appliedDiffs + rollback
    //    snapshots) land before reloading.
    await waitForRollbackPersisted(page);

    // 5. Reload: the applied state must be restored (notes still +1).
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="header-status"]')).toBeVisible();
    await page.locator('[data-testid="tab-compose"]').click();
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
    await expect.poll(async () => headerCount(page)).toBe(notesBefore + 1);

    // 6. The Agent Panel history still renders the applied card AND its
    //    rollback button after the refresh (Stage 0 restored both the
    //    appliedDiffs history and the DiffEngine snapshot map).
    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();
    const history = page.locator('[data-testid="agent-panel-history"]');
    const historyCards = history.locator('[data-testid^="diff-card-"]');
    await expect(historyCards).toHaveCount(1);
    await expect(historyCards.first()).toContainText("applied");
    const rollbackButton = historyCards
      .first()
      .locator('[data-testid^="diff-rollback-"]');
    await expect(rollbackButton).toBeVisible();

    // 7. Roll back: the history empties and the graph loses the bass note.
    await rollbackButton.click();
    await expect(historyCards).toHaveCount(0);
    await page.locator('[data-testid="tab-compose"]').click();
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
    await expect.poll(async () => headerCount(page)).toBe(notesBefore);
  });
});
