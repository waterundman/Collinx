import { describe, it, expect, beforeEach } from "vitest";
import { DiffLog } from "../diff-log";
import type { DiffLogEntry } from "../diff-log";

function makeEntry(overrides: Partial<DiffLogEntry> = {}): DiffLogEntry {
  return {
    diffId: "diff-1",
    baseRevision: "rev-1",
    newRevision: "rev-2",
    actor: { type: "agent", name: "test-agent" },
    summary: "Test entry",
    opsCount: 3,
    appliedAt: "2025-01-01T00:00:00.000Z",
    status: "applied",
    rollbackToken: "token-1",
    ...overrides,
  };
}

describe("DiffLog", () => {
  let log: DiffLog;

  beforeEach(() => {
    log = new DiffLog();
  });

  describe("record and query", () => {
    it("should record and retrieve by diffId", () => {
      const entry = makeEntry();
      log.record(entry);
      expect(log.getByDiffId("diff-1")).toEqual(entry);
    });

    it("should return undefined for unknown diffId", () => {
      expect(log.getByDiffId("unknown")).toBeUndefined();
    });

    it("should query by revision", () => {
      log.record(makeEntry({ diffId: "d1", baseRevision: "rev-A", newRevision: "rev-B" }));
      log.record(makeEntry({ diffId: "d2", baseRevision: "rev-B", newRevision: "rev-C" }));
      log.record(makeEntry({ diffId: "d3", baseRevision: "rev-C", newRevision: "rev-D" }));

      const results = log.getByRevision("rev-B");
      expect(results).toHaveLength(2);
    });

    it("should query by actor name", () => {
      log.record(makeEntry({ diffId: "d1", actor: { type: "agent", name: "alice" } }));
      log.record(makeEntry({ diffId: "d2", actor: { type: "user", name: "bob" } }));
      log.record(makeEntry({ diffId: "d3", actor: { type: "agent", name: "alice" } }));

      expect(log.getByActor("alice")).toHaveLength(2);
      expect(log.getByActor("bob")).toHaveLength(1);
      expect(log.getByActor("unknown")).toHaveLength(0);
    });

    it("should query by time range", () => {
      log.record(makeEntry({ diffId: "d1", appliedAt: "2025-01-01T00:00:00.000Z" }));
      log.record(makeEntry({ diffId: "d2", appliedAt: "2025-06-01T00:00:00.000Z" }));
      log.record(makeEntry({ diffId: "d3", appliedAt: "2025-12-01T00:00:00.000Z" }));

      const results = log.getByTimeRange("2025-03-01T00:00:00.000Z", "2025-09-01T00:00:00.000Z");
      expect(results).toHaveLength(1);
      expect(results[0].diffId).toBe("d2");
    });

    it("should get recent entries", () => {
      log.record(makeEntry({ diffId: "d1" }));
      log.record(makeEntry({ diffId: "d2" }));
      log.record(makeEntry({ diffId: "d3" }));

      const recent = log.getRecent(2);
      expect(recent).toHaveLength(2);
      expect(recent[0].diffId).toBe("d3");
      expect(recent[1].diffId).toBe("d2");
    });
  });

  describe("status updates", () => {
    it("should mark entry as rejected", () => {
      const entry = makeEntry({ diffId: "d1", status: "applied" });
      log.record(entry);
      log.markRejected("d1");
      expect(log.getByDiffId("d1")?.status).toBe("rejected");
    });

    it("should mark entry as rolled back", () => {
      const entry = makeEntry({ diffId: "d1", status: "applied" });
      log.record(entry);
      log.markRolledBack("d1");
      expect(log.getByDiffId("d1")?.status).toBe("rolled_back");
    });

    it("should not throw for unknown diffId on markRejected", () => {
      expect(() => log.markRejected("unknown")).not.toThrow();
    });

    it("should not throw for unknown diffId on markRolledBack", () => {
      expect(() => log.markRolledBack("unknown")).not.toThrow();
    });
  });

  describe("JSONL serialization", () => {
    it("should serialize to JSONL", () => {
      log.record(makeEntry({ diffId: "d1" }));
      log.record(makeEntry({ diffId: "d2" }));

      const jsonl = log.toJSONL();
      const lines = jsonl.trim().split("\n");
      expect(lines).toHaveLength(2);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.diffId).toBeDefined();
        expect(parsed.status).toBeDefined();
      }
    });

    it("should return newline for empty log", () => {
      expect(log.toJSONL()).toBe("\n");
    });
  });
});
