import { randomUUID } from "../util/random-uuid";
import type { DiffEnvelope, Actor, PermissionScope } from "../diff/diff-envelope";
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
  artifacts?: { type: string; ref: string }[];
  confidence?: number;
  requiresUserConfirmation: boolean;
  auditRef: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  permission: ToolPermission;
  parameters: ToolParameter[];
  handler: (params: Record<string, unknown>) => Promise<ToolResult>;
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
    actor: Actor
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
      let result = await tool.handler(params);

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
