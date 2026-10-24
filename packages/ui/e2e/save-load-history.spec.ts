import { test, expect } from "@playwright/test";

/**
 * E2E-F: 应用历史随工程存档往返（v2.9.1）。
 *
 * 历史：`graph-rollback-reload.spec` 曾断言「刷新后仍可回滚」，但产品并不做
 * 会话持久化（刷新即回 demo），该断言的前提从来不存在，spec 已于 v2.9.1 删除。
 *
 * 真实受支持的路径是 **.agentmusic 存档往返**：saveProjectAsAgentMusic 会写
 * appliedDiffs + rollbackSnapshots，load 时 restoreDiffHistory 重建历史。
 * 本 spec 锁定这条路径 —— 若它断了，用户「存盘 → 重开 → 撤销上次提案」
 * 的能力就没了。刷新恢复属于另一条（崩溃恢复）路径，不在此覆盖。
 */
test.describe("E2E-F: proposal history survives save/load", () => {
  test("applied proposal is still rollback-able after reload via .agentmusic", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 1. 用编排器产生真实提案（不依赖 LLM），应用其中一条。
    await page.locator('[data-testid="tab-arrange"]').click();
    await page.locator('[data-testid="arranger-generate"]').click();
    await page.locator('[data-testid="tab-agent"]').click();
    const pending = page
      .locator('[data-testid="agent-panel-pending"]')
      .locator('[data-testid^="diff-card-"]');
    await expect(pending.first()).toBeVisible();
    await pending.first().locator('[data-testid^="diff-apply-"]').click();

    const history = page
      .locator('[data-testid="agent-panel-history"]')
      .locator('[data-testid^="diff-card-"]');
    await expect(history).toHaveCount(1);

    // 2. 存盘（真实下载）。
    const downloadPromise = page.waitForEvent("download");
    await page.locator('[data-testid="save-project"]').click();
    const download = await downloadPromise;
    const savedPath = await download.path();
    expect(savedPath).toBeTruthy();

    // 3. 刷新回到干净会话，再加载存档。
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator('[data-testid="agent-panel-history"]')).toHaveCount(0);

    await page.locator('[data-testid="project-file-input"]').setInputFiles(savedPath!);
    await page.waitForLoadState("networkidle");

    // 4. 历史与应用结果都在，且可以回滚。
    await page.locator('[data-testid="tab-agent"]').click();
    const restoredHistory = page
      .locator('[data-testid="agent-panel-history"]')
      .locator('[data-testid^="diff-card-"]');
    await expect(restoredHistory).toHaveCount(1);
    await expect(restoredHistory.first()).toContainText("applied");

    await restoredHistory.first().locator('[data-testid^="diff-rollback-"]').click();
    await expect(restoredHistory).toHaveCount(0);
  });
});
