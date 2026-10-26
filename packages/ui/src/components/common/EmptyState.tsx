import React from "react";
import { Button } from "./Button";
import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  /** 一句话说明缺什么。不写"暂无 X"以外的引导长文。 */
  title: string;
  /** 可选：唯一动作。有且仅有一个。 */
  action?: { label: string; onClick: () => void };
  testId?: string;
}

/**
 * v3.0.0 S4：朴素空态。
 *
 * 取代 v2.6.0 的 `EmptyGuide`（图标 + 有序步骤 + CTA）。当时的出发点是
 * 「让空白回答我现在该点什么」，但结果是：图标要画、步骤要编号、文案三行，
 * 空态比正常内容还重。朴素哲学的判据是 **一句话 + 一个动作，无插画**。
 *
 * 一处例外：如果某块空白确实需要多步引导（如首次使用），那属于 onboarding，
 * 应做成独立的引导流，而不是塞进空态里。
 */
export const EmptyState: React.FC<EmptyStateProps> = ({ title, action, testId }) => (
  <div className={styles.root} data-testid={testId}>
    <p className={styles.title}>{title}</p>
    {action ? (
      <Button variant="ghost" onClick={action.onClick}>
        {action.label}
      </Button>
    ) : null}
  </div>
);

export default EmptyState;
