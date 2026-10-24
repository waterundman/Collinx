import { test, expect, type Page } from "@playwright/test";

/**
 * E2E-A: 提案应用 / 回滚流程（真实产品路径）。
 *
 * 历史：本 spec 原先依赖 `ProjectProvider` 预置的 2 条 demo 提案
 * （"Add a chorus phrase…" / "Add a bass fill…"）。那些种子在 v2.4.0 已从生产
 * 代码移除（避免假 AI 数据），于是断言 `toHaveCount(2)` 长期为红。
 *
 * v2.9.1 改写为**不依赖 LLM** 的真实提案来源：编排器（Arranger）的
 * 「生成变体」会产出 4 条真实 DiffEnvelope 入队（实测）。
 */
test.describe("E2E-A: proposal apply / rollback", () => {
  /** 生成一批真实提案并跳到 Agent 面板 */
  async function generateProposals(page: Page) {
    await page.locator('[data-testid="tab-arrange"]').click();
    await expect(page.locator('[data-testid="arrange-layout"]')).toBeVisible();
    await page.locator('[data-testid="arranger-generate"]').click();

    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();
  }

  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("applying a proposal moves the card from pending to history", async ({ page }) => {
    await generateProposals(page);

    const pendingCards = page
      .locator('[data-testid="agent-panel-pending"]')
      .locator('[data-testid^="diff-card-"]');
    const historyCards = page
      .locator('[data-testid="agent-panel-history"]')
      .locator('[data-testid^="diff-card-"]');

    const total = await pendingCards.count();
    expect(total).toBeGreaterThan(0);

    await pendingCards.first().locator('[data-testid^="diff-apply-"]').click();

    await expect(pendingCards).toHaveCount(total - 1);
    await expect(historyCards).toHaveCount(1);
    await expect(historyCards.first()).toContainText("applied");
  });

  test("rollback returns the applied proposal to nothing-applied", async ({ page }) => {
    await generateProposals(page);

    const pendingCards = page
      .locator('[data-testid="agent-panel-pending"]')
      .locator('[data-testid^="diff-card-"]');
    const historyCards = page
      .locator('[data-testid="agent-panel-history"]')
      .locator('[data-testid^="diff-card-"]');

    await pendingCards.first().locator('[data-testid^="diff-apply-"]').click();
    await expect(historyCards).toHaveCount(1);

    await historyCards.first().locator('[data-testid^="diff-rollback-"]').click();
    await expect(historyCards).toHaveCount(0);
  });
});
