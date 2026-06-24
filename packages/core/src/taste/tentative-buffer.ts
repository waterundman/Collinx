import { TasteEvidence } from "./taste-types";

export interface PendingEvidence {
  evidence: TasteEvidence;
  addedAt: string;
  expiresAt: string;
  promotedAt?: string;
  dismissedAt?: string;
  status: "pending" | "promoted" | "expired" | "dismissed";
}

function nowISO(): string {
  return new Date().toISOString();
}

function addDays(isoString: string, days: number): string {
  const date = new Date(isoString);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export class TentativeBuffer {
  private pending: Map<string, PendingEvidence>;
  private defaultTtlDays: number;

  constructor(ttlDays?: number) {
    this.pending = new Map();
    this.defaultTtlDays = ttlDays ?? 30;
  }

  addEvidence(evidence: TasteEvidence): void {
    const addedAt = nowISO();
    const expiresAt = addDays(addedAt, this.defaultTtlDays);

    const pending: PendingEvidence = {
      evidence,
      addedAt,
      expiresAt,
      status: "pending",
    };

    this.pending.set(evidence.id, pending);
  }

  getPending(): PendingEvidence[] {
    return Array.from(this.pending.values()).filter(
      (p) => p.status === "pending"
    );
  }

  getByParamKey(paramKey: string): PendingEvidence[] {
    return Array.from(this.pending.values()).filter(
      (p) => p.evidence.paramKey === paramKey
    );
  }

  promote(evidenceId: string): TasteEvidence | null {
    const pending = this.pending.get(evidenceId);
    if (!pending || pending.status !== "pending") return null;

    pending.status = "promoted";
    pending.promotedAt = nowISO();
    return pending.evidence;
  }

  dismiss(evidenceId: string): void {
    const pending = this.pending.get(evidenceId);
    if (!pending) return;

    pending.status = "dismissed";
    pending.dismissedAt = nowISO();
  }

  cleanExpired(): number {
    let cleaned = 0;
    const now = nowISO();

    for (const [, pending] of this.pending) {
      if (pending.status === "pending" && pending.expiresAt < now) {
        pending.status = "expired";
        cleaned++;
      }
    }

    return cleaned;
  }

  count(): number {
    return this.pending.size;
  }

  countPending(): number {
    let count = 0;
    for (const [, p] of this.pending) {
      if (p.status === "pending") count++;
    }
    return count;
  }

  toJSON(): object {
    const entries = Array.from(this.pending.entries());
    return {
      defaultTtlDays: this.defaultTtlDays,
      entries: entries.map(([id, pe]) => ({
        id,
        evidence: pe.evidence,
        addedAt: pe.addedAt,
        expiresAt: pe.expiresAt,
        promotedAt: pe.promotedAt,
        dismissedAt: pe.dismissedAt,
        status: pe.status,
      })),
    };
  }

  static fromJSON(json: unknown): TentativeBuffer {
    const data = json as {
      defaultTtlDays?: number;
      entries?: {
        id: string;
        evidence: TasteEvidence;
        addedAt: string;
        expiresAt: string;
        promotedAt?: string;
        dismissedAt?: string;
        status: PendingEvidence["status"];
      }[];
    };

    const buffer = new TentativeBuffer(data.defaultTtlDays);

    if (data.entries) {
      for (const entry of data.entries) {
        buffer.pending.set(entry.id, {
          evidence: entry.evidence,
          addedAt: entry.addedAt,
          expiresAt: entry.expiresAt,
          promotedAt: entry.promotedAt,
          dismissedAt: entry.dismissedAt,
          status: entry.status,
        });
      }
    }

    return buffer;
  }
}
