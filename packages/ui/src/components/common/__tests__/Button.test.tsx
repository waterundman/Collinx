import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Button } from "../Button";
import { EmptyState } from "../EmptyState";

/**
 * v3.0.0 S3 / S4 的护栏。
 *
 * `Button` 承载「一屏一主任务」的唯一强调档，`EmptyState` 承载「一句话 + 一个
 * 动作」。两者都是被 9 个视图共用的默认件 —— 一旦有人给 ghost 也加上强调色、
 * 或把图标塞回空态，视觉纪律就静默失效，而既有 829 条测试一条都不会红。
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

describe("Button", () => {
  it("carries distinct class per variant", () => {
    const host = setup(
      <div>
        <Button variant="primary">主</Button>
        <Button variant="ghost">次</Button>
        <Button variant="danger">危</Button>
      </div>,
    );
    const [primary, ghost, danger] = Array.from(host.querySelectorAll("button"));
    const cls = (el: Element) => el.className;

    expect(cls(primary)).not.toBe(cls(ghost));
    expect(cls(ghost)).not.toBe(cls(danger));
    // 三档共用 base，故类名数量一致但内容不同
    expect(cls(primary).split(" ")).toHaveLength(2);
  });

  it("passes through data-testid and defaults to type=button", () => {
    const host = setup(<Button testId="my-action">点</Button>);
    const btn = host.querySelector("button")!;
    expect(btn.getAttribute("data-testid")).toBe("my-action");
    // 默认 button：防止误在 form 里当 submit
    expect(btn.getAttribute("type")).toBe("button");
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    const host = setup(
      <Button testId="dis" disabled onClick={onClick}>
        停
      </Button>,
    );
    const btn = host.querySelector("button")!;
    act(() => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("EmptyState", () => {
  it("renders one sentence and at most one action", () => {
    const onAction = vi.fn();
    const host = setup(
      <EmptyState testId="empty-x" title="还没有乐段。" action={{ label: "新建", onClick: onAction }} />,
    );

    expect(host.querySelector('[data-testid="empty-x"]')).not.toBeNull();
    expect(host.textContent).toContain("还没有乐段。");
    // 朴素判据：空态只有一个按钮，且没有 svg 插画
    const buttons = host.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(host.querySelector("svg")).toBeNull();

    act(() => {
      buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("renders without an action when none is given", () => {
    const host = setup(<EmptyState title="暂无内容。" />);
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(host.textContent).toBe("暂无内容。");
  });
});
