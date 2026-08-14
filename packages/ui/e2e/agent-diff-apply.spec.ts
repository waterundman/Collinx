import { test, expect, type Page } from "@playwright/test";

/**
 * E2E-A: Agent diff apply flow (v1.9.0 Stage 3).
 *
 * Locks the real Agent proposal pipeline end to end:
 *  1. ProjectProvider pre-seeds 2 pending proposals ("Add a chorus phrase...",
 *     "Add a bass fill in bar 2").
 *  2. Applying a pending diff removes it from the pending list and moves it
 *     into the applied/history list.
 *  3. Applying the add_note_group proposal ("bass fill") actually mutates the
 *     project store, so the note count rendered in the compose tab increases.
 *
 * Selectors follow the repo convention (data-testid) and are locale-independent.
 */
test.describe("E2E-A: Agent diff apply flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();
  });

  /** Reads the leading number from the app header status text. */
  async function headerCount(page: Page): Promise<number> {
    const text = (await page.locator('[data-testid="header-status"]').textContent()) ?? "";
    const m = text.match(/\d+/);
    return m ? Number(m[0]) : -1;
  }

  test("applying a pending diff moves the card to history", async ({ page }) => {
    const pending = page.locator('[data-testid="agent-panel-pending"]');
    const history = page.locator('[data-testid="agent-panel-history"]');
    const pendingCards = pending.locator('[data-testid^="diff-card-"]');

    // ProjectProvider pre-seeds 2 proposals.
    await expect(pendingCards).toHaveCount(2);
    expect(await headerCount(page)).toBe(2);

    // Apply the first proposal ("Add a chorus phrase to the arrangement").
    const firstCard = pendingCards.first();
    await firstCard.locator('[data-testid^="diff-apply-"]').click();

    // Pending shrinks by one, the card appears in history as "applied".
    await expect(pendingCards).toHaveCount(1);
    const historyCards = history.locator('[data-testid^="diff-card-"]');
    await expect(historyCards).toHaveCount(1);
    await expect(historyCards.first()).toContainText("applied");
    expect(await headerCount(page)).toBe(1);
  });

  test("applying the add_note_group proposal increases the note count", async ({
    page,
  }) => {
    // The second pre-seeded proposal is "Add a bass fill in bar 2" (one
    // add_note_group op). It should visibly change the compose view.
    const pending = page.locator('[data-testid="agent-panel-pending"]');
    const pendingCards = pending.locator('[data-testid^="diff-card-"]');
    await expect(pendingCards).toHaveCount(2);

    // Baseline note count rendered in the compose tab header.
    await page.locator('[data-testid="tab-compose"]').click();
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
    const notesBefore = await headerCount(page);
    expect(notesBefore).toBeGreaterThan(0);

    // Apply the bass-fill proposal from the agent panel.
    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();
    await pendingCards.nth(1).locator('[data-testid^="diff-apply-"]').click();
    await expect(pendingCards).toHaveCount(1);

    // The compose view now renders one more note.
    await page.locator('[data-testid="tab-compose"]').click();
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
    const notesAfter = await headerCount(page);
    expect(notesAfter).toBe(notesBefore + 1);
  });
});
