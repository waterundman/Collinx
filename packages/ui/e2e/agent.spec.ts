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

  test("should display pending diffs", async ({ page }) => {
    const pending = page.locator('[data-testid="agent-panel-pending"]');
    const diffCards = pending.locator('[data-testid^="diff-card-"]');
    const count = await diffCards.count();
    expect(count).toBeGreaterThan(0);
  });

  test("should display the panel count", async ({ page }) => {
    const count = page.locator('[data-testid="agent-panel-count"]');
    await expect(count).toBeVisible();
  });
});
