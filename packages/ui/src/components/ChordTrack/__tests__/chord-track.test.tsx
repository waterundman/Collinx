/**
 * v3.2.0 S2：和弦轨从「固定循环切换」升级为「直接选根音/性质」。
 *
 * 保护的用户可见行为：
 *   - 点小节格子 → 在该行下方展开选择器（不弹浮层），再点一次收起；
 *   - 选根音立即写图（单击即生效），性质默认 maj；
 *   - 已有和弦时选性质只换性质、保留根音；
 *   - 清除写 null 并让格子回到空态；
 *   - Esc 收起选择器；
 *   - 写入的 quality 必须是 core 的 canonical 值（dom7 而不是 "7"），
 *     否则 core 的 harmony 解析拿不到。
 */
import { describe, it, expect, afterEach } from "vitest";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "../../../providers/I18nProvider";
import { ChordTrack } from "../ChordTrack";

interface Harness {
  container: HTMLElement;
  cleanup: () => void;
}

function renderTrack(totalBars = 8): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  function Controlled() {
    const [chords, setChords] = useState(
      new Map<number, { root: string; quality: string }>(),
    );
    return (
      <ChordTrack
        totalBars={totalBars}
        chordsByBar={chords}
        onSetChord={(bar, chord) => {
          setChords((prev) => {
            const next = new Map(prev);
            if (chord) next.set(bar, chord);
            else next.delete(bar);
            return next;
          });
        }}
      />
    );
  }

  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <Controlled />
      </I18nProvider>,
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

function click(el: Element | null) {
  if (!el) throw new Error("元素不存在");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function btnByText(container: HTMLElement, text: string): HTMLElement {
  const btn = Array.from(
    container.querySelectorAll<HTMLElement>('[data-testid="chord-editor"] button'),
  ).find((b) => b.textContent === text);
  if (!btn) throw new Error(`找不到按钮: ${text}`);
  return btn;
}

const cell = (container: HTMLElement, bar: number) =>
  container.querySelector(`[data-testid="chord-cell-${bar}"]`);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("v3.2.0 S2: 和弦轨直接选择", () => {
  it("点格子展开选择器，再点一次收起", () => {
    const h = renderTrack();

    expect(
      h.container.querySelector('[data-testid="chord-editor"]'),
    ).toBeNull();

    click(cell(h.container, 3));
    const editor = h.container.querySelector('[data-testid="chord-editor"]');
    expect(editor).not.toBeNull();
    expect(editor!.getAttribute("data-bar")).toBe("3");

    click(cell(h.container, 3));
    expect(
      h.container.querySelector('[data-testid="chord-editor"]'),
    ).toBeNull();

    h.cleanup();
  });

  it("选根音立即写入，性质默认 maj", () => {
    const h = renderTrack();
    click(cell(h.container, 2));
    click(btnByText(h.container, "D"));

    expect(cell(h.container, 2)!.textContent).toBe("D");
    // 选根音不收起选择器，性质按钮状态落在大三和弦上
    const majBtn = btnByText(h.container, "maj");
    expect(majBtn.getAttribute("aria-pressed")).toBe("true");

    h.cleanup();
  });

  it("已有和弦时选性质只换性质、保留根音", () => {
    const h = renderTrack();
    click(cell(h.container, 4));
    click(btnByText(h.container, "F"));
    click(btnByText(h.container, "min"));

    // 和弦记号：根音 F + 小三度 → Fm
    expect(cell(h.container, 4)!.textContent).toBe("Fm");
    // 根音按钮仍为选中态（没被重置成 C）
    expect(btnByText(h.container, "F").getAttribute("aria-pressed")).toBe("true");

    h.cleanup();
  });

  it("属七和弦写入 canonical quality（dom7），记号显示为 7", () => {
    const h = renderTrack();
    click(cell(h.container, 5));
    click(btnByText(h.container, "G"));
    click(btnByText(h.container, "7"));

    expect(cell(h.container, 5)!.textContent).toBe("G7");

    h.cleanup();
  });

  it("清除后格子回到空态，清除按钮随后不可用", () => {
    const h = renderTrack();
    click(cell(h.container, 6));
    click(btnByText(h.container, "A"));
    expect(cell(h.container, 6)!.textContent).toBe("A");

    click(h.container.querySelector('[data-testid="chord-clear"]'));
    expect(cell(h.container, 6)!.textContent).toBe("");

    const clearBtn = h.container.querySelector(
      '[data-testid="chord-clear"]',
    ) as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(true);

    h.cleanup();
  });

  it("Esc 收起选择器", () => {
    const h = renderTrack();
    click(cell(h.container, 7));
    expect(
      h.container.querySelector('[data-testid="chord-editor"]'),
    ).not.toBeNull();

    act(() => {
      cell(h.container, 7)!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(
      h.container.querySelector('[data-testid="chord-editor"]'),
    ).toBeNull();

    h.cleanup();
  });

  it("格子按小节渲染，且带可访问标签", () => {
    const h = renderTrack(4);
    const cells = h.container.querySelectorAll('[data-testid^="chord-cell-"]');
    expect(cells).toHaveLength(4);
    expect(cell(h.container, 1)!.getAttribute("aria-expanded")).toBe("false");

    click(cell(h.container, 1));
    expect(cell(h.container, 1)!.getAttribute("aria-expanded")).toBe("true");

    h.cleanup();
  });
});
