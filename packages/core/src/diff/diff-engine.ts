import { randomUUID } from "../util/random-uuid";
import { ProjectGraph } from "../graph/project-graph";
import type { GraphNode, GraphEdge, NodeType, EdgeType } from "../schema/graph-schema";
import type { NoteEvent } from "../model/note-event";
import type {
  DiffEnvelope,
  DiffOperation,
  DiffValidationResult,
} from "./diff-envelope";
import { createDiffEnvelope } from "./diff-envelope";

export class DiffEngine {
  private rollbackSnapshots: Map<string, string>;

  constructor() {
    this.rollbackSnapshots = new Map();
  }

  apply(
    diff: DiffEnvelope,
    graph: ProjectGraph
  ): {
    graph: ProjectGraph;
    appliedOps: number;
    skippedOps: number;
    rollbackToken: string;
  } {
    const preSnapshot = graph.snapshot();
    const rollbackToken = diff.rollbackToken;
    this.rollbackSnapshots.set(rollbackToken, JSON.stringify(preSnapshot.toJSON()));

    const newGraph = graph.snapshot();
    let appliedOps = 0;
    let skippedOps = 0;

    for (const op of diff.ops) {
      if (this.applyOp(newGraph, op)) {
        appliedOps++;
      } else {
        skippedOps++;
      }
    }

    return { graph: newGraph, appliedOps, skippedOps, rollbackToken };
  }

  rollback(_graph: ProjectGraph, rollbackToken: string): ProjectGraph {
    const snapshotJson = this.rollbackSnapshots.get(rollbackToken);
    if (!snapshotJson) {
      throw new Error(`Rollback snapshot not found for token: ${rollbackToken}`);
    }
    return ProjectGraph.fromJSON(JSON.parse(snapshotJson));
  }

  validate(diff: DiffEnvelope, graph: ProjectGraph): DiffValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (diff.baseRevision !== graph.getRevisionId()) {
      warnings.push(
        `baseRevision "${diff.baseRevision}" does not match current revision "${graph.getRevisionId()}"`
      );
    }

    for (let i = 0; i < diff.ops.length; i++) {
      const op = diff.ops[i];
      switch (op.op) {
        case "remove_node": {
          const node = graph.getNode(op.nodeId);
          if (!node) {
            errors.push(`ops[${i}]: remove_node references non-existent node "${op.nodeId}"`);
          } else {
            const { incoming, outgoing } = graph.getEdgesForNode(op.nodeId);
            if (incoming.length > 0 || outgoing.length > 0) {
              warnings.push(
                `ops[${i}]: remove_node "${op.nodeId}" will also remove ${incoming.length + outgoing.length} incident edge(s)`
              );
            }
          }
          break;
        }
        case "update_node": {
          if (!graph.getNode(op.nodeId)) {
            errors.push(`ops[${i}]: update_node references non-existent node "${op.nodeId}"`);
          }
          break;
        }
        case "add_edge": {
          if (!graph.getNode(op.sourceId)) {
            errors.push(`ops[${i}]: add_edge source node "${op.sourceId}" does not exist`);
          }
          if (!graph.getNode(op.targetId)) {
            errors.push(`ops[${i}]: add_edge target node "${op.targetId}" does not exist`);
          }
          break;
        }
        case "remove_edge": {
          if (!graph.getEdge(op.edgeId)) {
            errors.push(`ops[${i}]: remove_edge references non-existent edge "${op.edgeId}"`);
          }
          break;
        }
        case "add_node":
        case "update_meta":
        case "add_note_group":
          break;
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  computeDelta(before: ProjectGraph, after: ProjectGraph): DiffEnvelope {
    const ops: DiffOperation[] = [];
    const path = "/";

    const beforeNodes = new Map<string, GraphNode>();
    for (const n of before.getAllNodes()) {
      beforeNodes.set(n.id, n);
    }
    const afterNodes = new Map<string, GraphNode>();
    for (const n of after.getAllNodes()) {
      afterNodes.set(n.id, n);
    }

    for (const [id, newNode] of afterNodes) {
      const oldNode = beforeNodes.get(id);
      if (!oldNode) {
        ops.push({ op: "add_node", path, nodeType: newNode.type, data: newNode.data });
      } else {
        const oldJson = JSON.stringify(oldNode.data);
        const newJson = JSON.stringify(newNode.data);
        if (oldJson !== newJson) {
          ops.push({ op: "update_node", path, nodeId: id, data: newNode.data });
        }
      }
    }
    for (const id of beforeNodes.keys()) {
      if (!afterNodes.has(id)) {
        ops.push({ op: "remove_node", path, nodeId: id });
      }
    }

    const beforeEdges = new Map<string, GraphEdge>();
    for (const e of before.getAllEdges()) {
      beforeEdges.set(e.id, e);
    }
    const afterEdges = new Map<string, GraphEdge>();
    for (const e of after.getAllEdges()) {
      afterEdges.set(e.id, e);
    }

    for (const [id, newEdge] of afterEdges) {
      if (!beforeEdges.has(id)) {
        ops.push({
          op: "add_edge",
          path,
          edgeType: newEdge.type,
          sourceId: newEdge.source_id,
          targetId: newEdge.target_id,
          data: newEdge.data,
        });
      }
    }
    for (const id of beforeEdges.keys()) {
      if (!afterEdges.has(id)) {
        ops.push({ op: "remove_edge", path, edgeId: id });
      }
    }

    const beforeMeta = JSON.stringify(before.getMeta());
    const afterMeta = JSON.stringify(after.getMeta());
    if (beforeMeta !== afterMeta) {
      ops.push({ op: "update_meta", path, data: after.getMeta() });
    }

    return createDiffEnvelope({
      baseRevision: before.getRevisionId(),
      actor: { type: "system", name: "diff-engine" },
      permissionScope: "write_direct",
      summary: `Delta from ${before.getRevisionId()} to ${after.getRevisionId()}`,
      ops,
    });
  }

  merge(diffA: DiffEnvelope, diffB: DiffEnvelope): DiffEnvelope {
    return createDiffEnvelope({
      baseRevision: diffA.baseRevision,
      actor: { type: "system", name: "merge" },
      permissionScope: diffA.permissionScope,
      summary: `Merged: ${diffA.summary} + ${diffB.summary}`,
      ops: [...diffA.ops, ...diffB.ops],
      domainExplanations: [...diffA.domainExplanations, ...diffB.domainExplanations],
      evidenceRefs: [...new Set([...diffA.evidenceRefs, ...diffB.evidenceRefs])],
      riskFlags: [...diffA.riskFlags, ...diffB.riskFlags],
    });
  }

  hasConflict(diffA: DiffEnvelope, diffB: DiffEnvelope): boolean {
    const touchedIdsA = new Set<string>();
    for (const op of diffA.ops) {
      const id = this.extractTouchedId(op);
      if (id) touchedIdsA.add(id);
    }

    for (const op of diffB.ops) {
      const id = this.extractTouchedId(op);
      if (id && touchedIdsA.has(id)) return true;
    }

    return false;
  }

  private applyOp(graph: ProjectGraph, op: DiffOperation): boolean {
    try {
      switch (op.op) {
        case "add_node": {
          graph.addNode(op.nodeType as NodeType, op.data);
          return true;
        }
        case "remove_node": {
          if (!graph.getNode(op.nodeId)) return false;
          graph.removeNode(op.nodeId);
          return true;
        }
        case "update_node": {
          const node = graph.getNode(op.nodeId);
          if (!node) return false;
          node.data = { ...node.data, ...op.data };
          node.updated_at = new Date().toISOString();
          return true;
        }
        case "add_edge": {
          if (!graph.getNode(op.sourceId) || !graph.getNode(op.targetId)) return false;
          graph.addEdge(op.edgeType as EdgeType, op.sourceId, op.targetId, op.data ?? {});
          return true;
        }
        case "remove_edge": {
          if (!graph.getEdge(op.edgeId)) return false;
          graph.removeEdge(op.edgeId);
          return true;
        }
        case "update_meta": {
          const meta = graph.getMeta();
          if (op.data.id !== undefined) meta.id = op.data.id;
          if (op.data.title !== undefined) meta.title = op.data.title;
          if (op.data.tempo_map !== undefined) meta.tempo_map = op.data.tempo_map;
          if (op.data.meter_map !== undefined) meta.meter_map = op.data.meter_map;
          if (op.data.key_map !== undefined) meta.key_map = op.data.key_map;
          return true;
        }
        case "add_note_group": {
          for (const note of op.notes) {
            graph.addNode("NoteSpan", note as unknown as Record<string, unknown>);
          }
          return true;
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  private extractTouchedId(op: DiffOperation): string | null {
    switch (op.op) {
      case "remove_node":
      case "update_node":
        return `node:${op.nodeId}`;
      case "remove_edge":
        return `edge:${op.edgeId}`;
      case "add_node":
      case "add_edge":
      case "add_note_group":
      case "update_meta":
        return null;
      default:
        return null;
    }
  }
}
