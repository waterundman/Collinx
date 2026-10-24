import { randomUUID } from "../util/random-uuid";
import type { DiffEnvelope, Actor, PermissionScope } from "../diff/diff-envelope";
import type { ProjectGraph } from "../graph/project-graph";
import {
  createToolCallRecord,
  type ToolCallRecord,
  type NewToolCallRecord,
} from "./tool-call";

export type ToolPermission = PermissionScope;

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
  default?: unknown;
}

export interface ToolResult {
  status: "ok" | "error";
  resultType?: "proposal" | "data" | "confirmation";
  data?: unknown;
  diff?: DiffEnvelope;
  /**
   * v2.9.1：多提案结果（配器/变体/分谱等一次产出多个 DiffEnvelope）。
   *
   * 此前工具层在运行时挂 `diffs`，但类型里没有这个字段 —— UI 侧只能
   * `(result as { diffs?: unknown }).diffs as DiffEnvelope[]` 强转，
   * 字段名写错（diffs/diff 混用）编译器完全不管。现在收进契约。
   */
  diffs?: DiffEnvelope[];
  artifacts?: { type: string; ref: string }[];
  confidence?: number;
  requiresUserConfirmation: boolean;
  auditRef: string;
}

/**
 * 只读图视图 —— 工具只能读，不能改。
 *
 * 只挑读方法，不暴露 addNode/removeNode/withMeta 等写方法：
 * 所有对工程的修改必须走 DiffEnvelope（可审批、可审计、可回滚），
 * 这是本项目"AI 只能提案不能直接改"的根基。
 */
export type ReadonlyGraphView = Pick<
  ProjectGraph,
  "getMeta" | "getNode" | "getNodesByType" | "getRevisionId"
>;

/**
 * v2.8.0：工具的可选运行时上下文。
 *
 * 存在的原因：所有只读能力（统计工程、查当前速度、列轨道）都需要读图，
 * 而 handler 原先只有 params —— 于是 AI 只能回答「我没有查询工具」。
 * 注入只读视图后，这类能力才能实现，同时不破坏可审计性。
 */
export interface ToolContext {
  readGraph?: () => ReadonlyGraphView;
  /**
   * v2.9.0：只读混音快照。
   *
   * 混音状态（推子/静音/独奏/声像/FX）不在 ProjectGraph 里，只存在于
   * UI 的 `MixerState`。此前工具层拿不到它，AI 对混音完全盲——
   * 用户说「把贝斯静音」，模型只能凭猜测回答。
   */
  readMixer?: () => import("../model/audio-routes").MixerSnapshot;
}

export interface ToolDefinition {
  name: string;
  description: string;
  permission: ToolPermission;
  parameters: ToolParameter[];
  handler: (params: Record<string, unknown>, ctx?: ToolContext) => Promise<ToolResult>;
}

export interface AuditEntry {
  auditRef: string;
  toolName: string;
  params: Record<string, unknown>;
  result: ToolResult;
  timestamp: string;
  actorName: string;
}

/**
 * Options accepted by the ToolRegistry constructor. `onToolCall` is an
 * optional sink that receives a UI-facing ToolCallRecord for every invocation
 * that passes through `call()`: a "running" record once validation succeeds
 * and execution starts, then either a "success" or an "error" record with the
 * outcome. The running record and its outcome record share the same
 * `correlationId` (minted once per call), so a consumer may upsert the
 * in-flight record in place rather than append two independent entries.
 * Failures before execution (unknown tool, failed parameter validation) emit
 * a single "error" record only.
 */
export interface ToolRegistryOptions {
  onToolCall?: (record: ToolCallRecord) => void;
}

/** Cap for the human-readable result summary produced for the timeline. */
const MAX_SUMMARY_LENGTH = 200;

function truncate(text: string): string {
  if (text.length <= MAX_SUMMARY_LENGTH) return text;
  return text.slice(0, MAX_SUMMARY_LENGTH) + "...";
}

/** Derives a short, human-readable summary from a ToolResult. */
function summarizeResult(result: ToolResult): string {
  const data = result.data;
  if (data === undefined || data === null) {
    return result.status;
  }
  if (typeof data === "string") {
    return truncate(data);
  }
  try {
    const json = JSON.stringify(data);
    return truncate(json ?? String(data));
  } catch {
    return truncate(String(data));
  }
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private auditTrail: AuditEntry[] = [];
  private onToolCall: ((record: ToolCallRecord) => void) | undefined;

  constructor(options: ToolRegistryOptions = {}) {
    this.onToolCall = options.onToolCall;
  }

  /** Replace the tool-call sink (e.g. after the UI store becomes available). */
  setOnToolCall(
    callback: ((record: ToolCallRecord) => void) | undefined
  ): void {
    this.onToolCall = callback;
  }

  private emitToolCall(record: NewToolCallRecord): void {
    if (!this.onToolCall) return;
    this.onToolCall(createToolCallRecord(record));
  }

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    if (!this.tools.has(name)) {
      throw new Error(`Tool "${name}" is not registered`);
    }
    this.tools.delete(name);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  listToolsByPermission(permission: ToolPermission): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(
      (t) => t.permission === permission
    );
  }

  async call(
    name: string,
    params: Record<string, unknown>,
    actor: Actor,
    /** 可选运行时上下文（只读图视图等）；不传时只读类工具会明确报错 */
    ctx?: ToolContext
  ): Promise<ToolResult> {
    // One correlationId per invocation: every ToolCallRecord this call emits
    // (running then success/error) shares it, so the UI store can upsert the
    // in-flight record in place instead of appending two independent entries.
    const correlationId = randomUUID();
    const tool = this.tools.get(name);
    if (!tool) {
      const errorResult: ToolResult = {
        status: "error",
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
        data: `Tool "${name}" not found`,
      };
      this.recordAudit(name, params, errorResult, actor.name);
      this.emitToolCall({
        toolName: name,
        params,
        resultSummary: summarizeResult(errorResult),
        status: "error",
        agentName: actor.name,
        correlationId,
      });
      return errorResult;
    }

    const validationError = this.validateParams(tool, params);
    if (validationError) {
      const errorResult: ToolResult = {
        status: "error",
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
        data: validationError,
      };
      this.recordAudit(name, params, errorResult, actor.name);
      this.emitToolCall({
        toolName: name,
        params,
        resultSummary: summarizeResult(errorResult),
        status: "error",
        agentName: actor.name,
        correlationId,
      });
      return errorResult;
    }

    // Execution is about to start: emit the in-flight record so the timeline
    // shows the call as running while the handler is awaited.
    this.emitToolCall({
      toolName: name,
      params,
      resultSummary: "执行中",
      status: "running",
      agentName: actor.name,
      correlationId,
    });

    try {
      let result = await tool.handler(params, ctx);

      if (!result.auditRef) {
        result = { ...result, auditRef: randomUUID() };
      }

      const isProposal = tool.permission === "proposal_only";
      if (result.requiresUserConfirmation === undefined) {
        result = { ...result, requiresUserConfirmation: isProposal };
      }

      this.recordAudit(name, params, result, actor.name);
      this.emitToolCall({
        toolName: name,
        params,
        resultSummary: summarizeResult(result),
        status: "success",
        agentName: actor.name,
        correlationId,
      });
      return result;
    } catch (err) {
      const errorResult: ToolResult = {
        status: "error",
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
        data: err instanceof Error ? err.message : String(err),
      };
      this.recordAudit(name, params, errorResult, actor.name);
      this.emitToolCall({
        toolName: name,
        params,
        resultSummary: summarizeResult(errorResult),
        status: "error",
        agentName: actor.name,
        correlationId,
      });
      return errorResult;
    }
  }

  private validateParams(
    tool: ToolDefinition,
    params: Record<string, unknown>
  ): string | null {
    for (const param of tool.parameters) {
      const value = params[param.name];
      if (param.required && (value === undefined || value === null)) {
        return `Missing required parameter: ${param.name}`;
      }
      if (value !== undefined && value !== null) {
        switch (param.type) {
          case "string":
            if (typeof value !== "string") {
              return `Parameter "${param.name}" must be a string`;
            }
            break;
          case "number":
            if (typeof value !== "number") {
              return `Parameter "${param.name}" must be a number`;
            }
            break;
          case "boolean":
            if (typeof value !== "boolean") {
              return `Parameter "${param.name}" must be a boolean`;
            }
            break;
          case "object":
            if (typeof value !== "object" || Array.isArray(value)) {
              return `Parameter "${param.name}" must be an object`;
            }
            break;
          case "array":
            if (!Array.isArray(value)) {
              return `Parameter "${param.name}" must be an array`;
            }
            break;
        }
      }
    }
    return null;
  }

  private recordAudit(
    toolName: string,
    params: Record<string, unknown>,
    result: ToolResult,
    actorName: string
  ): void {
    this.auditTrail.push({
      auditRef: result.auditRef,
      toolName,
      params,
      result,
      timestamp: new Date().toISOString(),
      actorName,
    });
  }

  getAuditTrail(): AuditEntry[] {
    return [...this.auditTrail];
  }

  getAuditByTool(toolName: string): AuditEntry[] {
    return this.auditTrail.filter((e) => e.toolName === toolName);
  }

  getAuditByActor(actorName: string): AuditEntry[] {
    return this.auditTrail.filter((e) => e.actorName === actorName);
  }

  clearAudit(): void {
    this.auditTrail = [];
  }
}
