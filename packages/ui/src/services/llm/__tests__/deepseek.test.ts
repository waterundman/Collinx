import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  chatCompletion,
  listModels,
  resolveLlmApiKey,
  isLlmConfigured,
  LLM_PROVIDER_PRESETS,
} from "../deepseek";
import { toFunctionName, toolsToSchema } from "../agent-loop";
import { LlmError } from "../types";
import type { LlmProviderConfig } from "../types";

const BASE_CONFIG: LlmProviderConfig = {
  provider: "deepseek",
  apiKey: "sk-test",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-chat",
  temperature: 0.7,
  stream: false,
};

function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function mockStreamResponse(chunks: string[]): Response {
  let i = 0;
  const body = {
    getReader: () => ({
      read: async () =>
        i < chunks.length
          ? { done: false, value: asciiBytes(chunks[i++]) }
          : { done: true, value: undefined },
    }),
  };
  return { ok: true, status: 200, body } as unknown as Response;
}

function mockJsonResponse(json: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  } as unknown as Response;
}

function mockErrorResponse(status: number, message: string): Response {
  const body = JSON.stringify({ error: { message } });
  return {
    ok: false,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

function lastCallBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const calls = fetchMock.mock.calls;
  const init = calls[calls.length - 1][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("resolveLlmApiKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("配置的密钥优先于构建期环境变量", () => {
    vi.stubEnv("VITE_DEEPSEEK_API_KEY", "env-key");
    expect(resolveLlmApiKey("  config-key  ")).toBe("config-key");
  });

  it("配置为空时回落到环境变量", () => {
    vi.stubEnv("VITE_DEEPSEEK_API_KEY", "env-key");
    expect(resolveLlmApiKey("")).toBe("env-key");
    expect(resolveLlmApiKey("   ")).toBe("env-key");
  });

  it("isLlmConfigured 反映最终解析结果", () => {
    vi.stubEnv("VITE_DEEPSEEK_API_KEY", "");
    expect(isLlmConfigured(BASE_CONFIG)).toBe(true);
    expect(isLlmConfigured({ ...BASE_CONFIG, apiKey: "" })).toBe(false);
  });
});

describe("chatCompletion 非流式", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("解析 content / model / usage，且不把密钥写进请求体", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        model: "deepseek-chat",
        choices: [{ message: { role: "assistant", content: "你好" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })
    );

    const result = await chatCompletion(BASE_CONFIG, [{ role: "user", content: "hi" }]);

    expect(result.content).toBe("你好");
    expect(result.model).toBe("deepseek-chat");
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe("stop");
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });

    const body = lastCallBody(fetchMock);
    expect(body.stream).toBe(false);
    expect(body.model).toBe("deepseek-chat");
    expect(JSON.stringify(body)).not.toContain("sk-test");
  });

  it("解析非流式 tool_calls", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockJsonResponse({
        model: "deepseek-chat",
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "composer_generateMotif", arguments: '{"bars":2}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      })
    );

    const result = await chatCompletion(BASE_CONFIG, [{ role: "user", content: "写个动机" }]);

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("composer_generateMotif");
    expect(result.toolCalls[0].arguments).toBe('{"bars":2}');
    expect(result.finishReason).toBe("tool_calls");
  });

  it("tools 以 OpenAI schema 形式发出", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(mockJsonResponse({ choices: [{ message: { content: "ok" } }] }));

    await chatCompletion(BASE_CONFIG, [{ role: "user", content: "x" }], {
      tools: [
        {
          type: "function",
          function: { name: "composer_generateMotif", description: "d", parameters: { type: "object" } },
        },
      ],
    });

    const body = lastCallBody(fetchMock);
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tool_choice).toBe("auto");
  });
});

describe("chatCompletion 流式（SSE）", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("跨 chunk 断行被正确缓冲，onDelta 收到逐段文本", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // 第一帧被切成两半，验证缓冲逻辑
    fetchMock.mockResolvedValue(
      mockStreamResponse([
        'data: {"model":"deepseek-chat","choices":[{"delta":{"content":"Hel',
        'lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ])
    );

    const deltas: string[] = [];
    const result = await chatCompletion(
      { ...BASE_CONFIG, stream: true },
      [{ role: "user", content: "hi" }],
      { onDelta: (d) => deltas.push(d) }
    );

    expect(result.content).toBe("Hello world");
    expect(deltas).toEqual(["Hello", " world"]);
    expect(result.finishReason).toBe("stop");
  });

  it("流式 tool_calls 按 index 分片累加（id/name/arguments）", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockStreamResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"composer_gen","arguments":"{\\"bars\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"erateMotif","arguments":"2}"}}]},"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ])
    );

    const result = await chatCompletion(
      { ...BASE_CONFIG, stream: true },
      [{ role: "user", content: "x" }],
      { onDelta: () => {} }
    );

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].id).toBe("call_a");
    expect(result.toolCalls[0].name).toBe("composer_generateMotif");
    expect(result.toolCalls[0].arguments).toBe('{"bars":2}');
  });

  it("忽略心跳/空内容分片，不产生空 delta 回调", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockStreamResponse([
        'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
        "\n",
        'data: {"choices":[{"delta":{"content":"X"}}]}\n\ndata: [DONE]\n\n',
      ])
    );

    const deltas: string[] = [];
    const result = await chatCompletion(
      { ...BASE_CONFIG, stream: true },
      [{ role: "user", content: "x" }],
      { onDelta: (d) => deltas.push(d) }
    );

    expect(result.content).toBe("X");
    expect(deltas).toEqual(["X"]);
  });
});

describe("错误分类", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limit"],
    [400, "bad_request"],
    [500, "server"],
    [503, "server"],
  ])("HTTP %i → kind=%s", async (status, kind) => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(mockErrorResponse(status, `upstream ${status}`));

    await expect(chatCompletion(BASE_CONFIG, [{ role: "user", content: "x" }])).rejects.toMatchObject({
      name: "LlmError",
      kind,
      status,
    });
  });

  it("网络异常 → network", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(chatCompletion(BASE_CONFIG, [{ role: "user", content: "x" }])).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("AbortError → aborted", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    fetchMock.mockRejectedValue(abortErr);

    await expect(chatCompletion(BASE_CONFIG, [{ role: "user", content: "x" }])).rejects.toMatchObject({
      kind: "aborted",
    });
  });

  it("未配置密钥时抛 config 且**不发请求**", async () => {
    vi.stubEnv("VITE_DEEPSEEK_API_KEY", "");
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;

    await expect(
      chatCompletion({ ...BASE_CONFIG, apiKey: "" }, [{ role: "user", content: "x" }])
    ).rejects.toBeInstanceOf(LlmError);
    await expect(
      chatCompletion({ ...BASE_CONFIG, apiKey: "" }, [{ role: "user", content: "x" }])
    ).rejects.toMatchObject({ kind: "config" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("空模型名 → config", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    await expect(
      chatCompletion({ ...BASE_CONFIG, model: "" }, [{ role: "user", content: "x" }])
    ).rejects.toMatchObject({ kind: "config" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("baseURL 结尾斜杠被归一，不产生双斜杠路径", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(mockJsonResponse({ choices: [{ message: { content: "ok" } }] }));

    await chatCompletion({ ...BASE_CONFIG, baseURL: "https://api.deepseek.com/" }, [
      { role: "user", content: "x" },
    ]);

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/chat/completions");
  });

  it("baseURL 为空 → config", async () => {
    await expect(
      chatCompletion({ ...BASE_CONFIG, baseURL: "" }, [{ role: "user", content: "x" }])
    ).rejects.toMatchObject({ kind: "config" });
  });
});

describe("listModels", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("解析 data[].id 并过滤空值", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockJsonResponse({ object: "list", data: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }, {}] })
    );

    const models = await listModels(BASE_CONFIG);

    expect(models).toEqual(["deepseek-flash", "deepseek-v4-pro"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.deepseek.com/models");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("GET");
  });

  it("密钥无效 → auth", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(mockErrorResponse(401, "Authentication Fails"));

    await expect(listModels(BASE_CONFIG)).rejects.toMatchObject({ kind: "auth", status: 401 });
  });
});

describe("工具 schema 适配", () => {
  it("点号工具名映射为合法 function name 且可逆", () => {
    expect(toFunctionName("composer.generateMotif")).toBe("composer_generateMotif");
    expect(toFunctionName("arranger.expandSection")).toBe("arranger_expandSection");
    expect(toFunctionName("a.b-c_d")).toBe("a_b-c_d");
  });

  it("toolsToSchema 生成 object schema 与 required 列表", () => {
    const [schema] = toolsToSchema([
      {
        name: "composer.generateMotif",
        description: "生成旋律动机",
        parameters: [
          { name: "bars", type: "number", required: true, description: "小节数" },
          { name: "key", type: "string", required: false, description: "调性" },
        ],
      },
    ]);

    expect(schema.type).toBe("function");
    expect(schema.function.name).toBe("composer_generateMotif");
    const params = schema.function.parameters as { required: string[]; properties: Record<string, unknown> };
    expect(params.required).toEqual(["bars"]);
    expect(Object.keys(params.properties)).toEqual(["bars", "key"]);
  });

  it("provider 预设包含可用模型，供设置页下拉使用", () => {
    expect(LLM_PROVIDER_PRESETS.deepseek.models.length).toBeGreaterThan(0);
    expect(LLM_PROVIDER_PRESETS.deepseek.baseURL).toBe("https://api.deepseek.com");
  });
});
