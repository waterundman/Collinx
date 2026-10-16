import React, { useState, useCallback, useEffect } from "react";
import styles from "./CrashNotification.module.css";

export type CrashSeverity = "error" | "warning" | "fatal";

export interface CrashInfo {
  pluginId: string;
  pluginName: string;
  errorMessage: string;
  timestamp: Date;
  severity: CrashSeverity;
  stackTrace?: string;
}

interface CrashNotificationProps {
  crash: CrashInfo;
  onRecover?: (pluginId: string) => void;
  onDisable?: (pluginId: string) => void;
  onDismiss?: (pluginId: string) => void;
  autoHideDuration?: number;
}

export const CrashNotification: React.FC<CrashNotificationProps> = ({
  crash,
  onRecover,
  onDisable,
  onDismiss,
  autoHideDuration = 0,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (autoHideDuration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onDismiss?.(crash.pluginId);
      }, autoHideDuration);
      return () => clearTimeout(timer);
    }
  }, [autoHideDuration, crash.pluginId, onDismiss]);

  const handleDismiss = useCallback(() => {
    setIsVisible(false);
    onDismiss?.(crash.pluginId);
  }, [crash.pluginId, onDismiss]);

  const handleRecover = useCallback(() => {
    onRecover?.(crash.pluginId);
  }, [crash.pluginId, onRecover]);

  const handleDisable = useCallback(() => {
    onDisable?.(crash.pluginId);
  }, [crash.pluginId, onDisable]);

  const formatTime = useCallback((date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }, []);

  if (!isVisible) return null;

  return (
    <div className={`${styles.notification} ${styles[crash.severity]}`}>
      <div className={styles.header}>
        <div className={styles.statusIcon}>
          {crash.severity === "fatal" ? "✕" : crash.severity === "error" ? "!" : "⚠"}
        </div>
        <div className={styles.titleSection}>
          <span className={styles.pluginName}>{crash.pluginName}</span>
          <span className={styles.severityLabel}>
            {crash.severity === "fatal" ? "Fatal Error" : crash.severity === "error" ? "Crashed" : "Warning"}
          </span>
        </div>
        <span className={styles.timestamp}>{formatTime(crash.timestamp)}</span>
        <button className={styles.closeButton} onClick={handleDismiss} title="Dismiss">
          ×
        </button>
      </div>

      <div className={styles.body}>
        <p className={styles.errorMessage}>{crash.errorMessage}</p>

        {crash.stackTrace && (
          <button
            className={styles.expandButton}
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? "Hide Details" : "Show Details"}
          </button>
        )}

        {isExpanded && crash.stackTrace && (
          <pre className={styles.stackTrace}>{crash.stackTrace}</pre>
        )}
      </div>

      <div className={styles.actions}>
        <button className={styles.recoverButton} onClick={handleRecover}>
          Reload Plugin
        </button>
        <button className={styles.disableButton} onClick={handleDisable}>
          Disable Plugin
        </button>
      </div>
    </div>
  );
};
