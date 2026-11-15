import { useEffect, useRef } from "react";

export interface KeyboardShortcutHandlers {
  /** Ctrl+Z — restore the previous state (no-op when the undo stack is
   *  empty, the store guards that). */
  onUndo: () => void;
  /** Ctrl+Shift+Z or Ctrl+Y — re-apply an undone state (no-op when the redo
   *  stack is empty). */
  onRedo: () => void;
  /**
   * v2.0.0 Stage 1 (D1-4, additive/optional): Space (no modifier) toggles
   * transport play/pause. Optional so existing callers (which only pass
   * onUndo/onRedo) keep working unchanged — undefined = zero behaviour
   * change. Ignored when the event target is an editable field.
   */
  onPlayPause?: () => void;
  /**
   * v3.2.0 S3：Ctrl/Cmd+S 保存工程。
   *
   * 命令面板一直展示 "⌘S" 提示，但从没实现 —— 属"界面承诺了、键盘做不到"。
   * 这里补上：只在提供了 onSave 时才 preventDefault（否则把浏览器默认的
   * 「保存网页」对话框留给调用方，不擅自吞掉）。
   */
  onSave?: () => void;
  /**
   * v3.2.0 S3：Ctrl/Cmd+1..9 跳转到第 N 个页签（0-based）。
   * 与命令面板里的 "⌘1..⌘9" 提示同一套语义。
   */
  onSelectTab?: (index: number) => void;
}

/**
 * True when the keydown event target is a text-editing surface: an
 * <input>/<textarea>/<select> element or any contentEditable region. Ctrl+Z
 * inside these must keep the native text undo, so the global shortcut is
 * skipped.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  // isContentEditable is the standard property, but jsdom does not implement
  // it (always undefined); fall back to the contentEditable string property
  // and the contenteditable attribute so tests and real browsers agree.
  if (target.isContentEditable) return true;
  const mode =
    typeof target.contentEditable === "string"
      ? target.contentEditable.toLowerCase()
      : "";
  if (mode === "true" || mode === "plaintext-only") return true;
  const attr = (target.getAttribute("contenteditable") ?? "").toLowerCase();
  return attr === "true" || attr === "plaintext-only";
}

/**
 * Stage 2: global undo/redo keyboard shortcuts.
 *
 * - Ctrl+Z (or Cmd+Z on macOS)        -> onUndo
 * - Ctrl+Shift+Z / Ctrl+Y (or Cmd+..) -> onRedo
 * - Ctrl/Cmd+S                        -> onSave（输入框内也生效）
 * - Ctrl/Cmd+1..9                     -> onSelectTab(n-1)
 * - Never fires when the event target is an input/textarea/contentEditable
 *   region, so typing in a field keeps the browser's native text undo.
 *
 * v2.0.0 Stage 1 (D1-4): Space (no modifiers) -> onPlayPause. Judged BEFORE
 * the "no modifier => return" guard below, because Space has no modifier;
 * the editable-target guard is still applied so typing a space in a field
 * does not toggle playback.
 *
 * Handlers are read through a ref so the single window listener always calls
 * the latest callbacks without re-binding on every render.
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      // v2.0.0 Stage 1 (D1-4): Space = play/pause. Uses e.key === " " (the
      // standard value) with "Spacebar" (legacy browsers) and e.code ===
      // "Space" (layout-independent) as fallbacks. Any modifier disqualifies
      // it (Ctrl+Space etc. stay reserved / untouched).
      const isSpace =
        e.key === " " || e.key === "Spacebar" || e.code === "Space";
      if (
        isSpace &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        !e.altKey
      ) {
        // Editable fields keep the native space (text input).
        if (isEditableTarget(e.target)) return;
        e.preventDefault();
        handlersRef.current.onPlayPause?.();
        return;
      }

      // Ignore plain-letter shortcuts without a modifier.
      if (!(e.ctrlKey || e.metaKey)) return;

      const key = e.key.toLowerCase();

      // v3.2.0 S3：⌘S 是文档级命令，输入框里也该保存 —— 因此放在
      // editable-target 守卫**之前**。浏览器默认的「保存网页」必须挡掉，
      // 否则用户按 ⌘S 会得到一份 HTML 而不是 .agentmusic。
      if (key === "s" && !e.shiftKey && !e.altKey) {
        if (!handlersRef.current.onSave) return;
        e.preventDefault();
        handlersRef.current.onSave();
        return;
      }

      // Native text undo/redo inside a field takes precedence.
      if (isEditableTarget(e.target)) return;

      // v3.2.0 S3：⌘1..⌘9 跳页签。数字在输入框里是打字，已由上面的
      // editable-target 守卫排除。
      if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        if (!handlersRef.current.onSelectTab) return;
        e.preventDefault();
        handlersRef.current.onSelectTab(Number(e.key) - 1);
        return;
      }

      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          handlersRef.current.onRedo();
        } else {
          handlersRef.current.onUndo();
        }
      } else if (key === "y") {
        e.preventDefault();
        handlersRef.current.onRedo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

export default useKeyboardShortcuts;
