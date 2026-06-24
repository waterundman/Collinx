import { randomUUID } from "../util/random-uuid";
import type { ProjectGraph } from "./project-graph";
import { serializeGraph, deserializeGraph } from "./serialization";

export interface RevisionEntry {
  revisionId: string;
  graph: ProjectGraph;
  timestamp: string;
  parentRevisionId: string | null;
  message: string;
}

export class RevisionStore {
  private revisions: Map<string, RevisionEntry>;
  private history: RevisionEntry[];
  private currentRevisionId: string | null;
  private storagePath: string | null;

  constructor(storagePath?: string) {
    this.revisions = new Map();
    this.history = [];
    this.currentRevisionId = null;
    this.storagePath = storagePath ?? null;
  }

  commit(graph: ProjectGraph, message: string): string {
    const entry: RevisionEntry = {
      revisionId: randomUUID(),
      graph: graph.snapshot(),
      timestamp: new Date().toISOString(),
      parentRevisionId: this.currentRevisionId,
      message,
    };
    this.revisions.set(entry.revisionId, entry);
    this.history.push(entry);
    this.currentRevisionId = entry.revisionId;
    return entry.revisionId;
  }

  getRevision(revisionId: string): ProjectGraph | undefined {
    return this.revisions.get(revisionId)?.graph.snapshot();
  }

  getCurrentRevision(): ProjectGraph | undefined {
    if (!this.currentRevisionId) return undefined;
    return this.getRevision(this.currentRevisionId);
  }

  getHistory(): RevisionEntry[] {
    return [...this.history];
  }

  createCheckpoint(graph: ProjectGraph, label: string): string {
    const entry: RevisionEntry = {
      revisionId: randomUUID(),
      graph: graph.snapshot(),
      timestamp: new Date().toISOString(),
      parentRevisionId: this.currentRevisionId,
      message: `[CHECKPOINT] ${label}`,
    };
    this.revisions.set(entry.revisionId, entry);
    this.history.push(entry);
    this.currentRevisionId = entry.revisionId;
    return entry.revisionId;
  }

  listCheckpoints(): RevisionEntry[] {
    return this.history.filter((e) => e.message.startsWith("[CHECKPOINT]"));
  }

  restoreCheckpoint(revisionId: string): ProjectGraph {
    const entry = this.revisions.get(revisionId);
    if (!entry) {
      throw new Error(`Revision not found: ${revisionId}`);
    }
    return entry.graph.snapshot();
  }

  save(): void {
    if (!this.storagePath) {
      throw new Error("No storage path configured");
    }
    const fs = require("node:fs");
    const lines: string[] = [];
    for (const entry of this.history) {
      lines.push(
        JSON.stringify({
          revisionId: entry.revisionId,
          parentRevisionId: entry.parentRevisionId,
          message: entry.message,
          timestamp: entry.timestamp,
          graph: serializeGraph(entry.graph),
        })
      );
    }
    fs.writeFileSync(this.storagePath, lines.join("\n") + "\n", "utf-8");
  }

  load(): void {
    if (!this.storagePath) {
      throw new Error("No storage path configured");
    }
    const fs = require("node:fs");
    if (!fs.existsSync(this.storagePath)) return;

    const content = fs.readFileSync(this.storagePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    this.revisions.clear();
    this.history = [];

    for (const line of lines) {
      const raw = JSON.parse(line);
      const entry: RevisionEntry = {
        revisionId: raw.revisionId,
        graph: deserializeGraph(raw.graph),
        timestamp: raw.timestamp,
        parentRevisionId: raw.parentRevisionId,
        message: raw.message,
      };
      this.revisions.set(entry.revisionId, entry);
      this.history.push(entry);
    }
    if (this.history.length > 0) {
      this.currentRevisionId = this.history[this.history.length - 1].revisionId;
    }
  }
}
