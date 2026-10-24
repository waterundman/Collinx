import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { usePerformanceMetrics } from "../usePerformanceMetrics";
import type { AudioPerformanceInfo } from "../../services/audio-preview";

/**
 * v2.9.2：性能指标的采集语义。
 *
 * 只断言两件事：①轮询确实刷新 ②拿不到的项保持 undefined（不被填 0）。
 */
function info(over: Partial<AudioPerformanceInfo> = {}): AudioPerformanceInfo {
  return {
    ready: true,
    state: "running",
    sampleRate: 44100,
    baseLatencyMs: 5,
    outputLatencyMs: 3,
    activeVoices: 2,
    level: 0.1,
    ...over,
  };
}

describe("usePerformanceMetrics", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function mount(getInfo: () => AudioPerformanceInfo) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root: Root;
    let latest: ReturnType<typeof usePerformanceMetrics> | null = null;

    function Probe({ getInfo: g }: { getInfo: () => AudioPerformanceInfo }) {
      latest = usePerformanceMetrics(g, 1000);
      return null;
    }

    act(() => {
      root = createRoot(container);
      root.render(<Probe getInfo={getInfo} />);
    });

    return {
      get current() {
        if (!latest) throw new Error("not mounted");
        return latest;
      },
      rerender(g: () => AudioPerformanceInfo) {
        act(() => {
          root.render(<Probe getInfo={g} />);
        });
      },
      cleanup() {
        act(() => {
          root.unmount();
          container.remove();
        });
      },
    };
  }

  it("初始读取一次真实快照", () => {
    const m = mount(() => info({ activeVoices: 4 }));
    expect(m.current.metrics.activeVoices).toBe(4);
    expect(m.current.metrics.sampleRate).toBe(44100);
    expect(m.current.metrics.processingLatency).toBe(8); // base + output
    m.cleanup();
  });

  it("定时刷新读到最新值", () => {
    vi.useFakeTimers();
    let voices = 1;
    const m = mount(() => info({ activeVoices: voices }));
    expect(m.current.metrics.activeVoices).toBe(1);

    voices = 6;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(m.current.metrics.activeVoices).toBe(6);
    m.cleanup();
  });

  it("未就绪时不给延迟数字（避免把 0ms 当成真实延迟）", () => {
    const m = mount(() => info({ ready: false, baseLatencyMs: 0, outputLatencyMs: 0 }));
    expect(m.current.metrics.processingLatency).toBeUndefined();
    m.cleanup();
  });

  it("CPU 与缓冲欠载永远不填数（浏览器不可采集）", () => {
    const m = mount(() => info());
    expect(m.current.metrics.cpuUsage).toBeUndefined();
    expect(m.current.metrics.bufferUnderruns).toBeUndefined();
    m.cleanup();
  });

  it("无 performance.memory 时内存项留空", () => {
    const original = (performance as Performance & { memory?: unknown }).memory;
    // jsdom 默认没有 memory；显式置 undefined 以防未来环境变化
    Object.defineProperty(performance, "memory", { configurable: true, value: undefined });
    const m = mount(() => info());
    expect(m.current.metrics.memoryUsed).toBeUndefined();
    expect(m.current.metrics.memoryTotal).toBeUndefined();
    m.cleanup();
    if (original !== undefined) {
      Object.defineProperty(performance, "memory", { configurable: true, value: original });
    }
  });
});
