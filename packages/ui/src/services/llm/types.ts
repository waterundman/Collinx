/**
 * v2.4.0 S1：LLM 抽象层类型。
 * 采用 OpenAI 兼容协议（DeepSeek / OpenAI / 自定义端点均适用）。
 */

export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface LlmToolCall {
  id: string;
  name: string;
  /** 原始 JSON 字符串（未解析），解析失败由调用方处理 */
  arguments: string;
}

export interface LlmMessage {
  role: LlmRole;
  content: string | null;
  name?: string;
  toolCalls?: LlmToolCall[];
  toolCallId?: string;
}

export interface LlmToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * 错误分类：UI 据此给出可操作提示（而不是笼统"出错了"）。
 * - config     未配置 API 密钥
 * - auth       密钥无效 / 无权限
 * - rate_limit 限流
 * - network    网络不可达
 * - bad_request 请求体被拒（模型名错误等）
 * - server     上游 5xx
 * - aborted    用户取消
 */
export type LlmErrorKind =
  | "config"
  | "auth"
  | "rate_limit"
  | "network"
  | "bad_request"
  | "server"
  | "aborted"
  | "unknown";

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmChatResult {
  content: string;
  toolCalls: LlmToolCall[];
  finishReason: string | null;
  model: string;
  usage?: LlmUsage;
}

export interface LlmCallOptions {
  tools?: LlmToolSchema[];
  signal?: AbortSignal;
  /** 流式文本增量回调；提供时且 config.stream 为真才走 SSE */
  onDelta?: (delta: string) => void;
  maxTokens?: number;
}

export interface LlmProviderConfig {
  provider: "deepseek" | "openai" | "custom";
  apiKey: string;
  baseURL: string;
  model: string;
  temperature: number;
  stream: boolean;
}

export class LlmError extends Error {
  kind: LlmErrorKind;
  status?: number;

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = status;
  }
}
