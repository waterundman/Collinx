/**
 * v3.2.0 S2：编排区结构编辑（拖动 / 改长度 / 键盘微调 / 检查器 / 播放头）。
 *
 * 保护的用户可见行为：
 *   - 拖动落点吸附到小节整数，一次拖动只回调一次（= 一条 undo）；
 *   - 拖动被相邻乐段挡住（不重叠），且不越过 1 与总小节；
 *   - 右缘改长度只改 endBar，startBar 不动；
 *   - ←/→ 微调 1 小节、Shift 4 小节；到边界不动也不回调；
 *   - 删除键 / 检查器按钮走 onPhraseDelete，复制键走 onPhraseDuplicate；
 *   - 播放头按小节定位到正确百分比，所在乐段高亮；
 *   - 不传 onPhraseChange 时保持只读（无缩放手柄、无拖拽光标）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "../../../providers/I18nProvider";
import { ArrangementView, type PhraseBlock } from "../ArrangementView";

const BASE_PHRASES: PhraseBlock[] = [
  { id: "p1", name: "Intro", startBar: 1, endBar: 4, formRole: "intro" },
  { id: "p2", name: "Verse", startBar: 10, endBar: 13, formRole: "verse" },
];

/** 800px / 16 小节 = 每小节 50px（jsdom 的 clientWidth 恒为 0，必须打桩） */
const BAR_PX = 50;

interface Harness {
  container: HTMLElement;
  blocks: HTMLElement[];
  onChange: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

function renderView(
  overrides: Partial<React.ComponentProps<typeof ArrangementView>> = {},
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  const onChange = vi.fn();
  const props: React.ComponentProps<typeof ArrangementView> = {
    phrases: BASE_PHRASES,
    totalBars: 16,
    onPhraseChange: onChange,
    ...overrides,
  } as React.ComponentProps<typeof ArrangementView>;

  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <ArrangementView {...props} />
      </I18nProvider>,
    );
  });

  const bars = container.querySelector(
    '[data-testid="arrangement-bars"]',
  ) as HTMLElement | null;
  if (bars) {
    Object.defineProperty(bars, "clientWidth", {
      configurable: true,
      value: 800,
    });
  }

  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-testid="arrangement-view"] [role="button"]',
    ),
  );

  return {
    container,
    blocks,
    onChange,
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

function pointer(el: Element, type: string, clientX: number) {
  act(() => {
    el.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        clientX,
        clientY: 0,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function keydown(el: Element, key: string, init: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
    );
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("v3.2.0 S2: 乐段拖动", () => {
  it("拖动 2 小节 → 只回调一次，落点为小节整数", () => {
    const h = renderView();
    expect(h.blocks).toHaveLength(2);

    pointer(h.blocks[0], "pointerdown", 0);
    pointer(h.blocks[0], "pointermove", BAR_PX * 2);
    pointer(h.blocks[0], "pointerup", BAR_PX * 2);

    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.onChange).toHaveBeenCalledWith("p1", { startBar: 3, endBar: 6 });

    h.cleanup();
  });

  it("拖动不足半小节 → 不产生任何图更新", () => {
    const h = renderView();

    pointer(h.blocks[0], "pointerdown", 0);
    pointer(h.blocks[0], "pointermove", BAR_PX * 0.4);
    pointer(h.blocks[0], "pointerup", BAR_PX * 0.4);

    expect(h.onChange).not.toHaveBeenCalled();

    h.cleanup();
  });

  it("向右拖到相邻乐段 → 停在邻居前一格（不重叠）", () => {
    const h = renderView();

    pointer(h.blocks[0], "pointerdown", 0);
    pointer(h.blocks[0], "pointermove", BAR_PX * 20);
    pointer(h.blocks[0], "pointerup", BAR_PX * 20);

    expect(h.onChange).toHaveBeenCalledTimes(1);
    const changes = h.onChange.mock.calls[0][1] as { startBar: number; endBar: number };
    // 邻居 p2 从 10 起，长度 4 → 最晚只能放到 6..9
    expect(changes).toEqual({ startBar: 6, endBar: 9 });
    expect(changes.endBar).toBeLessThan(10);

    h.cleanup();
  });

  it("向左拖过头 → 停在 1（不越过第 1 小节）", () => {
    const h = renderView({
      phrases: [
        { id: "p1", name: "Intro", startBar: 5, endBar: 8, formRole: "intro" },
      ],
    });

    pointer(h.blocks[0], "pointerdown", 0);
    pointer(h.blocks[0], "pointermove", -BAR_PX * 20);
    pointer(h.blocks[0], "pointerup", -BAR_PX * 20);

    expect(h.onChange).toHaveBeenCalledWith("p1", { startBar: 1, endBar: 4 });

    h.cleanup();
  });
});

describe("v3.2.0 S2: 右缘改长度", () => {
  it("拖右缘 2 小节 → 只改 endBar，startBar 不动", () => {
    const h = renderView();
    const handle = h.container.querySelector(
      '[data-testid="arrangement-resize-p1"]',
    ) as HTMLElement;
    expect(handle).not.toBeNull();

    pointer(handle, "pointerdown", 0);
    pointer(h.blocks[0], "pointermove", BAR_PX * 2);
    pointer(h.blocks[0], "pointerup", BAR_PX * 2);

    expect(h.onChange).toHaveBeenCalledTimes(1);
    expect(h.onChange).toHaveBeenCalledWith("p1", { startBar: 1, endBar: 6 });

    h.cleanup();
  });

  it("改长度被相邻乐段挡住 → 停在邻居前一格", () => {
    const h = renderView({
      phrases: [
        { id: "p1", name: "Intro", startBar: 1, endBar: 4, formRole: "intro" },
        { id: "p2", name: "Verse", startBar: 6, endBar: 9, formRole: "verse" },
      ],
    });
    const handle = h.container.querySelector(
      '[data-testid="arrangement-resize-p1"]',
    ) as HTMLElement;

    pointer(handle, "pointerdown", 0);
    pointer(h.blocks[0], "pointermove", BAR_PX * 10);
    pointer(h.blocks[0], "pointerup", BAR_PX * 10);

    expect(h.onChange).toHaveBeenCalledWith("p1", { startBar: 1, endBar: 5 });

    h.cleanup();
  });
});

describe("v3.2.0 S2: 键盘与检查器", () => {
  it("→ 移动 1 小节，Shift+→ 移动 4 小节", () => {
    const h = renderView();

    keydown(h.blocks[0], "ArrowRight");
    expect(h.onChange).toHaveBeenLastCalledWith("p1", { startBar: 2, endBar: 5 });

    keydown(h.blocks[0], "ArrowRight", { shiftKey: true });
    expect(h.onChange).toHaveBeenLastCalledWith("p1", { startBar: 5, endBar: 8 });

    h.cleanup();
  });

  it("已在最左/最右时方向键不产生回调", () => {
    const h = renderView({
      phrases: [
        { id: "p1", name: "Intro", startBar: 1, endBar: 4, formRole: "intro" },
        { id: "p2", name: "Verse", startBar: 5, endBar: 8, formRole: "verse" },
      ],
    });

    keydown(h.blocks[0], "ArrowLeft"); // 已经在 1
    expect(h.onChange).not.toHaveBeenCalled();

    h.cleanup();
  });

  it("Delete 键删除当前乐段", () => {
    const onDelete = vi.fn();
    const h = renderView({ onPhraseDelete: onDelete });

    keydown(h.blocks[0], "Delete");
    expect(onDelete).toHaveBeenCalledWith("p1");

    h.cleanup();
  });

  it("单击选中 → 检查器出现，三个按钮各自接到回调", () => {
    const onDelete = vi.fn();
    const onDuplicate = vi.fn();
    const onDouble = vi.fn();
    const h = renderView({
      onPhraseDelete: onDelete,
      onPhraseDuplicate: onDuplicate,
      onSectionDoubleClick: onDouble,
    });

    // 未选中时没有检查器
    expect(
      h.container.querySelector('[data-testid="arrangement-selected-info"]'),
    ).toBeNull();

    click(h.blocks[0]);
    const info = h.container.querySelector(
      '[data-testid="arrangement-selected-info"]',
    );
    expect(info).not.toBeNull();

    click(h.container.querySelector('[data-testid="arrangement-focus"]')!);
    expect(onDouble).toHaveBeenCalledWith("p1");

    click(h.container.querySelector('[data-testid="arrangement-duplicate"]')!);
    expect(onDuplicate).toHaveBeenCalledWith("p1");

    click(h.container.querySelector('[data-testid="arrangement-delete"]')!);
    expect(onDelete).toHaveBeenCalledWith("p1");

    h.cleanup();
  });
});

describe("v3.2.0 S2: 播放头与只读形态", () => {
  it("播放头按小节定位，所在乐段高亮", () => {
    const h = renderView({
      phrases: [
        { id: "p1", name: "Intro", startBar: 1, endBar: 4, formRole: "intro" },
        { id: "p2", name: "Verse", startBar: 5, endBar: 8, formRole: "verse" },
      ],
      playheadPosition: { bar: 6, beat: 1 },
    });

    const playhead = h.container.querySelector(
      '[data-testid="arrangement-playhead"]',
    ) as HTMLElement | null;
    expect(playhead).not.toBeNull();
    // (6-1)/16 = 31.25%
    expect(playhead!.style.left).toBe("31.25%");

    // 第 6 小节落在 p2（5-8）内 → 只有 p2 带 active 类
    expect(h.blocks[1].className).toContain("phraseBlockActive");
    expect(h.blocks[0].className).not.toContain("phraseBlockActive");

    h.cleanup();
  });

  it("未传播放头时不渲染播放头", () => {
    const h = renderView();
    expect(
      h.container.querySelector('[data-testid="arrangement-playhead"]'),
    ).toBeNull();
    h.cleanup();
  });

  it("不传 onPhraseChange → 只读：无缩放手柄、无可拖拽形态", () => {
    const h = renderView({ onPhraseChange: undefined });

    expect(
      h.container.querySelector('[data-testid="arrangement-resize-p1"]'),
    ).toBeNull();
    expect(h.blocks[0].className).not.toContain("phraseBlockEditable");

    // 指针拖动不应崩溃，也不应留下任何选中态
    pointer(h.blocks[0], "pointerdown", 0);
    pointer(h.blocks[0], "pointermove", BAR_PX * 3);
    pointer(h.blocks[0], "pointerup", BAR_PX * 3);
    expect(
      h.container.querySelector('[data-testid="arrangement-selected-info"]'),
    ).toBeNull();

    h.cleanup();
  });

  it("拖动结束时的那次 click 被吞掉（不会误选中），随后的点击照常生效", async () => {
    const h = renderView();

    pointer(h.blocks[0], "pointerdown", 0);
    pointer(h.blocks[0], "pointermove", BAR_PX * 2);
    pointer(h.blocks[0], "pointerup", BAR_PX * 2);
    // 浏览器在 pointerup 之后必然补一个 click
    click(h.blocks[0]);
    expect(
      h.container.querySelector('[data-testid="arrangement-selected-info"]'),
    ).toBeNull();

    // 抑制标记必须自清除，否则下一次真实点击会被吃掉
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    click(h.blocks[0]);
    expect(
      h.container.querySelector('[data-testid="arrangement-selected-info"]'),
    ).not.toBeNull();

    h.cleanup();
  });
});
