import React, { useCallback, useState } from "react";
import type { ToolCallRecord } from "@collinx/core";
import { useI18n } from "../../i18n";
import styles from "./AgentToolCallTimeline.module.css";

export interface ToolCallTimelineProps {
  /** Agent tool-call trace, newest last (matches store.toolCalls). */
  toolCalls: ToolCallRecord[];
}

const STATUS_CLASS: Record<ToolCallRecord["status"], string> = {
  running: styles.statusRunning,
  success: styles.statusSuccess,
  error: styles.statusError,
};

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ToolCallTimeline({ toolCalls }: ToolCallTimelineProps) {
  const { t } = useI18n();
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    new Set()
  );

  const toggleParams = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return (
    <div className={styles.container} data-testid="tool-call-timeline">
      <div className={styles.toolbar}>
        <span className={styles.toolbarTitle}>{t("toolCalls.title")}</span>
        <span className={styles.count} data-testid="tool-call-count">
          {toolCalls.length}
        </span>
      </div>

      {toolCalls.length === 0 ? (
        <div className={styles.emptyState} data-testid="tool-call-empty">
          {t("toolCalls.empty")}
        </div>
      ) : (
        <div className={styles.list}>
          {toolCalls.map((call) => {
            const hasParams =
              call.params !== undefined && Object.keys(call.params).length > 0;
            const expanded = expandedIds.has(call.id);
            return (
              <div
                key={call.id}
                className={styles.item}
                data-testid="tool-call-item"
              >
                <div className={styles.itemHeader}>
                  <span className={styles.toolName} data-testid="tool-call-name">
                    {call.toolName}
                  </span>
                  <span
                    className={`${styles.statusBadge} ${STATUS_CLASS[call.status]}`}
                    data-testid="tool-call-status"
                  >
                    {t(`toolCalls.status.${call.status}`)}
                  </span>
                </div>

                <div className={styles.summary} data-testid="tool-call-summary">
                  {call.resultSummary}
                </div>

                <div className={styles.meta}>
                  <span className={styles.agentName}>{call.agentName}</span>
                  <span className={styles.time}>{formatTime(call.timestamp)}</span>
                </div>

                {hasParams && (
                  <>
                    <button
                      type="button"
                      className={styles.toggleButton}
                      onClick={() => toggleParams(call.id)}
                    >
                      {expanded
                        ? t("toolCalls.hideParams")
                        : t("toolCalls.showParams")}
                    </button>
                    {expanded && (
                      <pre
                        className={styles.params}
                        data-testid="tool-call-params"
                      >
                        {JSON.stringify(call.params, null, 2)}
                      </pre>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ToolCallTimeline;
