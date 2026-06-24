import type { Actor } from "./diff-envelope";

export interface DiffLogEntry {
  diffId: string;
  baseRevision: string;
  newRevision: string;
  actor: Actor;
  summary: string;
  opsCount: number;
  appliedAt: string;
  status: "applied" | "rejected" | "rolled_back";
  rollbackToken: string;
}

export class DiffLog {
  private entries: DiffLogEntry[];
  private storagePath: string | null;

  constructor(storagePath?: string) {
    this.entries = [];
    this.storagePath = storagePath ?? null;
  }

  record(entry: DiffLogEntry): void {
    this.entries.push(entry);
  }

  getByDiffId(diffId: string): DiffLogEntry | undefined {
    return this.entries.find((e) => e.diffId === diffId);
  }

  getByRevision(revisionId: string): DiffLogEntry[] {
    return this.entries.filter(
      (e) => e.baseRevision === revisionId || e.newRevision === revisionId
    );
  }

  getByActor(actorName: string): DiffLogEntry[] {
    return this.entries.filter((e) => e.actor.name === actorName);
  }

  getByTimeRange(from: string, to: string): DiffLogEntry[] {
    return this.entries.filter((e) => e.appliedAt >= from && e.appliedAt <= to);
  }

  getRecent(limit = 10): DiffLogEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  markRejected(diffId: string): void {
    const entry = this.entries.find((e) => e.diffId === diffId);
    if (entry) {
      entry.status = "rejected";
    }
  }

  markRolledBack(diffId: string): void {
    const entry = this.entries.find((e) => e.diffId === diffId);
    if (entry) {
      entry.status = "rolled_back";
    }
  }

  save(): void {
    if (!this.storagePath) {
      throw new Error("No storage path configured");
    }
    const fs = require("node:fs");
    fs.writeFileSync(this.storagePath, this.toJSONL(), "utf-8");
  }

  load(): void {
    if (!this.storagePath) {
      throw new Error("No storage path configured");
    }
    const fs = require("node:fs");
    if (!fs.existsSync(this.storagePath)) return;

    const content = fs.readFileSync(this.storagePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    this.entries = lines.map((line: string) => JSON.parse(line) as DiffLogEntry);
  }

  toJSONL(): string {
    return this.entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  }
}
