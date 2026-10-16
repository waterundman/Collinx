/**
 * v2.4.0 S4：Agent 工具循环 —— 让 LLM 真正能改动工程。
 *
 * 闭环：用户消息 → LLM（带工具 schema）→ tool_calls → ToolRegistry 执行
 *      → 提案 DiffEnvelope 入队 pendingDiffs → 工具结果回灌 LLM → 最终文本。
 *
 * 关键约束：
 * - OpenAI 的 function name 只允许 [a-zA-Z0-9_-]，而本仓工具名含点号
 *   （`composer.generateMotif`），因此必须做双向映射，否则请求被 400 拒绝。
 * - 工具执行结果一律标注为「待用户审批的提案」，不得声称已写入工程。
 */
import { chatCompletion } from "./deepseek";
import type {
  LlmChatResult,
  LlmMessage,
  LlmProviderConfig,
  LlmToolSchema,
} from "./types";

/** 与 packages/core 的 ToolDefinition 结构对齐的最小只读视图（避免 ui → core 深耦合）。 */
export interface AgentToolParameterLike {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface AgentToolDefinitionLike {
  name: string;
  description: string;
  parameters: AgentToolParameterLike[];
  /**
   * v2.6.0：工具权限（proposal_only / read_only）。存在于 core 的 ToolDefinition，
   * 但此前从未传给模型 —— 模型无从判断"这次调用有没有改工程"，于是把只读
   * 分析说成"已生成提案"。listTools 侧会把它拼进 description，这里保留原值
   * 供 UI 展示与测试断言。
   */
  permission?: string;
}

export interface AgentToolOutcome {
  ok: boolean;
  data?: unknown;
  error?: string;
  /** 该次调用产生并已入队待审批的提案数量 */
  diffCount: number;
}

export interface AgentToolExecutor {
  list(): AgentToolDefinitionLike[];
  execute(name: string, args: Record<string, unknown>): Promise<AgentToolOutcome>;
}

export interface AgentToolInvocation extends AgentToolOutcome {
  name: string;
  args: Record<string, unknown>;
}

export interface AgentLoopResult {
  content: string;
  toolInvocations: AgentToolInvocation[];
  messages: LlmMessage[];
  rounds: number;
  usage?: LlmChatResult["usage"];
}

export interface AgentLoopOptions {
  config: LlmProviderConfig;
  messages: LlmMessage[];
  executor: AgentToolExecutor;
  systemPrompt: string;
  /** 最大工具轮数，防止模型反复调用同一工具死循环 */
  maxRounds?: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onToolCall?: (invocation: AgentToolInvocation) => void;
}

const FUNCTION_NAME_SAFE = /[^a-zA-Z0-9_-]/g;

/** `composer.generateMotif` → `composer_generateMotif`（LLM 侧合法函数名） */
export function toFunctionName(toolName: string): string {
  return toolName.replace(/\./g, "_").replace(FUNCTION_NAME_SAFE, "_");
}

export function toolsToSchema(defs: AgentToolDefinitionLike[]): LlmToolSchema[] {
  return defs.map((def) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of def.parameters) {
      properties[p.name] = { type: p.type, description: p.description };
      if (p.required) required.push(p.name);
    }
    return {
      type: "function",
      function: {
        name: toFunctionName(def.name),
        description: def.description,
        parameters: {
          type: "object",
          properties,
          required,
          additionalProperties: false,
        } as unknown as Record<string, unknown>,
      },
    };
  });
}

export const AGENT_SYSTEM_PROMPT = [
  "你是 Collinx 的编曲助手，直接在用户的音乐工程上工作。",
  "可用工具能生成动机、和声进行、编排方案、配器方案、效果链建议等。",
  "",
  "规则：",
  "1. 当用户要求生成/编排/配器/混音建议时，**必须**调用相应工具，不要只描述。",
  "2. 工具的产物是「提案（DiffEnvelope）」，需要用户在 Agent 面板确认后才会写入工程。回复时明确告诉用户：已生成 N 条待审批提案，请到 Agent 面板审批。",
  "3. 工具失败时如实说明失败原因，不要编造结果。",
  "4. 解释音乐决策时给结论 + 理由 + 一个可替换方案，避免空话。",
  "5. 用与用户相同的语言回复。",
  "6. 不要声称你已经修改了工程数据——你只能提交提案。",
  // v2.6.0：工具描述里已标注【可产出提案】/【只读分析】，这里再给一条判定规则。
  // 此前 14 个工具的权限（proposal_only / read_only）只存在于 core 的元数据里，
  // 从未传给模型 → 模型无法判断"这次调用到底改了工程没有"，容易把只读分析
  // 说成"已生成提案"，或把提案说成"已改好"。
  "7. 依据工具描述尾部的标注判断：标【只读分析】的工具**不会**产出提案，回复里不要说「已生成提案」；标【可产出提案】的工具若返回 proposalsEnqueued=0，也要如实说「未产出提案」，不要含糊成「已完成」。",
].join("\n");

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function describeOutcome(invocation: AgentToolInvocation): string {
  if (!invocation.ok) {
    return JSON.stringify({ status: "error", message: invocation.error ?? "执行失败" });
  }
  return JSON.stringify({
    status: "ok",
    proposalsEnqueued: invocation.diffCount,
    note:
      invocation.diffCount > 0
        ? "提案已加入待审批队列，用户确认后才会写入工程"
        : "无提案产出",
    data: invocation.data ?? null,
  });
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { config, executor, systemPrompt, signal, onDelta, onToolCall } = options;
  const maxRounds = options.maxRounds ?? 3;

  const defs = executor.list();
  const tools = defs.length > 0 ? toolsToSchema(defs) : undefined;
  const nameByFunction = new Map(defs.map((d) => [toFunctionName(d.name), d.name]));

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    ...options.messages,
  ];

  const toolInvocations: AgentToolInvocation[] = [];
  let rounds = 0;

  while (rounds < maxRounds) {
    rounds += 1;
    const result = await chatCompletion(config, messages, {
      tools,
      signal,
      onDelta,
    });

    if (result.toolCalls.length === 0) {
      messages.push({ role: "assistant", content: result.content });
      return {
        content: result.content,
        toolInvocations,
        messages,
        rounds,
        usage: result.usage,
      };
    }

    messages.push({
      role: "assistant",
      content: result.content.length > 0 ? result.content : null,
      toolCalls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      const toolName = nameByFunction.get(call.name) ?? call.name;
      const args = parseToolArguments(call.arguments);
      let outcome: AgentToolOutcome;
      try {
        outcome = await executor.execute(toolName, args);
      } catch (err) {
        outcome = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          diffCount: 0,
        };
      }
      const invocation: AgentToolInvocation = { ...outcome, name: toolName, args };
      toolInvocations.push(invocation);
      onToolCall?.(invocation);

      messages.push({
        role: "tool",
        name: toolName,
        toolCallId: call.id,
        content: describeOutcome(invocation),
      });
    }
  }

  // 轮数用尽：用最后一次的文本（可能为空）收尾
  const last = messages.filter((m) => m.role === "assistant").pop();
  return {
    content: last?.content ?? "",
    toolInvocations,
    messages,
    rounds,
  };
}
