import { test, expect } from "@playwright/test";

/**
 * E2E-E: Agent tool-call timeline (v1.11.0 Stage 3, v1.14.0 Stage 2 single-card).
 *
 * Locks the Stage 0/1 tool-call trace in a real browser session:
 *  1. A fresh session starts with an empty timeline (tool-call-empty,
 *     tool-call-count "0").
 *  2. Sending a chat message through AgentChat records an agent.chat entry
 *     via store.recordToolCall with a correlationId minted once per round-trip.
 *     The AgentBus round-trip resolves quickly, so the running entry is
 *     upserted to success in place — exactly ONE card renders (the timeline
 *     is single-card per correlationId since v1.14.0 Stage 2).
 *
 * Selectors follow the repo convention (data-testid) and are locale-
 * independent (toolName "agent.chat" and the item count, not localized text).
 */
test.describe("E2E-E: Agent tool-call timeline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();
  });

  test("timeline starts empty on a fresh session", async ({ page }) => {
    await expect(page.locator('[data-testid="tool-call-timeline"]')).toBeVisible();
    await expect(page.locator('[data-testid="tool-call-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="tool-call-count"]')).toHaveText("0");
  });

  test("sending a chat message appends an agent.chat timeline entry", async ({
    page,
  }) => {
    // Fresh page, so the timeline is empty before we send anything.
    await expect(page.locator('[data-testid="tool-call-empty"]')).toBeVisible();

    await page.locator('[data-testid="agent-chat-input"]').fill("hello");
    await page.locator('[data-testid="agent-chat-send"]').click();

    // The request records a "running" entry synchronously; once the AgentBus
    // answers, the running card is upserted to success via the shared
    // correlationId (v1.14.0 Stage 2), so exactly ONE card renders.
    const items = page.locator('[data-testid="tool-call-item"]');
    await expect.poll(async () => items.count()).toBe(1);

    // Every card must show the tool name of the AgentChat call.
    await expect(
      page.locator('[data-testid="tool-call-name"]').first(),
    ).toHaveText("agent.chat");

    // 用户消息已渲染。v2.4.0 起聊天走真实 LLM（无密钥时只会显示错误提示），
    // 因此不再断言 "[compose]" 这类本地规则回复 —— 那属于已删除的旧实现。
    const messages = page.locator('[data-testid="agent-chat-messages"]');
    await expect(messages).toContainText("hello");
  });
});
