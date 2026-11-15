import React from "react";
import styles from "./TabPill.module.css";

export interface TabPillProps<TId extends string = string> {
  /** Tab id; also used for the data-testid="tab-{id}" contract. */
  id: TId;
  /** Whether this pill is the active tab (gets the white pill style). */
  active?: boolean;
  /** Called with the pill id when clicked. */
  onSelect: (id: TId) => void;
  /** Tab label. */
  children?: React.ReactNode;
}

/**
 * Single tab button (pill style) in the app chrome header.
 *
 * Extracted from App.tsx in v1.14 Stage 3. Controlled: `active` + `onSelect`
 * come from the parent. Keeps the data-testid="tab-{id}" contract the
 * integration/E2E tests click.
 */
export const TabPill = <TId extends string = string>({
  id,
  active = false,
  onSelect,
  children,
}: TabPillProps<TId>) => {
  return (
    <button
      type="button"
      // v3.2.0 S3：此前只是「一排长得像页签的按钮」—— 读屏软件读不出
      // 当前在哪一页，Tab 键要按 10 次才能穿过顶栏。
      // 现在：role="tab" + aria-selected + roving tabindex（只有当前页在 Tab 序列里，
      // 页签之间用 ←/→ 移动）。
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      data-testid={`tab-${id}`}
      onClick={() => onSelect(id)}
      className={`${styles.pill}${active ? ` ${styles.pillActive}` : ""}`}
    >
      {children}
    </button>
  );
};
