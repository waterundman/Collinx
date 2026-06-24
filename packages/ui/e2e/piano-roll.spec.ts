import { test, expect } from "@playwright/test";

test.describe("Piano Roll", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("should render the piano roll canvas in compose tab", async ({ page }) => {
    const canvas = page.locator('[data-testid="piano-roll-canvas"]');
    await expect(canvas).toBeVisible();
  });

  test("should render the piano roll toolbar", async ({ page }) => {
    const toolbar = page.locator('[data-testid="piano-roll-toolbar"]');
    await expect(toolbar).toBeVisible();
  });

  test("should have select and draw mode buttons", async ({ page }) => {
    await expect(page.locator('[data-testid="piano-roll-select"]')).toBeVisible();
    await expect(page.locator('[data-testid="piano-roll-draw"]')).toBeVisible();
  });

  test("should have quantize selector", async ({ page }) => {
    const quantize = page.locator('[data-testid="piano-roll-quantize"]');
    await expect(quantize).toBeVisible();
    await expect(quantize).toHaveValue("1/4");
  });

  test("should toggle between select and draw modes", async ({ page }) => {
    const selectBtn = page.locator('[data-testid="piano-roll-select"]');
    const drawBtn = page.locator('[data-testid="piano-roll-draw"]');

    await drawBtn.click();
    await expect(drawBtn).toHaveClass(/active/i);

    await selectBtn.click();
    await expect(selectBtn).toHaveClass(/active/i);
  });

  test("should change quantize value", async ({ page }) => {
    const quantize = page.locator('[data-testid="piano-roll-quantize"]');
    await quantize.selectOption("1/8");
    await expect(quantize).toHaveValue("1/8");
  });

  test("should zoom in and out", async ({ page }) => {
    const zoomIn = page.locator('[data-testid="piano-roll-zoom-in"]');
    const zoomOut = page.locator('[data-testid="piano-roll-zoom-out"]');

    await expect(zoomIn).toBeVisible();
    await expect(zoomOut).toBeVisible();

    await zoomIn.click();
    await zoomOut.click();
  });

  test("should render the piano keyboard on the left", async ({ page }) => {
    const pianoRoll = page.locator('[data-testid="piano-roll"]');
    await expect(pianoRoll).toBeVisible();
    const text = await pianoRoll.innerText();
    expect(text).toContain("C");
  });

  test("should render the timeline at the bottom", async ({ page }) => {
    const pianoRoll = page.locator('[data-testid="piano-roll"]');
    await expect(pianoRoll).toBeVisible();
    const text = await pianoRoll.innerText();
    expect(text).toContain("1");
  });
});
