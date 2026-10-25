import { describe, it, expect } from "vitest";
import { groupNotesForStaves } from "../note-grouping";
import { createNoteEvent, type NoteEvent } from "@collinx/core";

/** v2.9.6：谱面音符分组规则（同时性聚合 + 整组谱表归属）。 */
const TWO_STAFF = [{ clef: "treble" }, { clef: "bass" }];
const ONE_STAFF = [{ clef: "treble" }];

function note(over: Partial<NoteEvent> & { id: string }): NoteEvent {
  return createNoteEvent({
    trackId: "t",
    bar: 1,
    beat: 1,
    durQn: 2,
    pitchMidi: 60,
    ...over,
  } as Parameters<typeof createNoteEvent>[0]);
}

describe("groupNotesForStaves —— 同时性聚合", () => {
  it("同小节同拍同值的 3 个音聚成 1 组（键位按音高升序）", () => {
    const groups = groupNotesForStaves(
      [
        note({ id: "a", pitchMidi: 64, pitchSpelling: "E4" }),
        note({ id: "b", pitchMidi: 57, pitchSpelling: "A3" }),
        note({ id: "c", pitchMidi: 60, pitchSpelling: "C4" }),
      ],
      TWO_STAFF,
    );
    const all = groups.flat();
    expect(all).toHaveLength(1);
    expect(all[0]!.notes.map((n) => n.pitchMidi)).toEqual([57, 60, 64]);
  });

  it("拍点或时值不同 → 不聚合", () => {
    const groups = groupNotesForStaves(
      [
        note({ id: "a", pitchMidi: 60, beat: 1, durQn: 2 }),
        note({ id: "b", pitchMidi: 62, beat: 2, durQn: 2 }),
        note({ id: "c", pitchMidi: 64, beat: 1, durQn: 1 }),
      ],
      TWO_STAFF,
    );
    expect(groups.flat()).toHaveLength(3);
  });

  it("跨小节不聚合", () => {
    const groups = groupNotesForStaves(
      [
        note({ id: "a", pitchMidi: 60, bar: 1 }),
        note({ id: "b", pitchMidi: 64, bar: 2 }),
      ],
      TWO_STAFF,
    );
    expect(groups.flat()).toHaveLength(2);
  });
});

describe("groupNotesForStaves —— 谱表归属", () => {
  it("和弦整组走低音谱表（最低音 < 60），不再被音高阈值拆散", () => {
    // 旧实现：57→低音谱表、60/64→高音谱表（和弦散架）
    const groups = groupNotesForStaves(
      [
        note({ id: "a", pitchMidi: 57, pitchSpelling: "A3" }),
        note({ id: "b", pitchMidi: 60, pitchSpelling: "C4" }),
        note({ id: "c", pitchMidi: 64, pitchSpelling: "E4" }),
      ],
      TWO_STAFF,
    );
    const [treble, bass] = groups;
    expect(treble).toHaveLength(0);
    expect(bass).toHaveLength(1);
    expect(bass![0]!.notes).toHaveLength(3);
  });

  it("单音行为与旧的按音高分配一致（≥60 高音谱表）", () => {
    const groups = groupNotesForStaves(
      [
        note({ id: "hi", pitchMidi: 64, pitchSpelling: "E4", beat: 1 }),
        note({ id: "lo", pitchMidi: 48, pitchSpelling: "C3", beat: 2 }),
      ],
      TWO_STAFF,
    );
    expect(groups[0]).toHaveLength(1);
    expect(groups[1]).toHaveLength(1);
  });

  it("单谱表布局全部进 staff 0（不同拍点，避免被同时性聚合）", () => {
    const groups = groupNotesForStaves(
      [
        note({ id: "hi", pitchMidi: 72, pitchSpelling: "C5", beat: 1 }),
        note({ id: "lo", pitchMidi: 43, pitchSpelling: "G2", beat: 2 }),
      ],
      ONE_STAFF,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });
});
