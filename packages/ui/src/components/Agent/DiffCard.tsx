import React from "react";
import type { DiffEnvelope } from "@collinx/core";
import { useI18n } from "../../i18n";
import { ExplanationView } from "./ExplanationView";
import styles from "./DiffCard.module.css";

export interface DiffCardProps {
  diff: DiffEnvelope;
  status?: "pending" | "applied" | "rejected" | "rolled-back";
  onApply?: () => void;
  onReject?: () => void;
  onRollback?: () => void;
}

function severityClass(severity: "low" | "medium" | "high"): string {
  switch (severity) {
    case "low":
      return styles.riskLow;
    case "medium":
      return styles.riskMedium;
    case "high":
      return styles.riskHigh;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "applied":
      return styles.statusApplied;
    case "rejected":
      return styles.statusRejected;
    case "rolled-back":
      return styles.statusRolledBack;
    default:
      return "";
  }
}

export function DiffCard({ diff, status = "pending", onApply, onReject, onRollback }: DiffCardProps) {
  const { t } = useI18n();
  const isProposal = diff.permissionScope === "proposal_only";

  return (
    <div className={styles.card} data-testid={`diff-card-${diff.diffId}`}>
      <div className={styles.header}>
        <span className={styles.agentName}>{diff.actor.name}</span>
        <span
          className={`${styles.badge} ${isProposal ? styles.badgeProposal : styles.badgeReadOnly}`}
        >
          {diff.permissionScope.replace("_", " ")}
        </span>
        {status !== "pending" && (
          <span className={`${styles.statusBadge} ${statusClass(status)}`}>
            {status}
          </span>
        )}
      </div>

      <div className={styles.summary}>{diff.summary}</div>

      <div className={styles.meta}>
        <span>{diff.ops.length} {diff.ops.length !== 1 ? t('diffCard.operations') : t('diffCard.operation')}</span>
        {diff.riskFlags.length > 0 && (
          <span style={{ color: "var(--accent-red)" }}>
            {diff.riskFlags.length} {diff.riskFlags.length !== 1 ? t('diffCard.riskFlags') : t('diffCard.riskFlag')}
          </span>
        )}
      </div>

      {diff.riskFlags.length > 0 && (
        <div className={styles.riskFlags}>
          {diff.riskFlags.map((flag, i) => (
            <span
              key={i}
              className={`${styles.riskFlag} ${severityClass(flag.severity)}`}
              title={flag.description}
            >
              {flag.type} ({flag.severity})
            </span>
          ))}
        </div>
      )}

      <ExplanationView explanations={diff.domainExplanations} />

      {(status === "pending" || status === "applied") && (
        <div className={styles.footer}>
          {status === "pending" && (
            <>
              {onApply && (
                <button type="button" className={`${styles.btn} ${styles.btnApply}`} onClick={onApply}>
                  {t('diffCard.apply')}
                </button>
              )}
              {onReject && (
                <button type="button" className={`${styles.btn} ${styles.btnReject}`} onClick={onReject}>
                  {t('diffCard.reject')}
                </button>
              )}
            </>
          )}
          {status === "applied" && onRollback && (
            <button type="button" className={`${styles.btn} ${styles.btnRollback}`} onClick={onRollback}>
              {t('diffCard.rollback')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
