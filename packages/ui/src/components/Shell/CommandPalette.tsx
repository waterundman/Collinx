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
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label="命令面板">
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          placeholder={placeholder}
          data-testid="command-input"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className={styles.list} role="listbox">
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
