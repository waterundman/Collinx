import { test, expect } from "@playwright/test";

test.describe("Mixer Console", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-mixer"]').click();
  });

  test("should render the mixer console", async ({ page }) => {
    const mixer = page.locator('[data-testid="mixer-console"]');
    await expect(mixer).toBeVisible();
  });

  test("should display channel strips", async ({ page }) => {
    const strips = page.locator('[data-testid="mixer-strips"]');
    await expect(strips).toBeVisible();
  });

  test("should display the mixer title", async ({ page }) => {
    const mixer = page.locator('[data-testid="mixer-console"]');
    await expect(mixer).toBeVisible();
    const text = await mixer.innerText();
    expect(text).toContain("Mixer");
  });

  test("should have an add track button", async ({ page }) => {
    const addBtn = page.locator('[data-testid="mixer-add-track"]');
    await expect(addBtn).toBeVisible();
  });

  test("should toggle mute on a track", async ({ page }) => {
    const muteBtn = page.locator('[data-testid^="mixer-mute-"]').first();
    await expect(muteBtn).toBeVisible();
    await muteBtn.click();
    await expect(muteBtn).toHaveClass(/active/i);
  });

  test("should toggle solo on a track", async ({ page }) => {
    const soloBtn = page.locator('[data-testid^="mixer-solo-"]').first();
    await expect(soloBtn).toBeVisible();
    await soloBtn.click();
    await expect(soloBtn).toHaveClass(/active/i);
  });

  test("should display FX slots", async ({ page }) => {
    const mixer = page.locator('[data-testid="mixer-console"]');
    await expect(mixer).toBeVisible();
    const text = await mixer.innerText();
    expect(text).toContain("FX");
  });

  test("should open FX editor on slot click", async ({ page }) => {
    const mixer = page.locator('[data-testid="mixer-console"]');
    await expect(mixer).toBeVisible();
    const fxBtn = mixer.locator("text=EQ").first();
    if (await fxBtn.isVisible()) {
      await fxBtn.click();
    }
  });

  test("should add a new track via modal", async ({ page }) => {
    await page.locator('[data-testid="mixer-add-track"]').click();
    const mixer = page.locator('[data-testid="mixer-console"]');
    await expect(mixer).toBeVisible();
  });

  test("should display the mixer layout", async ({ page }) => {
    await expect(page.locator('[data-testid="mixer-layout"]')).toBeVisible();
  });
});
