import { randomUUID } from "../util/random-uuid";

/**
 * A single tool invocation made by an Agent. Unlike ToolRegistry's internal
 * AuditEntry, this is a UI-facing, store-resident record so the Agent Panel
 * can render the agent's decision process: which tool ran, with which params,
 * and how it turned out. Defined in core so both the agent package and the UI
 * store can share the shape.
 */
export interface ToolCallRecord {
  id: string;
  /** Tool identifier, e.g. "mixing.suggestChain". */
  toolName: string;
  /** Parameter summary passed to the tool. */
  params: Record<string, unknown>;
  /** Human-readable outcome, e.g. "建议 3 段 FX 链". */
  resultSummary: string;
  status: "running" | "success" | "error";
  /** ISO 8601 timestamp of when the call was recorded. */
  timestamp: string;
  /** Agent that invoked the tool, e.g. "mixing". */
  agentName: string;
  /** Optional AgentBus request this call belongs to. */
  correlationId?: string;
}

/** Everything a caller must provide; id and timestamp are minted for them. */
export type NewToolCallRecord = Omit<ToolCallRecord, "id" | "timestamp">;

/**
 * Factory that completes a tool-call record with a fresh id and ISO timestamp.
 */
export function createToolCallRecord(params: NewToolCallRecord): ToolCallRecord {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...params,
  };
}
