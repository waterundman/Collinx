import React from "react";
import type { DiffEnvelope } from "@collinx/core";
import { useI18n } from "../../i18n";
import { EmptyState } from "../common/EmptyState";
import { DiffCard } from "./DiffCard";
import styles from "./AgentPanel.module.css";

export interface AgentPanelProps {
  pendingDiffs: DiffEnvelope[];
  historyDiffs: DiffEnvelope[];
  /** v2.5.0：被拒绝的提案（留痕计数；此前"已拒绝"恒显示 0） */
  rejectedDiffs?: DiffEnvelope[];
  onApply: (diffId: string) => void;
  onReject: (diffId: string) => void;
  onRollback: (rollbackToken: string) => void;
}

interface HistoryEntry {
  diff: DiffEnvelope;
  status: "applied" | "rejected" | "rolled-back";
}

export function AgentPanel({
  pendingDiffs,
  historyDiffs,
  rejectedDiffs,
  onApply,
  onReject,
  onRollback,
}: AgentPanelProps) {
  const { t } = useI18n();
  // Stage 1: history comes from the real store's appliedDiffs list, which only
  // keeps diffs that are currently applied (rejected diffs never enter it and
  // rolled-back diffs are removed by rollback). No demo heuristic needed.
  const historyEntries: HistoryEntry[] = historyDiffs.map((diff) => ({
    diff,
    status: "applied",
  }));

  const appliedCount = historyEntries.filter((e) => e.status === "applied").length;
  // v2.5.0：拒绝计数来自 store 的 rejectedDiffs 留痕（此前恒为 0）
  const rejectedCount = (rejectedDiffs ?? []).length;

  return (
    <div className={styles.panel} data-testid="agent-panel">
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>{t('agentPanel.title')}</span>
        <span className={styles.count} data-testid="agent-panel-count">
          {t('agentPanel.pendingCount', { count: pendingDiffs.length })} · {t('agentPanel.appliedCount', { count: appliedCount })} · {t('agentPanel.rejectedCount', { count: rejectedCount })}
        </span>
      </div>

      <div className={styles.content}>
        <div className={styles.leftPane} data-testid="agent-panel-pending">
          <div className={styles.sectionHeader}>
            <span className={`${styles.sectionDot} ${styles.dotPending}`} />
            {t('agentPanel.pendingReview')} ({pendingDiffs.length})
          </div>
          {pendingDiffs.length === 0 ? (
            <EmptyState testId="agent-panel-empty-pending" title={t('agentPanel.noPendingDiffs')} />
          ) : (
            <div className={styles.cardList}>
              {pendingDiffs.map((diff) => (
                <DiffCard
                  key={diff.diffId}
                  diff={diff}
                  status="pending"
                  onApply={() => onApply(diff.diffId)}
                  onReject={() => onReject(diff.diffId)}
                />
              ))}
            </div>
          )}
        </div>

        <div className={styles.rightPane} data-testid="agent-panel-history">
          <div className={styles.sectionHeader}>
            <span className={`${styles.sectionDot} ${styles.dotApplied}`} />
            {t('agentPanel.history')} ({historyDiffs.length})
          </div>
          {historyEntries.length === 0 ? (
            <EmptyState testId="agent-panel-empty-history" title={t('agentPanel.noHistory')} />
          ) : (
            <div className={styles.cardList}>
              {historyEntries.map((entry) => (
                <DiffCard
                  key={entry.diff.diffId}
                  diff={entry.diff}
                  status={entry.status}
                  onRollback={
                    entry.status === "applied"
                      ? () => onRollback(entry.diff.rollbackToken)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
