import React from "react";
import styles from "./AppShell.module.css";

export interface AppShellProps {
  /**
   * 应用内容。约定：**第一个子节点是 `<header>`（TopBar 自带 `<header>` 元素）**，
   * AppShell 用 `.shell > header` 把它固定在顶部；其余节点按文档流排布。
   * 这样无需把 57 行 TopBar JSX 挪成 prop，也不改变既有 DOM 结构（e2e 依赖）。
   */
  children: React.ReactNode;
  /** 可选右侧栏。仅在需要常驻侧栏的视图里传入，compose 不传。 */
  aside?: React.ReactNode;
}

/**
 * v3.0.0 A1：App Shell。
 *
 * 抽出来之前，`App.module.css` 的 `.appRoot` 是唯一根容器，9 个页签各自
 * 在自己分支里实现布局，没有共同骨架。AppShell 只负责「整页高度 + 纵向流
 * + 可选右栏」这一层，**不持有任何业务 state**，也不感知页签。
 */
export const AppShell: React.FC<AppShellProps> = ({ children, aside }) => {
  return (
    <div className={styles.shell} data-testid="app-shell">
      <div className={styles.main}>
        {children}
        {aside ? <div className={styles.aside}>{aside}</div> : null}
      </div>
    </div>
  );
};
