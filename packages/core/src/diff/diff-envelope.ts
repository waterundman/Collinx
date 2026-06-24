import { randomUUID } from "../util/random-uuid";
import type { ProjectMeta } from "../schema/graph-schema";
import type { NoteEvent } from "../model/note-event";

export type PermissionScope = "read_only" | "proposal_only" | "write_direct";

export type ActorType = "agent" | "user" | "system";

export interface Actor {
  type: ActorType;
  name: string;
  model?: string;
}

export type DiffOperation =
  | { op: "add_node"; path: string; nodeType: string; data: Record<string, unknown> }
  | { op: "remove_node"; path: string; nodeId: string }
  | { op: "update_node"; path: string; nodeId: string; data: Record<string, unknown> }
  | { op: "add_edge"; path: string; edgeType: string; sourceId: string; targetId: string; data?: Record<string, unknown> }
  | { op: "remove_edge"; path: string; edgeId: string }
  | { op: "update_meta"; path: string; data: Partial<ProjectMeta> }
  | { op: "add_note_group"; path: string; notes: NoteEvent[] };

export interface DomainExplanation {
  label: string;
  text: string;
}

export interface RiskFlag {
  type: string;
  severity: "low" | "medium" | "high";
  description: string;
}

export interface DiffEnvelope {
  diffId: string;
  baseRevision: string;
  actor: Actor;
  permissionScope: PermissionScope;
  summary: string;
  ops: DiffOperation[];
  domainExplanations: DomainExplanation[];
  evidenceRefs: string[];
  rollbackToken: string;
  riskFlags: RiskFlag[];
  createdAt: string;
}

export interface DiffValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface CreateDiffEnvelopeParams {
  baseRevision: string;
  actor: Actor;
  permissionScope: PermissionScope;
  summary: string;
  ops: DiffOperation[];
  domainExplanations?: DomainExplanation[];
  evidenceRefs?: string[];
  riskFlags?: RiskFlag[];
}

export function createDiffEnvelope(params: CreateDiffEnvelopeParams): DiffEnvelope {
  return {
    diffId: randomUUID(),
    baseRevision: params.baseRevision,
    actor: params.actor,
    permissionScope: params.permissionScope,
    summary: params.summary,
    ops: params.ops,
    domainExplanations: params.domainExplanations ?? [],
    evidenceRefs: params.evidenceRefs ?? [],
    rollbackToken: randomUUID(),
    riskFlags: params.riskFlags ?? [],
    createdAt: new Date().toISOString(),
  };
}

export function validateDiffEnvelope(diff: unknown): DiffValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!diff || typeof diff !== "object") {
    return { valid: false, errors: ["DiffEnvelope must be an object"], warnings: [] };
  }

  const d = diff as Record<string, unknown>;

  if (!d.diffId || typeof d.diffId !== "string") {
    errors.push("diffId is required and must be a string");
  }
  if (!d.baseRevision || typeof d.baseRevision !== "string") {
    errors.push("baseRevision is required and must be a string");
  }
  if (!d.actor || typeof d.actor !== "object") {
    errors.push("actor is required and must be an object");
  } else {
    const a = d.actor as Record<string, unknown>;
    if (!a.type || typeof a.type !== "string") {
      errors.push("actor.type is required and must be a string");
    }
    if (!a.name || typeof a.name !== "string") {
      errors.push("actor.name is required and must be a string");
    }
  }
  if (
    !d.permissionScope ||
    !["read_only", "proposal_only", "write_direct"].includes(d.permissionScope as string)
  ) {
    errors.push("permissionScope must be one of: read_only, proposal_only, write_direct");
  }
  if (!d.summary || typeof d.summary !== "string") {
    errors.push("summary is required and must be a string");
  }
  if (!Array.isArray(d.ops)) {
    errors.push("ops must be an array");
  } else {
    for (let i = 0; i < d.ops.length; i++) {
      const op = d.ops[i] as Record<string, unknown>;
      if (!op.op || typeof op.op !== "string") {
        errors.push(`ops[${i}]: op is required`);
        continue;
      }
      if (!op.path || typeof op.path !== "string") {
        errors.push(`ops[${i}]: path is required`);
      }
      switch (op.op) {
        case "add_node":
          if (!op.nodeType || typeof op.nodeType !== "string") {
            errors.push(`ops[${i}]: nodeType is required for add_node`);
          }
          break;
        case "remove_node":
        case "update_node":
          if (!op.nodeId || typeof op.nodeId !== "string") {
            errors.push(`ops[${i}]: nodeId is required for ${op.op}`);
          }
          break;
        case "add_edge":
          if (!op.edgeType || typeof op.edgeType !== "string") {
            errors.push(`ops[${i}]: edgeType is required for add_edge`);
          }
          if (!op.sourceId || typeof op.sourceId !== "string") {
            errors.push(`ops[${i}]: sourceId is required for add_edge`);
          }
          if (!op.targetId || typeof op.targetId !== "string") {
            errors.push(`ops[${i}]: targetId is required for add_edge`);
          }
          break;
        case "remove_edge":
          if (!op.edgeId || typeof op.edgeId !== "string") {
            errors.push(`ops[${i}]: edgeId is required for remove_edge`);
          }
          break;
        case "add_note_group":
          if (!Array.isArray(op.notes)) {
            errors.push(`ops[${i}]: notes array is required for add_note_group`);
          }
          break;
      }
    }
  }
  if (!d.rollbackToken || typeof d.rollbackToken !== "string") {
    errors.push("rollbackToken is required and must be a string");
  }

  return { valid: errors.length === 0, errors, warnings };
}
