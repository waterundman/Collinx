import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DiffEnvelope } from "@collinx/core";
import { TeachingAgent } from "@collinx/agent";
import { TeachingPanel, type TeachingPanelProps } from "../TeachingPanel";
import { convertAgentExplanation } from "../../../store/project-store";

// ---------------------------------------------------------------------------
// T01 (component, critical): with an activeDiff the panel renders the REAL
// explanation produced by teaching.explainDecision (converted through the
// store conversion layer), never the old hardcoded DEFAULT_EXPLANATION.
//
// T05 (component, non-critical): without an activeDiff the panel shows the
// empty-state guidance — not template content.
// ---------------------------------------------------------------------------

function makeDiff(diffId: string): DiffEnvelope {
  return {
    diffId,
    baseRevision: "graph://base",
    actor: { type: "agent", name: "HarmonyBot", model: "gpt-4o" },
    permissionScope: "proposal_only",
    summary: "Apply voicing plan with drop-2 voicings",
    ops: [],
    domainExplanations: [],
    evidenceRefs: [],
    rollbackToken: `token-${diffId}`,
    riskFlags: [],
    createdAt: new Date().toISOString(),
  };
}

/** Runs the real TeachingAgent and packs its output into the exact props the
 *  App hands to the panel after the store conversion layer. */
function buildRealProps(
  diffId: string,
  level: "beginner" | "intermediate" | "advanced" | "expert",
  compareWithAlt = true
): Partial<TeachingPanelProps> {
  const raw = new TeachingAgent().explainDecision(diffId, level, compareWithAlt);
  const ui = convertAgentExplanation(raw);
  if (!ui) throw new Error("conversion of real agent explanation failed");
  return {
    explanation: ui,
    alternatives: ui.alternatives,
    relatedConcepts: ui.conceptTags,
  };
}

function renderPanel(props: TeachingPanelProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  act(() => {
    root = createRoot(container);
    root.render(<TeachingPanel {...props} />);
  });

  return {
    container,
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("TeachingPanel (v1.14 Stage 1: real explanation data source)", () => {
  it("T01: 有 activeDiff + 真实解释 → 渲染真实解释内容 (critical)", () => {
    const diff = makeDiff("reflow-layout-1");
    const real = buildRealProps(diff.diffId, "advanced", true);
    const { container, cleanup } = renderPanel({
      activeDiff: diff,
      userLevel: "professional",
      ...real,
    });

    // Real agent content rendered: overview (agent summary) + detail.
    expect(container.textContent).toContain(real.explanation!.overview);
    expect(container.textContent).toContain(real.explanation!.detail);
    // Every concept tag surfaced as a tag (agent concepts -> conceptTags).
    for (const tag of real.explanation!.conceptTags) {
      expect(container.textContent).toContain(tag);
    }
    // Examples rendered.
    for (const example of real.explanation!.examples) {
      expect(container.textContent).toContain(example);
    }
    // Alternatives rendered by name (agent description -> UI name).
    for (const alt of real.alternatives!) {
      expect(container.textContent).toContain(alt.name);
      for (const pro of alt.pros) expect(container.textContent).toContain(pro);
      for (const con of alt.cons) expect(container.textContent).toContain(con);
    }
    // Template remnants must NOT appear.
    expect(container.textContent).not.toContain("方案 A: 密集和声排列");
    expect(container.textContent).not.toContain(
      "选择一个编曲方案或差异操作来查看详细的教学解释"
    );

    cleanup();
  });

  it("T01: 无 alternatives(compareWithAlt=false)时侧边栏显示空态而非模板替代方案", () => {
    const diff = makeDiff("motif-compose-1");
    const real = buildRealProps(diff.diffId, "beginner", false);
    expect(real.alternatives!.length).toBe(0);
    const { container, cleanup } = renderPanel({
      activeDiff: diff,
      userLevel: "beginner",
      ...real,
    });

    // Real explanation still rendered.
    expect(container.textContent).toContain(real.explanation!.overview);
    // No template alternatives; sidebar shows an explicit empty hint.
    expect(container.textContent).not.toContain("方案 A: 密集和声排列");
    expect(container.textContent).toContain("暂无替代方案对比");

    cleanup();
  });

  it("T01: loading 态显示加载指示,不渲染解释 (critical)", () => {
    const { container, cleanup } = renderPanel({
      activeDiff: makeDiff("d1"),
      userLevel: "beginner",
      loading: true,
    });

    expect(
      container.querySelector('[data-testid="teaching-loading"]')
    ).not.toBeNull();
    expect(container.textContent).toContain("正在生成教学解释");
    // Not the empty state, not an error state.
    expect(container.querySelector('[data-testid="teaching-empty"]')).toBeNull();
    expect(container.querySelector('[data-testid="teaching-error"]')).toBeNull();

    cleanup();
  });

  it("T01: error 态显示错误提示,不渲染模板内容", () => {
    const { container, cleanup } = renderPanel({
      activeDiff: makeDiff("d1"),
      userLevel: "beginner",
      error: "教学解释生成失败，请重试",
    });

    const err = container.querySelector('[data-testid="teaching-error"]');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain("教学解释生成失败");
    expect(container.textContent).not.toContain(
      "选择一个编曲方案或差异操作来查看详细的教学解释"
    );

    cleanup();
  });

  it("T05: 无 activeDiff → 空态引导而非模板内容 (non-critical)", () => {
    const { container, cleanup } = renderPanel({ userLevel: "beginner" });

    // Empty-state guidance rendered.
    const empty = container.querySelector('[data-testid="teaching-empty"]');
    expect(empty).not.toBeNull();
    expect(container.textContent).toContain("暂无活跃的编曲方案");
    // Old template content must not leak into the empty state.
    expect(container.textContent).not.toContain(
      "选择一个编曲方案或差异操作来查看详细的教学解释"
    );
    expect(container.textContent).not.toContain("方案 A: 密集和声排列");

    cleanup();
  });
});

// ---------------------------------------------------------------------------
// v1.18.0 Stage 0: harmony explanation block (teaching.explainHarmony wiring).
// ---------------------------------------------------------------------------

describe("TeachingPanel harmony block (v1.18.0 Stage 0)", () => {
  /** Real agent explanation converted through the same store conversion layer
   *  the App uses, so the panel test exercises the production payload shape. */
  function buildRealHarmonyProps(): Partial<TeachingPanelProps> {
    const raw = new TeachingAgent().explainHarmony(
      ["I", "IV", "V", "I"],
      "C major",
      "intermediate"
    );
    const ui = convertAgentExplanation(raw);
    if (!ui) throw new Error("conversion of real agent harmony explanation failed");
    return { harmonyExplanation: ui };
  }

  it("T03: harmony 结果渲染真实讲解内容 (critical)", () => {
    const real = buildRealHarmonyProps();
    const { container, cleanup } = renderPanel({
      userLevel: "intermediate",
      onExplainHarmony: () => {},
      canExplainHarmony: true,
      ...real,
    });

    const section = container.querySelector('[data-testid="teaching-harmony-section"]');
    expect(section).not.toBeNull();
    const result = container.querySelector('[data-testid="teaching-harmony-result"]');
    expect(result).not.toBeNull();
    // Real agent content: title carries key + progression, overview/detail present.
    expect(result!.textContent).toContain("和声进行分析");
    expect(result!.textContent).toContain("C major");
    expect(result!.textContent).toContain(real.harmonyExplanation!.overview);
    expect(result!.textContent).toContain(real.harmonyExplanation!.detail);
    // No error / loading / empty state leaking.
    expect(container.querySelector('[data-testid="teaching-harmony-error"]')).toBeNull();
    expect(container.querySelector('[data-testid="teaching-harmony-loading"]')).toBeNull();
    expect(container.querySelector('[data-testid="teaching-harmony-empty"]')).toBeNull();

    cleanup();
  });

  it("T03: 触发按钮可点击并调用 onExplainHarmony (critical)", () => {
    const onExplainHarmony = vi.fn();
    const { container, cleanup } = renderPanel({
      userLevel: "intermediate",
      onExplainHarmony,
      canExplainHarmony: true,
    });

    const trigger = container.querySelector(
      '[data-testid="teaching-harmony-trigger"]'
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger!.disabled).toBe(false);
    act(() => {
      trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onExplainHarmony).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("T03: 无 harmony 数据时按钮可用但显示空态 (non-critical)", () => {
    const { container, cleanup } = renderPanel({
      userLevel: "intermediate",
      onExplainHarmony: () => {},
      canExplainHarmony: true,
    });

    expect(
      container.querySelector('[data-testid="teaching-harmony-result"]')
    ).toBeNull();
    const empty = container.querySelector('[data-testid="teaching-harmony-empty"]');
    expect(empty).not.toBeNull();
    // Empty state text comes from i18n — never a template explanation.
    expect(empty!.textContent).not.toContain("方案 A");

    cleanup();
  });

  it("T04: canExplainHarmony=false 时触发按钮禁用 (non-critical)", () => {
    const onExplainHarmony = vi.fn();
    const { container, cleanup } = renderPanel({
      userLevel: "intermediate",
      onExplainHarmony,
      canExplainHarmony: false,
    });

    const trigger = container.querySelector(
      '[data-testid="teaching-harmony-trigger"]'
    ) as HTMLButtonElement | null;
    expect(trigger).not.toBeNull();
    expect(trigger!.disabled).toBe(true);
    act(() => {
      trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    // Disabled button must not fire the handler.
    expect(onExplainHarmony).not.toHaveBeenCalled();

    cleanup();
  });

  it("T04: 未传 onExplainHarmony 时 harmony 区块整体隐藏 (non-critical)", () => {
    const { container, cleanup } = renderPanel({ userLevel: "beginner" });

    expect(
      container.querySelector('[data-testid="teaching-harmony-section"]')
    ).toBeNull();

    cleanup();
  });
});
