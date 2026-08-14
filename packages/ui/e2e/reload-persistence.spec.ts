import { test, expect, type Page } from "@playwright/test";

const PERSISTENCE_KEY = "collinx.project.v1";

/**
 * E2E-D: Cross-refresh persistence (v1.10.0 Stage 3).
 *
 * Locks the Stage 1 storage envelope under a real browser reload:
 *  1. Mixer edits write through UPDATE_MIXER_TRACK into the persisted
 *     envelope (collinx.project.v1); a page reload restores mixer.gainDb.
 *  2. Note edits (ADD_NOTE on the ProjectGraph) survive a reload through the
 *     serialized graphJson, so the compose view shows the same note count.
 *
 * Persistence is enabled under the dev server (import.meta.env.MODE !==
 * "test" -> PROJECT_PERSISTENCE_KEY), and the provider debounces writes by
 * 500ms, so each test waits for the real localStorage payload before
 * reloading.
 */
test.describe("E2E-D: Reload persistence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  /** Parses the leading number out of the header status text. */
  async function headerCount(page: Page): Promise<number> {
    const text =
      (await page.locator('[data-testid="header-status"]').textContent()) ?? "";
    const m = text.match(/\d+/);
    return m ? Number(m[0]) : -1;
  }

  /** Drags the first channel-strip fader to an approximate gain value (dB). */
  async function dragFaderToDb(page: Page, targetDb: number): Promise<void> {
    const fader = page.locator('[data-testid^="mixer-fader-"]').first();
    await expect(fader).toBeVisible();
    const box = await fader.boundingBox();
    if (!box) throw new Error("mixer fader has no bounding box");
    // db = -60 + (pct / 100) * 66  =>  pct = (db + 60) / 66 * 100
    const pct = (targetDb + 60) / 66;
    const x = box.x + box.width / 2;
    const startY = box.y + box.height * 0.9;
    const targetY = box.y + box.height * (1 - pct);
    await page.mouse.move(x, startY);
    await page.mouse.down();
    await page.mouse.move(x, targetY, { steps: 10 });
    await page.mouse.up();
  }

  /** Waits until the debounced write has landed in localStorage. */
  async function waitForPersistence(page: Page, hasGain: boolean): Promise<void> {
    await page.waitForFunction(
      ({ key, gain }: { key: string; gain: boolean }) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return false;
        try {
          const data = JSON.parse(raw) as {
            graphJson?: string;
            mixer?: { tracks?: Array<{ gainDb?: string }> };
          };
          if (!data.graphJson) return false;
          if (!gain) return true;
          const g = data.mixer?.tracks?.[0]?.gainDb;
          return typeof g === "string" && g !== "0";
        } catch {
          return false;
        }
      },
      { key: PERSISTENCE_KEY, gain: hasGain },
    );
  }

  test("gain edit survives a page reload", async ({ page }) => {
    await page.locator('[data-testid="tab-mixer"]').click();
    await expect(page.locator('[data-testid="mixer-layout"]')).toBeVisible();

    const gain = page.locator('[data-testid^="mixer-gain-"]').first();
    await expect(gain).toHaveText("+0.0");

    // Drag the first track's fader to roughly -6 dB.
    await dragFaderToDb(page, -6);
    await expect(gain).not.toHaveText("+0.0");
    const changedText = (await gain.textContent()) ?? "";
    expect(changedText).not.toBe("");

    // Let the debounced (500ms) localStorage write land before reloading.
    await waitForPersistence(page, true);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-mixer"]').click();
    await expect(page.locator('[data-testid="mixer-layout"]')).toBeVisible();
    await expect(
      page.locator('[data-testid^="mixer-gain-"]').first(),
    ).toHaveText(changedText);
  });

  test("note addition survives a page reload", async ({ page }) => {
    await page.locator('[data-testid="tab-compose"]').click();
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();

    const notesBefore = await headerCount(page);
    expect(notesBefore).toBeGreaterThan(0);

    // Draw a note by double-clicking empty canvas space. The demo notes only
    // cover bars 1-3, so hitting 60% across / 30% down the canvas adds a note.
    const canvas = page.locator('[data-testid="piano-roll-canvas"]');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("piano roll canvas has no bounding box");
    await canvas.dblclick({
      position: { x: box.width * 0.6, y: box.height * 0.3 },
    });

    await expect
      .poll(async () => headerCount(page))
      .toBe(notesBefore + 1);

    // Let the debounced graphJson write land, then reload.
    await waitForPersistence(page, false);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator('[data-testid="header-status"]')).toBeVisible();
    await expect
      .poll(async () => headerCount(page))
      .toBe(notesBefore + 1);
  });
});
