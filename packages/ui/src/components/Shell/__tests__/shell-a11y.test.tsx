/**
 * v3.2.0 S3：Shell 的无障碍行为。
 *
 * 1) 顶栏页签此前只是「一排长得像页签的按钮」：没有 role="tab"、没有
 *    aria-selected（实测为 null），读屏软件读不出当前在哪一页，Tab 键要按
 *    10 次才能穿过顶栏。现在 = tablist + roving tabindex + ←/→ 切换。
 * 2) 命令面板声明了 aria-modal="true"，但 Tab 从来不会被拦住 —— 焦点会跑到
 *    遮罩背后的顶栏按钮上；关闭后焦点落在 <body>，键盘用户要从头 Tab 进来。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TopBar } from "../TopBar";
import { TabPill } from "../TabPill";
import { CommandPalette } from "../CommandPalette";
import type { CommandItem } from "../useCommandPalette";

function mount(node: React.ReactElement): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(node);
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

function key(el: Element, k: string, init: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }),
    );
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

afterEach(() => {
  document.body.innerHTML = "";
});

// ---------------------------------------------------------------------------

function TabHarness() {
  const [active, setActive] = useState<"a" | "b" | "c">("a");
  return (
    <TopBar brand="Collinx" status="0" tablistLabel="Sections">
      {(["a", "b", "c"] as const).map((id) => (
        <TabPill key={id} id={id} active={active === id} onSelect={setActive}>
          {id.toUpperCase()}
        </TabPill>
      ))}
    </TopBar>
  );
}

describe("v3.2.0 S3: 顶栏 tablist", () => {
  it("页签区是 tablist，每个页签是 tab 且只有当前页 aria-selected", () => {
    const h = mount(<TabHarness />);
    const list = h.container.querySelector('[data-testid="tab-bar"]')!;
    expect(list.getAttribute("role")).toBe("tablist");
    expect(list.getAttribute("aria-label")).toBe("Sections");

    const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(3);
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    h.cleanup();
  });

  it("roving tabindex：只有当前页签在 Tab 序列里", () => {
    const h = mount(<TabHarness />);
    const tabs = Array.from(h.container.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);

    click(tabs[1]);
    const after = Array.from(h.container.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(after.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    expect(after[1].getAttribute("aria-selected")).toBe("true");
    h.cleanup();
  });

  it("←/→ 移动并切换，Home/End 跳首尾 (critical)", () => {
    const h = mount(<TabHarness />);
    const tabs = () => Array.from(h.container.querySelectorAll<HTMLElement>('[role="tab"]'));

    act(() => tabs()[0].focus());
    key(tabs()[0], "ArrowRight");
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs()[1]);

    key(tabs()[1], "End");
    expect(tabs()[2].getAttribute("aria-selected")).toBe("true");

    // 末尾再按 → 回绕到第一个
    key(tabs()[2], "ArrowRight");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");

    key(tabs()[0], "Home");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");

    h.cleanup();
  });

  it("未启用 tablist 时保持原样（不改变只用 TopBar 当布局壳的调用方）", () => {
    const h = mount(
      <TopBar brand="Collinx" status="0">
        <button type="button">bare</button>
      </TopBar>,
    );
    const list = h.container.querySelector('[data-testid="tab-bar"]')!;
    expect(list.getAttribute("role")).toBeNull();
    h.cleanup();
  });
});

// ---------------------------------------------------------------------------

const ITEMS: CommandItem[] = [
  { id: "one", label: "命令一", run: () => {} },
  { id: "two", label: "命令二", run: () => {} },
  { id: "three", label: "命令三", run: () => {} },
];

function PaletteHarness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        data-testid="opener"
        onClick={() => setOpen(true)}
      >
        open
      </button>
      <CommandPalette
        open={open}
        items={ITEMS}
        onClose={() => {
          setOpen(false);
          onClose?.();
        }}
      />
    </div>
  );
}

describe("v3.2.0 S3: 命令面板焦点", () => {
  it("打开后自动聚焦输入框", async () => {
    const h = mount(<PaletteHarness />);
    act(() => (h.container.querySelector('[data-testid="opener"]') as HTMLElement).focus());
    click(h.container.querySelector('[data-testid="opener"]')!);
    await flush();

    expect(document.activeElement).toBe(
      h.container.querySelector('[data-testid="command-input"]'),
    );
    h.cleanup();
  });

  it("Tab 到最后一个条目后回绕到面板第一个可聚焦元素（输入框）", async () => {
    const h = mount(<PaletteHarness />);
    click(h.container.querySelector('[data-testid="opener"]')!);
    await flush();

    const items = Array.from(
      h.container.querySelectorAll<HTMLElement>('[data-testid^="command-item-"]'),
    );
    const last = items[items.length - 1];
    const input = h.container.querySelector<HTMLElement>(
      '[data-testid="command-input"]',
    )!;

    act(() => last.focus());
    const e = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    act(() => last.dispatchEvent(e));

    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    h.cleanup();
  });

  it("Shift+Tab 在输入框（首个可聚焦元素）上回绕到最后一个条目", async () => {
    const h = mount(<PaletteHarness />);
    click(h.container.querySelector('[data-testid="opener"]')!);
    await flush();

    const items = Array.from(
      h.container.querySelectorAll<HTMLElement>('[data-testid^="command-item-"]'),
    );
    const last = items[items.length - 1];
    const input = h.container.querySelector<HTMLElement>(
      '[data-testid="command-input"]',
    )!;

    act(() => input.focus());
    const e = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => input.dispatchEvent(e));

    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    h.cleanup();
  });

  it("Shift+Tab 从第一个条目向左是自然回退到输入框，不该被拦", async () => {
    const h = mount(<PaletteHarness />);
    click(h.container.querySelector('[data-testid="opener"]')!);
    await flush();

    const firstItem = h.container.querySelector<HTMLElement>(
      '[data-testid="command-item-one"]',
    )!;
    act(() => firstItem.focus());
    const e = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => firstItem.dispatchEvent(e));

    expect(e.defaultPrevented).toBe(false);
    h.cleanup();
  });

  it("Esc 关闭并把焦点还给打开它的按钮 (critical)", async () => {
    const onClose = vi.fn();
    const h = mount(<PaletteHarness onClose={onClose} />);
    const opener = h.container.querySelector<HTMLElement>('[data-testid="opener"]')!;
    act(() => opener.focus());
    click(opener);
    await flush();

    const input = h.container.querySelector('[data-testid="command-input"]')!;
    key(input, "Escape");
    await flush();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(h.container.querySelector('[data-testid="command-palette"]')).toBeNull();
    expect(document.activeElement).toBe(opener);

    h.cleanup();
  });
});
