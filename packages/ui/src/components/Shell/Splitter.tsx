import React, { useCallback, useRef } from "react";
import styles from "./Splitter.module.css";

export interface SplitterProps {
  /**
   * 被调整高度的上方面板选择器（默认取兄弟节点 `previousElementSibling`）。
   * 拖动时只改 CSS 变量，**不 setState** —— 每帧 setState 会让整棵 App 重渲染，
   * 而拖动时用户看到的只是面板边界移动。
   */
  token?: string;
  min?: number;
  max?: number;
  /** 松手后回调，用于持久化尺寸（可选）。 */
  onCommit?: (px: number) => void;
  label?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * v3.0.0 A2：可拖拽分栏。
 *
 * 朴素约束：8px 热区、1px 视觉线、拖动时面板边界即时跟手但**不加过渡**
 * （过渡会让拖动产生拖影），仅在非拖动状态保留 120ms 的 hover 反馈。
 */
export const Splitter: React.FC<SplitterProps> = ({
  token = "--compose-score-h",
  min = 80,
  max = 560,
  onCommit,
  label = "调整面板高度",
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  const apply = useCallback(
    (px: number) => {
      const parent = ref.current?.parentElement;
      if (parent) parent.style.setProperty(token, `${px}px`);
      return px;
    },
    [token],
  );

  const currentHeight = useCallback(() => {
    const prev = ref.current?.previousElementSibling as HTMLElement | null;
    return prev ? prev.getBoundingClientRect().height : min;
  }, [min]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startH: currentHeight() };
    },
    [currentHeight],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      apply(clamp(drag.startH + (e.clientY - drag.startY), min, max));
    },
    [apply, min, max],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        /* 已释放则忽略 */
      }
      onCommit?.(Math.round(currentHeight()));
    },
    [currentHeight, onCommit],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const delta = e.key === "ArrowUp" ? 8 : -8;
      apply(clamp(currentHeight() + delta, min, max));
    },
    [apply, currentHeight, min, max],
  );

  const handleReset = useCallback(() => {
    const parent = ref.current?.parentElement;
    parent?.style.removeProperty(token);
    onCommit?.(Math.round(currentHeight()));
  }, [token, currentHeight, onCommit]);

  return (
    <div
      ref={ref}
      className={styles.splitter}
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuenow={Math.round(currentHeight())}
      data-testid="shell-splitter"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={handleReset}
      onKeyDown={handleKeyDown}
    />
  );
};
