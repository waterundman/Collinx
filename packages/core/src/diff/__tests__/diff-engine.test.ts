import { describe, it, expect, beforeEach } from "vitest";
import { DiffEngine } from "../diff-engine";
import { createDiffEnvelope } from "../diff-envelope";
import type { DiffEnvelope, DiffOperation } from "../diff-envelope";
import { ProjectGraph } from "../../graph/project-graph";

function makeEnvelope(overrides: Partial<DiffEnvelope> & { baseRevision: string; ops: DiffOperation[] }): DiffEnvelope {
  const { baseRevision, ops, ...rest } = overrides;
  return {
    diffId: "test-diff-1",
    baseRevision,
    actor: { type: "agent", name: "test-agent" },
    permissionScope: "write_direct",
    summary: "Test diff",
    ops,
    domainExplanations: [],
    evidenceRefs: [],
    rollbackToken: "test-rollback-token",
    riskFlags: [],
    createdAt: new Date().toISOString(),
    ...rest,
  };
}

describe("DiffEngine", () => {
  let engine: DiffEngine;
  let graph: ProjectGraph;

  beforeEach(() => {
    engine = new DiffEngine();
    graph = ProjectGraph.create("Test Project", 120);
  });

  describe("apply", () => {
    it("should add a node", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_node", path: "/", nodeType: "Phrase", data: { name: "verse" } }],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(1);
      expect(result.skippedOps).toBe(0);
      expect(result.graph.getAllNodes()).toHaveLength(1);
      expect(result.graph.getAllNodes()[0].type).toBe("Phrase");
      expect(result.graph.getAllNodes()[0].data.name).toBe("verse");
    });

    it("should remove a node", () => {
      const node = graph.addNode("Phrase", { name: "verse" });
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_node", path: "/", nodeId: node.id }],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(1);
      expect(result.graph.getAllNodes()).toHaveLength(0);
    });

    it("should skip remove_node for non-existent node", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_node", path: "/", nodeId: "nonexistent" }],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(0);
      expect(result.skippedOps).toBe(1);
    });

    it("should update a node", async () => {
      const node = graph.addNode("Phrase", { name: "old" });
      // Wait to ensure updated_at differs
      await new Promise((r) => setTimeout(r, 5));
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "update_node", path: "/", nodeId: node.id, data: { name: "new" } }],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(1);
      const updated = result.graph.getNode(node.id);
      expect(updated?.data.name).toBe("new");
      expect(updated?.updated_at).not.toBe(node.updated_at);
    });

    it("should skip update_node for non-existent node", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "update_node", path: "/", nodeId: "nonexistent", data: { name: "x" } }],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(0);
      expect(result.skippedOps).toBe(1);
    });

    it("should add an edge", () => {
      const a = graph.addNode("Phrase", { name: "A" });
      const b = graph.addNode("Phrase", { name: "B" });
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_edge", path: "/", edgeType: "contains", sourceId: a.id, targetId: b.id }],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(1);
      expect(result.graph.getAllEdges()).toHaveLength(1);
    });

    it("should skip add_edge when source missing", () => {
      const b = graph.addNode("Phrase", { name: "B" });
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_edge", path: "/", edgeType: "contains", sourceId: "nonexistent", targetId: b.id }],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(0);
      expect(result.skippedOps).toBe(1);
    });

    it("should skip add_edge when target missing", () => {
      const a = graph.addNode("Phrase", { name: "A" });
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_edge", path: "/", edgeType: "contains", sourceId: a.id, targetId: "nonexistent" }],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(0);
      expect(result.skippedOps).toBe(1);
    });

    it("should remove an edge", () => {
      const a = graph.addNode("Phrase", { name: "A" });
      const b = graph.addNode("Phrase", { name: "B" });
      const edge = graph.addEdge("contains", a.id, b.id);
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_edge", path: "/", edgeId: edge.id }],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(1);
      expect(result.graph.getAllEdges()).toHaveLength(0);
    });

    it("should skip remove_edge for non-existent edge", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_edge", path: "/", edgeId: "nonexistent" }],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(0);
      expect(result.skippedOps).toBe(1);
    });

    it("should update meta", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "update_meta", path: "/", data: { title: "New Title" } }],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(1);
      expect(result.graph.getMeta().title).toBe("New Title");
    });

    it("should add note group as NoteSpan nodes", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [
          {
            op: "add_note_group",
            path: "/",
            notes: [
              {
                id: "note-1",
                trackId: "track-1",
                phraseId: null,
                bar: 1,
                beat: 1,
                durQn: 1,
                pitchMidi: 60,
                pitchSpelling: "C4",
                velocity: 0.8,
                voice: "rh",
                tags: [],
              },
              {
                id: "note-2",
                trackId: "track-1",
                phraseId: null,
                bar: 1,
                beat: 2,
                durQn: 1,
                pitchMidi: 64,
                pitchSpelling: "E4",
                velocity: 0.8,
                voice: "rh",
                tags: [],
              },
            ],
          },
        ],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(1);
      expect(result.graph.getNodesByType("NoteSpan")).toHaveLength(2);
    });

    it("should not mutate the original graph (immutability)", () => {
      const node = graph.addNode("Phrase", { name: "original" });
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "update_node", path: "/", nodeId: node.id, data: { name: "changed" } }],
      });

      engine.apply(diff, graph);
      expect(graph.getNode(node.id)?.data.name).toBe("original");
    });

    it("should handle multiple operations", () => {
      const node = graph.addNode("Phrase", { name: "A" });
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [
          { op: "add_node", path: "/", nodeType: "Phrase", data: { name: "B" } },
          { op: "update_node", path: "/", nodeId: node.id, data: { name: "Updated" } },
          { op: "remove_node", path: "/", nodeId: "nonexistent" },
        ],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(2);
      expect(result.skippedOps).toBe(1);
      expect(result.graph.getAllNodes()).toHaveLength(2);
    });

    it("should apply an add_note_group with an empty notes array as a no-op success", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_note_group", path: "/", notes: [] }],
      });

      const result = engine.apply(diff, graph);
      expect(result.appliedOps).toBe(1);
      expect(result.skippedOps).toBe(0);
      expect(result.graph.getNodesByType("NoteSpan")).toHaveLength(0);
    });
  });

  describe("validate", () => {
    it("should pass for valid diff", () => {
      const node = graph.addNode("Phrase", { name: "A" });
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "update_node", path: "/", nodeId: node.id, data: { name: "B" } }],
      });

      const result = engine.validate(diff, graph);
      expect(result.valid).toBe(true);
    });

    it("should error on remove_node for non-existent node", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_node", path: "/", nodeId: "nonexistent" }],
      });

      const result = engine.validate(diff, graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("non-existent node"))).toBe(true);
    });

    it("should warn about incident edges on remove_node", () => {
      const a = graph.addNode("Phrase", { name: "A" });
      const b = graph.addNode("Phrase", { name: "B" });
      graph.addEdge("contains", a.id, b.id);

      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_node", path: "/", nodeId: a.id }],
      });

      const result = engine.validate(diff, graph);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("incident edge"))).toBe(true);
    });

    it("should error on update_node for non-existent node", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "update_node", path: "/", nodeId: "nonexistent", data: {} }],
      });

      const result = engine.validate(diff, graph);
      expect(result.valid).toBe(false);
    });

    it("should error on add_edge with missing source", () => {
      const b = graph.addNode("Phrase", { name: "B" });
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_edge", path: "/", edgeType: "contains", sourceId: "nonexistent", targetId: b.id }],
      });

      const result = engine.validate(diff, graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("source node"))).toBe(true);
    });

    it("should error on add_edge with missing target", () => {
      const a = graph.addNode("Phrase", { name: "A" });
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_edge", path: "/", edgeType: "contains", sourceId: a.id, targetId: "nonexistent" }],
      });

      const result = engine.validate(diff, graph);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("target node"))).toBe(true);
    });

    it("should error on remove_edge for non-existent edge", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_edge", path: "/", edgeId: "nonexistent" }],
      });

      const result = engine.validate(diff, graph);
      expect(result.valid).toBe(false);
    });

    it("should warn on baseRevision mismatch", () => {
      const diff = makeEnvelope({
        baseRevision: "different-revision",
        ops: [],
      });

      const result = engine.validate(diff, graph);
      expect(result.warnings.some((w) => w.includes("baseRevision"))).toBe(true);
    });
  });

  describe("rollback", () => {
    it("should restore graph to pre-apply state", () => {
      graph.addNode("Phrase", { name: "original" });

      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_node", path: "/", nodeType: "Track", data: { name: "new" } }],
        rollbackToken: "my-rollback-token",
      });

      const result = engine.apply(diff, graph);
      expect(result.graph.getAllNodes()).toHaveLength(2);

      const restored = engine.rollback(graph, result.rollbackToken);
      expect(restored.getAllNodes()).toHaveLength(1);
      expect(restored.getAllNodes()[0].type).toBe("Phrase");
    });

    it("should throw for unknown rollback token", () => {
      expect(() => engine.rollback(graph, "unknown-token")).toThrow("Rollback snapshot not found");
    });

    it("should be idempotent: replaying the same rollback token restores the same snapshot", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_node", path: "/", nodeType: "Phrase", data: { name: "once" } }],
      });

      const result = engine.apply(diff, graph);
      expect(result.graph.getAllNodes()).toHaveLength(1);

      // First rollback restores the pre-apply state.
      const restored = engine.rollback(graph, result.rollbackToken);
      expect(restored.getAllNodes()).toHaveLength(0);

      // Replaying the same token is safe: snapshots are never consumed.
      const replayed = engine.rollback(graph, result.rollbackToken);
      expect(replayed.getAllNodes()).toHaveLength(0);
      expect(replayed.toJSON().nodes).toEqual(restored.toJSON().nodes);
    });
  });

  describe("exportSnapshots/importSnapshots (Stage 0)", () => {
    it("exportSnapshots returns a JSON-serializable shallow copy of the rollback map", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_node", path: "/", nodeType: "Phrase", data: { name: "A" } }],
        rollbackToken: "token-a",
      });
      engine.apply(diff, graph);

      const exported = engine.exportSnapshots();
      expect(exported).toEqual({ "token-a": expect.any(String) });

      // JSON round-trip keeps the snapshot string byte-for-byte.
      const revived = JSON.parse(JSON.stringify(exported)) as Record<string, string>;
      expect(revived["token-a"]).toBe(exported["token-a"]);

      // The exported record is a shallow copy: mutating it does not touch the live map.
      delete exported["token-a"];
      expect(engine.exportSnapshots()["token-a"]).toBe(revived["token-a"]);
    });

    it("importSnapshots restores snapshots into a fresh engine so rollback works after refresh", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_node", path: "/", nodeType: "Phrase", data: { name: "A" } }],
        rollbackToken: "token-b",
      });
      const result = engine.apply(diff, graph);
      expect(result.graph.getAllNodes()).toHaveLength(1);

      // Simulate a refresh: a brand-new engine hydrated from persisted data.
      const exported = engine.exportSnapshots();
      const fresh = new DiffEngine();
      fresh.importSnapshots(JSON.parse(JSON.stringify(exported)) as Record<string, string>);

      const restored = fresh.rollback(result.graph, result.rollbackToken);
      expect(restored.getAllNodes()).toHaveLength(0);
    });

    it("importSnapshots merges over existing tokens and keeps unknown tokens", () => {
      const diff = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_node", path: "/", nodeType: "Phrase", data: { name: "A" } }],
        rollbackToken: "token-c",
      });
      engine.apply(diff, graph);
      engine.importSnapshots({ "token-c": "{\"replaced\":true}", "token-d": "{}" });

      const exported = engine.exportSnapshots();
      expect(exported["token-c"]).toBe("{\"replaced\":true}");
      expect(exported["token-d"]).toBe("{}");
    });

    it("importSnapshots with an empty record is a no-op", () => {
      engine.importSnapshots({});
      expect(engine.exportSnapshots()).toEqual({});
    });
  });

  describe("merge", () => {
    it("should merge two non-conflicting diffs", () => {
      const diffA = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_node", path: "/", nodeType: "Phrase", data: { name: "A" } }],
        summary: "Add phrase A",
      });

      const diffB = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_node", path: "/", nodeType: "Track", data: { name: "B" } }],
        summary: "Add track B",
      });

      const merged = engine.merge(diffA, diffB);
      expect(merged.ops).toHaveLength(2);
      expect(merged.summary).toContain("Merged");
      expect(merged.actor.name).toBe("merge");
    });

    it("should concatenate ops for conflicting diffs without throwing (conflict is a hasConflict concern)", () => {
      const diffA = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "update_node", path: "/", nodeId: "shared-node", data: { name: "A" } }],
        summary: "Touch shared-node from A",
      });

      const diffB = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_node", path: "/", nodeId: "shared-node" }],
        summary: "Touch shared-node from B",
      });

      // The two diffs touch the same node, so they conflict...
      expect(engine.hasConflict(diffA, diffB)).toBe(true);

      // ...but merge itself does not reject them: it concatenates the ops.
      expect(() => engine.merge(diffA, diffB)).not.toThrow();
      const merged = engine.merge(diffA, diffB);
      expect(merged.ops).toHaveLength(2);
      expect(merged.ops[0]).toMatchObject({ op: "update_node", nodeId: "shared-node" });
      expect(merged.ops[1]).toMatchObject({ op: "remove_node", nodeId: "shared-node" });
    });
  });

  describe("hasConflict", () => {
    it("should detect no conflict for independent diffs", () => {
      const diffA = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_node", path: "/", nodeId: "node-a" }],
      });

      const diffB = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_node", path: "/", nodeId: "node-b" }],
      });

      expect(engine.hasConflict(diffA, diffB)).toBe(false);
    });

    it("should detect conflict when same node is touched", () => {
      const diffA = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_node", path: "/", nodeId: "node-a" }],
      });

      const diffB = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "update_node", path: "/", nodeId: "node-a", data: {} }],
      });

      expect(engine.hasConflict(diffA, diffB)).toBe(true);
    });

    it("should detect conflict when same edge is touched", () => {
      const diffA = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_edge", path: "/", edgeId: "edge-a" }],
      });

      const diffB = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "remove_edge", path: "/", edgeId: "edge-a" }],
      });

      expect(engine.hasConflict(diffA, diffB)).toBe(true);
    });

    it("should not conflict on add_node operations", () => {
      const diffA = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_node", path: "/", nodeType: "Phrase", data: {} }],
      });

      const diffB = makeEnvelope({
        baseRevision: graph.getRevisionId(),
        ops: [{ op: "add_node", path: "/", nodeType: "Track", data: {} }],
      });

      expect(engine.hasConflict(diffA, diffB)).toBe(false);
    });
  });

  describe("computeDelta", () => {
    it("should detect added nodes", () => {
      const before = graph.snapshot();
      graph.addNode("Phrase", { name: "new" });

      const delta = engine.computeDelta(before, graph);
      const addOps = delta.ops.filter((o) => o.op === "add_node");
      expect(addOps).toHaveLength(1);
      expect((addOps[0] as { data: Record<string, unknown> }).data.name).toBe("new");
    });

    it("should detect removed nodes", () => {
      const node = graph.addNode("Phrase", { name: "temp" });
      const before = graph.snapshot();
      graph.removeNode(node.id);

      const delta = engine.computeDelta(before, graph);
      const removeOps = delta.ops.filter((o) => o.op === "remove_node");
      expect(removeOps).toHaveLength(1);
      expect((removeOps[0] as { nodeId: string }).nodeId).toBe(node.id);
    });

    it("should detect updated nodes", () => {
      const node = graph.addNode("Phrase", { name: "old" });
      const before = graph.snapshot();
      const n = graph.getNode(node.id)!;
      n.data = { name: "new" };

      const delta = engine.computeDelta(before, graph);
      const updateOps = delta.ops.filter((o) => o.op === "update_node");
      expect(updateOps).toHaveLength(1);
    });

    it("should detect added edges", () => {
      const a = graph.addNode("Phrase", { name: "A" });
      const b = graph.addNode("Phrase", { name: "B" });
      const before = graph.snapshot();
      graph.addEdge("contains", a.id, b.id);

      const delta = engine.computeDelta(before, graph);
      const addOps = delta.ops.filter((o) => o.op === "add_edge");
      expect(addOps).toHaveLength(1);
    });

    it("should detect removed edges", () => {
      const a = graph.addNode("Phrase", { name: "A" });
      const b = graph.addNode("Phrase", { name: "B" });
      const edge = graph.addEdge("contains", a.id, b.id);
      const before = graph.snapshot();
      graph.removeEdge(edge.id);

      const delta = engine.computeDelta(before, graph);
      const removeOps = delta.ops.filter((o) => o.op === "remove_edge");
      expect(removeOps).toHaveLength(1);
    });

    it("should detect meta changes", () => {
      const before = graph.snapshot();
      graph.getMeta().title = "Changed Title";

      const delta = engine.computeDelta(before, graph);
      const metaOps = delta.ops.filter((o) => o.op === "update_meta");
      expect(metaOps).toHaveLength(1);
    });
  });
});
