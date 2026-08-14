import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ToolCallTimeline } from "../ToolCallTimeline";
import { I18nProvider } from "../../../providers/I18nProvider";
import type { ToolCallRecord } from "@collinx/core";

function makeCall(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    id: overrides.id ?? "call-1",
    toolName: overrides.toolName ?? "mixing.suggestChain",
    params: overrides.params ?? { track: "drums", preset: "punchy" },
    resultSummary: overrides.resultSummary ?? "建议 3 段 FX 链",
    status: overrides.status ?? "success",
    timestamp: overrides.timestamp ?? "2026-08-10T10:00:00.000Z",
    agentName: overrides.agentName ?? "mixing",
    correlationId: overrides.correlationId,
  };
}

function renderTimeline(toolCalls: ToolCallRecord[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <ToolCallTimeline toolCalls={toolCalls} />
      </I18nProvider>
    );
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

describe("ToolCallTimeline", () => {
  it("T01: 渲染工具名/状态/摘要 (critical)", () => {
    const { container, cleanup } = renderTimeline([
      makeCall({
        toolName: "mixing.suggestChain",
        resultSummary: "建议 3 段 FX 链",
        status: "success",
        agentName: "mixing",
      }),
    ]);

    const items = container.querySelectorAll('[data-testid="tool-call-item"]');
    expect(items.length).toBe(1);

    const name = container.querySelector('[data-testid="tool-call-name"]');
    expect(name?.textContent).toContain("mixing.suggestChain");

    const summary = container.querySelector('[data-testid="tool-call-summary"]');
    expect(summary?.textContent).toContain("建议 3 段 FX 链");

    const status = container.querySelector('[data-testid="tool-call-status"]');
    expect(status).not.toBeNull();

    // Agent name is rendered too.
    expect(items[0].textContent).toContain("mixing");

    cleanup();
  });

  it("T02: 空数据时空态显示", () => {
    const { container, cleanup } = renderTimeline([]);

    expect(container.querySelector('[data-testid="tool-call-empty"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="tool-call-item"]').length).toBe(0);
    // The counter still renders zero.
    const count = container.querySelector('[data-testid="tool-call-count"]');
    expect(count?.textContent).toBe("0");

    cleanup();
  });

  it("T03: status 徽章区分(success/error 样式类不同)", () => {
    const { container, cleanup } = renderTimeline([
      makeCall({ id: "ok", toolName: "mixing.suggestChain", status: "success" }),
      makeCall({ id: "err", toolName: "arranger.plan", status: "error" }),
    ]);

    const badges = container.querySelectorAll('[data-testid="tool-call-status"]');
    expect(badges.length).toBe(2);

    const successBadge = badges[0];
    const errorBadge = badges[1];

    // Distinct style classes prove the badge differentiates statuses.
    expect(successBadge.className).not.toBe(errorBadge.className);
    expect(successBadge.className).not.toBe("");
    expect(errorBadge.className).not.toBe("");
    expect(successBadge.className).toContain("status");
    expect(errorBadge.className).toContain("status");

    cleanup();
  });

  it("renders collapsible params when provided", () => {
    const { container, cleanup } = renderTimeline([
      makeCall({ params: { track: "drums", preset: "punchy" } }),
    ]);

    // Params start collapsed; the toggle button is present.
    expect(container.querySelector('[data-testid="tool-call-params"]')).toBeNull();

    const toggle = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Show params" || b.textContent === "查看参数"
    );
    expect(toggle).toBeDefined();

    act(() => {
      toggle!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    const params = container.querySelector('[data-testid="tool-call-params"]');
    expect(params).not.toBeNull();
    expect(params?.textContent).toContain("drums");

    cleanup();
  });

  it("is a function component", () => {
    expect(typeof ToolCallTimeline).toBe("function");
  });
});
