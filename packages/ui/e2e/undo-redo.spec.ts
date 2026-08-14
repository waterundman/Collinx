import { test, expect, type Page } from "@playwright/test";

/**
 * E2E-F: Undo/redo note edits (v1.11.0 Stage 3).
 *
 * Locks the Stage 2 composite undo/redo keyboard shortcuts in the browser:
 *  1. Double-clicking blank piano-roll space adds a note (compose header
 *     count goes up by one).
 *  2. Ctrl+Z undoes the edit (the composite snapshot restores the graph, so
 *     the note disappears and the count returns to its baseline).
 *  3. Ctrl+Shift+Z redoes it (the note comes back).
 *
 * The global shortcut hook excludes text-editing targets, so each shortcut is
 * issued only after clicking the non-editable canvas, keeping focus outside
 * any input/textarea.
 */
test.describe("E2E-F: Undo/redo note edits", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-compose"]').click();
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
  });

  /** Reads the leading number from the app header status text. */
  async function headerCount(page: Page): Promise<number> {
    const text =
      (await page.locator('[data-testid="header-status"]').textContent()) ?? "";
    const m = text.match(/\d+/);
    return m ? Number(m[0]) : -1;
  }

  test("Ctrl+Z undoes an added note and Ctrl+Shift+Z redoes it", async ({
    page,
  }) => {
    const notesBefore = await headerCount(page);
    expect(notesBefore).toBeGreaterThan(0);

    const canvas = page.locator('[data-testid="piano-roll-canvas"]');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("piano roll canvas has no bounding box");

    // Draw a note by double-clicking blank canvas space (same approach as
    // reload-persistence.spec.ts: demo notes only cover bars 1-3, so a click
    // at 60% across / 30% down lands on empty space).
    await canvas.dblclick({
      position: { x: box.width * 0.6, y: box.height * 0.3 },
    });
    await expect.poll(async () => headerCount(page)).toBe(notesBefore + 1);

    // Move focus to the non-editable canvas so the global Ctrl+Z handler (not
    // the native text undo) runs.
    await canvas.click({ position: { x: 8, y: 8 } });

    // Ctrl+Z -> the added note disappears again.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => headerCount(page)).toBe(notesBefore);

    // Ctrl+Shift+Z -> the note comes back.
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(async () => headerCount(page)).toBe(notesBefore + 1);
  });
});
