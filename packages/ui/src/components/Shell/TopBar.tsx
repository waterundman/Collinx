import React from "react";
import styles from "./TopBar.module.css";

export interface TopBarProps {
  /** Brand text rendered on the left of the header. */
  brand: string;
  /** Status text rendered on the right of the header. */
  status: React.ReactNode;
  /** Tab area content (usually a set of <TabPill /> children). */
  children?: React.ReactNode;
  /** Right-aligned action buttons (e.g. save/load project) shown before status. */
  toolbar?: React.ReactNode;
  /** v3.0.0 A3: 全局命令入口（⌘K），渲染在 toolbar 之后、status 之前。 */
  command?: React.ReactNode;
  /**
   * v3.2.0 S3：给出标签即把页签区升级为真正的 tablist
   * （role="tablist" + ←/→ 在页签间移动并切换）。缺省时保持原来的纯容器，
   * 不影响只用 TopBar 当布局壳的调用方。
   */
  tablistLabel?: string;
}

/**
 * App chrome header: brand + tab area (children) + status.
 *
 * Extracted from App.tsx in v1.14 Stage 3 (xAI-style layout migration). Keeps
 * the data-testid contract the integration/E2E tests rely on: "tab-bar" for
 * the tab container, "header-status" for the status line.
 */
export const TopBar: React.FC<TopBarProps> = ({
  brand,
  status,
  children,
  toolbar,
  command,
  tablistLabel,
}) => {
  /**
   * v3.2.0 S3：tablist 的方向键导航（WAI-ARIA tabs 模式）。
   *
   * 页签切换是纯客户端状态，没有代价，所以采用 "selection follows focus"
   * ——方向键一按就切，不需要再按 Enter。Home/End 跳到首尾。
   */
  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      e.key !== "ArrowRight" &&
      e.key !== "ArrowLeft" &&
      e.key !== "Home" &&
      e.key !== "End"
    ) {
      return;
    }
    const tabs = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
    );
    if (tabs.length === 0) return;
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    e.preventDefault();
    let next = current;
    if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else next = tabs.length - 1;
    const target = tabs[next];
    target.focus();
    target.click();
  };

  const tabBar = (
    <div className={styles.tabBar} data-testid="tab-bar">
      {children}
    </div>
  );

  return (
    <header className={styles.header}>
      <span className={styles.brand}>{brand}</span>

      {tablistLabel ? (
        <div
          className={styles.tabBar}
          data-testid="tab-bar"
          role="tablist"
          aria-label={tablistLabel}
          onKeyDown={handleTabKeyDown}
        >
          {children}
        </div>
      ) : (
        tabBar
      )}

      {toolbar ? (
        <div className={styles.toolbar} data-testid="topbar-toolbar">
          {toolbar}
        </div>
      ) : null}

      {command ? (
        <div className={styles.command} data-testid="topbar-command">
          {command}
        </div>
      ) : null}

      <span className={styles.status} data-testid="header-status">
        {status}
      </span>
    </header>
  );
};
