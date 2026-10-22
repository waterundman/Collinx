import { z } from "zod";

export const NodeType = z.enum([
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
  "AgentDecision",
  /**
   * 和弦事件（v2.8.0）。
   *
   * data 形状对齐 `HarmonyEntry`（core/src/model/harmony-plan.ts）：
   * `{ bar, beat, durationQn, chord: { root, quality, bass?, extensions? }, romanNumeral? }`。
   *
   * 为什么进图而不是塞进 mixer/settings：和弦是**作品内容**，不是混音设置；
   * 进图后 diff/undo/审批/.agentmusic 全链路自动生效，无需另开序列化路径。
   */
  "ChordEvent",
]);

export type NodeType = z.infer<typeof NodeType>;

export const EdgeType = z.enum([
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
]);

export type EdgeType = z.infer<typeof EdgeType>;

export const TempoChange = z.object({
  bar: z.number().int().min(1),
  bpm: z.number().positive(),
  // Stage 0 (v2.1.0): tempo ramp shape, optional (instant by default). Kept
  // optional so the schema stays backward-compatible and the field survives
  // graph JSON round-trips (it is part of the canonical tempo_map in the
  // store, which is the single source of truth now).
  curve: z.enum(["instant", "linear", "ease_in", "ease_out"]).optional(),
});

export const MeterChange = z.object({
  bar: z.number().int().min(1),
  numerator: z.number().int().positive(),
  denominator: z.number().int().positive(),
});

export const KeyChange = z.object({
  bar: z.number().int().min(1),
  tonic: z.string(),
  mode: z.enum(["major", "minor", "dorian", "phrygian", "lydian", "mixolydian", "aeolian", "locrian"]),
});

export const ProjectMeta = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  tempo_map: z.array(TempoChange),
  meter_map: z.array(MeterChange),
  key_map: z.array(KeyChange),
});

export type ProjectMeta = z.infer<typeof ProjectMeta>;

export const GraphNode = z.object({
  id: z.string().uuid(),
  type: NodeType,
  data: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type GraphNode = z.infer<typeof GraphNode>;

export const GraphEdge = z.object({
  id: z.string().uuid(),
  type: EdgeType,
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type GraphEdge = z.infer<typeof GraphEdge>;

export const ProjectGraphSchema = z.object({
  meta: ProjectMeta,
  nodes: z.array(GraphNode),
  edges: z.array(GraphEdge),
  revision_id: z.string().uuid(),
  created_at: z.string().datetime(),
});

export type ProjectGraphData = z.infer<typeof ProjectGraphSchema>;
