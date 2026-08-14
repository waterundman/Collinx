import { useEffect, useRef } from "react";

export interface KeyboardShortcutHandlers {
  /** Ctrl+Z — restore the previous state (no-op when the undo stack is
   *  empty, the store guards that). */
  onUndo: () => void;
  /** Ctrl+Shift+Z or Ctrl+Y — re-apply an undone state (no-op when the redo
   *  stack is empty). */
  onRedo: () => void;
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
 * - Never fires when the event target is an input/textarea/contentEditable
 *   region, so typing in a field keeps the browser's native text undo.
 *
 * Handlers are read through a ref so the single window listener always calls
 * the latest callbacks without re-binding on every render.
 */
export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      // Ignore plain-letter shortcuts without a modifier.
      if (!(e.ctrlKey || e.metaKey)) return;
      // Native text undo/redo inside a field takes precedence.
      if (isEditableTarget(e.target)) return;

      const key = e.key.toLowerCase();
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
