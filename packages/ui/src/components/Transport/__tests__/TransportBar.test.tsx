/**
 * TransportBar 组件测试（v2.0.0 Stage 1 / D1-1，用例 S1-T11）。
 *
 * 约定（对齐仓库既有 canvas/DOM harness 先例）：
 * - 无 @testing-library/react → createRoot + act 手写 harness。
 * - 组件经 useI18n 取文案 → 外层包 I18nProvider（先例 ArrangerPanel.test.tsx）。
 * - 断言绑定 data-testid 锚点与派生文本，不绑定具体语言文案。
 * - 位置双形态：m{bar}.{floor(beat)} + M:SS.S（positionSeconds 格式化）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  TransportBar,
  formatTransportSeconds,
  type TransportBarProps,
} from "../TransportBar";
import { I18nProvider } from "../../../providers/I18nProvider";
import i18n from "../../../i18n";

interface Harness {
  container: HTMLDivElement;
  rerender: (next: Partial<TransportBarProps>) => void;
  cleanup: () => void;
}

function renderBar(initial: Partial<TransportBarProps> = {}): Harness {
  const onPlay = initial.onPlay ?? vi.fn();
  const onPause = initial.onPause ?? vi.fn();
  const onStop = initial.onStop ?? vi.fn();
  const defaults: TransportBarProps = {
    isPlaying: false,
    position: { bar: 1, beat: 1 },
    positionSeconds: 0,
    onPlay,
    onPause,
    onStop,
  };
  let props: TransportBarProps = { ...defaults, ...initial };

  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  const render = (p: TransportBarProps) => (
    <I18nProvider>
      <TransportBar {...p} />
    </I18nProvider>
  );

  act(() => {
    root = createRoot(container);
    root.render(render(props));
  });

  return {
    container,
    rerender(next) {
      props = { ...props, ...next };
      act(() => {
        root.render(render(props));
      });
    },
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function click(el: Element | null): void {
  expect(el).not.toBeNull();
  act(() => {
    el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const q = (c: HTMLElement, id: string): Element | null =>
  c.querySelector(`[data-testid="${id}"]`);

describe("TransportBar (S1-T11)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("S1-T11a: isPlaying=false → 显示 Play、无 Pause；点击触发 onPlay (critical)", () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const h = renderBar({ isPlaying: false, onPlay, onPause });

    expect(q(h.container, "transport-play")).not.toBeNull();
    expect(q(h.container, "transport-pause")).toBeNull();

    click(q(h.container, "transport-play"));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onPause).not.toHaveBeenCalled();

    h.cleanup();
  });

  it("S1-T11b: isPlaying=true → 显示 Pause、无 Play；点击触发 onPause（互斥显示） (critical)", () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const h = renderBar({ isPlaying: true, onPlay, onPause });

    expect(q(h.container, "transport-pause")).not.toBeNull();
    expect(q(h.container, "transport-play")).toBeNull();

    click(q(h.container, "transport-pause"));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();

    h.cleanup();
  });

  it("S1-T11c: 独立 Stop 按钮 → 触发 onStop（播放态也在） (critical)", () => {
    const onStop = vi.fn();
    const h = renderBar({ isPlaying: true, onStop });
    click(q(h.container, "transport-stop"));
    expect(onStop).toHaveBeenCalledTimes(1);
    h.cleanup();
  });

  it("S1-T11d: 位置文本随 position 更新（beat 取 floor）+ M:SS.S 由 positionSeconds 格式化 (critical)", () => {
    const h = renderBar({
      position: { bar: 1, beat: 1 },
      positionSeconds: 0,
    });
    const pos0 = q(h.container, "transport-position")!;
    expect(pos0.textContent).toContain("m1.1");
    expect(pos0.textContent).toContain("0:00.0");

    // positionSeconds=3.5 → 0:03.5；beat=2.9 → floor=2。
    h.rerender({ position: { bar: 2, beat: 2.9 }, positionSeconds: 3.5 });
    const pos1 = q(h.container, "transport-position")!;
    expect(pos1.textContent).toContain("m2.2");
    expect(pos1.textContent).toContain("0:03.5");

    // positionSeconds=65.4 → 1:05.4（跨分）。
    h.rerender({ position: { bar: 5, beat: 4 }, positionSeconds: 65.4 });
    const pos2 = q(h.container, "transport-position")!;
    expect(pos2.textContent).toContain("m5.4");
    expect(pos2.textContent).toContain("1:05.4");

    h.cleanup();
  });

  it("S1-T11e: 按钮均带 aria-label 锚点（可访问性）", () => {
    const h = renderBar({ isPlaying: false });
    const play = q(h.container, "transport-play")!;
    const stop = q(h.container, "transport-stop")!;
    expect(play.getAttribute("aria-label")).toBeTruthy();
    expect(stop.getAttribute("aria-label")).toBeTruthy();

    h.rerender({ isPlaying: true });
    const pause = q(h.container, "transport-pause")!;
    expect(pause.getAttribute("aria-label")).toBeTruthy();

    h.cleanup();
  });
});

// ---------------------------------------------------------------------------
// v2.0.0 Stage 1（S1.5-T2）：formatTransportSeconds 边界补强。
//
// 既有 S1-T11d 只覆盖 0 / 3.5 / 65.4。本段直接单测导出函数，锁定：
// - 截断语义（Math.floor，非四舍五入）：3.999 → "0:03.9"，绝不进到 04.0；
// - 无小时位、分钟可超 59：3600 → "60:00.0"；
// - 非有限 / 负数 / 零 → "0:00.0"；
// - 十分位不足一位不显示：0.05 → "0:00.0"。
// 不改动既有 T11a-e 任何断言。
// ---------------------------------------------------------------------------
describe("formatTransportSeconds 边界 (v2.0.0 Stage 1 补强 / S1.5-T2)", () => {
  it("S1-T11f: 截断语义（非四舍五入）——3.999 → 0:03.9", () => {
    expect(formatTransportSeconds(3.999)).toBe("0:03.9");
    // 正名：截断而非进位；四舍五入会得到 "0:04.0"。
    expect(formatTransportSeconds(3.999)).not.toBe("0:04.0");
    expect(formatTransportSeconds(9.99)).toBe("0:09.9");
    expect(formatTransportSeconds(59.99)).toBe("0:59.9");
  });

  it("S1-T11g: 跨分——无小时位，分钟可超 59（60/3600/3661.9）", () => {
    expect(formatTransportSeconds(60)).toBe("1:00.0");
    expect(formatTransportSeconds(65.4)).toBe("1:05.4");
    expect(formatTransportSeconds(600)).toBe("10:00.0");
    // 无小时位：3600s → "60:00.0"（而非 "1:00:00.0"）。
    expect(formatTransportSeconds(3600)).toBe("60:00.0");
    expect(formatTransportSeconds(3661.9)).toBe("61:01.9");
  });

  it("S1-T11h: 非有限 / 负数 / 零 一律归零 → 0:00.0", () => {
    for (const bad of [0, -1, -0.001, NaN, Infinity, -Infinity]) {
      expect(formatTransportSeconds(bad)).toBe("0:00.0");
    }
  });

  it("S1-T11i: 十分位不足一位不显示——0.05 → 0:00.0，0.1 → 0:00.1", () => {
    expect(formatTransportSeconds(0.05)).toBe("0:00.0");
    expect(formatTransportSeconds(0.099)).toBe("0:00.0");
    expect(formatTransportSeconds(0.1)).toBe("0:00.1");
  });
});

// ---------------------------------------------------------------------------
// v2.0.0 Stage 4（S4-D4）：count-in 文案统一。TransportBar 的 t("transport.countIn")
// 的 defaultValue 与 zh-CN 权威值 "预备…"（zh-CN.json:1537）保持一致；保留
// {defaultValue} 形式，禁用 t(k) || '默认' 死兜底。本测试锁定渲染出的文案为
// "预备…"，且不再出现旧 typo "准备中…"。
// ---------------------------------------------------------------------------
describe("TransportBar count-in 文案 (v2.0.0 Stage 4 / S4-D4)", () => {
  it("S4-D4: isCountingIn → 渲染 count-in 文案 '预备…'（与 zh-CN 权威值一致，无死兜底 typo）", async () => {
    const prevLng = i18n.language;
    await act(async () => {
      await i18n.changeLanguage("zh-CN");
    });

    const h = renderBar({ isCountingIn: true });
    const label = q(h.container, "transport-count-in-label");
    expect(label).not.toBeNull();
    expect(label!.textContent).toContain("预备…");
    // 统一后不再出现旧死兜底 typo "准备中…"
    expect(label!.textContent).not.toContain("准备中…");

    await act(async () => {
      await i18n.changeLanguage(prevLng);
    });
    h.cleanup();
  });
});
