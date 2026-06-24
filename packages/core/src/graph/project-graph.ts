import { randomUUID } from "../util/random-uuid";
import {
  ProjectGraphSchema,
  type ProjectGraphData,
  type ProjectMeta,
  type GraphNode,
  type GraphEdge,
  type NodeType,
  type EdgeType,
} from "../schema/graph-schema";

function generateId(): string {
  return randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export class ProjectGraph {
  private meta: ProjectMeta;
  private nodes: Map<string, GraphNode>;
  private edges: Map<string, GraphEdge>;
  private revisionId: string;

  constructor(meta: ProjectMeta) {
    this.meta = meta;
    this.nodes = new Map();
    this.edges = new Map();
    this.revisionId = generateId();
  }

  static fromJSON(json: unknown): ProjectGraph {
    const parsed = ProjectGraphSchema.parse(json);
    const graph = new ProjectGraph(parsed.meta);
    graph.revisionId = parsed.revision_id;
    for (const node of parsed.nodes) {
      graph.nodes.set(node.id, node);
    }
    for (const edge of parsed.edges) {
      graph.edges.set(edge.id, edge);
    }
    return graph;
  }

  static create(title: string, tempo = 120): ProjectGraph {
    const meta: ProjectMeta = {
      id: generateId(),
      title,
      tempo_map: [{ bar: 1, bpm: tempo }],
      meter_map: [{ bar: 1, numerator: 4, denominator: 4 }],
      key_map: [{ bar: 1, tonic: "C", mode: "major" }],
    };
    return new ProjectGraph(meta);
  }

  // ─── Node operations ───────────────────────────────────────

  addNode(type: NodeType, data: Record<string, unknown> = {}): GraphNode {
    const node: GraphNode = {
      id: generateId(),
      type,
      data,
      created_at: now(),
      updated_at: now(),
    };
    this.nodes.set(node.id, node);
    return node;
  }

  removeNode(id: string): void {
    if (!this.nodes.has(id)) {
      throw new Error(`Node not found: ${id}`);
    }
    this.nodes.delete(id);
    for (const [edgeId, edge] of this.edges) {
      if (edge.source_id === id || edge.target_id === id) {
        this.edges.delete(edgeId);
      }
    }
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getNodesByType(type: NodeType): GraphNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.type === type);
  }

  getAllNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  // ─── Edge operations ───────────────────────────────────────

  addEdge(
    type: EdgeType,
    sourceId: string,
    targetId: string,
    data: Record<string, unknown> = {}
  ): GraphEdge {
    if (!this.nodes.has(sourceId)) {
      throw new Error(`Source node not found: ${sourceId}`);
    }
    if (!this.nodes.has(targetId)) {
      throw new Error(`Target node not found: ${targetId}`);
    }
    const edge: GraphEdge = {
      id: generateId(),
      type,
      source_id: sourceId,
      target_id: targetId,
      data,
    };
    this.edges.set(edge.id, edge);
    return edge;
  }

  removeEdge(id: string): void {
    if (!this.edges.has(id)) {
      throw new Error(`Edge not found: ${id}`);
    }
    this.edges.delete(id);
  }

  getEdge(id: string): GraphEdge | undefined {
    return this.edges.get(id);
  }

  getEdgesByType(type: EdgeType): GraphEdge[] {
    return Array.from(this.edges.values()).filter((e) => e.type === type);
  }

  getEdgesForNode(nodeId: string): {
    incoming: GraphEdge[];
    outgoing: GraphEdge[];
  } {
    const incoming: GraphEdge[] = [];
    const outgoing: GraphEdge[] = [];
    for (const edge of this.edges.values()) {
      if (edge.source_id === nodeId) outgoing.push(edge);
      if (edge.target_id === nodeId) incoming.push(edge);
    }
    return { incoming, outgoing };
  }

  getAllEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }

  // ─── Queries ───────────────────────────────────────────────

  getNeighbors(nodeId: string, edgeType?: EdgeType): GraphNode[] {
    const neighborIds = new Set<string>();
    for (const edge of this.edges.values()) {
      if (edgeType && edge.type !== edgeType) continue;
      if (edge.source_id === nodeId) neighborIds.add(edge.target_id);
      if (edge.target_id === nodeId) neighborIds.add(edge.source_id);
    }
    return Array.from(neighborIds)
      .map((id) => this.nodes.get(id)!)
      .filter(Boolean);
  }

  traverse(
    startNodeId: string,
    edgeType: EdgeType,
    maxDepth = 10
  ): GraphNode[] {
    const visited = new Set<string>();
    const result: GraphNode[] = [];

    function dfs(
      nodeId: string,
      depth: number,
      graph: ProjectGraph
    ): void {
      if (depth > maxDepth || visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = graph.nodes.get(nodeId);
      if (node) result.push(node);
      for (const edge of graph.edges.values()) {
        if (edge.type !== edgeType) continue;
        if (edge.source_id === nodeId) {
          dfs(edge.target_id, depth + 1, graph);
        }
      }
    }

    dfs(startNodeId, 1, this);
    return result;
  }

  // ─── Validation ────────────────────────────────────────────

  validate(): { valid: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const edge of this.edges.values()) {
      if (!this.nodes.has(edge.source_id)) {
        errors.push(
          `Edge ${edge.id}: source node ${edge.source_id} does not exist`
        );
      }
      if (!this.nodes.has(edge.target_id)) {
        errors.push(
          `Edge ${edge.id}: target node ${edge.target_id} does not exist`
        );
      }

      if (
        edge.source_id === edge.target_id &&
        edge.type !== "derived_from"
      ) {
        errors.push(
          `Edge ${edge.id}: self-loop not allowed for edge type "${edge.type}"`
        );
      }
    }

    const tempoBars = this.meta.tempo_map.map((t) => t.bar);
    if (new Set(tempoBars).size !== tempoBars.length) {
      warnings.push("Duplicate bar numbers in tempo_map");
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // ─── Serialization ─────────────────────────────────────────

  toJSON(): ProjectGraphData {
    return {
      meta: this.meta,
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
      revision_id: this.revisionId,
      created_at: now(),
    };
  }

  getRevisionId(): string {
    return this.revisionId;
  }

  getMeta(): ProjectMeta {
    return this.meta;
  }

  // ─── Snapshot ──────────────────────────────────────────────

  snapshot(): ProjectGraph {
    return ProjectGraph.fromJSON(this.toJSON());
  }
}
