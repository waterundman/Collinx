import { describe, it, expect, beforeEach } from "vitest";
import { ProjectGraph } from "../../graph/project-graph";
import { DiffEngine } from "../../diff/diff-engine";
import { createDiffEnvelope } from "../../diff/diff-envelope";
import { RevisionStore } from "../../graph/revision-store";

describe("ProjectGraph + DiffEngine integration", () => {
  let graph: ProjectGraph;
  let engine: DiffEngine;

  beforeEach(() => {
    graph = ProjectGraph.create("Integration Test", 120);
    engine = new DiffEngine();
  });

  it("should add nodes via DiffEnvelope and update graph", () => {
    const diff = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "test-agent" },
      permissionScope: "write_direct",
      summary: "Add a Phrase node",
      ops: [
        {
          op: "add_node",
          path: "/",
          nodeType: "Phrase",
          data: { name: "verse-phrase" },
        },
        {
          op: "add_node",
          path: "/",
          nodeType: "Motif",
          data: { name: "main-motif" },
        },
      ],
    });

    const result = engine.apply(diff, graph);

    expect(result.appliedOps).toBe(2);
    expect(result.skippedOps).toBe(0);
    expect(result.graph.getAllNodes()).toHaveLength(2);

    const phrases = result.graph.getNodesByType("Phrase");
    expect(phrases).toHaveLength(1);
    expect(phrases[0].data.name).toBe("verse-phrase");
  });

  it("should rollback to original state after apply", () => {
    const preNodes = graph.getAllNodes().length;

    const diff = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "test-agent" },
      permissionScope: "write_direct",
      summary: "Add nodes then rollback",
      ops: [
        {
          op: "add_node",
          path: "/",
          nodeType: "Phrase",
          data: { name: "temp" },
        },
      ],
    });

    // apply works on a snapshot, returns new graph
    const { graph: newGraph, rollbackToken } = engine.apply(diff, graph);
    expect(newGraph.getAllNodes()).toHaveLength(preNodes + 1);
    // original graph is unchanged
    expect(graph.getAllNodes()).toHaveLength(preNodes);

    const restored = engine.rollback(graph, rollbackToken);
    expect(restored.getAllNodes()).toHaveLength(preNodes);
    expect(restored.getNodesByType("Phrase")).toHaveLength(0);
  });

  it("should increment revision count after multiple applies", () => {
    const store = new RevisionStore();

    const rev1 = store.commit(graph, "initial");

    const diff1 = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "test" },
      permissionScope: "write_direct",
      summary: "First change",
      ops: [
        { op: "add_node", path: "/", nodeType: "Track", data: { name: "piano" } },
      ],
    });
    const result1 = engine.apply(diff1, graph);
    const rev2 = store.commit(result1.graph, "added piano track");

    const diff2 = createDiffEnvelope({
      baseRevision: result1.graph.getRevisionId(),
      actor: { type: "agent", name: "test" },
      permissionScope: "write_direct",
      summary: "Second change",
      ops: [
        { op: "add_node", path: "/", nodeType: "Track", data: { name: "violin" } },
      ],
    });
    const result2 = engine.apply(diff2, result1.graph);
    const rev3 = store.commit(result2.graph, "added violin track");

    const history = store.getHistory();
    expect(history).toHaveLength(3);
    expect(rev1).not.toBe(rev2);
    expect(rev2).not.toBe(rev3);
    expect(store.getRevision(rev3)?.getNodesByType("Track")).toHaveLength(2);
  });

  it("should record all changes in RevisionStore", () => {
    const store = new RevisionStore();
    store.commit(graph, "empty graph");

    const diff = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "test" },
      permissionScope: "write_direct",
      summary: "Add CompositionUnit and Phrase",
      ops: [
        { op: "add_node", path: "/", nodeType: "CompositionUnit", data: { name: "main" } },
        { op: "add_node", path: "/", nodeType: "Phrase", data: { name: "verse1" } },
      ],
    });

    const applied = engine.apply(diff, graph);
    store.commit(applied.graph, "added structure nodes");

    const history = store.getHistory();
    expect(history).toHaveLength(2);

    const latest = store.getCurrentRevision();
    expect(latest).toBeDefined();
    expect(latest!.getAllNodes()).toHaveLength(2);
    expect(latest!.getNodesByType("CompositionUnit")).toHaveLength(1);
    expect(latest!.getNodesByType("Phrase")).toHaveLength(1);
  });

  it("should handle node removal via diff with edge cascading", () => {
    const a = graph.addNode("Phrase", { name: "A" });
    const b = graph.addNode("Motif", { name: "B" });
    graph.addEdge("contains", a.id, b.id);

    const diff = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "test" },
      permissionScope: "write_direct",
      summary: "Remove phrase A",
      ops: [{ op: "remove_node", path: "/", nodeId: a.id }],
    });

    const result = engine.apply(diff, graph);
    expect(result.appliedOps).toBe(1);
    expect(result.graph.getAllNodes()).toHaveLength(1);
    expect(result.graph.getAllEdges()).toHaveLength(0);
  });

  it("should validate diff before applying", () => {
    const diff = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "test" },
      permissionScope: "write_direct",
      summary: "Update non-existent node",
      ops: [
        { op: "update_node", path: "/", nodeId: "non-existent-id", data: { name: "nope" } },
      ],
    });

    const validation = engine.validate(diff, graph);
    expect(validation.valid).toBe(false);
    expect(validation.errors.length).toBeGreaterThan(0);
    expect(validation.errors.some((e) => e.includes("non-existent"))).toBe(true);
  });

  it("should compute delta between two graph states with nodes", () => {
    const beforeGraph = ProjectGraph.create("Before", 120);
    beforeGraph.addNode("Phrase", { name: "original" });
    beforeGraph.addNode("Track", { name: "existing" });
    const beforeSnapshot = beforeGraph.snapshot();

    const afterGraph = beforeGraph.snapshot();
    afterGraph.addNode("Motif", { name: "new-motif" });

    const delta = engine.computeDelta(beforeSnapshot, afterGraph);
    expect(delta.ops.length).toBeGreaterThan(0);

    // Delta applied to beforeSnapshot should reproduce afterGraph state
    const applied = engine.apply(delta, beforeSnapshot);
    expect(applied.graph.getAllNodes()).toHaveLength(3);
    expect(applied.graph.getNodesByType("Motif")).toHaveLength(1);
  });

  it("should merge two diffs and detect conflicts", () => {
    const node = graph.addNode("Phrase", { name: "shared" });

    const diffA = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "agent-a" },
      permissionScope: "write_direct",
      summary: "A: update phrase",
      ops: [
        { op: "update_node", path: "/", nodeId: node.id, data: { name: "renamed-by-a" } },
      ],
    });

    const diffB = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "agent-b" },
      permissionScope: "write_direct",
      summary: "B: update same phrase",
      ops: [
        { op: "update_node", path: "/", nodeId: node.id, data: { name: "renamed-by-b" } },
      ],
    });

    const merged = engine.merge(diffA, diffB);
    expect(merged.ops).toHaveLength(2);

    const hasConflict = engine.hasConflict(diffA, diffB);
    expect(hasConflict).toBe(true);
  });
});
