import React from "react";
import { Icon } from "../Icon/Icon";
import type { IconName } from "../Icon/Icon";
import styles from "./EmptyGuide.module.css";

export interface EmptyGuideStep {
  label: string;
}

export interface EmptyGuideProps {
  icon?: IconName;
  title: string;
  /** 有序步骤 —— 告诉用户"接下来做什么"，而不是只说"这里什么都没有" */
  steps?: EmptyGuideStep[];
  /** 可选主行动 */
  action?: { label: string; onClick: () => void };
  testId?: string;
}

/**
 * v2.6.0：统一空态引导。
 *
 * 起因：taste-critic 实测五个 tab 的主工作区有 77–95% 是死区（编排/教学/
 * 编制/混音/Agent）。空态只写"暂无 X"不构成任何可执行的下一步 —— 用户看到
 * 一片空白就只能走开。本组件把空态统一成「图标 + 标题 + 有序步骤 + 可选 CTA」，
 * 让每一块空白都至少回答"我现在该点什么"。
 */
export const EmptyGuide: React.FC<EmptyGuideProps> = ({
  icon = "spark",
  title,
  steps,
  action,
  testId,
}) => (
  <div className={styles.guide} data-testid={testId}>
    <span className={styles.icon}>
      <Icon name={icon} size={22} strokeWidth={1.4} aria-hidden />
    </span>
    <p className={styles.title}>{title}</p>
    {steps && steps.length > 0 && (
      <ol className={styles.steps}>
        {steps.map((step, i) => (
          <li key={i} className={styles.step}>
            <span className={styles.stepIndex}>{i + 1}</span>
            <span className={styles.stepLabel}>{step.label}</span>
          </li>
        ))}
      </ol>
    )}
    {action && (
      <button type="button" className={styles.action} onClick={action.onClick}>
        {action.label}
      </button>
    )}
  </div>
);

export default EmptyGuide;
