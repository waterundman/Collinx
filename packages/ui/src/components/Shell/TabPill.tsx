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
      data-testid={`tab-${id}`}
      onClick={() => onSelect(id)}
      className={`${styles.pill}${active ? ` ${styles.pillActive}` : ""}`}
    >
      {children}
    </button>
  );
};
