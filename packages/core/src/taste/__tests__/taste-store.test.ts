import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TasteGenome } from "../taste-genome";
import { TasteStore } from "../taste-store";
import type { TasteParameter, TasteEvidence } from "../taste-types";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function createTestParam(
  value: string,
  evidence: TasteEvidence[] = []
): TasteParameter {
  return {
    value,
    distribution: { family: "beta", alpha: "1.0", beta: "1.0" },
    confidence: "0.8",
    context: {},
    evidence,
    timeDecay: { policy: "none", lambda: "0.0" },
    lastUpdatedAt: new Date().toISOString(),
  };
}

function createTestEvidence(id: string, paramKey: string): TasteEvidence {
  return {
    id,
    type: "manual_keep",
    paramKey,
    context: {},
    sourceQuality: 1.0,
    timestamp: new Date().toISOString(),
    ref: "test-ref",
    confirmed: true,
  };
}

describe("TasteStore", () => {
  // ---------------------------------------------------------------------------
  // Memory mode (no storage path)
  // ---------------------------------------------------------------------------

  describe("memory mode", () => {
    let store: TasteStore;

    beforeEach(() => {
      store = new TasteStore();
    });

    it("should create an empty store, load() returns null", () => {
      expect(store.load()).toBeNull();
    });

    it("hasGenome() returns false for empty store", () => {
      expect(store.hasGenome()).toBe(false);
    });

    it("getCurrentGenome() returns null for empty store", () => {
      expect(store.getCurrentGenome()).toBeNull();
    });

    it("getVersion() returns 0 for empty store", () => {
      expect(store.getVersion()).toBe(0);
    });

    it("save() + getCurrentGenome() round-trip", () => {
      const genome = new TasteGenome();
      genome.setParameter("tempo", createTestParam("120"));

      store.save(genome);

      expect(store.hasGenome()).toBe(true);
      const restored = store.getCurrentGenome();
      expect(restored).not.toBeNull();
      expect(restored!.getParameter("tempo")?.value).toBe("120");
    });

    it("save() increments version from 0 to 1", () => {
      const genome = new TasteGenome();
      expect(genome.version).toBe(0);

      store.save(genome);
      expect(store.getVersion()).toBe(1);
    });

    it("getCurrentGenome returns independent copy", () => {
      const genome = new TasteGenome();
      genome.setParameter("key", createTestParam("original"));
      store.save(genome);

      const copy1 = store.getCurrentGenome();
      copy1!.setParameter("key", createTestParam("mutated"));

      const copy2 = store.getCurrentGenome();
      expect(copy2!.getParameter("key")?.value).toBe("original");
    });

    it("should handle multiple saves and updates", () => {
      const g1 = new TasteGenome();
      g1.setParameter("a", createTestParam("v1"));
      store.save(g1); // version 1

      const g2 = store.getCurrentGenome()!;
      g2.setParameter("b", createTestParam("v2"));
      store.save(g2); // version 2

      const current = store.getCurrentGenome()!;
      expect(current.getParameter("a")?.value).toBe("v1");
      expect(current.getParameter("b")?.value).toBe("v2");
      expect(current.version).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Version history
  // ---------------------------------------------------------------------------

  describe("version history", () => {
    let store: TasteStore;

    beforeEach(() => {
      store = new TasteStore();
    });

    it("should track version history length across multiple saves", () => {
      const g1 = new TasteGenome();
      g1.setParameter("p1", createTestParam("a"));
      store.save(g1);

      const g2 = store.getCurrentGenome()!;
      g2.setParameter("p2", createTestParam("b"));
      store.save(g2);

      const g3 = store.getCurrentGenome()!;
      g3.setParameter("p3", createTestParam("c"));
      store.save(g3);

      const history = store.getVersionHistory();
      expect(history).toHaveLength(3);
      expect(history[0].version).toBe(1);
      expect(history[1].version).toBe(2);
      expect(history[2].version).toBe(3);
    });

    it("each version entry has a timestamp", () => {
      const genome = new TasteGenome();
      store.save(genome);

      const history = store.getVersionHistory();
      expect(history[0].timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
      );
    });

    it("getVersionHistory returns deep copy", () => {
      const genome = new TasteGenome();
      store.save(genome);

      const history = store.getVersionHistory();
      history.pop();

      expect(store.getVersionHistory()).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------
  // revertTo
  // ---------------------------------------------------------------------------

  describe("revertTo", () => {
    let store: TasteStore;

    beforeEach(() => {
      store = new TasteStore();
      const g1 = new TasteGenome();
      g1.setParameter("x", createTestParam("v1"));
      store.save(g1); // v1

      const g2 = store.getCurrentGenome()!;
      g2.setParameter("x", createTestParam("v2"));
      g2.setParameter("y", createTestParam("added"));
      store.save(g2); // v2
    });

    it("should revert to a previous version", () => {
      const reverted = store.revertTo(1);
      expect(reverted).not.toBeNull();
      expect(reverted!.getParameter("x")?.value).toBe("v1");
      expect(reverted!.getParameter("y")).toBeUndefined();
    });

    it("should return null for unknown version", () => {
      expect(store.revertTo(999)).toBeNull();
    });

    it("reverted state becomes current", () => {
      store.revertTo(1);
      const current = store.getCurrentGenome()!;
      expect(current.getParameter("x")?.value).toBe("v1");
      expect(current.getParameter("y")).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getDiff
  // ---------------------------------------------------------------------------

  describe("getDiff", () => {
    let store: TasteStore;

    beforeEach(() => {
      store = new TasteStore();
      const g1 = new TasteGenome();
      g1.setParameter("a", createTestParam("1"));
      g1.setParameter("b", createTestParam("x"));
      store.save(g1); // v1

      const g2 = store.getCurrentGenome()!;
      g2.setParameter("a", createTestParam("2"));
      g2.setParameter("c", createTestParam("new"));
      store.save(g2); // v2
    });

    it("should detect changed parameters", () => {
      const diffs = store.getDiff(1, 2);
      const changed = diffs.filter((d) => d.changed);
      expect(changed).toHaveLength(2);

      const aDiff = diffs.find((d) => d.paramKey === "a")!;
      expect(aDiff.fromValue).toBe("1");
      expect(aDiff.toValue).toBe("2");
      expect(aDiff.changed).toBe(true);

      const cDiff = diffs.find((d) => d.paramKey === "c")!;
      expect(cDiff.fromValue).toBeNull();
      expect(cDiff.toValue).toBe("new");
    });

    it("should identify unchanged parameters", () => {
      const diffs = store.getDiff(1, 2);
      const bDiff = diffs.find((d) => d.paramKey === "b")!;
      expect(bDiff.changed).toBe(false);
      expect(bDiff.fromValue).toBe("x");
      expect(bDiff.toValue).toBe("x");
    });

    it("should return empty array for unknown version", () => {
      expect(store.getDiff(1, 999)).toEqual([]);
      expect(store.getDiff(999, 1)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Export / Import
  // ---------------------------------------------------------------------------

  describe("export / import", () => {
    let store: TasteStore;

    beforeEach(() => {
      store = new TasteStore();
      const genome = new TasteGenome();
      genome.setParameter(
        "tempo",
        createTestParam("140", [
          createTestEvidence("ev-1", "tempo"),
          createTestEvidence("ev-2", "tempo"),
        ])
      );
      genome.setParameter("key", createTestParam("C minor"));
      store.save(genome);
    });

    it("exportPackage should return valid package", () => {
      const pkg = store.exportPackage();
      expect(pkg.packageVersion).toBe(1);
      expect(pkg.genome).toBeDefined();
      expect(pkg.evidence).toHaveLength(2);
      expect(pkg.versionHistory).toHaveLength(1);
      expect(pkg.exportedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
      );
    });

    it("exportPackage / importPackage round-trip", () => {
      const pkg = store.exportPackage();

      const newStore = new TasteStore();
      newStore.importPackage(pkg);

      expect(newStore.hasGenome()).toBe(true);
      const restored = newStore.getCurrentGenome()!;
      expect(restored.getParameter("tempo")?.value).toBe("140");
      expect(restored.getParameter("key")?.value).toBe("C minor");
      expect(restored.getParameter("tempo")?.evidence).toHaveLength(2);
      expect(newStore.getVersionHistory()).toHaveLength(1);
    });

    it("exportPackage should throw when no genome", () => {
      const empty = new TasteStore();
      expect(() => empty.exportPackage()).toThrow("No genome to export");
    });

    it("exportToJSON / importFromJSON round-trip with storagePath", () => {
      const json = store.exportToJSON();
      expect(typeof json).toBe("string");

      const restored = TasteStore.importFromJSON(json);
      expect(restored.hasGenome()).toBe(true);
      expect(
        restored.getCurrentGenome()!.getParameter("tempo")?.value
      ).toBe("140");
      expect(restored.getVersionHistory()).toHaveLength(1);
    });

    it("importFromJSON handles null genome", () => {
      const store2 = new TasteStore();
      const json = store2.exportToJSON();
      const restored = TasteStore.importFromJSON(json);
      expect(restored.hasGenome()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Data governance
  // ---------------------------------------------------------------------------

  describe("deleteGenome", () => {
    let store: TasteStore;

    beforeEach(() => {
      store = new TasteStore();
      const genome = new TasteGenome();
      genome.setParameter("p", createTestParam("val"));
      store.save(genome);
    });

    it("should clear genome and version history", () => {
      store.deleteGenome();
      expect(store.hasGenome()).toBe(false);
      expect(store.getCurrentGenome()).toBeNull();
      expect(store.getVersionHistory()).toHaveLength(0);
    });
  });

  describe("deleteEvidence", () => {
    let store: TasteStore;

    beforeEach(() => {
      store = new TasteStore();
      const genome = new TasteGenome();
      genome.setParameter(
        "tempo",
        createTestParam("120", [
          createTestEvidence("ev-a", "tempo"),
          createTestEvidence("ev-b", "tempo"),
        ])
      );
      genome.setParameter(
        "key",
        createTestParam("D", [createTestEvidence("ev-c", "key")])
      );
      store.save(genome);
    });

    it("should delete a specific evidence by id", () => {
      store.deleteEvidence("tempo", "ev-a");

      const param = store.getCurrentGenome()!.getParameter("tempo")!;
      expect(param.evidence).toHaveLength(1);
      expect(param.evidence[0].id).toBe("ev-b");
    });

    it("should not affect other parameters", () => {
      store.deleteEvidence("tempo", "ev-a");

      const keyParam = store.getCurrentGenome()!.getParameter("key")!;
      expect(keyParam.evidence).toHaveLength(1);
      expect(keyParam.evidence[0].id).toBe("ev-c");
    });

    it("should be no-op for non-existent evidence id", () => {
      store.deleteEvidence("tempo", "nonexistent");
      const param = store.getCurrentGenome()!.getParameter("tempo")!;
      expect(param.evidence).toHaveLength(2);
    });

    it("should be no-op for non-existent paramKey", () => {
      store.deleteEvidence("nonexistent", "ev-a");
      const param = store.getCurrentGenome()!.getParameter("tempo")!;
      expect(param.evidence).toHaveLength(2);
    });

    it("should be no-op when no genome", () => {
      store.deleteGenome();
      store.deleteEvidence("tempo", "ev-a");
      expect(store.hasGenome()).toBe(false);
    });
  });

  describe("listAllEvidence", () => {
    it("should list all evidence across all parameters", () => {
      const store = new TasteStore();
      const genome = new TasteGenome();
      genome.setParameter(
        "a",
        createTestParam("1", [createTestEvidence("e1", "a")])
      );
      genome.setParameter(
        "b",
        createTestParam("2", [
          createTestEvidence("e2", "b"),
          createTestEvidence("e3", "b"),
        ])
      );
      store.save(genome);

      const all = store.listAllEvidence();
      expect(all).toHaveLength(3);
      expect(all.map((e) => e.paramKey).sort()).toEqual(["a", "b", "b"]);
      expect(all.map((e) => e.evidence.id).sort()).toEqual(["e1", "e2", "e3"]);
    });

    it("should return empty array when no genome", () => {
      const store = new TasteStore();
      expect(store.listAllEvidence()).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Disk persistence
  // ---------------------------------------------------------------------------

  describe("disk persistence", () => {
    let tmpDir: string;
    let storePath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "collinx-taste-test-")
      );
      storePath = path.join(tmpDir, "taste");
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should save and load genome from disk", () => {
      const store1 = new TasteStore(storePath);
      const genome = new TasteGenome();
      genome.setParameter("tempo", createTestParam("128"));
      store1.save(genome);

      expect(fs.existsSync(path.join(storePath, "genome.json"))).toBe(true);
      expect(fs.existsSync(path.join(storePath, "versions.jsonl"))).toBe(
        true
      );

      const store2 = new TasteStore(storePath);
      const loaded = store2.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.getParameter("tempo")?.value).toBe("128");
    });

    it("should persist version history to disk", () => {
      const store1 = new TasteStore(storePath);
      const g1 = new TasteGenome();
      g1.setParameter("a", createTestParam("1"));
      store1.save(g1);

      const g2 = store1.getCurrentGenome()!;
      g2.setParameter("b", createTestParam("2"));
      store1.save(g2);

      const store2 = new TasteStore(storePath);
      store2.load();
      expect(store2.getVersionHistory()).toHaveLength(2);
      expect(store2.getVersionHistory()[0].version).toBe(1);
      expect(store2.getVersionHistory()[1].version).toBe(2);
    });

    it("load() returns null when no storage path", () => {
      const store = new TasteStore();
      expect(store.load()).toBeNull();
    });

    it("should handle non-existent directory gracefully", () => {
      const nonExistent = path.join(tmpDir, "does-not-exist", "taste");
      const store = new TasteStore(nonExistent);
      expect(store.load()).toBeNull();
    });

    it("should handle empty genome.json gracefully", () => {
      fs.mkdirSync(storePath, { recursive: true });
      fs.writeFileSync(
        path.join(storePath, "genome.json"),
        JSON.stringify({
          genome: null,
          updatedAt: new Date().toISOString(),
        }),
        "utf-8"
      );

      const store = new TasteStore(storePath);
      expect(store.load()).toBeNull();
    });

    it("deleteGenome should persist empty state", () => {
      const store1 = new TasteStore(storePath);
      const genome = new TasteGenome();
      genome.setParameter("x", createTestParam("y"));
      store1.save(genome);

      store1.deleteGenome();

      const store2 = new TasteStore(storePath);
      store2.load();
      expect(store2.hasGenome()).toBe(false);
      expect(store2.getVersionHistory()).toHaveLength(0);
    });
  });
});
