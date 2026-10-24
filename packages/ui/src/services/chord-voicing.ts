/**
 * 和弦 → 音高（v2.9.1）。
 *
 * ## 解决什么
 *
 * 和弦轨此前是**只画不响**：`SET_CHORD` 只写一个 `ChordEvent` 节点，
 * 播放/导出都只读 `NoteSpan`，于是「点一个 C 和弦，什么也没发生」。
 *
 * 现在写和弦时同时生成三个 `NoteSpan`（标记 `chordGenerated`），
 * 它是真实的、可编辑、可混音、可导出的音符 —— 不是播放期的隐形叠加。
 * 为什么不走「播放时投影」：那样谱面/钢琴卷看不到和弦，听到的和看到的
 * 不一致，而且删不掉。
 *
 * ## 音区与转位
 *
 * 和弦落在大字组附近（根音 C3 = MIDI 48），跨度 > 12 半音时向上转位，
 * 保证三和弦落在 48..59 内 —— 低音区不糊、也不与旋律抢。
 */

export interface ChordSpec {
  root: string;
  quality?: string;
  bass?: string;
}

/** 音名 → 音级（支持升号与降号） */
const PITCH_CLASS: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

/** 和弦性质 → 相对根音的半音集合（UI 与 agent 共用这几个拼写） */
const QUALITY_INTERVALS: Record<string, number[]> = {
  maj: [0, 4, 7],
  major: [0, 4, 7],
  "": [0, 4, 7],
  min: [0, 3, 7],
  minor: [0, 3, 7],
  m: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  sus: [0, 5, 7],
  "6": [0, 4, 7, 9],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
};

/** 和弦根音所在的基准八度：C3 = 48 */
export const CHORD_BASE_MIDI = 48;

/** 解析根音为音级；无法识别时返回 null（调用方跳过，不写错音） */
export function pitchClassOf(name: string | undefined): number | null {
  if (!name) return null;
  const key = name.trim();
  const direct = PITCH_CLASS[key];
  if (direct !== undefined) return direct;
  // 容忍 "c" / "bb" 之类的大小写
  const normalized = key[0]?.toUpperCase() + key.slice(1).toLowerCase();
  const alt = PITCH_CLASS[normalized];
  return alt === undefined ? null : alt;
}

/**
 * 把和弦展开成 MIDI 音高（升序，含转位）。
 *
 * 无法识别的根音/性质 → 只出根音（宁可少一个音，也不写一个错和弦）。
 */
export function chordPitches(chord: ChordSpec, baseMidi = CHORD_BASE_MIDI): number[] {
  const pc = pitchClassOf(chord.root);
  if (pc === null) return [];
  const intervals = QUALITY_INTERVALS[(chord.quality ?? "maj").trim()] ?? QUALITY_INTERVALS.maj;

  // 根音落在 baseMidi 之上最近的同名音
  const rootMidi = baseMidi + ((pc - (baseMidi % 12) + 12) % 12);
  let pitches = intervals.map((i) => rootMidi + i);

  // 转位：跨度超过一个八度时，把低音抬八度（保持音区集中）
  while (pitches[pitches.length - 1] - pitches[0] > 12) {
    const lowest = pitches.shift()!;
    pitches.push(lowest + 12);
    pitches = [...pitches].sort((a, b) => a - b);
  }

  // 指定 bass 音时，把该音放到最低声部（斜线和弦）
  const bassPc = pitchClassOf(chord.bass);
  if (bassPc !== null) {
    let bassMidi = baseMidi + ((bassPc - (baseMidi % 12) + 12) % 12);
    if (bassMidi >= pitches[0]) bassMidi -= 12;
    pitches = [bassMidi, ...pitches];
  }
  return pitches;
}
