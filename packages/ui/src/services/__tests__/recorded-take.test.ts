/**
 * v2.2.0 S1 (T40-T43)：录制 take 转换 + 批量落盘测试。
 *
 * TempoMap.default() = 120bpm 4/4 → 1 拍 = 0.5s，bar 1 = [0, 2.0)。
 */
import { describe, it, expect } from "vitest";
import { DiffEngine, TempoMap, createNoteEvent } from "@collinx/core";
import { convertTakeToNotes } from "../recorded-take";
import {
  createInitialState,
  createProjectReducer,
  type ProjectStoreAction,
} from "../../store/project-store";

const tempoMap = TempoMap.default();

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

describe("convertTakeToNotes (T40-T43, v2.2.0 S1)", () => {
  it("T40: 时刻→落点/时长正确（grid=0 不量化；velocity live）", () => {
    const take = {
      notes: [
        { pitchMidi: 60, velocity: 100, onSeconds: 0.5, offSeconds: 1.25 },
      ],
      endSeconds: 2.0,
    };
    const notes = convertTakeToNotes(take, tempoMap, {
      quantizeGrid: 0,
      velocityMode: "live",
      fixedVelocity: 64,
    });
    expect(notes.length).toBe(1);
    expect(notes[0]!.bar).toBe(1);
    expect(notes[0]!.beat).toBe(2); // 0.5s = 1 拍 → bar1.beat2
    expect(notes[0]!.durQn).toBeCloseTo(1.5, 6); // 0.75s = 1.5 四分拍
    expect(notes[0]!.velocity).toBeCloseTo(100 / 127, 6);
    expect(notes[0]!.pitchMidi).toBe(60);
  });

  it("T41: quantizeGrid=0.25 → 落点 snap 到 16 分网格；负秒 clamp {1,1}；grid=0 不量化", () => {
    const take = {
      notes: [
        { pitchMidi: 60, velocity: 100, onSeconds: 0.55, offSeconds: 1.0 },
        { pitchMidi: 62, velocity: 100, onSeconds: 0.05, offSeconds: 0.5 },
        { pitchMidi: 64, velocity: 100, onSeconds: -1.0, offSeconds: -0.5 },
        { pitchMidi: 65, velocity: 100, onSeconds: 2.05, offSeconds: 2.5 },
      ],
      endSeconds: 3.0,
    };
    const notes = convertTakeToNotes(take, tempoMap, {
      quantizeGrid: 0.25,
      velocityMode: "live",
      fixedVelocity: 64,
    });
    // 0.55s → beat 1.1 → snap 1.0 → bar1.beat2
    expect(notes[0]!.bar).toBe(1);
    expect(notes[0]!.beat).toBe(2);
    // 0.05s → beat 0.1 → snap 0 → bar1.beat1（不越界）
    expect(notes[1]!.bar).toBe(1);
    expect(notes[1]!.beat).toBe(1);
    // 负秒（count-in 区）→ clamp {1,1}
    expect(notes[2]!.bar).toBe(1);
    expect(notes[2]!.beat).toBe(1);
    // 2.05s → beat 4.1 → snap 4.0 → bar2.beat1
    expect(notes[3]!.bar).toBe(2);
    expect(notes[3]!.beat).toBe(1);

    // grid=0 → 不量化（0.55s 停在 beat 2.1）
    const raw = convertTakeToNotes(take, tempoMap, {
      quantizeGrid: 0,
      velocityMode: "live",
      fixedVelocity: 64,
    });
    expect(raw[0]!.beat).toBeCloseTo(2.1, 6);
  });

  it("T42: velocityMode=live → 原始值；=fixed → settings.fixedVelocity（均 /127）", () => {
    const take = {
      notes: [{ pitchMidi: 60, velocity: 100, onSeconds: 0.5, offSeconds: 1.0 }],
      endSeconds: 2.0,
    };
    const live = convertTakeToNotes(take, tempoMap, {
      quantizeGrid: 0,
      velocityMode: "live",
      fixedVelocity: 64,
    });
    expect(live[0]!.velocity).toBeCloseTo(100 / 127, 6);
    const fixed = convertTakeToNotes(take, tempoMap, {
      quantizeGrid: 0,
      velocityMode: "fixed",
      fixedVelocity: 64,
    });
    expect(fixed[0]!.velocity).toBeCloseTo(64 / 127, 6);
  });

  it("T43: 多音符 take 全量转换 + ADD_NOTES 一条 undo 撤整个 take", () => {
    const take = {
      notes: [
        { pitchMidi: 60, velocity: 100, onSeconds: 0.5, offSeconds: 1.0 },
        { pitchMidi: 64, velocity: 90, onSeconds: 1.0, offSeconds: 1.5 },
        { pitchMidi: 67, velocity: 80, onSeconds: 1.5, offSeconds: 2.0 },
      ],
      endSeconds: 2.0,
    };
    const notes = convertTakeToNotes(take, tempoMap, {
      quantizeGrid: 0,
      velocityMode: "live",
      fixedVelocity: 64,
    });
    expect(notes.length).toBe(3);

    // 批量落盘：ADD_NOTES 一次 → notes 全入 store；undo 一次全撤
    const s = makeState();
    s.dispatch({ type: "ADD_NOTES", notes });
    expect(s.state.notes.length).toBe(3);
    s.dispatch({ type: "UNDO" });
    expect(s.state.notes.length).toBe(0);
    s.dispatch({ type: "REDO" });
    expect(s.state.notes.length).toBe(3);
  });

  it("T40b: 未闭合（按住未松）以 take.endSeconds 闭合；零长钳到 0.125", () => {
    const take = {
      notes: [
        { pitchMidi: 60, velocity: 100, onSeconds: 1.0, offSeconds: null },
        { pitchMidi: 62, velocity: 100, onSeconds: 1.5, offSeconds: 1.5 }, // 零长
      ],
      endSeconds: 2.0,
    };
    const notes = convertTakeToNotes(take, tempoMap, {
      quantizeGrid: 0,
      velocityMode: "live",
      fixedVelocity: 64,
    });
    // 未闭合：off = endSeconds 2.0 → durQn = (2.0-1.0)*2 = 2
    expect(notes[0]!.durQn).toBeCloseTo(2, 6);
    // 零长 → 0.125 下限
    expect(notes[1]!.durQn).toBe(0.125);
    void createNoteEvent; // 保持导入（实测经 convertTakeToNotes 内部使用）
  });
});
