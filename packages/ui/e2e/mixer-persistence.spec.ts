import { test, expect, type Page } from "@playwright/test";

/**
 * E2E-B: Mixer state persistence (v1.9.0 Stage 3).
 *
 * Locks the Stage 0 store-ization outcome for the mixer: changing a track's
 * gain writes through the project store (UPDATE_MIXER_TRACK), so the value
 * survives tab switches instead of being reset by a local component state.
 *
 * The gain fader is a custom div (mouse-drag based), so the test drags it to
 * roughly -6 dB using the same coordinates the component maps to gainDb.
 * `data-testid="mixer-fader-{trackId}"` / `mixer-gain-{trackId}` were added
 * in MixerConsole.tsx as minimal test-support hooks.
 */
test.describe("E2E-B: Mixer state persistence", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-mixer"]').click();
    await expect(page.locator('[data-testid="mixer-layout"]')).toBeVisible();
  });

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

  /** Parses the dB number out of a fader value display like "+0.0" / "-6.0". */
  async function readGainDb(page: Page): Promise<number> {
    const text = (await page.locator('[data-testid^="mixer-gain-"]').first().textContent()) ?? "";
    return Number.parseFloat(text.replace(/[^\d.-]/g, ""));
  }

  test("gain change persists across tab switches", async ({ page }) => {
    const gain = page.locator('[data-testid^="mixer-gain-"]').first();

    // Default fader position is unity (0 dB).
    await expect(gain).toHaveText("+0.0");

    // Drag the first track's fader to roughly -6 dB.
    await dragFaderToDb(page, -6);
    await expect(gain).not.toHaveText("+0.0");
    const changedDb = await readGainDb(page);
    expect(Math.abs(changedDb + 6)).toBeLessThan(0.5);
    const changedText = (await gain.textContent()) ?? "";

    // Switch to another tab and back — the value must survive.
    await page.locator('[data-testid="tab-compose"]').click();
    await expect(page.locator('[data-testid="compose-layout"]')).toBeVisible();
    await page.locator('[data-testid="tab-mixer"]').click();
    await expect(page.locator('[data-testid="mixer-layout"]')).toBeVisible();

    await expect(page.locator('[data-testid^="mixer-gain-"]').first()).toHaveText(
      changedText,
    );
  });
});
