import React, { useState, useCallback, useEffect } from "react";
import type { CrashInfo } from "./CrashNotification";
import styles from "./RecoveryDialog.module.css";

export type RecoveryAction = "reload" | "disable" | "ignore";

interface RecoveryDialogProps {
  crash: CrashInfo;
  isOpen: boolean;
  onAction: (action: RecoveryAction, pluginId: string) => void;
  onClose: () => void;
}

export const RecoveryDialog: React.FC<RecoveryDialogProps> = ({
  crash,
  isOpen,
  onAction,
  onClose,
}) => {
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryProgress, setRecoveryProgress] = useState(0);
  const [selectedAction, setSelectedAction] = useState<RecoveryAction | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setIsRecovering(false);
      setRecoveryProgress(0);
      setSelectedAction(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isRecovering) {
      const interval = setInterval(() => {
        setRecoveryProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            return 100;
          }
          return prev + 10;
        });
      }, 200);
      return () => clearInterval(interval);
    }
  }, [isRecovering]);

  const handleAction = useCallback(
    (action: RecoveryAction) => {
      setSelectedAction(action);
      if (action === "reload") {
        setIsRecovering(true);
        setTimeout(() => {
          onAction(action, crash.pluginId);
        }, 2000);
      } else {
        onAction(action, crash.pluginId);
      }
    },
    [crash.pluginId, onAction]
  );

  const handleClose = useCallback(() => {
    if (!isRecovering) {
      onClose();
    }
  }, [isRecovering, onClose]);

  const formatTime = useCallback((date: Date) => {
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerContent}>
            <span className={styles.title}>Plugin Recovery</span>
            <span className={styles.subtitle}>{crash.pluginName}</span>
          </div>
          <button className={styles.closeButton} onClick={handleClose} disabled={isRecovering}>
            ×
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.crashInfo}>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Status</span>
              <span className={`${styles.infoValue} ${styles.severityBadge} ${styles[crash.severity]}`}>
                {crash.severity === "fatal" ? "Fatal" : crash.severity === "error" ? "Crashed" : "Warning"}
              </span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Time</span>
              <span className={styles.infoValue}>{formatTime(crash.timestamp)}</span>
            </div>
            <div className={styles.infoRow}>
              <span className={styles.infoLabel}>Error</span>
              <span className={styles.infoValue}>{crash.errorMessage}</span>
            </div>
          </div>

          {isRecovering ? (
            <div className={styles.recoveryProgress}>
              <div className={styles.progressHeader}>
                <span className={styles.progressLabel}>
                  {selectedAction === "reload" ? "Reloading plugin..." : "Processing..."}
                </span>
                <span className={styles.progressValue}>{recoveryProgress}%</span>
              </div>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${recoveryProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <button
                className={styles.actionCard}
                onClick={() => handleAction("reload")}
              >
                <div className={styles.actionIcon}>↻</div>
                <div className={styles.actionContent}>
                  <span className={styles.actionTitle}>Reload Plugin</span>
                  <span className={styles.actionDescription}>
                    Attempt to reload the plugin. Unsaved state may be lost.
                  </span>
                </div>
              </button>

              <button
                className={styles.actionCard}
                onClick={() => handleAction("disable")}
              >
                <div className={styles.actionIcon}>⊘</div>
                <div className={styles.actionContent}>
                  <span className={styles.actionTitle}>Disable Plugin</span>
                  <span className={styles.actionDescription}>
                    Disable this plugin until the next session. Requires manual re-enable.
                  </span>
                </div>
              </button>

              <button
                className={`${styles.actionCard} ${styles.actionCardSecondary}`}
                onClick={() => handleAction("ignore")}
              >
                <div className={styles.actionIcon}>—</div>
                <div className={styles.actionContent}>
                  <span className={styles.actionTitle}>Ignore</span>
                  <span className={styles.actionDescription}>
                    Dismiss this notification and continue. Plugin may remain unstable.
                  </span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
