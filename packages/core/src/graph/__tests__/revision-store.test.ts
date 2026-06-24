import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ProjectGraph } from "../project-graph";
import { RevisionStore } from "../revision-store";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("RevisionStore", () => {
  let graph: ProjectGraph;
  let store: RevisionStore;

  beforeEach(() => {
    graph = ProjectGraph.create("Test Song", 96);
    store = new RevisionStore();
  });

  describe("commit and getRevision", () => {
    it("should commit a graph snapshot and return revision ID", () => {
      graph.addNode("Phrase", { name: "intro" });
      const revId = store.commit(graph, "Initial commit");

      expect(revId).toBeDefined();
      expect(revId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it("should retrieve a committed revision", () => {
      graph.addNode("Phrase", { name: "intro" });
      const revId = store.commit(graph, "first");

      const restored = store.getRevision(revId);
      expect(restored).toBeDefined();
      expect(restored!.getAllNodes()).toHaveLength(1);
      expect(restored!.getAllNodes()[0].data.name).toBe("intro");
    });

    it("should return undefined for unknown revision", () => {
      expect(store.getRevision("unknown")).toBeUndefined();
    });

    it("should return independent snapshots", () => {
      graph.addNode("Phrase", { name: "A" });
      const rev1 = store.commit(graph, "first");

      graph.addNode("Phrase", { name: "B" });
      store.commit(graph, "second");

      const r1 = store.getRevision(rev1);
      expect(r1!.getAllNodes()).toHaveLength(1);

      const current = store.getCurrentRevision();
      expect(current!.getAllNodes()).toHaveLength(2);
    });
  });

  describe("version history", () => {
    it("should track parent revision IDs", () => {
      const rev1 = store.commit(graph, "first");
      graph.addNode("Phrase");
      const rev2 = store.commit(graph, "second");

      const history = store.getHistory();
      expect(history).toHaveLength(2);
      expect(history[1].parentRevisionId).toBe(rev1);
      expect(history[0].message).toBe("first");
      expect(history[1].message).toBe("second");
    });

    it("should have null parent for first commit", () => {
      store.commit(graph, "init");
      const history = store.getHistory();
      expect(history[0].parentRevisionId).toBeNull();
    });

    it("should return getCurrentRevision as the latest", () => {
      graph.addNode("Phrase", { name: "v1" });
      store.commit(graph, "v1");

      graph.addNode("Phrase", { name: "v2" });
      store.commit(graph, "v2");

      const current = store.getCurrentRevision();
      expect(current!.getAllNodes()).toHaveLength(2);
    });

    it("should return undefined getCurrentRevision when empty", () => {
      expect(store.getCurrentRevision()).toBeUndefined();
    });
  });

  describe("checkpoints", () => {
    it("should create a checkpoint with [CHECKPOINT] label", () => {
      store.createCheckpoint(graph, "baseline");

      const checkpoints = store.listCheckpoints();
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].message).toBe("[CHECKPOINT] baseline");
    });

    it("should restore from a checkpoint", () => {
      graph.addNode("Phrase", { name: "saved" });
      const cpId = store.createCheckpoint(graph, "before-changes");

      graph.addNode("Phrase", { name: "unsaved" });
      store.commit(graph, "after changes");

      const restored = store.restoreCheckpoint(cpId);
      expect(restored.getAllNodes()).toHaveLength(1);
      expect(restored.getAllNodes()[0].data.name).toBe("saved");
    });

    it("should throw when restoring unknown checkpoint", () => {
      expect(() => store.restoreCheckpoint("unknown")).toThrow(
        "Revision not found"
      );
    });

    it("should filter checkpoints from regular commits", () => {
      store.commit(graph, "regular commit");
      store.createCheckpoint(graph, "save point");
      store.commit(graph, "another regular");

      const checkpoints = store.listCheckpoints();
      expect(checkpoints).toHaveLength(1);
      expect(store.getHistory()).toHaveLength(3);
    });
  });

  describe("JSONL persistence", () => {
    let tmpDir: string;
    let filePath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "collinx-test-"));
      filePath = path.join(tmpDir, "revisions.jsonl");
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("should save and load revisions", () => {
      const store2 = new RevisionStore(filePath);

      graph.addNode("Phrase", { name: "hello" });
      store2.commit(graph, "first");
      store2.commit(graph, "second");
      store2.save();

      const store3 = new RevisionStore(filePath);
      store3.load();

      const history = store3.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].message).toBe("first");
      expect(history[1].message).toBe("second");

      const current = store3.getCurrentRevision();
      expect(current).toBeDefined();
    });

    it("should throw save when no storage path", () => {
      expect(() => store.save()).toThrow("No storage path");
    });

    it("should throw load when no storage path", () => {
      expect(() => store.load()).toThrow("No storage path");
    });

    it("should handle empty file on load gracefully", () => {
      fs.writeFileSync(filePath, "", "utf-8");
      const store2 = new RevisionStore(filePath);
      store2.load();
      expect(store2.getHistory()).toHaveLength(0);
    });
  });
});
