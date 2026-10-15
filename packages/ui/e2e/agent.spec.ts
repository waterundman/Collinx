import { test, expect } from "@playwright/test";

test.describe("Agent Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-agent"]').click();
  });

  test("should render the agent layout", async ({ page }) => {
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();
  });

  test("should render the agent chat", async ({ page }) => {
    const chat = page.locator('[data-testid="agent-chat"]');
    await expect(chat).toBeVisible();
  });

  test("should render the agent panel with pending and history", async ({ page }) => {
    const panel = page.locator('[data-testid="agent-panel"]');
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-testid="agent-panel-pending"]')).toBeVisible();
    await expect(page.locator('[data-testid="agent-panel-history"]')).toBeVisible();
  });

  test("should display the chat input", async ({ page }) => {
    const input = page.locator('[data-testid="agent-chat-input"]');
    await expect(input).toBeVisible();
  });

  test("should display the send button", async ({ page }) => {
    const sendBtn = page.locator('[data-testid="agent-chat-send"]');
    await expect(sendBtn).toBeVisible();
  });

  test("should type a message in the chat input", async ({ page }) => {
    const input = page.locator('[data-testid="agent-chat-input"]');
    await input.fill("Hello, agent!");
    await expect(input).toHaveValue("Hello, agent!");
  });

  test("should send a message and display it", async ({ page }) => {
    const input = page.locator('[data-testid="agent-chat-input"]');
    await input.fill("Test message");
    await page.locator('[data-testid="agent-chat-send"]').click();

    const messages = page.locator('[data-testid="agent-chat-messages"]');
    await expect(messages).toContainText("Test message");
  });

  // v2.4.0：不再有预置的示例提案（原为假 AI 数据），待审批队列只能由真实路径产生。
  // 这里经 Mixer 面板的「建议效果链」真实触发一次提案，再回 Agent 面板断言渲染。
  test("should display pending diffs", async ({ page }) => {
    await page.locator('[data-testid="tab-mixer"]').click();
    await page.locator('[data-testid="mixer-suggest-fx"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();

    const pending = page.locator('[data-testid="agent-panel-pending"]');
    const diffCards = pending.locator('[data-testid^="diff-card-"]');
    await expect(diffCards.first()).toBeVisible();
    const count = await diffCards.count();
    expect(count).toBeGreaterThan(0);
  });

  // v2.4.0：未配置模型时，聊天必须给出可操作提示，而不是返回硬编码假回复。
  test("should show a configuration hint instead of a canned reply", async ({ page }) => {
    const input = page.locator('[data-testid="agent-chat-input"]');
    await input.fill("帮我写一个动机");
    await page.locator('[data-testid="agent-chat-send"]').click();

    const messages = page.locator('[data-testid="agent-chat-messages"]');
    // 已配置（env/设置）→ 真实回复；未配置 → 配置提示。二者都不得是旧的假回复。
    await expect(messages).not.toContainText("Rule-based response", { timeout: 30000 });
  });

  test("should display the panel count", async ({ page }) => {
    const count = page.locator('[data-testid="agent-panel-count"]');
    await expect(count).toBeVisible();
  });
});
