import React, { useState, useCallback, useEffect, useRef } from "react";
import styles from "./PluginHealthIndicator.module.css";

export type HealthStatus = "healthy" | "warning" | "crashed" | "unknown";

export interface PluginHealthInfo {
  pluginId: string;
  pluginName: string;
  status: HealthStatus;
  lastUpdated: Date;
  errorMessage?: string;
  memoryUsage?: number;
  cpuUsage?: number;
}

interface PluginHealthIndicatorProps {
  health: PluginHealthInfo;
  showDetails?: boolean;
  onStatusClick?: (pluginId: string) => void;
  compact?: boolean;
}

export const PluginHealthIndicator: React.FC<PluginHealthIndicatorProps> = ({
  health,
  showDetails = false,
  onStatusClick,
  compact = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current);
      }
    };
  }, []);

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    tooltipTimerRef.current = setTimeout(() => {
      setShowTooltip(true);
    }, 500);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
    setShowTooltip(false);
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
    }
  }, []);

  const handleClick = useCallback(() => {
    onStatusClick?.(health.pluginId);
  }, [health.pluginId, onStatusClick]);

  const getStatusIcon = useCallback(() => {
    switch (health.status) {
      case "healthy":
        return "●";
      case "warning":
        return "▲";
      case "crashed":
        return "✕";
      case "unknown":
        return "?";
    }
  }, [health.status]);

  const getStatusLabel = useCallback(() => {
    switch (health.status) {
      case "healthy":
        return "Healthy";
      case "warning":
        return "Warning";
      case "crashed":
        return "Crashed";
      case "unknown":
        return "Unknown";
    }
  }, [health.status]);

  const formatTime = useCallback((date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);

    if (seconds < 60) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, []);

  const formatBytes = useCallback((bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);

  if (compact) {
    return (
      <div
        className={`${styles.compact} ${styles[health.status]}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        role="status"
        aria-label={`${health.pluginName}: ${getStatusLabel()}`}
      >
        <span className={styles.compactIcon}>{getStatusIcon()}</span>

        {showTooltip && (
          <div className={styles.tooltip}>
            <div className={styles.tooltipHeader}>
              <span className={styles.tooltipTitle}>{health.pluginName}</span>
              <span className={`${styles.tooltipStatus} ${styles[health.status]}`}>
                {getStatusLabel()}
              </span>
            </div>
            {health.errorMessage && (
              <p className={styles.tooltipError}>{health.errorMessage}</p>
            )}
            <div className={styles.tooltipMeta}>
              <span>Updated: {formatTime(health.lastUpdated)}</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`${styles.indicator} ${styles[health.status]} ${isHovered ? styles.hovered : ""}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    >
      <div className={styles.statusSection}>
        <span className={styles.statusIcon}>{getStatusIcon()}</span>
        <div className={styles.statusText}>
          <span className={styles.pluginName}>{health.pluginName}</span>
          <span className={styles.statusLabel}>{getStatusLabel()}</span>
        </div>
      </div>

      {showDetails && (
        <div className={styles.details}>
          {health.memoryUsage !== undefined && (
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Memory</span>
              <span className={styles.metricValue}>{formatBytes(health.memoryUsage)}</span>
            </div>
          )}
          {health.cpuUsage !== undefined && (
            <div className={styles.metric}>
              <span className={styles.metricLabel}>CPU</span>
              <span className={styles.metricValue}>{health.cpuUsage.toFixed(1)}%</span>
            </div>
          )}
          <div className={styles.metric}>
            <span className={styles.metricLabel}>Updated</span>
            <span className={styles.metricValue}>{formatTime(health.lastUpdated)}</span>
          </div>
        </div>
      )}

      {health.errorMessage && (
        <p className={styles.errorMessage}>{health.errorMessage}</p>
      )}
    </div>
  );
};
