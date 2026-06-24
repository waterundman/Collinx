import { describe, it, expect, beforeEach } from "vitest";
import { ProjectGraph } from "../project-graph";

describe("ProjectGraph", () => {
  let graph: ProjectGraph;

  beforeEach(() => {
    graph = ProjectGraph.create("Test Project", 120);
  });

  describe("create", () => {
    it("should create a graph with meta", () => {
      const meta = graph.getMeta();
      expect(meta.title).toBe("Test Project");
      expect(meta.tempo_map[0].bpm).toBe(120);
      expect(meta.meter_map[0].numerator).toBe(4);
      expect(meta.key_map[0].tonic).toBe("C");
    });

    it("should default tempo to 120 when not provided", () => {
      const g = ProjectGraph.create("Default Tempo");
      expect(g.getMeta().tempo_map[0].bpm).toBe(120);
    });

    it("should have empty nodes and edges initially", () => {
      expect(graph.getAllNodes()).toHaveLength(0);
      expect(graph.getAllEdges()).toHaveLength(0);
    });

    it("should generate a unique revision ID", () => {
      const id = graph.getRevisionId();
      expect(id).toBeDefined();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });
  });

  describe("node operations", () => {
    it("should add a node", () => {
      const node = graph.addNode("CompositionUnit", { name: "main" });
      expect(node.id).toBeDefined();
      expect(node.type).toBe("CompositionUnit");
      expect(node.data.name).toBe("main");
      expect(node.created_at).toBeDefined();
      expect(node.updated_at).toBeDefined();
      expect(graph.getNode(node.id)).toEqual(node);
    });

    it("should add a node with empty data by default", () => {
      const node = graph.addNode("Phrase");
      expect(node.data).toEqual({});
    });

    it("should remove a node and its incident edges", () => {
      const a = graph.addNode("Phrase", { label: "A" });
      const b = graph.addNode("Phrase", { label: "B" });
      const edge = graph.addEdge("contains", a.id, b.id);

      graph.removeNode(a.id);

      expect(graph.getNode(a.id)).toBeUndefined();
      expect(graph.getNode(b.id)).toBeDefined();
      expect(graph.getEdge(edge.id)).toBeUndefined();
    });

    it("should throw when removing non-existent node", () => {
      expect(() => graph.removeNode("nonexistent")).toThrow(
        "Node not found"
      );
    });

    it("should get nodes by type", () => {
      graph.addNode("CompositionUnit");
      graph.addNode("Phrase");
      graph.addNode("Phrase");
      graph.addNode("Track");

      expect(graph.getNodesByType("CompositionUnit")).toHaveLength(1);
      expect(graph.getNodesByType("Phrase")).toHaveLength(2);
      expect(graph.getNodesByType("Track")).toHaveLength(1);
      expect(graph.getNodesByType("Player")).toHaveLength(0);
    });

    it("should get all nodes", () => {
      graph.addNode("CompositionUnit");
      graph.addNode("Phrase");
      expect(graph.getAllNodes()).toHaveLength(2);
    });
  });

  describe("edge operations", () => {
    let sourceId: string;
    let targetId: string;

    beforeEach(() => {
      sourceId = graph.addNode("CompositionUnit").id;
      targetId = graph.addNode("Phrase").id;
    });

    it("should add an edge between existing nodes", () => {
      const edge = graph.addEdge("contains", sourceId, targetId, {
        weight: 1,
      });
      expect(edge.id).toBeDefined();
      expect(edge.type).toBe("contains");
      expect(edge.source_id).toBe(sourceId);
      expect(edge.target_id).toBe(targetId);
      expect(edge.data.weight).toBe(1);
    });

    it("should throw when source node missing", () => {
      expect(() =>
        graph.addEdge("contains", "nonexistent", targetId)
      ).toThrow("Source node not found");
    });

    it("should throw when target node missing", () => {
      expect(() =>
        graph.addEdge("contains", sourceId, "nonexistent")
      ).toThrow("Target node not found");
    });

    it("should remove an edge", () => {
      const edge = graph.addEdge("contains", sourceId, targetId);
      graph.removeEdge(edge.id);
      expect(graph.getEdge(edge.id)).toBeUndefined();
    });

    it("should throw when removing non-existent edge", () => {
      expect(() => graph.removeEdge("nonexistent")).toThrow(
        "Edge not found"
      );
    });

    it("should get edges by type", () => {
      graph.addEdge("contains", sourceId, targetId);
      const third = graph.addNode("Motif").id;
      graph.addEdge("realizes", sourceId, third);
      graph.addEdge("contains", sourceId, third);

      expect(graph.getEdgesByType("contains")).toHaveLength(2);
      expect(graph.getEdgesByType("realizes")).toHaveLength(1);
      expect(graph.getEdgesByType("notates")).toHaveLength(0);
    });

    it("should get edges for a node (incoming/outgoing)", () => {
      const third = graph.addNode("Motif").id;
      graph.addEdge("contains", sourceId, targetId);
      graph.addEdge("realizes", sourceId, third);
      graph.addEdge("contains", third, targetId);

      const result = graph.getEdgesForNode(targetId);
      expect(result.incoming).toHaveLength(2);
      expect(result.outgoing).toHaveLength(0);
    });

    it("should get all edges", () => {
      graph.addEdge("contains", sourceId, targetId);
      graph.addEdge("realizes", sourceId, targetId);
      expect(graph.getAllEdges()).toHaveLength(2);
    });
  });

  describe("queries", () => {
    it("should get neighbors", () => {
      const a = graph.addNode("Phrase", { name: "A" }).id;
      const b = graph.addNode("Phrase", { name: "B" }).id;
      const c = graph.addNode("Phrase", { name: "C" }).id;

      graph.addEdge("contains", a, b);
      graph.addEdge("contains", a, c);
      graph.addEdge("realizes", b, c);

      const neighbors = graph.getNeighbors(a);
      expect(neighbors).toHaveLength(2);

      const neighborsByType = graph.getNeighbors(a, "contains");
      expect(neighborsByType).toHaveLength(2);
    });

    it("should traverse graph by edge type", () => {
      const root = graph.addNode("CompositionUnit", { name: "root" }).id;
      const a = graph.addNode("Phrase", { name: "A" }).id;
      const b = graph.addNode("Phrase", { name: "B" }).id;
      const c = graph.addNode("Motif", { name: "C" }).id;

      graph.addEdge("contains", root, a);
      graph.addEdge("contains", a, b);
      graph.addEdge("contains", b, c);
      graph.addEdge("realizes", root, c);

      const result = graph.traverse(root, "contains");
      expect(result).toHaveLength(4);

      const realizeResult = graph.traverse(root, "realizes");
      expect(realizeResult).toHaveLength(2);
    });

    it("should respect maxDepth in traverse", () => {
      const root = graph.addNode("CompositionUnit").id;
      let current = root;
      for (let i = 0; i < 10; i++) {
        const next = graph.addNode("Phrase").id;
        graph.addEdge("contains", current, next);
        current = next;
      }

      const result = graph.traverse(root, "contains", 3);
      expect(result.length).toBeLessThanOrEqual(4);
    });
  });

  describe("validation", () => {
    it("should pass validation for an empty graph", () => {
      const result = graph.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass validation for a valid graph", () => {
      const a = graph.addNode("CompositionUnit").id;
      const b = graph.addNode("Phrase").id;
      graph.addEdge("contains", a, b);

      const result = graph.validate();
      expect(result.valid).toBe(true);
    });

    it("should detect dangling edges", () => {
      const a = graph.addNode("CompositionUnit").id;
      const b = graph.addNode("Phrase").id;
      graph.addEdge("contains", a, b);

      const json = graph.toJSON();
      json.edges.push({
        id: "00000000-0000-4000-8000-000000000001",
        type: "contains" as const,
        source_id: a,
        target_id: "00000000-0000-4000-8000-000000000099",
        data: {},
      });

      const restored = ProjectGraph.fromJSON(json);
      const result = restored.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("does not exist"))).toBe(true);
    });

    it("should detect self-loops for non-derived_from types", () => {
      const nodeId = graph.addNode("Phrase").id;
      graph.addEdge("contains", nodeId, nodeId);

      const result = graph.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("self-loop"))).toBe(true);
    });

    it("should allow self-loops for derived_from", () => {
      const nodeId = graph.addNode("Phrase").id;
      graph.addEdge("derived_from", nodeId, nodeId);

      const result = graph.validate();
      expect(result.valid).toBe(true);
    });

    it("should warn about duplicate tempo bar numbers", () => {
      const g = ProjectGraph.create("Dup", 120);
      g.getMeta().tempo_map.push({ bar: 1, bpm: 140 });

      const result = g.validate();
      expect(result.warnings.some((w) => w.includes("Duplicate"))).toBe(true);
    });
  });

  describe("serialization", () => {
    it("should serialize to JSON and back", () => {
      const a = graph.addNode("CompositionUnit", { name: "main" }).id;
      const b = graph.addNode("Phrase", { name: "verse" }).id;
      graph.addEdge("contains", a, b);

      const json = graph.toJSON();
      const restored = ProjectGraph.fromJSON(json);

      expect(restored.getNode(a)).toBeDefined();
      expect(restored.getNode(b)).toBeDefined();
      expect(restored.getAllEdges()).toHaveLength(1);
      expect(restored.getMeta().title).toBe("Test Project");
    });

    it("should reject invalid JSON", () => {
      expect(() => ProjectGraph.fromJSON({})).toThrow();
      expect(() => ProjectGraph.fromJSON({ meta: { title: "" } })).toThrow();
    });
  });

  describe("snapshot", () => {
    it("should create a deep copy via snapshot", () => {
      graph.addNode("Phrase", { name: "A" });
      const snap = graph.snapshot();

      graph.addNode("Phrase", { name: "B" });

      expect(snap.getAllNodes()).toHaveLength(1);
      expect(graph.getAllNodes()).toHaveLength(2);
    });

    it("should not share references with the original", () => {
      graph.addNode("Phrase", { name: "A" });
      const snap = graph.snapshot();
      const node = snap.getAllNodes()[0];
      node.data.name = "Modified";

      const originalNode = graph.getAllNodes()[0];
      expect(originalNode.data.name).toBe("A");
    });
  });
});
