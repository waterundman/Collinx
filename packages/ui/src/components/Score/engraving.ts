/**
 * 记谱法规则引擎（v2.9.7）。
 *
 * ## 为什么存在
 *
 * v2.9.5/2.9.6 点击会话暴露：谱面渲染「规则不明确」—— 临时记号见音就画、
 * 低音谱表没有谱号、全曲没有调号、空小节没有休止符、整小节连成一条梁。
 * 本文件把**权威记谱规则**落成可测试的纯函数，渲染器只消费这里的结果。
 *
 * ## 规则来源
 *
 * - Elaine Gould《Behind Bars》(Faber Music, 2011) p.78：临时记号在小节内
 *   对**同八度**的同音名持续有效；过小节线即失效（不同八度需另标）。
 * - Wikipedia "Accidental (music)"：调号全程有效；临时记号只影响本小节
 *   同谱表位置；连音线跨小节延续； courtesy accidental 可选。
 * - 通行排印惯例：谱号在**每行每个谱表**开头；调号紧随谱号（每行每谱表）；
 *   拍号只在变化处/首行；空小节画全小节休止符；4/4 的八分音符按拍分梁
 *   （每拍一组），6/8 按附点四分（3/8）分组。
 */


export type Alteration = "#" | "b" | "n" | "";

/** 调号定义：tonic（如 "C"/"G"/"Bb"）+ mode（major/minor） */
export interface KeyDef {
  tonic: string;
  mode: string;
}

/** 大调主音 → 五度圈数（正=升号数，负=降号数） */
const MAJOR_FIFTHS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
};

/** 小调 = 关系大调（向上小三度）的五度圈数 */
const MINOR_FIFTHS: Record<string, number> = {
  A: 0, E: 1, B: 2, "F#": 3, "C#": 4, "G#": 5, "D#": 6, "A#": 7,
  D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7,
};

/** 升号顺序：F C G D A E B（Gould/五度圈标准顺序） */
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"] as const;
/** 降号顺序：B E A D G C F */
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"] as const;

/** 调号 → 各音名的固定升降（作用于所有八度）。未知调回退 C（无升降）。 */
export function keyAlterations(key: KeyDef): Record<string, Alteration> {
  const tonic = key.tonic.trim();
  const fifths =
    key.mode === "minor"
      ? (MINOR_FIFTHS[tonic] ?? MAJOR_FIFTHS[relativeMajor(tonic)] ?? 0)
      : (MAJOR_FIFTHS[tonic] ?? MINOR_FIFTHS[relativeMinor(tonic)] ?? 0);

  const map: Record<string, Alteration> = {};
  if (fifths > 0) {
    for (let i = 0; i < Math.min(fifths, 7); i++) map[SHARP_ORDER[i]!] = "#";
  } else if (fifths < 0) {
    for (let i = 0; i < Math.min(-fifths, 7); i++) map[FLAT_ORDER[i]!] = "b";
  }
  return map;
}

function relativeMinor(majorTonic: string): string {
  // 向下大三度的大调字母 → 其关系小调
  const table: Record<string, string> = {
    C: "A", G: "E", D: "B", A: "F#", E: "C#", B: "G#", "F#": "D#", "C#": "A#",
    F: "D", Bb: "G", Eb: "C", Ab: "F", Db: "Bb", Gb: "Eb", Cb: "Ab",
  };
  return table[majorTonic] ?? "A";
}

function relativeMajor(minorTonic: string): string {
  const table: Record<string, string> = {
    A: "C", E: "G", B: "D", "F#": "A", "C#": "E", "G#": "B", "D#": "F#", "A#": "C#",
    D: "F", G: "Bb", C: "Eb", F: "Ab", Bb: "Db", Eb: "Gb", Ab: "Cb",
  };
  return table[minorTonic] ?? "C";
}

/** VexFlow 调号规格（"C"/"G"/"Am"/"Bb"...） */
export function vexflowKeySpec(key: KeyDef): string {
  return `${key.tonic.trim()}${key.mode === "minor" ? "m" : ""}`;
}

export interface PitchIdentity {
  /** 音名字母 A-G */
  letter: string;
  /** 八度（科学记谱：C4 = midi 60） */
  octave: number;
  /** 拼写要求的升降号 */
  alteration: Alteration;
}

/** 从 midi + 拼写提取 (字母, 八度, 升降)。拼写缺失时按升号规则兜底。 */
export function pitchIdentity(midi: number, spelling?: string): PitchIdentity {
  if (spelling) {
    const m = spelling.match(/^([A-G])([#b]*)(-?\d)/);
    if (m) {
      return {
        letter: m[1]!,
        octave: Number(m[3]),
        alteration: (m[2] === "" ? "" : m[2] === "#" ? "#" : "b") as Alteration,
      };
    }
  }
  const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const name = SHARP_NAMES[((midi % 12) + 12) % 12]!;
  return {
    letter: name[0]!,
    octave: Math.floor(midi / 12) - 1,
    alteration: name.includes("#") ? "#" : "",
  };
}

/**
 * 小节内临时记号判定（Gould p.78 规则的纯函数实现）。
 *
 * 规则：
 * 1. 调号对该音名的升降全程有效（所有八度）；
 * 2. 小节内出现临时记号后，**同八度同音名**的后续音沿用，不重画；
 * 3. 过小节线全部复位（reset 由调用方按小节新建 context 实现）；
 * 4. 与调号/当前状态一致 → 不画符号。
 */
export class MeasureAccidentalState {
  /** 调号固定升降（按音名字母） */
  private readonly keyAlt: Record<string, Alteration>;
  /** 小节内已建立的临时状态：`字母+八度` → 当前升降 */
  private readonly state = new Map<string, Alteration>();

  constructor(keyAlt: Record<string, Alteration>) {
    this.keyAlt = keyAlt;
  }

  /**
   * 返回该音**应当画的符号**（"" = 不画）。
   * 必须按小节内演奏顺序调用（和弦按音高升序即可）。
   */
  symbolFor(midi: number, spelling?: string): Alteration {
    const { letter, octave, alteration } = pitchIdentity(midi, spelling);
    const id = `${letter}${octave}`;
    const effective = this.state.get(id) ?? this.keyAlt[letter] ?? "";
    if (alteration === effective) return "";
    this.state.set(id, alteration);
    // 还原音（alteration === "" 且调号/前状态非空）画 ♮
    return alteration === "" ? "n" : alteration;
  }
}

/**
 * 梁分组完整模式（v2.9.8，按 Digital Engraving Practice 重写）。
 *
 * 返回**铺满整小节**的分组序列（VexFlow generateBeams 的 groups 语义）。
 * 规则（ScoreLabs #11 / mymusictheory / Wikipedia Beam）：
 * - 4/4：**1+2 一梁、3+4 一梁**；严禁四拍一条梁（跨过第二强拍 beat3）
 * - 2/4：整小节一梁；3/4：整小节一梁（首音必须落拍）
 * - 6/8、9/8、12/8：按附点四分（3/8）分块
 * - 2/2：按二分音符一拍（1/2）一组；3/2：整小节
 * - 5/8 默认 3+2；7/8 默认 2+2+3；5/4 默认 3+2
 * - x/16：按四分音符（4 个十六分）一组
 */
export function beamGroups(numerator: number, denominator: number): [number, number][] {
  const n = Math.max(1, Math.floor(numerator));
  const d = Math.max(1, Math.floor(denominator));
  const chunks = (size: number, count: number, den: number): [number, number][] =>
    Array.from({ length: count }, () => [size, den] as [number, number]);

  if (d === 8) {
    if (n % 3 === 0) return chunks(3, n / 3, 8);
    if (n === 5) return [[3, 8], [2, 8]];
    if (n === 7) return [[2, 8], [2, 8], [3, 8]];
    return chunks(1, n, 8);
  }
  if (d === 4) {
    if (n === 2) return [[2, 4]];
    if (n === 3) return [[3, 4]];
    if (n === 4) return [[2, 4], [2, 4]]; // 1+2 / 3+4 —— 严禁 [[4,4]]
    if (n === 5) return [[3, 4], [2, 4]];
    if (n === 6) return [[3, 4], [3, 4]];
    return chunks(1, n, 4);
  }
  if (d === 2) {
    if (n === 2) return [[1, 2], [1, 2]];
    if (n === 3) return [[3, 2]];
    return chunks(1, n, 2);
  }
  if (d === 16) return chunks(1, n, 4); // 4 个十六分 = 1 拍
  return chunks(1, n, d);
}

/**
 * 符干方向（Wikipedia Beam / daviddarling 规则）：
 * **离中线最远的音符决定整组方向**；单音即自身。
 * 中线：高音谱表 B4（midi 71），低音谱表 D3（midi 50）。
 */
export function stemDirection(pitches: number[], clef: string): "up" | "down" {
  const middle = clef === "treble" ? 71 : 50;
  const farthest = pitches.reduce(
    (best, p) => (Math.abs(p - middle) > Math.abs(best - middle) ? p : best),
    pitches[0] ?? middle,
  );
  return farthest < middle ? "up" : "down";
}

/**
 * 小节内空隙补休止（v2.9.8 规则：每个声部每小节必须被音符+休止填满）。
 *
 * 输入本小节已有的组（beat/durQn），输出需要插入的休止段。
 * 贪心策略：按 [2,1,0.5]（二分/四分/八分）从前往后取能放进空隙的最大块
 * —— 符合 Gould 的「优先大块、避免附点」取向。16 分音符级空隙本轮
 * 按 0.5 兜底（登记局限）。
 */
export function fillRestGaps(
  meterNumerator: number,
  meterDenominator: number,
  groups: { beat: number; durQn: number }[],
): { beat: number; durQn: number }[] {
  const beatsPerBar = (meterNumerator * 4) / meterDenominator; // 四分音符单位
  const UNIT = 0.5; // 八分音符粒度
  const total = Math.round(beatsPerBar / UNIT);
  const covered = new Array<boolean>(total).fill(false);
  for (const g of groups) {
    const start = Math.round((g.beat - 1) / UNIT);
    const len = Math.max(0, Math.round(g.durQn / UNIT));
    for (let i = start; i < Math.min(start + len, total); i++) covered[i] = true;
  }

  const rests: { beat: number; durQn: number }[] = [];
  let i = 0;
  while (i < total) {
    if (covered[i]) {
      i += 1;
      continue;
    }
    let gapEnd = i;
    while (gapEnd < total && !covered[gapEnd]) gapEnd += 1;
    let cursor = i;
    while (cursor < gapEnd) {
      const remainingBeats = (gapEnd - cursor) * UNIT;
      const block =
        remainingBeats >= 2 ? 2 : remainingBeats >= 1 ? 1 : 0.5;
      rests.push({ beat: 1 + cursor * UNIT, durQn: block });
      cursor += Math.round(block / UNIT);
    }
    i = gapEnd;
  }
  return rests;
}
