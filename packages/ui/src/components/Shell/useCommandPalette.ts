import { useCallback, useEffect, useState } from "react";

export interface CommandItem {
  id: string;
  label: string;
  /** 右侧快捷键提示，例如 "⌘2"。仅展示，不参与匹配。 */
  hint?: string;
  run: () => void;
}

/**
 * v3.0.0 A3：命令面板开关。
 *
 * 为什么集中在一个 hook：`⌘K` 只能有一个 keydown 入口。每个组件各挂一个
 * window listener 会出现「两个面板同时开」「Esc 被上游先吃掉」这类竞态。
 * 需要打开面板的地方调用 `open()`，不要自己再监听按键。
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  const show = useCallback(() => setOpen(true), []);

  return { open, setOpen, openPalette: show, close };
}
