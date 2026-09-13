import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useKeyboardShortcuts,
  isEditableTarget,
} from "../useKeyboardShortcuts";

function fireKeyDown(target: EventTarget, init: KeyboardEventInit): void {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
}

/** Dispatching on `window` itself makes window the event target. */
function fireOnWindow(init: KeyboardEventInit): void {
  fireKeyDown(window, init);
}

function setup(onUndo = vi.fn(), onRedo = vi.fn()) {
  let root!: Root;
  const container = document.createElement("div");
  document.body.appendChild(container);

  function Probe({
    undo,
    redo,
  }: {
    undo: () => void;
    redo: () => void;
  }) {
    useKeyboardShortcuts({ onUndo: undo, onRedo: redo });
    return <div data-testid="hook-probe" />;
  }

  act(() => {
    root = createRoot(container);
    root.render(<Probe undo={onUndo} redo={onRedo} />);
  });

  return {
    root,
    container,
    rerender(undo: () => void, redo: () => void) {
      act(() => {
        root.render(<Probe undo={undo} redo={redo} />);
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

describe("useKeyboardShortcuts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("Ctrl+Z 触发 onUndo,Ctrl+Shift+Z 触发 onRedo", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const s = setup(onUndo, onRedo);

    fireOnWindow({ key: "z", ctrlKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).not.toHaveBeenCalled();

    fireOnWindow({ key: "z", ctrlKey: true, shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledTimes(1);

    s.cleanup();
  });

  it("Ctrl+Y 触发 onRedo(macOS 兼容 Cmd+Shift+Z / Cmd+Y)", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const s = setup(onUndo, onRedo);

    fireOnWindow({ key: "y", ctrlKey: true });
    expect(onRedo).toHaveBeenCalledTimes(1);

    fireOnWindow({ key: "z", metaKey: true });
    expect(onUndo).toHaveBeenCalledTimes(1);

    fireOnWindow({ key: "z", metaKey: true, shiftKey: true });
    expect(onRedo).toHaveBeenCalledTimes(2);

    fireOnWindow({ key: "y", metaKey: true });
    expect(onRedo).toHaveBeenCalledTimes(3);

    s.cleanup();
  });

  it("无 Ctrl/Cmd 修饰键时 z/y 不触发", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const s = setup(onUndo, onRedo);

    fireOnWindow({ key: "z" });
    fireOnWindow({ key: "y" });
    fireOnWindow({ key: "z", shiftKey: true });
    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();

    s.cleanup();
  });

  it("input 元素内 Ctrl+Z 不触发全局撤销(保留原生文本撤销)", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const s = setup(onUndo, onRedo);

    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      fireKeyDown(input, { key: "z", ctrlKey: true });
      fireKeyDown(input, { key: "y", ctrlKey: true });
      fireKeyDown(input, { key: "z", ctrlKey: true, shiftKey: true });
    });
    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();

    input.remove();
    s.cleanup();
  });

  it("textarea 元素内 Ctrl+Z 不触发全局撤销", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const s = setup(onUndo, onRedo);

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    act(() => {
      fireKeyDown(textarea, { key: "z", ctrlKey: true });
    });
    expect(onUndo).not.toHaveBeenCalled();

    textarea.remove();
    s.cleanup();
  });

  it("contentEditable 区域内 Ctrl+Z 不触发全局撤销", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const s = setup(onUndo, onRedo);

    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.appendChild(editable);
    act(() => {
      fireKeyDown(editable, { key: "z", ctrlKey: true });
    });
    expect(onUndo).not.toHaveBeenCalled();

    editable.remove();
    s.cleanup();
  });

  it("非编辑区域(普通 body/window)Ctrl+Z 正常触发全局撤销", () => {
    const onUndo = vi.fn();
    const s = setup(onUndo, vi.fn());

    act(() => {
      fireOnWindow({ key: "z", ctrlKey: true });
    });
    expect(onUndo).toHaveBeenCalledTimes(1);

    const button = document.createElement("button");
    document.body.appendChild(button);
    act(() => {
      fireKeyDown(button, { key: "z", ctrlKey: true });
    });
    expect(onUndo).toHaveBeenCalledTimes(2);

    button.remove();
    s.cleanup();
  });

  it("handlers 更新后使用最新回调(单监听 ref 模式)", () => {
    const onUndo1 = vi.fn();
    const onUndo2 = vi.fn();
    const onRedo = vi.fn();
    const s = setup(onUndo1, onRedo);

    s.rerender(onUndo2, onRedo);
    act(() => {
      fireOnWindow({ key: "z", ctrlKey: true });
    });
    expect(onUndo2).toHaveBeenCalledTimes(1);
    expect(onUndo1).not.toHaveBeenCalled();

    s.cleanup();
  });

  describe("isEditableTarget", () => {
    it("input/textarea/select 判定为可编辑", () => {
      const input = document.createElement("input");
      const textarea = document.createElement("textarea");
      const select = document.createElement("select");
      expect(isEditableTarget(input)).toBe(true);
      expect(isEditableTarget(textarea)).toBe(true);
      expect(isEditableTarget(select)).toBe(true);
    });

    it("contentEditable 元素判定为可编辑,普通元素/非 HTMLElement 不是", () => {
      const editable = document.createElement("div");
      editable.contentEditable = "true";
      expect(isEditableTarget(editable)).toBe(true);

      const plain = document.createElement("div");
      expect(isEditableTarget(plain)).toBe(false);

      expect(isEditableTarget(window)).toBe(false);
      expect(isEditableTarget(null)).toBe(false);
      // Runtime-tolerant: undefined targets are also treated as non-editable.
      expect(isEditableTarget(undefined as unknown as EventTarget | null)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// v2.0.0 Stage 1（S1-T10）：Space = 播放/暂停（onPlayPause）。
//
// - 无修饰键的 Space 在既有 `if (!(e.ctrlKey || e.metaKey)) return;` 之前处理，
//   preventDefault 后调用 onPlayPause 并返回。
// - 沿用 isEditableTarget 守卫：input/textarea/select/contentEditable 内 Space
//   不触发（保留输入框内空格打字）。
// - Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 行为完全不变。
// 本段使用独立 harness（不改既有用例与其 setup 助手）。
// ---------------------------------------------------------------------------

describe("useKeyboardShortcuts v2.0.0 Space → onPlayPause (S1-T10)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function setupPlay() {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const onPlayPause = vi.fn();
    let root!: Root;
    const container = document.createElement("div");
    document.body.appendChild(container);

    function Probe() {
      useKeyboardShortcuts({ onUndo, onRedo, onPlayPause });
      return <div data-testid="play-probe" />;
    }

    act(() => {
      root = createRoot(container);
      root.render(<Probe />);
    });

    return {
      onUndo,
      onRedo,
      onPlayPause,
      cleanup() {
        act(() => {
          root.unmount();
          container.remove();
        });
      },
    };
  }

  /** 派发并返回事件对象（以便断言 defaultPrevented）。 */
  function fire(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  }

  it("S1-T10a: 无修饰键 Space（key=' '）→ onPlayPause 触发 + preventDefault (critical)", () => {
    const s = setupPlay();
    const e = fire(window, { key: " " });
    expect(s.onPlayPause).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(s.onUndo).not.toHaveBeenCalled();
    expect(s.onRedo).not.toHaveBeenCalled();
    s.cleanup();
  });

  it("S1-T10b: input 内 Space 不触发（保留原生打字；不 preventDefault） (critical)", () => {
    const s = setupPlay();
    const input = document.createElement("input");
    document.body.appendChild(input);
    const e = fire(input, { key: " " });
    expect(s.onPlayPause).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    input.remove();
    s.cleanup();
  });

  it("S1-T10c: textarea/contentEditable 内 Space 均不触发", () => {
    const s = setupPlay();
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.appendChild(textarea);
    document.body.appendChild(editable);
    fire(textarea, { key: " " });
    fire(editable, { key: " " });
    expect(s.onPlayPause).not.toHaveBeenCalled();
    textarea.remove();
    editable.remove();
    s.cleanup();
  });

  it("S1-T10d: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 行为不受影响，且 Space 判定不误伤 (critical)", () => {
    const s = setupPlay();

    fire(window, { key: "z", ctrlKey: true });
    expect(s.onUndo).toHaveBeenCalledTimes(1);
    fire(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(s.onRedo).toHaveBeenCalledTimes(1);
    fire(window, { key: "y", ctrlKey: true });
    expect(s.onRedo).toHaveBeenCalledTimes(2);
    expect(s.onPlayPause).not.toHaveBeenCalled();

    s.cleanup();
  });

  it("S1-T10e: 带修饰键的 Space（Ctrl/Shift/Meta/Alt+Space）不触发播放", () => {
    const s = setupPlay();
    fire(window, { key: " ", ctrlKey: true });
    fire(window, { key: " ", shiftKey: true });
    fire(window, { key: " ", metaKey: true });
    fire(window, { key: " ", altKey: true });
    expect(s.onPlayPause).not.toHaveBeenCalled();
    s.cleanup();
  });

  it("S1-T10f: code='Space' / key='Spacebar' 兼容判定", () => {
    const s = setupPlay();
    // 旧浏览器 / 特殊键位：key 可能为 "Spacebar"，或 key 为空但 code="Space"。
    fire(window, { key: "Spacebar" });
    expect(s.onPlayPause).toHaveBeenCalledTimes(1);
    fire(window, { key: "Unidentified", code: "Space" });
    expect(s.onPlayPause).toHaveBeenCalledTimes(2);
    s.cleanup();
  });
});
