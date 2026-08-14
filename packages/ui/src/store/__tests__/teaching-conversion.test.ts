import { describe, it, expect } from "vitest";
import {
  convertAgentExplanation,
  convertAgentAlternative,
  mapUiLevelToAgent,
  EMPTY_UI_EXPLANATION,
} from "../project-store";
import { TeachingAgent } from "@collinx/agent";

// ---------------------------------------------------------------------------
// T03 (unit, critical): teaching explanation conversion layer.
//
// The agent-side Explanation (packages/agent teaching-agent.ts) carries
// summary/concepts/alternatives[].description/level; the UI TeachingPanel only
// knows overview/conceptTags/alternatives[].name and has no level field. These
// tests lock every field conversion plus the UI "professional" -> agent
// "expert" level mapping.
// ---------------------------------------------------------------------------

describe("T03 convertAgentExplanation: agent -> UI full-field mapping", () => {
  it("全字段转换:title 直传,summary→overview,concepts→conceptTags,alternatives.description→name", () => {
    const agent = new TeachingAgent();
    const raw = agent.explainDecision("reflow-layout-1", "advanced", true);
    const ui = convertAgentExplanation(raw);
    expect(ui).not.toBeNull();

    expect(ui!.title).toBe(raw.title);
    expect(ui!.overview).toBe(raw.summary); // summary -> overview
    expect(ui!.detail).toBe(raw.detail);
    expect(ui!.conceptTags).toEqual(raw.concepts); // concepts -> conceptTags
    expect(ui!.examples).toEqual(raw.examples);
    // alternatives: description -> name, pros/cons 原样
    expect(ui!.alternatives).toHaveLength(raw.alternatives.length);
    for (let i = 0; i < raw.alternatives.length; i++) {
      expect(ui!.alternatives[i].name).toBe(raw.alternatives[i].description);
      expect(ui!.alternatives[i].pros).toEqual(raw.alternatives[i].pros);
      expect(ui!.alternatives[i].cons).toEqual(raw.alternatives[i].cons);
    }
  });

  it("agent level 不回写 UI(UiExplanation 无 level 字段)", () => {
    const ui = convertAgentExplanation({
      title: "t",
      summary: "s",
      detail: "d",
      level: "expert",
      concepts: [],
      examples: [],
      alternatives: [],
    });
    expect(ui).not.toBeNull();
    expect(ui!).not.toHaveProperty("level");
  });

  it("无 alternatives 时(compareWithAlt=false)给出空数组而非模板", () => {
    const agent = new TeachingAgent();
    const raw = agent.explainDecision("voicing-plan-1", "beginner", false);
    expect(raw.alternatives).toEqual([]);
    const ui = convertAgentExplanation(raw);
    expect(ui!.alternatives).toEqual([]);
  });

  it("alternatives 中的 example 字段被丢弃(UI 侧无对应字段)", () => {
    const ui = convertAgentExplanation({
      title: "t",
      summary: "s",
      detail: "d",
      concepts: ["c"],
      examples: ["e"],
      alternatives: [
        { description: "alt", pros: ["p"], cons: ["c"], example: "ignored" },
      ],
    });
    expect(ui!.alternatives[0]).toEqual({ name: "alt", pros: ["p"], cons: ["c"] });
    expect(ui!.alternatives[0]).not.toHaveProperty("example");
  });

  it("concepts/examples 中的非字符串元素被过滤(部分畸形不崩溃)", () => {
    const ui = convertAgentExplanation({
      title: "t",
      summary: "s",
      detail: "d",
      concepts: ["c1", 42 as unknown as string],
      examples: ["e1", null as unknown as string],
      alternatives: [],
    });
    expect(ui!.conceptTags).toEqual(["c1"]);
    expect(ui!.examples).toEqual(["e1"]);
  });

  it("畸形输入:非对象/缺关键字段 → null(调用方回退 EMPTY_UI_EXPLANATION)", () => {
    expect(convertAgentExplanation(null)).toBeNull();
    expect(convertAgentExplanation("nope")).toBeNull();
    expect(convertAgentExplanation(42)).toBeNull();
    expect(convertAgentExplanation({ title: "t" })).toBeNull();
    expect(convertAgentExplanation({ title: "t", summary: "s" })).toBeNull();
    expect(convertAgentExplanation({ title: "t", summary: "s", detail: 42 })).toBeNull();
  });

  it("convertAgentAlternative: 缺 description 返回 null,非法 pros/cons 兜底空数组", () => {
    expect(convertAgentAlternative(null)).toBeNull();
    expect(convertAgentAlternative({ pros: ["p"] })).toBeNull();
    expect(
      convertAgentAlternative({ description: "d", pros: "nope", cons: [1 as unknown as string] })
    ).toEqual({ name: "d", pros: [], cons: [] });
  });
});

describe("T03 mapUiLevelToAgent: UI professional -> agent expert", () => {
  it("professional -> expert(UI 枚举无 expert,agent 枚举无 professional)", () => {
    expect(mapUiLevelToAgent("professional")).toBe("expert");
  });

  it("其余三级直传(beginner/intermediate/advanced)", () => {
    expect(mapUiLevelToAgent("beginner")).toBe("beginner");
    expect(mapUiLevelToAgent("intermediate")).toBe("intermediate");
    expect(mapUiLevelToAgent("advanced")).toBe("advanced");
  });

  it("未知值兜底 intermediate(未来 UI 枚举不崩工具调用)", () => {
    expect(mapUiLevelToAgent("bogus")).toBe("intermediate");
    expect(mapUiLevelToAgent(undefined)).toBe("intermediate");
  });

  it("EMPTY_UI_EXPLANATION 是全空结构(失败态安全兜底)", () => {
    expect(EMPTY_UI_EXPLANATION).toEqual({
      title: "",
      overview: "",
      detail: "",
      conceptTags: [],
      examples: [],
      alternatives: [],
    });
  });
});
