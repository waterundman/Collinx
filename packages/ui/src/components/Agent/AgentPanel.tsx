import React from "react";
import type { DiffEnvelope } from "@collinx/core";
import { useI18n } from "../../i18n";
import { DiffCard } from "./DiffCard";
import styles from "./AgentPanel.module.css";

export interface AgentPanelProps {
  pendingDiffs: DiffEnvelope[];
  historyDiffs: DiffEnvelope[];
  onApply: (diffId: string) => void;
  onReject: (diffId: string) => void;
  onRollback: (rollbackToken: string) => void;
}

interface HistoryEntry {
  diff: DiffEnvelope;
  status: "applied" | "rejected" | "rolled-back";
}

function inferStatus(diff: DiffEnvelope, _historyDiffs: DiffEnvelope[]): HistoryEntry["status"] {
  void _historyDiffs;
  // In a real implementation, the status would come from the diff store.
  // For demo purposes, we use a simple heuristic based on diffId suffix.
  const last = diff.diffId.charAt(diff.diffId.length - 1);
  if (last < "4") return "applied";
  if (last < "8") return "rejected";
  return "rolled-back";
}

export function AgentPanel({
  pendingDiffs,
  historyDiffs,
  onApply,
  onReject,
  onRollback,
}: AgentPanelProps) {
  const { t } = useI18n();
  const historyEntries: HistoryEntry[] = historyDiffs.map((diff) => ({
    diff,
    status: inferStatus(diff, historyDiffs),
  }));

  const appliedCount = historyEntries.filter((e) => e.status === "applied").length;
  const rejectedCount = historyEntries.filter((e) => e.status === "rejected").length;

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
            <div className={styles.emptyState}>{t('agentPanel.noPendingDiffs')}</div>
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
            <div className={styles.emptyState}>{t('agentPanel.noHistory')}</div>
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
