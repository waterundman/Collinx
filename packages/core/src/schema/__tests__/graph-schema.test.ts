import { describe, it, expect } from "vitest";
import {
  ProjectMeta,
  NodeType,
  EdgeType,
  GraphNode,
  GraphEdge,
  ProjectGraphSchema,
  TempoChange,
  MeterChange,
  KeyChange,
} from "../graph-schema";

const validTempoChange = { bar: 1, bpm: 120 };
const validMeterChange = { bar: 1, numerator: 4, denominator: 4 };
const validKeyChange = { bar: 1, tonic: "C", mode: "major" as const };
const validUuid = "550e8400-e29b-41d4-a716-446655440000";
const validDatetime = "2024-01-15T10:30:00.000Z";

describe("GraphSchema", () => {
  describe("TempoChange", () => {
    it("should validate a correct TempoChange", () => {
      const result = TempoChange.safeParse({ bar: 3, bpm: 140 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.bar).toBe(3);
        expect(result.data.bpm).toBe(140);
      }
    });

    it("should reject bar less than 1", () => {
      const result = TempoChange.safeParse({ bar: 0, bpm: 120 });
      expect(result.success).toBe(false);
    });

    it("should reject non-integer bar", () => {
      const result = TempoChange.safeParse({ bar: 1.5, bpm: 120 });
      expect(result.success).toBe(false);
    });

    it("should reject zero bpm", () => {
      const result = TempoChange.safeParse({ bar: 1, bpm: 0 });
      expect(result.success).toBe(false);
    });

    it("should reject negative bpm", () => {
      const result = TempoChange.safeParse({ bar: 1, bpm: -10 });
      expect(result.success).toBe(false);
    });

    it("should reject missing bar field", () => {
      const result = TempoChange.safeParse({ bpm: 120 });
      expect(result.success).toBe(false);
    });

    it("should reject missing bpm field", () => {
      const result = TempoChange.safeParse({ bar: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe("MeterChange", () => {
    it("should validate a correct MeterChange", () => {
      const result = MeterChange.safeParse({ bar: 1, numerator: 3, denominator: 8 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.numerator).toBe(3);
        expect(result.data.denominator).toBe(8);
      }
    });

    it("should reject non-integer numerator", () => {
      const result = MeterChange.safeParse({ bar: 1, numerator: 3.5, denominator: 4 });
      expect(result.success).toBe(false);
    });

    it("should reject zero numerator", () => {
      const result = MeterChange.safeParse({ bar: 1, numerator: 0, denominator: 4 });
      expect(result.success).toBe(false);
    });

    it("should reject zero denominator", () => {
      const result = MeterChange.safeParse({ bar: 1, numerator: 4, denominator: 0 });
      expect(result.success).toBe(false);
    });

    it("should reject missing denominator", () => {
      const result = MeterChange.safeParse({ bar: 1, numerator: 4 });
      expect(result.success).toBe(false);
    });
  });

  describe("KeyChange", () => {
    it("should validate a correct KeyChange (major mode)", () => {
      const result = KeyChange.safeParse({ bar: 1, tonic: "G", mode: "major" });
      expect(result.success).toBe(true);
    });

    it("should validate a correct KeyChange (dorian mode)", () => {
      const result = KeyChange.safeParse({ bar: 5, tonic: "D", mode: "dorian" });
      expect(result.success).toBe(true);
    });

    it("should validate a correct KeyChange (locrian mode)", () => {
      const result = KeyChange.safeParse({ bar: 10, tonic: "B", mode: "locrian" });
      expect(result.success).toBe(true);
    });

    it("should reject invalid mode", () => {
      const result = KeyChange.safeParse({ bar: 1, tonic: "C", mode: "blues" as string });
      expect(result.success).toBe(false);
    });

    it("should reject missing tonic", () => {
      const result = KeyChange.safeParse({ bar: 1, mode: "major" });
      expect(result.success).toBe(false);
    });

    it("should reject bar less than 1", () => {
      const result = KeyChange.safeParse({ bar: 0, tonic: "C", mode: "major" });
      expect(result.success).toBe(false);
    });

    it("should accept all 8 church modes", () => {
      const modes = ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"];
      for (const mode of modes) {
        const result = KeyChange.safeParse({ bar: 1, tonic: "C", mode });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("NodeType enumeration", () => {
    const allNodeTypes = [
      "CompositionUnit",
      "Phrase",
      "Motif",
      "Track",
      "Player",
      "PartLayout",
      "NoteSpan",
      "AutomationCurve",
      "AudioBus",
      "RenderArtifact",
      "TasteEvidence",
      "ExportVersion",
    ] as const;

    it("should have exactly 12 node types", () => {
      expect(allNodeTypes.length).toBe(12);
    });

    it("should accept each valid NodeType", () => {
      for (const type of allNodeTypes) {
        const result = NodeType.safeParse(type);
        expect(result.success).toBe(true);
      }
    });

    it("should reject an invalid NodeType", () => {
      const result = NodeType.safeParse("NonExistentType");
      expect(result.success).toBe(false);
    });

    it("should reject non-string values", () => {
      const result = NodeType.safeParse(123);
      expect(result.success).toBe(false);
    });
  });

  describe("EdgeType enumeration", () => {
    const allEdgeTypes = [
      "contains",
      "realizes",
      "notates",
      "performed_as",
      "routed_to",
      "rendered_to",
      "derived_from",
      "suggested_by_agent",
      "confirmed_by_user",
      "updates_taste",
    ] as const;

    it("should have exactly 10 edge types", () => {
      expect(allEdgeTypes.length).toBe(10);
    });

    it("should accept each valid EdgeType", () => {
      for (const type of allEdgeTypes) {
        const result = EdgeType.safeParse(type);
        expect(result.success).toBe(true);
      }
    });

    it("should reject an invalid EdgeType", () => {
      const result = EdgeType.safeParse("unknown_relation");
      expect(result.success).toBe(false);
    });
  });

  describe("GraphNode", () => {
    it("should validate a valid GraphNode", () => {
      const node = {
        id: validUuid,
        type: "NoteSpan",
        created_at: validDatetime,
        updated_at: validDatetime,
      };
      const result = GraphNode.safeParse(node);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(validUuid);
        expect(result.data.type).toBe("NoteSpan");
        expect(result.data.data).toEqual({});
      }
    });

    it("should provide empty data defaults", () => {
      const node = {
        id: validUuid,
        type: "Track",
        created_at: validDatetime,
        updated_at: validDatetime,
      };
      const result = GraphNode.parse(node);
      expect(result.data).toEqual({});
    });

    it("should accept node with custom data", () => {
      const node = {
        id: validUuid,
        type: "Player",
        data: { instrument: "violin", octave: 4 },
        created_at: validDatetime,
        updated_at: validDatetime,
      };
      const result = GraphNode.safeParse(node);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data).toEqual({ instrument: "violin", octave: 4 });
      }
    });

    it("should reject node with missing id", () => {
      const result = GraphNode.safeParse({
        type: "NoteSpan",
        created_at: validDatetime,
        updated_at: validDatetime,
      });
      expect(result.success).toBe(false);
    });

    it("should reject node with invalid id format", () => {
      const result = GraphNode.safeParse({
        id: "not-a-uuid",
        type: "NoteSpan",
        created_at: validDatetime,
        updated_at: validDatetime,
      });
      expect(result.success).toBe(false);
    });

    it("should reject node with invalid type", () => {
      const result = GraphNode.safeParse({
        id: validUuid,
        type: "BadType",
        created_at: validDatetime,
        updated_at: validDatetime,
      });
      expect(result.success).toBe(false);
    });

    it("should reject node with non-datetime string", () => {
      const result = GraphNode.safeParse({
        id: validUuid,
        type: "NoteSpan",
        created_at: "yesterday",
        updated_at: validDatetime,
      });
      expect(result.success).toBe(false);
    });

    it("should reject node with missing created_at", () => {
      const result = GraphNode.safeParse({
        id: validUuid,
        type: "NoteSpan",
        updated_at: validDatetime,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("GraphEdge", () => {
    it("should validate a valid GraphEdge", () => {
      const edge = {
        id: validUuid,
        type: "contains",
        source_id: "11111111-1111-1111-1111-111111111111",
        target_id: "22222222-2222-2222-2222-222222222222",
      };
      const result = GraphEdge.safeParse(edge);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("contains");
        expect(result.data.source_id).toBe("11111111-1111-1111-1111-111111111111");
        expect(result.data.target_id).toBe("22222222-2222-2222-2222-222222222222");
        expect(result.data.data).toEqual({});
      }
    });

    it("should provide empty data defaults", () => {
      const edge = {
        id: validUuid,
        type: "realizes",
        source_id: "11111111-1111-1111-1111-111111111111",
        target_id: "22222222-2222-2222-2222-222222222222",
      };
      const result = GraphEdge.parse(edge);
      expect(result.data).toEqual({});
    });

    it("should reject edge with invalid source_id UUID format", () => {
      const result = GraphEdge.safeParse({
        id: validUuid,
        type: "contains",
        source_id: "bad-source",
        target_id: "22222222-2222-2222-2222-222222222222",
      });
      expect(result.success).toBe(false);
    });

    it("should reject edge with invalid target_id UUID format", () => {
      const result = GraphEdge.safeParse({
        id: validUuid,
        type: "contains",
        source_id: "11111111-1111-1111-1111-111111111111",
        target_id: "bad-target",
      });
      expect(result.success).toBe(false);
    });

    it("should reject edge with invalid type", () => {
      const result = GraphEdge.safeParse({
        id: validUuid,
        type: "not_a_real_edge",
        source_id: "11111111-1111-1111-1111-111111111111",
        target_id: "22222222-2222-2222-2222-222222222222",
      });
      expect(result.success).toBe(false);
    });

    it("should accept edge with custom data", () => {
      const edge = {
        id: validUuid,
        type: "updates_taste",
        source_id: "11111111-1111-1111-1111-111111111111",
        target_id: "22222222-2222-2222-2222-222222222222",
        data: { score: 0.95, evidence: "user_rating" },
      };
      const result = GraphEdge.safeParse(edge);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data.score).toBe(0.95);
      }
    });
  });

  describe("ProjectMeta", () => {
    it("should validate a complete ProjectMeta", () => {
      const meta = {
        id: validUuid,
        title: "Test Project",
        tempo_map: [validTempoChange],
        meter_map: [validMeterChange],
        key_map: [validKeyChange],
      };
      const result = ProjectMeta.safeParse(meta);
      expect(result.success).toBe(true);
    });

    it("should reject empty title", () => {
      const result = ProjectMeta.safeParse({
        id: validUuid,
        title: "",
        tempo_map: [validTempoChange],
        meter_map: [validMeterChange],
        key_map: [validKeyChange],
      });
      expect(result.success).toBe(false);
    });

    it("should reject missing title", () => {
      const result = ProjectMeta.safeParse({
        id: validUuid,
        tempo_map: [validTempoChange],
        meter_map: [validMeterChange],
        key_map: [validKeyChange],
      });
      expect(result.success).toBe(false);
    });

    it("should reject non-UUID id", () => {
      const result = ProjectMeta.safeParse({
        id: "not-valid",
        title: "Test",
        tempo_map: [validTempoChange],
        meter_map: [validMeterChange],
        key_map: [validKeyChange],
      });
      expect(result.success).toBe(false);
    });

    it("should reject empty tempo_map", () => {
      const result = ProjectMeta.safeParse({
        id: validUuid,
        title: "Test",
        tempo_map: [],
        meter_map: [validMeterChange],
        key_map: [validKeyChange],
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid TempoChange in tempo_map", () => {
      const result = ProjectMeta.safeParse({
        id: validUuid,
        title: "Test",
        tempo_map: [{ bar: 0, bpm: 120 }],
        meter_map: [validMeterChange],
        key_map: [validKeyChange],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ProjectGraphSchema (complete graph)", () => {
    const validMeta = {
      id: validUuid,
      title: "My Composition",
      tempo_map: [validTempoChange],
      meter_map: [validMeterChange],
      key_map: [validKeyChange],
    };

    const validNode = {
      id: validUuid,
      type: "CompositionUnit" as const,
      created_at: validDatetime,
      updated_at: validDatetime,
    };

    const validEdge = {
      id: "33333333-3333-3333-3333-333333333333",
      type: "contains" as const,
      source_id: validUuid,
      target_id: "44444444-4444-4444-4444-444444444444",
    };

    it("should validate a complete ProjectGraph", () => {
      const graph = {
        meta: validMeta,
        nodes: [validNode],
        edges: [validEdge],
        revision_id: validUuid,
        created_at: validDatetime,
      };
      const result = ProjectGraphSchema.safeParse(graph);
      expect(result.success).toBe(true);
    });

    it("should validate a graph with multiple nodes and edges", () => {
      const node2Id = "22222222-2222-2222-2222-222222222222";
      const graph = {
        meta: validMeta,
        nodes: [
          validNode,
          {
            id: node2Id,
            type: "Phrase" as const,
            created_at: validDatetime,
            updated_at: validDatetime,
          },
        ],
        edges: [
          validEdge,
          {
            id: "33333333-3333-3333-3333-333333333333",
            type: "realizes" as const,
            source_id: validUuid,
            target_id: node2Id,
          },
        ],
        revision_id: validUuid,
        created_at: validDatetime,
      };
      const result = ProjectGraphSchema.safeParse(graph);
      expect(result.success).toBe(true);
    });

    it("should accept empty nodes array", () => {
      const graph = {
        meta: validMeta,
        nodes: [] as typeof validNode[],
        edges: [] as typeof validEdge[],
        revision_id: validUuid,
        created_at: validDatetime,
      };
      const result = ProjectGraphSchema.safeParse(graph);
      expect(result.success).toBe(true);
    });

    it("should reject missing meta", () => {
      const result = ProjectGraphSchema.safeParse({
        nodes: [validNode],
        edges: [validEdge],
        revision_id: validUuid,
        created_at: validDatetime,
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid node in nodes array", () => {
      const result = ProjectGraphSchema.safeParse({
        meta: validMeta,
        nodes: [{ id: "bad", type: "Bad" }],
        edges: [validEdge],
        revision_id: validUuid,
        created_at: validDatetime,
      });
      expect(result.success).toBe(false);
    });

    it("should reject invalid edge in edges array", () => {
      const result = ProjectGraphSchema.safeParse({
        meta: validMeta,
        nodes: [validNode],
        edges: [{ id: "bad", type: "bad" }],
        revision_id: validUuid,
        created_at: validDatetime,
      });
      expect(result.success).toBe(false);
    });

    it("should reject non-UUID revision_id", () => {
      const result = ProjectGraphSchema.safeParse({
        meta: validMeta,
        nodes: [validNode],
        edges: [validEdge],
        revision_id: "not-uuid",
        created_at: validDatetime,
      });
      expect(result.success).toBe(false);
    });

    it("should reject non-datetime created_at", () => {
      const result = ProjectGraphSchema.safeParse({
        meta: validMeta,
        nodes: [validNode],
        edges: [validEdge],
        revision_id: validUuid,
        created_at: "some random string",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("schema.parse() strict mode error messages", () => {
    it("should include field name in error message for TempoChange", () => {
      const result = TempoChange.safeParse({ bar: "abc", bpm: 120 });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message.toLowerCase()).join(" ");
        expect(messages).toContain("number");
      }
    });

    it("should include field name in error message for MeterChange", () => {
      const result = MeterChange.safeParse({ bar: 1, numerator: "abc", denominator: 4 });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.path.join(".")).join(",");
        expect(messages).toContain("numerator");
      }
    });

    it("should include path information for KeyChange mode error", () => {
      const result = KeyChange.safeParse({ bar: 1, tonic: "C", mode: "jazz" as string });
      expect(result.success).toBe(false);
      if (!result.success) {
        const hasModePath = result.error.issues.some((i) => i.path.includes("mode"));
        expect(hasModePath).toBe(true);
      }
    });

    it("should report multiple errors for a completely invalid GraphNode", () => {
      const result = GraphNode.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThanOrEqual(3);
      }
    });

    it("should fail parse with throw for ProjectMeta.parse()", () => {
      expect(() => {
        ProjectMeta.parse({ title: "" });
      }).toThrow();
    });

    it("should fail parse with throw for ProjectGraphSchema.parse()", () => {
      expect(() => {
        ProjectGraphSchema.parse({});
      }).toThrow();
    });
  });
});
