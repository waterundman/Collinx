import { randomUUID } from "../util/random-uuid";
import type { DiffEnvelope, Actor, PermissionScope } from "../diff/diff-envelope";

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

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private auditTrail: AuditEntry[] = [];

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
    const tool = this.tools.get(name);
    if (!tool) {
      const errorResult: ToolResult = {
        status: "error",
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
        data: `Tool "${name}" not found`,
      };
      this.recordAudit(name, params, errorResult, actor.name);
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
      return errorResult;
    }

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
      return result;
    } catch (err) {
      const errorResult: ToolResult = {
        status: "error",
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
        data: err instanceof Error ? err.message : String(err),
      };
      this.recordAudit(name, params, errorResult, actor.name);
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
