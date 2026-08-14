import React from "react";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  /** Brand text rendered on the left of the header. */
  brand: string;
  /** Status text rendered on the right of the header. */
  status: React.ReactNode;
  /** Tab area content (usually a set of <TabPill /> children). */
  children?: React.ReactNode;
}

/**
 * App chrome header: brand + tab area (children) + status.
 *
 * Extracted from App.tsx in v1.14 Stage 3 (xAI-style layout migration). Keeps
 * the data-testid contract the integration/E2E tests rely on: "tab-bar" for
 * the tab container, "header-status" for the status line.
 */
export const TopBar: React.FC<TopBarProps> = ({ brand, status, children }) => {
  return (
    <header className={styles.header}>
      <span className={styles.brand}>{brand}</span>

      <div className={styles.tabBar} data-testid="tab-bar">
        {children}
      </div>

      <span className={styles.status} data-testid="header-status">
        {status}
      </span>
    </header>
  );
};
