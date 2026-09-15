import { describe, it, expect } from "vitest";
import {
  DiffEngine,
  TempoMap,
  createNoteEvent,
  createDiffEnvelope,
} from "@collinx/core";
import {
  createInitialState,
  createProjectReducer,
  type ProjectStoreAction,
} from "../../store/project-store";

/**
 * Stage 0 (v2.1.0) T28: tempo/meter as first-class UNDOABLE store data, with
 * graph.meta as the SINGLE SOURCE OF TRUTH.
 *
 * These tests drive the reducer directly (no React/Provider) so they exercise
 * SET_TEMPO / SET_METER + snapshot/undo wiring without pulling in the UI
 * provider. createProjectReducer needs a DiffEngine instance, but
 * SET_TEMPO / SET_METER / UNDO / REDO never touch it.
 *
 * After the graph-native refactor, tempo/meter live on `graph.getMeta()`
 * (which is what `.agentmusic` serializes and what Agent-native consumers
 * read). `state.tempoChanges` / `state.meterChanges` are a derived projection
 * of that meta, so we assert BOTH stay in lockstep.
 */
function makeState() {
  const engine = new DiffEngine();
  const reducer = createProjectReducer(engine);
  let state = createInitialState({});
  return {
    get state() {
      return state;
    },
    dispatch(action: ProjectStoreAction) {
      state = reducer(state, action);
      return state;
    },
  };
}

describe("tempo/meter store (T28, graph-native)", () => {
  it("defaults: graph.meta and projection both carry bar1/120 and bar1/4-4", () => {
    const s = makeState();
    expect(s.state.graph.getMeta().tempo_map).toEqual([{ bar: 1, bpm: 120 }]);
    expect(s.state.graph.getMeta().meter_map).toEqual([
      { bar: 1, numerator: 4, denominator: 4 },
    ]);
    // projection mirrors the authoritative graph.meta
    expect(s.state.tempoChanges).toEqual(s.state.graph.getMeta().tempo_map);
    expect(s.state.meterChanges).toEqual(s.state.graph.getMeta().meter_map);
  });

  it("SET_TEMPO: new bar appended + sorted, graph.meta and projection agree", () => {
    const s = makeState();
    s.dispatch({ type: "SET_TEMPO", bar: 5, bpm: 90 });
    s.dispatch({ type: "SET_TEMPO", bar: 2, bpm: 140 });
    const expected = [
      { bar: 1, bpm: 120 },
      { bar: 2, bpm: 140 },
      { bar: 5, bpm: 90 },
    ];
    expect(s.state.graph.getMeta().tempo_map).toEqual(expected);
    expect(s.state.tempoChanges).toEqual(expected);
  });

  it("SET_TEMPO: same bar overwrites (no duplicate) and carries curve", () => {
    const s = makeState();
    s.dispatch({ type: "SET_TEMPO", bar: 1, bpm: 90 });
    s.dispatch({ type: "SET_TEMPO", bar: 1, bpm: 75, curve: "linear" });
    const expected = [{ bar: 1, bpm: 75, curve: "linear" }];
    expect(s.state.graph.getMeta().tempo_map).toEqual(expected);
    expect(s.state.tempoChanges).toEqual(expected);
  });

  it("SET_METER: new bar appended + sorted, same bar overwritten", () => {
    const s = makeState();
    s.dispatch({ type: "SET_METER", bar: 3, numerator: 3, denominator: 4 });
    s.dispatch({ type: "SET_METER", bar: 2, numerator: 2, denominator: 4 });
    s.dispatch({ type: "SET_METER", bar: 3, numerator: 5, denominator: 8 });
    const expected = [
      { bar: 1, numerator: 4, denominator: 4 },
      { bar: 2, numerator: 2, denominator: 4 },
      { bar: 3, numerator: 5, denominator: 8 },
    ];
    expect(s.state.graph.getMeta().meter_map).toEqual(expected);
    expect(s.state.meterChanges).toEqual(expected);
  });

  it("SET_TEMPO undo/redo round-trip via graph.meta", () => {
    const s = makeState();
    s.dispatch({ type: "SET_TEMPO", bar: 3, bpm: 90 });
    expect(s.state.graph.getMeta().tempo_map).toEqual([
      { bar: 1, bpm: 120 },
      { bar: 3, bpm: 90 },
    ]);
    // undo -> graph.meta back to default
    s.dispatch({ type: "UNDO" });
    expect(s.state.graph.getMeta().tempo_map).toEqual([{ bar: 1, bpm: 120 }]);
    expect(s.state.tempoChanges).toEqual([{ bar: 1, bpm: 120 }]);
    // redo -> re-applied
    s.dispatch({ type: "REDO" });
    expect(s.state.graph.getMeta().tempo_map).toEqual([
      { bar: 1, bpm: 120 },
      { bar: 3, bpm: 90 },
    ]);
    expect(s.state.tempoChanges).toEqual([
      { bar: 1, bpm: 120 },
      { bar: 3, bpm: 90 },
    ]);
  });

  it("SET_METER undo/redo round-trip via graph.meta", () => {
    const s = makeState();
    s.dispatch({ type: "SET_METER", bar: 2, numerator: 3, denominator: 4 });
    expect(s.state.graph.getMeta().meter_map).toEqual([
      { bar: 1, numerator: 4, denominator: 4 },
      { bar: 2, numerator: 3, denominator: 4 },
    ]);
    s.dispatch({ type: "UNDO" });
    expect(s.state.graph.getMeta().meter_map).toEqual([
      { bar: 1, numerator: 4, denominator: 4 },
    ]);
    expect(s.state.meterChanges).toEqual([
      { bar: 1, numerator: 4, denominator: 4 },
    ]);
    s.dispatch({ type: "REDO" });
    expect(s.state.graph.getMeta().meter_map).toEqual([
      { bar: 1, numerator: 4, denominator: 4 },
      { bar: 2, numerator: 3, denominator: 4 },
    ]);
    expect(s.state.meterChanges).toEqual([
      { bar: 1, numerator: 4, denominator: 4 },
      { bar: 2, numerator: 3, denominator: 4 },
    ]);
  });

  it("SET_TEMPO: invalid bar (0 / negative / fractional) is a no-op on graph.meta", () => {
    const s = makeState();
    s.dispatch({ type: "SET_TEMPO", bar: 0, bpm: 90 });
    s.dispatch({ type: "SET_TEMPO", bar: -2, bpm: 90 });
    s.dispatch({ type: "SET_TEMPO", bar: 2.5, bpm: 90 });
    expect(s.state.graph.getMeta().tempo_map).toEqual([{ bar: 1, bpm: 120 }]);
    expect(s.state.tempoChanges).toEqual([{ bar: 1, bpm: 120 }]);
  });

  it("SET_METER: invalid bar (0 / negative / fractional) is a no-op on graph.meta", () => {
    const s = makeState();
    s.dispatch({ type: "SET_METER", bar: 0, numerator: 3, denominator: 4 });
    s.dispatch({ type: "SET_METER", bar: -1, numerator: 3, denominator: 4 });
    s.dispatch({ type: "SET_METER", bar: 1.5, numerator: 3, denominator: 4 });
    expect(s.state.graph.getMeta().meter_map).toEqual([
      { bar: 1, numerator: 4, denominator: 4 },
    ]);
    expect(s.state.meterChanges).toEqual([
      { bar: 1, numerator: 4, denominator: 4 },
    ]);
  });

  // SEV1 regression gate: a tempo/meter edit must NEVER wipe the musical
  // content. withMeta carries the full node/edge set, so the note added
  // before the tempo edit is still on the graph afterwards, state.notes is
  // unchanged, and the tempo_map is updated — all three at once.
  it("cross: ADD_NOTE then SET_TEMPO — the note survives the tempo edit", () => {
    const s = makeState();
    const note = createNoteEvent({
      trackId: "melody",
      bar: 1,
      beat: 1,
      durQn: 1,
      pitchMidi: 60,
    });
    s.dispatch({ type: "ADD_NOTE", note });
    expect(s.state.notes).toHaveLength(1);

    s.dispatch({ type: "SET_TEMPO", bar: 1, bpm: 90 });

    // 1) graph.toJSON() still contains the NoteSpan node
    const span = s.state.graph
      .toJSON()
      .nodes.find((n) => n.type === "NoteSpan");
    expect(span).toBeDefined();
    expect((span!.data as Record<string, unknown>).pitchMidi).toBe(60);
    // 2) state.notes unchanged
    expect(s.state.notes).toHaveLength(1);
    expect(s.state.notes[0].pitchMidi).toBe(60);
    // 3) graph.meta tempo_map updated, projection in lockstep
    expect(s.state.graph.getMeta().tempo_map).toEqual([{ bar: 1, bpm: 90 }]);
    expect(s.state.tempoChanges).toEqual([{ bar: 1, bpm: 90 }]);
  });

  // S0-D2 regression gate: ROLLBACK_DIFF restores graph.meta from the
  // pre-diff snapshot, and the tempo/meter projection must be re-derived
  // from the restored graph (this path returns directly, without withUndo).
  it("S0-D2: diff rollback restores tempo_map and the projection stays in lockstep", () => {
    const s = makeState();
    const diff = createDiffEnvelope({
      baseRevision: s.state.graph.getRevisionId(),
      actor: { type: "user", name: "test" },
      permissionScope: "write_direct",
      summary: "set tempo via diff",
      ops: [
        {
          op: "update_meta",
          path: "/meta",
          data: { tempo_map: [{ bar: 1, bpm: 90 }] },
        },
      ],
    });

    s.dispatch({ type: "APPLY_DIFF", diff });
    expect(s.state.graph.getMeta().tempo_map).toEqual([{ bar: 1, bpm: 90 }]);
    expect(s.state.tempoChanges).toEqual([{ bar: 1, bpm: 90 }]);

    s.dispatch({ type: "ROLLBACK_DIFF", rollbackToken: diff.rollbackToken });
    // graph.meta rolled back to the pre-diff default...
    expect(s.state.graph.getMeta().tempo_map).toEqual([{ bar: 1, bpm: 120 }]);
    // ...and the projection was re-derived from the restored graph (no drift)
    expect(s.state.tempoChanges).toEqual([{ bar: 1, bpm: 120 }]);
    expect(s.state.tempoChanges).toEqual(s.state.graph.getMeta().tempo_map);
  });
});


// ---------------------------------------------------------------------------
// v2.1.0 S1: TempoMap 派生（T26 / T27 / T30）
//   store 的 tempoChanges/meterChanges 是 graph.meta 的投影；App 侧以
//   new TempoMap(tempoChanges, meterChanges) 派生播放引擎实际消费的时间表。
//   这里验证「改 store → 派生结果正确」与「默认值 ≡ TempoMap.default()」。
// ---------------------------------------------------------------------------

describe("tempo map derivation (T26 / T27 / T30, S1)", () => {
  it("T26: SET_TEMPO(1, 90) → 派生 TempoMap.bpmAt 全曲生效", () => {
    const s = makeState();
    s.dispatch({ type: "SET_TEMPO", bar: 1, bpm: 90 });
    const tm = new TempoMap(s.state.tempoChanges, s.state.meterChanges);
    expect(tm.bpmAt(1, 1)).toBe(90);
    expect(tm.bpmAt(5, 1)).toBe(90);
  });

  it("T27: SET_METER(1, 3/4) → 派生 TempoMap.meterAt 变化，beatsPerBar=3", () => {
    const s = makeState();
    s.dispatch({ type: "SET_METER", bar: 1, numerator: 3, denominator: 4 });
    const tm = new TempoMap(s.state.tempoChanges, s.state.meterChanges);
    expect(tm.meterAt(1)).toEqual({ numerator: 3, denominator: 4 });
    const m = tm.meterAt(1);
    expect(m.numerator * (4 / m.denominator)).toBe(3); // 归一化（与 Tone.js 同规则）
  });

  it("T30: 默认 store → 派生 TempoMap 与 TempoMap.default() 逐字段等价（回归门）", () => {
    const s = makeState();
    const derived = new TempoMap(s.state.tempoChanges, s.state.meterChanges);
    const def = TempoMap.default();
    expect(derived.bpmAt(1, 1)).toBe(def.bpmAt(1, 1));
    expect(derived.meterAt(1)).toEqual(def.meterAt(1));
    expect(derived.keyAt(1)).toEqual(def.keyAt(1));
    expect(derived.timeAt(3, 2)).toBe(def.timeAt(3, 2));
    expect(derived.timeAt(5, 3)).toBe(def.timeAt(5, 3));
    expect(derived.barBeatAt(def.timeAt(5, 3))).toEqual(def.barBeatAt(def.timeAt(5, 3)));
  });
});
