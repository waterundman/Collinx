import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PerformanceDashboard } from "../PerformanceDashboard";
import { I18nProvider } from "../../../providers/I18nProvider";

/**
 * v2.9.2：性能面板从「零引用组件」变成挂载组件。
 *
 * 关键语义：浏览器拿不到的指标必须显示「—」，不能显示 0 ——
 * 0% CPU 会被读成「很健康」，比没数据更误导。
 */
function render(metrics: React.ComponentProps<typeof PerformanceDashboard>["metrics"]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <PerformanceDashboard metrics={metrics} />
      </I18nProvider>,
    );
  });
  return {
    container,
    expand() {
      const header = container.querySelector('[class*="header"]')!;
      act(() => {
        header.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    },
    text(id: string) {
      return container.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";
    },
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

describe("PerformanceDashboard（真实指标 / 缺项显式 NA）", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("渲染标题，默认收起", () => {
    const r = render({});
    expect(r.container.querySelector('[data-testid="performance-dashboard"]')).not.toBeNull();
    expect(r.container.querySelector('[data-testid="perf-voices"]')).toBeNull();
    r.cleanup();
  });

  it("展开后：不可采集项显示「—」", () => {
    const r = render({});
    r.expand();
    expect(r.text("perf-cpu")).toBe("—");
    expect(r.text("perf-underruns")).toBe("—");
    expect(r.text("perf-memory")).toBe("—");
    expect(r.text("perf-latency")).toBe("—");
    r.cleanup();
  });

  it("真实值按单位格式化", () => {
    const r = render({
      activeVoices: 7,
      sampleRate: 48000,
      processingLatency: 12.34,
      memoryUsed: 80 * 1024 * 1024,
      memoryTotal: 2 * 1024 * 1024 * 1024,
    });
    r.expand();
    expect(r.text("perf-voices")).toBe("7");
    expect(r.text("perf-sample-rate")).toBe("48.0 kHz");
    expect(r.text("perf-latency")).toBe("12.3 ms");
    expect(r.text("perf-memory")).toBe("80 MB / 2.0 GB");
    r.cleanup();
  });

  it("只给部分指标时，缺失项各自显示「—」", () => {
    const r = render({ activeVoices: 0 });
    r.expand();
    expect(r.text("perf-voices")).toBe("0"); // 0 个声部是真实值，不是缺失
    expect(r.text("perf-sample-rate")).toBe("—");
    expect(r.text("perf-cpu")).toBe("—");
    r.cleanup();
  });
});
