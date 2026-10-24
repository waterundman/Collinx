import { test, expect, type Route } from "@playwright/test";

/**
 * E2E-L: LLM 聊天链路的 e2e 桩（v2.9.1）。
 *
 * 此前真实对话没有任何自动化覆盖：聊天要么走真 API（需要密钥、不稳定、费钱），
 * 要么完全没人测。这里用 Playwright 拦截 `/chat/completions`，返回一段
 * **标准 SSE**（delta.content 分片 + [DONE]），从而在 CI 里确定性地验证：
 * 配置读取 → 请求发出 → 流式解析 → 消息上屏 → 时间线记录。
 *
 * 不覆盖：真实模型质量、tool_calls 分片累加（已有单测覆盖解析器）。
 */
const SETTINGS_KEY = "collinx_settings";
const BASE_URL = "https://llm.stub.test/v1";

function sse(chunks: string[]): string {
  // OpenAI 兼容流：每个 data: 一行 JSON，最后 [DONE]
  return (
    chunks
      .map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
      .join("") + "data: [DONE]\n\n"
  );
}

test.describe("E2E-L: Agent chat with stubbed SSE", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([key, baseURL]) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            agent: {
              llm: {
                provider: "custom",
                apiKey: "test-key",
                baseURL,
                model: "stub-model",
                temperature: 0,
                stream: true,
              },
            },
          }),
        );
      },
      [SETTINGS_KEY, BASE_URL],
    );
  });

  test("streamed reply is rendered and the call is recorded", async ({ page }) => {
    let requestBody = "";

    await page.route("**/chat/completions", async (route: Route) => {
      requestBody = route.request().postData() ?? "";
      await route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream; charset=utf-8" },
        body: sse(["你好", "，我是", "测试模型"]),
      });
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[data-testid="tab-agent"]').click();
    await expect(page.locator('[data-testid="agent-layout"]')).toBeVisible();

    await page.locator('[data-testid="agent-chat-input"]').fill("写一个动机");
    await page.locator('[data-testid="agent-chat-send"]').click();

    const messages = page.locator('[data-testid="agent-chat-messages"]');
    await expect(messages).toContainText("写一个动机");
    await expect(messages).toContainText("你好，我是测试模型");

    // 请求确实发出去了，且带上了我们配置的模型（证明配置读取链路通了）
    expect(requestBody).toContain("stub-model");
    // 工具清单仍在请求里（system prompt 不硬编码工具，靠 tools 字段传入）
    expect(requestBody).toContain('"tools"');

    await expect(page.locator('[data-testid="tool-call-name"]').first()).toHaveText("agent.chat");
  });
});
