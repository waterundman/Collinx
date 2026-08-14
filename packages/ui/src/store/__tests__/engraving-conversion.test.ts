import { describe, it, expect } from "vitest";
import {
  convertAgentCollision,
  convertAgentCollisions,
  mapAgentSeverity,
  AGENT_TYPE_TO_UI_TYPE,
  DEFAULT_FIX_SUGGESTION,
} from "../project-store";

// ---------------------------------------------------------------------------
// T03 (unit, critical): engraving collision conversion layer.
//
// The agent-side CollisionWarning (packages/agent engraving-agent.ts) has six
// fine-grained `type` values, a three-value `severity` (error/warning/info),
// an optional `fix` and NO stave index. The UI ScorePanel CollisionWarning
// only knows four `type` values, two `severity` values, a required
// fixSuggestion and a staveIndex. These tests lock every field conversion
// (type convergence, severity escalation, fix fallback, staveIndex default).
// ---------------------------------------------------------------------------

describe("T03 convertAgentCollision: agent -> UI full-field mapping", () => {
  it("类型收敛映射表覆盖全部六个 agent 类型且均落入 UI 四值联合", () => {
    // 收敛映射必须完整:六个 agent 类型全部有映射目标
    const agentTypes = [
      "voice_crossing",
      "range_violation",
      "overlap",
      "spacing",
      "stem_direction",
      "accidental_conflict",
    ];
    for (const t of agentTypes) {
      expect(AGENT_TYPE_TO_UI_TYPE[t]).toBeDefined();
      const ui = convertAgentCollision({
        type: t,
        bar: 1,
        beat: 2,
        description: "d",
        severity: "warning",
        fix: "f",
      });
      expect(ui).not.toBeNull();
      expect([
        "symbol_overlap",
        "slur_cross",
        "dynamic_clash",
        "articulation_conflict",
      ]).toContain(ui!.type);
    }
  });

  it("overlap/accidental_conflict -> symbol_overlap, spacing/stem_direction -> articulation_conflict", () => {
    expect(AGENT_TYPE_TO_UI_TYPE.overlap).toBe("symbol_overlap");
    expect(AGENT_TYPE_TO_UI_TYPE.accidental_conflict).toBe("symbol_overlap");
    expect(AGENT_TYPE_TO_UI_TYPE.voice_crossing).toBe("slur_cross");
    expect(AGENT_TYPE_TO_UI_TYPE.range_violation).toBe("dynamic_clash");
    expect(AGENT_TYPE_TO_UI_TYPE.spacing).toBe("articulation_conflict");
    expect(AGENT_TYPE_TO_UI_TYPE.stem_direction).toBe("articulation_conflict");
  });

  it("全字段转换:bar/beat/description/severity/fix/staveIndex", () => {
    const ui = convertAgentCollision({
      type: "overlap",
      bar: 3,
      beat: 4,
      description: "音符重叠",
      severity: "info",
      fix: "调整水平位移",
    });
    expect(ui).toEqual({
      type: "symbol_overlap",
      staveIndex: 0, // agent 无谱表索引 -> UI 默认 0
      bar: 3,
      beat: 4,
      description: "音符重叠",
      severity: "warning", // info -> warning
      fixSuggestion: "调整水平位移", // fix -> fixSuggestion
    });
  });

  it("severity 映射:error 保持 error,info 升级为 warning,未知值兜底 warning", () => {
    expect(mapAgentSeverity("error")).toBe("error");
    expect(mapAgentSeverity("warning")).toBe("warning");
    expect(mapAgentSeverity("info")).toBe("warning");
    expect(mapAgentSeverity("bogus")).toBe("warning");
    expect(mapAgentSeverity(undefined)).toBe("warning");
  });

  it("fix 缺失时 fixSuggestion 使用默认占位而非空串", () => {
    const ui = convertAgentCollision({
      type: "spacing",
      bar: 1,
      beat: 1,
      description: "d",
      severity: "warning",
    });
    expect(ui).not.toBeNull();
    expect(ui!.fixSuggestion).toBe(DEFAULT_FIX_SUGGESTION);
  });

  it("空 fix 字符串同样回退默认占位", () => {
    const ui = convertAgentCollision({
      type: "range_violation",
      bar: 1,
      beat: 1,
      description: "d",
      severity: "error",
      fix: "",
    });
    expect(ui!.fixSuggestion).toBe(DEFAULT_FIX_SUGGESTION);
  });

  it("畸形输入被过滤:非数组/非对象/缺关键字段的条目丢弃", () => {
    expect(convertAgentCollisions(null)).toEqual([]);
    expect(convertAgentCollisions("nope")).toEqual([]);
    expect(convertAgentCollisions(42)).toEqual([]);
    // bar 非数字 -> 丢弃
    expect(
      convertAgentCollisions([{ type: "overlap", bar: "1", beat: 1, description: "x" }])
    ).toEqual([]);
    // 混合输入:合法 1 条 + 垃圾条目被过滤
    const mixed = convertAgentCollisions([
      { type: "overlap", bar: 1, beat: 2, description: "x", severity: "error", fix: "f" },
      42,
      null,
      { type: "stem_direction", bar: 2, beat: 1, description: "y", severity: "info" },
    ]);
    expect(mixed).toHaveLength(2);
    expect(mixed[0].type).toBe("symbol_overlap");
    expect(mixed[1].type).toBe("articulation_conflict");
    expect(mixed[1].severity).toBe("warning");
    expect(mixed[1].staveIndex).toBe(0);
  });

  it("未知 type 兜底为 symbol_overlap(不崩溃)", () => {
    const ui = convertAgentCollision({
      type: "alien_type",
      bar: 1,
      beat: 1,
      description: "d",
      severity: "warning",
    });
    expect(ui!.type).toBe("symbol_overlap");
  });
});
