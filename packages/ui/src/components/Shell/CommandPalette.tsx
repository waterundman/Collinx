import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CommandItem } from "./useCommandPalette";
import styles from "./CommandPalette.module.css";

export interface CommandPaletteProps {
  open: boolean;
  items: CommandItem[];
  onClose: () => void;
  placeholder?: string;
}

/**
 * v3.0.0 A3：命令面板。
 *
 * 命令式组件：只吃 `items`，不认识任何业务。过滤走 label 子串（不引入模糊
 * 匹配库 —— 30 条命令量级下子串足够，且行为可预期）。
 * 朴素：无毛玻璃、无缩放入场，只有 120ms 透明度。
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  items,
  onClose,
  placeholder = "搜索或执行命令…",
}) => {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.label.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      // 面板挂载后立即聚焦，用户不需要再点一次
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  /**
   * v3.2.0 S3：关闭后把焦点还给打开它的控件。
   *
   * 此前 Esc 关闭面板后焦点落在 <body>，键盘用户要重新从页面开头 Tab 进来。
   * 记录时机取"open 刚变 true"这一刻 —— 此时输入框的 focus 还在 setTimeout 里
   * 没落地，activeElement 仍是触发按钮。
   */
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    return () => {
      previous?.focus?.();
    };
  }, [open]);

  /**
   * v3.2.0 S3：焦点陷阱。aria-modal="true" 只是声明，浏览器不会真的拦住 Tab。
   * 不拦的话 Tab 会跑到面板背后的顶栏按钮上，而遮罩又挡住了它们的视觉焦点。
   */
  const handleTabTrap = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const focusables = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'input, button:not([disabled])',
      ) ?? [],
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = active !== null && panelRef.current?.contains(active) === true;
    if (e.shiftKey) {
      if (!inside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (!inside || active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  const runAt = (index: number) => {
    const item = filtered[index];
    if (!item) return;
    onClose();
    item.run();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (filtered.length === 0 ? 0 : (c + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (filtered.length === 0 ? 0 : (c - 1 + filtered.length) % filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(cursor);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className={styles.overlay}
      data-testid="command-palette"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onKeyDown={handleTabTrap}
      >
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          placeholder={placeholder}
          data-testid="command-input"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className={styles.list} role="listbox" aria-label="命令">
          {filtered.length === 0 ? (
            <div className={styles.empty} data-testid="command-empty">
              没有匹配的命令
            </div>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={i === cursor}
                className={i === cursor ? styles.rowActive : styles.row}
                data-testid={`command-item-${item.id}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => runAt(i)}
              >
                <span className={styles.label}>{item.label}</span>
                {item.hint ? <span className={styles.hint}>{item.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
