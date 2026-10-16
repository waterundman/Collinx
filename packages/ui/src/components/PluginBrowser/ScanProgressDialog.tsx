import React, { useState, useCallback, useEffect } from "react";
import styles from "./ScanProgressDialog.module.css";

export interface ScanResult {
  totalScanned: number;
  newPlugins: number;
  failedPlugins: number;
  duration: number;
}

export interface ScanProgress {
  scanned: number;
  total: number;
  currentPlugin?: string;
}

interface ScanProgressDialogProps {
  isOpen: boolean;
  progress: ScanProgress;
  result?: ScanResult | null;
  onCancel: () => void;
  onClose: () => void;
}

export const ScanProgressDialog: React.FC<ScanProgressDialogProps> = ({
  isOpen,
  progress,
  result,
  onCancel,
  onClose,
}) => {
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsCancelling(false);
    }
  }, [isOpen]);

  const handleCancel = useCallback(() => {
    setIsCancelling(true);
    onCancel();
  }, [onCancel]);

  const handleClose = useCallback(() => {
    if (result) {
      onClose();
    }
  }, [result, onClose]);

  const progressPercent = progress.total > 0
    ? Math.round((progress.scanned / progress.total) * 100)
    : 0;

  const isComplete = result !== null && result !== undefined;

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={handleClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.headerContent}>
            <span className={styles.title}>
              {isComplete ? "Scan Complete" : "Scanning Plugins"}
            </span>
            <span className={styles.subtitle}>
              {isComplete
                ? `Found ${result.totalScanned} plugins`
                : progress.currentPlugin || "Initializing..."}
            </span>
          </div>
          {isComplete && (
            <button className={styles.closeButton} onClick={handleClose}>
              ×
            </button>
          )}
        </div>

        <div className={styles.body}>
          {!isComplete && (
            <div className={styles.progressSection}>
              <div className={styles.progressHeader}>
                <span className={styles.progressLabel}>
                  {progress.scanned} of {progress.total} plugins
                </span>
                <span className={styles.progressValue}>{progressPercent}%</span>
              </div>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              {progress.currentPlugin && (
                <div className={styles.currentPlugin}>
                  <span className={styles.pluginPath}>{progress.currentPlugin}</span>
                </div>
              )}
            </div>
          )}

          {isComplete && (
            <div className={styles.resultSection}>
              <div className={styles.resultGrid}>
                <div className={styles.resultItem}>
                  <span className={styles.resultValue}>{result.totalScanned}</span>
                  <span className={styles.resultLabel}>Total Scanned</span>
                </div>
                <div className={styles.resultItem}>
                  <span className={`${styles.resultValue} ${styles.resultNew}`}>
                    +{result.newPlugins}
                  </span>
                  <span className={styles.resultLabel}>New Plugins</span>
                </div>
                <div className={styles.resultItem}>
                  <span className={`${styles.resultValue} ${styles.resultFailed}`}>
                    {result.failedPlugins}
                  </span>
                  <span className={styles.resultLabel}>Failed</span>
                </div>
                <div className={styles.resultItem}>
                  <span className={styles.resultValue}>
                    {(result.duration / 1000).toFixed(1)}s
                  </span>
                  <span className={styles.resultLabel}>Duration</span>
                </div>
              </div>
            </div>
          )}

          <div className={styles.actions}>
            {!isComplete ? (
              <button
                className={styles.cancelButton}
                onClick={handleCancel}
                disabled={isCancelling}
              >
                {isCancelling ? "Cancelling..." : "Cancel Scan"}
              </button>
            ) : (
              <button className={styles.doneButton} onClick={handleClose}>
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
