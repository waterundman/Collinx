/**
 * v2.4.0 S1：OpenAI 兼容协议的 LLM 客户端（DeepSeek / OpenAI / 自定义端点）。
 *
 * 设计要点：
 * - 纯 fetch，无第三方 SDK（本仓不引运行时依赖）
 * - 错误一律归一为 LlmError（kind 供 UI 做分类提示）
 * - 流式解析对"跨 chunk 断行"、"tool_calls 分片累加"、"data: [DONE]" 都做处理
 * - 未配置密钥时**不发请求**，直接抛 config 错误
 */
import { LlmError } from "./types";
import type {
  LlmCallOptions,
  LlmChatResult,
  LlmMessage,
  LlmProviderConfig,
  LlmToolCall,
  LlmUsage,
} from "./types";

export interface LlmProviderPreset {
  label: string;
  baseURL: string;
  models: string[];
}

export const LLM_PROVIDER_PRESETS: Record<LlmProviderConfig["provider"], LlmProviderPreset> = {
  deepseek: {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  openai: {
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o"],
  },
  custom: {
    label: "自定义",
    baseURL: "",
    models: [],
  },
};

/** 设置里的密钥优先；为空时回落到构建期注入的 VITE_DEEPSEEK_API_KEY（供自动化测试/本地开发）。 */
export function resolveLlmApiKey(configuredKey: string): string {
  const configured = (configuredKey ?? "").trim();
  if (configured) return configured;
  const fromEnv = (import.meta.env?.VITE_DEEPSEEK_API_KEY ?? "") as string;
  return fromEnv.trim();
}

export function isLlmConfigured(config: LlmProviderConfig): boolean {
  return resolveLlmApiKey(config.apiKey).length > 0;
}

function normalizeBaseURL(baseURL: string): string {
  return (baseURL ?? "").trim().replace(/\/+$/, "");
}

function joinURL(baseURL: string, path: string): string {
  const base = normalizeBaseURL(baseURL);
  if (!base) {
    throw new LlmError("config", "未配置接口地址（baseURL）");
  }
  return `${base}${path}`;
}

interface ApiErrorBody {
  error?: { message?: string; type?: string };
  message?: string;
}

function classifyStatus(status: number): LlmError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  if (status >= 400) return "bad_request";
  return "unknown";
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const body = JSON.parse(text) as ApiErrorBody;
      const msg = body?.error?.message ?? body?.message;
      if (typeof msg === "string" && msg.length > 0) return msg;
    } catch {
      /* 非 JSON，落到原文 */
    }
    return text.slice(0, 300) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof DOMException && err.name === "AbortError") {
    return new LlmError("aborted", "请求已取消");
  }
  if (err instanceof Error && err.name === "AbortError") {
    return new LlmError("aborted", "请求已取消");
  }
  return new LlmError("network", err instanceof Error ? err.message : String(err));
}

function mapMessages(messages: LlmMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    const out: Record<string, unknown> = { role: m.role, content: m.content ?? "" };
    if (m.role === "tool" && m.toolCallId) out.tool_call_id = m.toolCallId;
    if (m.role === "tool" && m.name) out.name = m.name;
    if (m.toolCalls && m.toolCalls.length > 0) {
      out.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));
      if (m.content === null) out.content = null;
    }
    return out;
  });
}

function buildRequestBody(
  config: LlmProviderConfig,
  messages: LlmMessage[],
  options: LlmCallOptions | undefined,
  stream: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: mapMessages(messages),
    temperature: config.temperature,
    stream,
  };
  if (typeof options?.maxTokens === "number") body.max_tokens = options.maxTokens;
  if (options?.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = "auto";
  }
  return body;
}

interface StreamAccumulator {
  content: string;
  toolCalls: Map<number, { id: string; name: string; args: string }>;
  finishReason: string | null;
  model: string;
  usage?: LlmUsage;
}

function accumulateChunk(acc: StreamAccumulator, json: Record<string, unknown>): string {
  const choices = (json.choices ?? []) as Array<Record<string, unknown>>;
  if (typeof json.model === "string") acc.model = json.model;

  const usage = json.usage as Record<string, unknown> | undefined;
  if (usage) {
    acc.usage = {
      promptTokens: Number(usage.prompt_tokens ?? 0),
      completionTokens: Number(usage.completion_tokens ?? 0),
      totalTokens: Number(usage.total_tokens ?? 0),
    };
  }

  if (choices.length === 0) return "";
  const choice = choices[0];
  if (typeof choice.finish_reason === "string") acc.finishReason = choice.finish_reason;

  const delta = (choice.delta ?? {}) as Record<string, unknown>;
  let text = "";
  if (typeof delta.content === "string" && delta.content.length > 0) {
    text = delta.content;
    acc.content += text;
  }

  const toolCallDeltas = (delta.tool_calls ?? []) as Array<Record<string, unknown>>;
  for (const tc of toolCallDeltas) {
    const index = typeof tc.index === "number" ? tc.index : 0;
    const fn = (tc.function ?? {}) as Record<string, unknown>;
    const prev = acc.toolCalls.get(index) ?? { id: "", name: "", args: "" };
    // 与 openai-python 的 accumulate_delta 语义一致：除 index/type 外的字符串字段
    // 逐片**拼接**（首个分片给出 id/name，后续分片只带 arguments 增量）。
    acc.toolCalls.set(index, {
      id: prev.id + ((tc.id as string | undefined) ?? ""),
      name: prev.name + ((fn.name as string | undefined) ?? ""),
      args: prev.args + ((fn.arguments as string | undefined) ?? ""),
    });
  }
  return text;
}

/** 解析 SSE 缓冲：按空行分帧；返回 [帧内容, 剩余缓冲] */
function drainSseFrames(buffer: string): { frames: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  return { frames: parts, rest };
}

function framesToPayloads(frames: string[]): string[] {
  const payloads: string[] = [];
  for (const frame of frames) {
    for (const line of frame.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data.length === 0) continue;
      payloads.push(data);
    }
  }
  return payloads;
}

function finalizeStream(acc: StreamAccumulator): LlmChatResult {
  const toolCalls: LlmToolCall[] = [...acc.toolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v], i) => ({
      id: v.id || `call_${i}`,
      name: v.name,
      arguments: v.args,
    }));
  return {
    content: acc.content,
    toolCalls,
    finishReason: acc.finishReason,
    model: acc.model,
    usage: acc.usage,
  };
}

export async function chatCompletion(
  config: LlmProviderConfig,
  messages: LlmMessage[],
  options?: LlmCallOptions
): Promise<LlmChatResult> {
  const apiKey = resolveLlmApiKey(config.apiKey);
  if (!apiKey) {
    throw new LlmError("config", "未配置 API 密钥");
  }
  if (!config.model) {
    throw new LlmError("config", "未配置模型名");
  }

  const useStream = Boolean(config.stream && options?.onDelta);
  const url = joinURL(config.baseURL, "/chat/completions");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(config, messages, options, useStream)),
      signal: options?.signal,
    });
  } catch (err) {
    throw toLlmError(err);
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new LlmError(classifyStatus(res.status), message, res.status);
  }

  if (!useStream) {
    let json: Record<string, unknown>;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      throw toLlmError(err);
    }
    const choices = (json.choices ?? []) as Array<Record<string, unknown>>;
    const choice = choices[0] ?? {};
    const message = (choice.message ?? {}) as Record<string, unknown>;
    const rawToolCalls = (message.tool_calls ?? []) as Array<Record<string, unknown>>;
    const usage = json.usage as Record<string, unknown> | undefined;
    return {
      content: typeof message.content === "string" ? message.content : "",
      toolCalls: rawToolCalls.map((tc, i) => {
        const fn = (tc.function ?? {}) as Record<string, unknown>;
        return {
          id: (tc.id as string | undefined) ?? `call_${i}`,
          name: (fn.name as string | undefined) ?? "",
          arguments: (fn.arguments as string | undefined) ?? "{}",
        };
      }),
      finishReason: (choice.finish_reason as string | null) ?? null,
      model: (json.model as string | undefined) ?? config.model,
      usage: usage
        ? {
            promptTokens: Number(usage.prompt_tokens ?? 0),
            completionTokens: Number(usage.completion_tokens ?? 0),
            totalTokens: Number(usage.total_tokens ?? 0),
          }
        : undefined,
    };
  }

  if (!res.body) {
    throw new LlmError("unknown", "响应体为空，无法读取流");
  }

  const acc: StreamAccumulator = {
    content: "",
    toolCalls: new Map(),
    finishReason: null,
    model: config.model,
  };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = drainSseFrames(buffer);
      buffer = rest;
      for (const payload of framesToPayloads(frames)) {
        if (payload === "[DONE]") {
          return finalizeStream(acc);
        }
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(payload) as Record<string, unknown>;
        } catch {
          continue; // 忽略无法解析的片段
        }
        const delta = accumulateChunk(acc, json);
        if (delta) options?.onDelta?.(delta);
      }
    }
    // 收尾：处理未以空行结束的残帧（解析器已保证 buffer 内不含完整帧分隔）
    for (const payload of framesToPayloads([buffer])) {
      if (payload === "[DONE]") break;
      try {
        const json = JSON.parse(payload) as Record<string, unknown>;
        const delta = accumulateChunk(acc, json);
        if (delta) options?.onDelta?.(delta);
      } catch {
        /* 忽略 */
      }
    }
  } catch (err) {
    throw toLlmError(err);
  }

  return finalizeStream(acc);
}

export async function listModels(config: LlmProviderConfig): Promise<string[]> {
  const apiKey = resolveLlmApiKey(config.apiKey);
  if (!apiKey) {
    throw new LlmError("config", "未配置 API 密钥");
  }
  const url = joinURL(config.baseURL, "/models");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    throw toLlmError(err);
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    throw new LlmError(classifyStatus(res.status), message, res.status);
  }

  try {
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch (err) {
    throw toLlmError(err);
  }
}
