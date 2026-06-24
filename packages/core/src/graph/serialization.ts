import {
  ProjectGraphSchema,
  type ProjectGraphData,
  type GraphNode,
  type GraphEdge,
} from "../schema/graph-schema";
import { ProjectGraph } from "./project-graph";

export function serializeGraph(graph: ProjectGraph): string {
  return JSON.stringify(graph.toJSON());
}

export function deserializeGraph(json: string): ProjectGraph {
  const parsed = JSON.parse(json);
  return ProjectGraph.fromJSON(parsed);
}

export function serializeToJSONL(graph: ProjectGraph): string {
  const data = graph.toJSON();
  const lines: string[] = [];

  lines.push(
    JSON.stringify({
      meta: data.meta,
      revision_id: data.revision_id,
      created_at: data.created_at,
    })
  );

  for (const node of data.nodes) {
    lines.push(JSON.stringify({ node }));
  }

  for (const edge of data.edges) {
    lines.push(JSON.stringify({ edge }));
  }

  return lines.join("\n") + "\n";
}

export function deserializeFromJSONL(jsonl: string): ProjectGraph {
  const lines = jsonl.trim().split("\n").filter(Boolean);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let meta: ProjectGraphData["meta"] | null = null;
  let revision_id = "";
  let created_at = "";

  for (const line of lines) {
    const obj = JSON.parse(line);
    if (obj.meta) {
      meta = obj.meta;
      revision_id = obj.revision_id;
      created_at = obj.created_at;
    } else if (obj.node) {
      nodes.push(obj.node);
    } else if (obj.edge) {
      edges.push(obj.edge);
    }
  }

  if (!meta) {
    throw new Error("Invalid JSONL: missing meta header");
  }

  const data: ProjectGraphData = { meta, nodes, edges, revision_id, created_at };
  ProjectGraphSchema.parse(data);
  return ProjectGraph.fromJSON(data);
}

export function createSnapshot(graph: ProjectGraph): ProjectGraph {
  return graph.snapshot();
}

export function compareSnapshots(
  a: ProjectGraph,
  b: ProjectGraph
): {
  added: string[];
  removed: string[];
  modified: string[];
} {
  const aNodes = a.getAllNodes();
  const bNodes = b.getAllNodes();
  const aEdges = a.getAllEdges();
  const bEdges = b.getAllEdges();

  const aNodeMap = new Map(aNodes.map((n) => [n.id, n]));
  const bNodeMap = new Map(bNodes.map((n) => [n.id, n]));

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  for (const [id, node] of bNodeMap) {
    if (!aNodeMap.has(id)) {
      added.push(`node:${id} (${node.type})`);
    } else {
      const oldNode = aNodeMap.get(id)!;
      const jsonA = JSON.stringify(oldNode);
      const jsonB = JSON.stringify(node);
      if (jsonA !== jsonB) {
        modified.push(`node:${id} (${node.type})`);
      }
    }
  }

  for (const [id, node] of aNodeMap) {
    if (!bNodeMap.has(id)) {
      removed.push(`node:${id} (${node.type})`);
    }
  }

  const aEdgeMap = new Map(aEdges.map((e) => [e.id, e]));
  const bEdgeMap = new Map(bEdges.map((e) => [e.id, e]));

  for (const [id, edge] of bEdgeMap) {
    if (!aEdgeMap.has(id)) {
      added.push(`edge:${id} (${edge.type})`);
    } else {
      const oldEdge = aEdgeMap.get(id)!;
      const jsonA = JSON.stringify(oldEdge);
      const jsonB = JSON.stringify(edge);
      if (jsonA !== jsonB) {
        modified.push(`edge:${id} (${edge.type})`);
      }
    }
  }

  for (const [id, edge] of aEdgeMap) {
    if (!bEdgeMap.has(id)) {
      removed.push(`edge:${id} (${edge.type})`);
    }
  }

  return { added, removed, modified };
}
