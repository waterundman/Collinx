import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppShell } from "../AppShell";
import { Splitter } from "../Splitter";
import { CommandPalette } from "../CommandPalette";

/**
 * v3.0.0 A1-A3 的接线护栏。
 *
 * 这三个组件都是「画布上存在、代码里也必须存在」的骨架件：
 * AppShell 决定整页高度链路，Splitter 决定分栏能否被键盘调整，
 * CommandPalette 决定 ⌘K 能否真的执行命令。它们此前零覆盖 ——
 * 删掉任何一个，824 条既有测试都不会变红。
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function setup(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

describe("AppShell", () => {
  it("renders children and optional aside inside the shell", () => {
    const host = setup(
      <AppShell aside={<div data-testid="aside-slot">aside</div>}>
        <header data-testid="header-slot">top</header>
        <main data-testid="content-slot">content</main>
      </AppShell>,
    );

    expect(host.querySelector('[data-testid="app-shell"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="header-slot"]')?.textContent).toBe("top");
    expect(host.querySelector('[data-testid="content-slot"]')?.textContent).toBe("content");
    expect(host.querySelector('[data-testid="aside-slot"]')?.textContent).toBe("aside");
  });

  it("omits the aside node when no aside prop is given", () => {
    const host = setup(
      <AppShell>
        <div>only content</div>
      </AppShell>,
    );
    expect(host.querySelector('[data-testid="app-shell"]')).not.toBeNull();
    expect(host.textContent).toBe("only content");
  });
});

describe("Splitter", () => {
  it("adjusts the panel height token by keyboard (8px per ArrowUp)", () => {
    const host = setup(
      <div>
        <div style={{ height: 200 }} />
        <Splitter min={0} max={999} />
      </div>,
    );
    const parent = host.firstElementChild as HTMLElement;
    const handle = host.querySelector('[data-testid="shell-splitter"]') as HTMLElement;

    expect(handle.getAttribute("role")).toBe("separator");

    act(() => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
      );
    });

    // ArrowUp = 上方面板变高。jsdom 里上一兄弟的 rect 高度为 0，故 0 + 8 = 8px
    expect(parent.style.getPropertyValue("--compose-score-h")).toBe("8px");
  });
});

describe("CommandPalette", () => {
  it("filters by label and runs the selected command on Enter", () => {
    const runTab = vi.fn();
    const runSave = vi.fn();
    const onClose = vi.fn();

    const host = setup(
      <CommandPalette
        open
        onClose={onClose}
        items={[
          { id: "tab-mixer", label: "跳到 混音", run: runTab },
          { id: "save-project", label: "保存工程", run: runSave },
        ]}
      />,
    );

    const input = host.querySelector('[data-testid="command-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    // 受控输入：必须走原生 setter + input 事件，直接改 value 不会触发 onChange
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "保存");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const items = host.querySelectorAll('[role="option"]');
    expect(items).toHaveLength(1);

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });

    expect(runSave).toHaveBeenCalledTimes(1);
    expect(runTab).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an empty hint when nothing matches", () => {
    const host = setup(
      <CommandPalette open onClose={() => {}} items={[{ id: "x", label: "保存工程", run: () => {} }]} />,
    );
    const input = host.querySelector('[data-testid="command-input"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "zzz");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="command-empty"]')).not.toBeNull();
  });
});
