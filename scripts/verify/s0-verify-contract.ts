// S0 合约对齐实测：v1.22 (e1fedfb) vs 当前实现，对 v1.22 输入形态输出等价性
import * as oldHp from "./old/harmony-plan";
import * as newHp from "../../项目仓库/Collinx-new/packages/core/src/model/harmony-plan";
import { midiToSpelling, type NoteEvent } from "./old/note-event";

function note(bar: number, beat: number, pitchMidi: number, durQn = 1): NoteEvent {
  return {
    id: `v-${bar}-${beat}-${pitchMidi}`,
    trackId: "chords",
    phraseId: null,
    bar,
    beat,
    durQn,
    pitchMidi,
    pitchSpelling: midiToSpelling(pitchMidi),
    velocity: 0.8,
    voice: "rh",
    tags: [],
  };
}

const key = { tonic: "C", mode: "major" };

const cases: Array<{ name: string; notes: NoteEvent[]; key?: typeof key }> = [
  {
    // v1.22 S0-T05: 单和弦 bar，beat=最小 beat，durationQn=跨度
    name: "single-chord bar (C maj, dur4)",
    notes: [note(1, 1, 60, 4), note(1, 1, 64, 4), note(1, 1, 67, 4)],
  },
  {
    // v1.22 S0-T05: 琶音 bar，durationQn=跨度 3
    name: "arpeggio bar (A min, dur3)",
    notes: [note(3, 1, 57, 1), note(3, 2, 60, 1), note(3, 3, 64, 1)],
  },
  {
    // v1.22 S0-T06: 多 bar 排序 + RN 填充 + 无法识别 bar 跳过
    name: "multi-bar sort + RN + unrecognized bar skipped",
    notes: [
      note(1, 1, 60, 4), note(1, 1, 64, 4), note(1, 1, 67, 4),
      note(4, 1, 60, 4), note(4, 1, 62, 4), note(4, 1, 67, 4),
      note(3, 1, 57, 1), note(3, 2, 60, 1), note(3, 3, 64, 1),
    ],
    key,
  },
  {
    // v1.22 S0-T05: G7 dom7 bar
    name: "dom7 bar (G7)",
    notes: [note(2, 1, 67, 4), note(2, 1, 71, 4), note(2, 1, 74, 4), note(2, 1, 77, 4)],
    key,
  },
];

let allEq = true;
for (const c of cases) {
  const oldOut = oldHp.notesToHarmonyEntries(c.notes, c.key);
  const newOut = newHp.notesToHarmonyEntries(c.notes, c.key);
  const o = JSON.stringify(oldOut);
  const n = JSON.stringify(newOut);
  const eq = o === n;
  if (!eq) allEq = false;
  console.log(`${eq ? "EQ " : "DIFF"} | ${c.name}`);
  console.log(`  old: ${o}`);
  if (!eq) console.log(`  new: ${n}`);
}
console.log(allEq ? "CONTRACT-ALIGNED: all cases equivalent" : "CONTRACT-BROKEN");
process.exit(allEq ? 0 : 1);
