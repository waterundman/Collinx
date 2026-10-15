import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgentChat } from "../AgentChat";
import { I18nProvider } from "../../../providers/I18nProvider";
import { ProjectProvider } from "../../../providers/ProjectProvider";
import { SettingsContext, type SettingsContextValue } from "../../../contexts/SettingsContext";
import { DEFAULT_SETTINGS } from "../../../types/settings";
import { useProjectStore } from "../../../hooks/useProjectStore";
import type { ProjectStoreValue } from "../../../store/project-store";

/**
 * v2.4.0 S3/S4：AgentChat 真实 LLM 化后的行为契约。
 *
 * 旧契约（rule-based 硬编码回复 + AgentBus 往返）已被替换，本文件保护新语义：
 *  - 未配置密钥：不发请求，给出可操作提示，不污染工具时间线
 *  - 已配置：真实 chat/completions 请求，回复上屏，时间线 running→success 单卡
 *  - LLM 返回 tool_calls：经真实 ToolRegistry 执行，提案进入 pendingDiffs（AI↔工程闭环）
 *  - 错误按 kind 分类提示（401 → 密钥提示，而非笼统错误）
 */

function makeSettings(apiKey: string, stream = false): SettingsContextValue {
  const settings = {
    ...DEFAULT_SETTINGS,
    agent: {
      ...DEFAULT_SETTINGS.agent,
      llm: { ...DEFAULT_SETTINGS.agent.llm, apiKey, stream },
    },
  };
  return {
    settings,
    updateCategory: () => {},
    updateSettings: () => {},
    resetCategory: () => {},
    resetAll: () => {},
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function completion(content: string) {
  return { model: "deepseek-chat", choices: [{ message: { role: "assistant", content } }] };
}

function renderChat(apiKey: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  let current: ProjectStoreValue | null = null;

  function Probe() {
    current = useProjectStore();
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <SettingsContext.Provider value={makeSettings(apiKey)}>
          <ProjectProvider title="Chat Test">
            <AgentChat agentName="HarmonyBot" />
            <Probe />
          </ProjectProvider>
        </SettingsContext.Provider>
      </I18nProvider>
    );
  });

  const submit = (text: string) => {
    act(() => {
      const input = container.querySelector('[data-testid="agent-chat-input"]') as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )!.set!;
      setter.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      const form = container.querySelector('[data-testid="agent-chat-form"]') as HTMLFormElement;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  };

  const waitFor = async (fn: () => boolean, ms = 3000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (fn()) return true;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 10));
      });
    }
    return fn();
  };

  return {
    get store(): ProjectStoreValue {
      if (!current) throw new Error("Store not initialized");
      return current;
    },
    container,
    submit,
    waitFor,
    text: () => container.textContent ?? "",
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("AgentChat 未配置模型", () => {
  it("T01: 未配置密钥时不发请求,给出可操作提示(不再返回假回复) (critical)", async () => {
    // 本机 .env.local 可能注入了 VITE_DEEPSEEK_API_KEY，这里显式清空以模拟"未配置"。
    vi.stubEnv("VITE_DEEPSEEK_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const chat = renderChat("");
    chat.submit("帮我写一个动机");
    const shown = await chat.waitFor(() => /No API key configured/i.test(chat.text()));
    expect(shown).toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
    // 硬编码假回复彻底消失
    expect(chat.text()).not.toContain("Rule-based response");
    // 未配置时不产生 agent.chat 时间线记录（没有真实往返）
    expect(chat.store.toolCalls.filter((r) => r.toolName === "agent.chat").length).toBe(0);
    chat.cleanup();
  });
});

describe("AgentChat 真实 LLM 往返", () => {
  it("T02: 回复上屏 + 时间线 running→success 单卡 + 参数含模型 (critical)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(completion("建议 C-Am-F-G")));
    vi.stubGlobal("fetch", fetchMock);

    const chat = renderChat("sk-test");
    expect(chat.store.toolCalls.length).toBe(0);

    chat.submit("帮我建议一个和声进行");
    const ok = await chat.waitFor(() =>
      chat.store.toolCalls.some((r) => r.toolName === "agent.chat" && r.status === "success")
    );
    expect(ok).toBe(true);

    // 请求真的打到了 chat/completions，且体里带模型与温度
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe("deepseek-chat");
    expect(body.stream).toBe(false);
    expect(JSON.stringify(body)).not.toContain("sk-test");

    await chat.waitFor(() => chat.text().includes("建议 C-Am-F-G"));
    expect(chat.text()).toContain("建议 C-Am-F-G");

    const cards = chat.store.toolCalls.filter((r) => r.toolName === "agent.chat");
    expect(cards.length).toBe(1);
    expect(cards[0].status).toBe("success");
    expect((cards[0].params as Record<string, unknown>).prompt).toBe("帮我建议一个和声进行");
    expect(typeof cards[0].correlationId).toBe("string");
    chat.cleanup();
  });

  it("T03: 多轮对话把历史一并发给模型(第二轮含前一轮 assistant 回复)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(completion("第一轮回答")))
      .mockResolvedValueOnce(jsonResponse(completion("第二轮回答")));
    vi.stubGlobal("fetch", fetchMock);

    const chat = renderChat("sk-test");
    chat.submit("第一个问题");
    await chat.waitFor(() => chat.text().includes("第一轮回答"));
    chat.submit("第二个问题");
    await chat.waitFor(() => chat.text().includes("第二轮回答"));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    const roles = secondBody.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(secondBody.messages[2].content).toContain("第一轮回答");
    chat.cleanup();
  });

  it("T04: 401 归类为密钥问题,提示可操作而非笼统报错 (critical)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "Authentication Fails" } }, 401));
    vi.stubGlobal("fetch", fetchMock);

    const chat = renderChat("sk-bad");
    chat.submit("你好");
    const ok = await chat.waitFor(() =>
      chat.store.toolCalls.some((r) => r.toolName === "agent.chat" && r.status === "error")
    );
    expect(ok).toBe(true);
    // 测试环境 i18n 解析为 en-US，故断言英文文案（同时验证不是笼统错误）
    await chat.waitFor(() => /Invalid API key/i.test(chat.text()));
    expect(chat.text()).toMatch(/Invalid API key/i);
    chat.cleanup();
  });
});

describe("AI ↔ 工程图闭环", () => {
  it("T05: LLM 返回 tool_calls → 真实工具执行 → 提案进入待审批队列 (critical)", async () => {
    // 第一轮：模型要求调用 arranger.expandSection（proposal_only，产出 DiffEnvelope）；第二轮：模型总结
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          model: "deepseek-chat",
          choices: [
            {
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "arranger_expandSection", arguments: '{"bars":4,"style":"pop"}' },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse(completion("已给出编排建议。")));
    vi.stubGlobal("fetch", fetchMock);

    const chat = renderChat("sk-test");
    expect(chat.store.pendingDiffs.length).toBe(0);

    chat.submit("把这个段落扩展成完整编曲");
    const got = await chat.waitFor(() => chat.store.pendingDiffs.length > 0, 8000);
    if (!got) {
      // eslint-disable-next-line no-console
      console.log(
        "DIAG pendingDiffs=",
        chat.store.pendingDiffs.length,
        "toolCalls=",
        JSON.stringify(chat.store.toolCalls.map((r) => ({ n: r.toolName, s: r.status, m: r.resultSummary }))),
        "text=",
        chat.text()
      );
    }
    expect(chat.store.pendingDiffs.length).toBeGreaterThan(0);
    // 工具调用进入了时间线
    expect(chat.store.toolCalls.some((r) => r.toolName === "arranger.expandSection")).toBe(true);
    // 回复里告知用户去审批，而不是宣称已改工程
    const told = await chat.waitFor(() => /proposal/i.test(chat.text()));
    expect(told).toBe(true);

    // 第二轮请求把 tool 结果回灌给模型（role: tool）
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      messages: Array<{ role: string }>;
    };
    expect(secondBody.messages.some((m) => m.role === "tool")).toBe(true);
    chat.cleanup();
  }, 30000);
});
