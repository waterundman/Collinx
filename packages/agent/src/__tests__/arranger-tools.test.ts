import { describe, it, expect, beforeEach } from "vitest";
import {
  ToolRegistry,
  AgentBus,
  createNoteEvent,
  type NoteEvent,
} from "@collinx/core";
import { registerBuiltinTools } from "../tools";

function makeSourceNotes(): NoteEvent[] {
  return [
    createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 64 }),
    createNoteEvent({ trackId: "melody", bar: 1, beat: 2, durQn: 0.5, pitchMidi: 66 }),
    createNoteEvent({ trackId: "melody", bar: 1, beat: 3, durQn: 1, pitchMidi: 67 }),
  ];
}

describe("arranger.expandSection tool (real Arranger)", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerBuiltinTools(registry, new AgentBus());
  });

  it("T01: handler 调用真实 Arranger,返回变体而非 stub 固定消息 (critical)", async () => {
    const result = await registry.call(
      "arranger.expandSection",
      { source: makeSourceNotes(), bars: 4, style: "pop", variantCount: 3 },
      { type: "agent", name: "test" }
    );

    expect(result.status).toBe("ok");
    expect(result.resultType).toBe("proposal");
    expect(result.requiresUserConfirmation).toBe(true);

    const data = result.data as Record<string, unknown>;
    // The stub returned { message: "段落扩展 (stub - v0.1.0)" } — no variants,
    // no formStructure, fixed confidence 0.3. A real Arranger run must expose
    // variant data authored by the agent.
    expect(data.variants).toBeDefined();
    expect(Array.isArray(data.variants)).toBe(true);
    const variants = data.variants as {
      id: string;
      notes: NoteEvent[];
      operations: string[];
      variationScore: number;
      description: string;
    }[];
    expect(variants.length).toBeGreaterThan(0);
    for (const v of variants) {
      expect(v.id).toBeTruthy();
      expect(Array.isArray(v.notes)).toBe(true);
      expect(Array.isArray(v.operations)).toBe(true);
      expect(typeof v.variationScore).toBe("number");
      expect(typeof v.description).toBe("string");
    }
    expect(data.selectedVariant).toBeDefined();
    expect(data.formStructure).toBeDefined();
    expect(Array.isArray(data.energyCurvePoints)).toBe(true);

    // Real Arranger reports its own confidence (0.8 with variants), not the
    // stub's fixed 0.3.
    expect(typeof result.confidence).toBe("number");
    expect(result.confidence!).toBeGreaterThan(0.3);

    // DiffEnvelope contract: proposal diffs authored by the real Arranger.
    const diffs = (result as { diffs?: unknown }).diffs;
    expect(Array.isArray(diffs)).toBe(true);
    const diffList = diffs as {
      diffId: string;
      actor: { type: string; name: string };
      permissionScope: string;
      ops: unknown[];
    }[];
    expect(diffList.length).toBeGreaterThan(0);
    for (const d of diffList) {
      expect(d.diffId).toBeTruthy();
      expect(d.actor.type).toBe("agent");
      expect(d.actor.name).toBe("arranger");
      expect(d.permissionScope).toBe("proposal_only");
      expect(d.ops.length).toBeGreaterThan(0);
    }
    expect((result.diff as { diffId?: string } | undefined)?.diffId).toBeTruthy();
  });

  it("handles missing source gracefully (empty motif does not throw)", async () => {
    const result = await registry.call(
      "arranger.expandSection",
      { bars: 2 },
      { type: "agent", name: "test" }
    );

    expect(result.status).toBe("ok");
    const data = result.data as Record<string, unknown>;
    expect(Array.isArray(data.variants)).toBe(true);
    expect((data.variants as unknown[]).length).toBeGreaterThanOrEqual(0);
  });

  it("honors formTemplate/bars/variantCount parameters", async () => {
    const result = await registry.call(
      "arranger.expandSection",
      {
        source: makeSourceNotes(),
        bars: 8,
        formTemplate: "minimal",
        variantCount: 2,
      },
      { type: "agent", name: "test" }
    );

    expect(result.status).toBe("ok");
    const data = result.data as Record<string, unknown>;
    expect((data.variants as unknown[]).length).toBe(2);
    const formStructure = data.formStructure as {
      sections: { startBar: number; endBar: number }[];
    };
    expect(formStructure.sections[0].startBar).toBe(1);
    expect(formStructure.sections[0].endBar).toBe(8);
  });
});
