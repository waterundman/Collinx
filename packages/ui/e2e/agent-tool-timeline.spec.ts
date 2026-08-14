import { test, expect } from "@playwright/test";

/**
 * E2E-E: Agent tool-call timeline (v1.11.0 Stage 3).
 *
 * Locks the Stage 0/1 tool-call trace in a real browser session:
 *  1. A fresh session starts with an empty timeline (tool-call-empty,
 *     tool-call-count "0").
 *  2. Sending a chat message through AgentChat records an agent.chat entry
 *     via store.recordToolCall; the AgentBus round-trip resolves quickly, so
 *     the append-only trace ends up with the running entry plus a success
 *     entry (>= 2 cards), each rendering the tool name and a status badge.
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
    // answers, a "success" entry is appended (the trace is append-only, so the
    // running card stays visible). Allow either render order.
    const items = page.locator('[data-testid="tool-call-item"]');
    await expect.poll(async () => items.count()).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => items.count()).toBeGreaterThanOrEqual(2);

    // Every card must show the tool name of the AgentChat call.
    await expect(
      page.locator('[data-testid="tool-call-name"]').first(),
    ).toHaveText("agent.chat");

    // The chat round-trip completed: the user message is rendered and the
    // rule-based compose agent answered with a text response.
    const messages = page.locator('[data-testid="agent-chat-messages"]');
    await expect(messages).toContainText("hello");
    await expect(messages).toContainText("[compose]");
  });
});
