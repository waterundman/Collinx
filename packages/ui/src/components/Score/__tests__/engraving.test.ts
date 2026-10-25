import { describe, it, expect } from "vitest";
import {
  beamGroups,
  keyAlterations,
  MeasureAccidentalState,
  vexflowKeySpec,
} from "../engraving";

/**
 * v2.9.7：记谱规则引擎单测。
 * 规则来源：Gould《Behind Bars》p.78（临时记号小节内同八度有效）、
 * Wikipedia "Accidental"（调号全程有效/过小节线失效）、通行排印惯例
 * （谱号/调号每行每谱表、空小节全休止、按拍分梁）。
 */
describe("keyAlterations（调号 → 固定升降）", () => {
  it("G 大调 = 1 个升号（F#）", () => {
    expect(keyAlterations({ tonic: "G", mode: "major" })).toEqual({ F: "#" });
  });

  it("F 大调 = 1 个降号（Bb）", () => {
    expect(keyAlterations({ tonic: "F", mode: "major" })).toEqual({ B: "b" });
  });

  it("Bb 大调 = 2 个降号（B、E）", () => {
    expect(keyAlterations({ tonic: "Bb", mode: "major" })).toEqual({ B: "b", E: "b" });
  });

  it("A 小调（关系调）= 无升降", () => {
    expect(keyAlterations({ tonic: "A", mode: "minor" })).toEqual({});
  });

  it("E 小调 = 1 个升号；C 小调 = 3 个降号", () => {
    expect(keyAlterations({ tonic: "E", mode: "minor" })).toEqual({ F: "#" });
    expect(keyAlterations({ tonic: "C", mode: "minor" })).toEqual({ B: "b", E: "b", A: "b" });
  });

  it("未知调回退无升降（宁缺勿错）", () => {
    expect(keyAlterations({ tonic: "H", mode: "major" })).toEqual({});
  });
});

describe("vexflowKeySpec", () => {
  it("大调直拼、小调加 m", () => {
    expect(vexflowKeySpec({ tonic: "C", mode: "major" })).toBe("C");
    expect(vexflowKeySpec({ tonic: "A", mode: "minor" })).toBe("Am");
    expect(vexflowKeySpec({ tonic: "Bb", mode: "major" })).toBe("Bb");
  });
});

describe("MeasureAccidentalState（Gould p.78）", () => {
  const C_MAJOR = keyAlterations({ tonic: "C", mode: "major" });
  const F_MAJOR = keyAlterations({ tonic: "F", mode: "major" });

  it("小节内第一个变化音要画；同八度重复不重画", () => {
    const state = new MeasureAccidentalState(C_MAJOR);
    expect(state.symbolFor(68, "G#4")).toBe("#"); // G#4 首次出现
    expect(state.symbolFor(68, "G#4")).toBe(""); // 同八度同音名沿用
  });

  it("不同八度需要单独画（Gould：each additional octave requires a further accidental）", () => {
    const state = new MeasureAccidentalState(C_MAJOR);
    expect(state.symbolFor(68, "G#4")).toBe("#");
    expect(state.symbolFor(80, "G#5")).toBe("#");
  });

  it("升号之后的还原音画 ♮（同小节内取消）", () => {
    const state = new MeasureAccidentalState(C_MAJOR);
    state.symbolFor(68, "G#4");
    expect(state.symbolFor(67, "G4")).toBe("n");
  });

  it("过小节线复位：新小节的还原音不画 ♮", () => {
    const bar1 = new MeasureAccidentalState(C_MAJOR);
    bar1.symbolFor(68, "G#4");
    const bar2 = new MeasureAccidentalState(C_MAJOR);
    expect(bar2.symbolFor(67, "G4")).toBe(""); // 无需 courtesy ♮
  });

  it("与调号一致的变化音不画（F 大调的 Bb）；还原要画 ♮", () => {
    const state = new MeasureAccidentalState(F_MAJOR);
    expect(state.symbolFor(70, "Bb4")).toBe(""); // 调号已有 Bb
    expect(state.symbolFor(71, "B4")).toBe("n"); // 还原要画
    expect(state.symbolFor(70, "Bb4")).toBe("b"); // 回到 Bb 要重新画
  });

  it("拼写缺失时按升号规则兜底（midi 68 → G#）", () => {
    const state = new MeasureAccidentalState(C_MAJOR);
    expect(state.symbolFor(68)).toBe("#");
  });
});

describe("beamGroups（按拍分梁）", () => {
  it("4/4、3/4：每拍（四分音符）一组", () => {
    expect(beamGroups(4, 4)).toEqual([[1, 4]]);
    expect(beamGroups(3, 4)).toEqual([[1, 4]]);
  });

  it("6/8、9/8 复拍子：按附点四分（3/8）一组；5/8 按八分", () => {
    expect(beamGroups(6, 8)).toEqual([[3, 8]]);
    expect(beamGroups(9, 8)).toEqual([[3, 8]]);
    expect(beamGroups(5, 8)).toEqual([[1, 8]]);
  });

  it("2/2：按二分音符一拍", () => {
    expect(beamGroups(2, 2)).toEqual([[1, 2]]);
  });
});
