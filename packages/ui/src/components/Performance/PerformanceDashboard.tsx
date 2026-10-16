import React, { useState, useEffect, useCallback } from "react";
import styles from "./PerformanceDashboard.module.css";

export interface PerformanceMetrics {
  cpuUsage: number;
  memoryUsed: number;
  memoryTotal: number;
  processingLatency: number;
  bufferUnderruns: number;
  activeVoices: number;
}

interface PerformanceDashboardProps {
  metrics: PerformanceMetrics;
  onRefresh?: () => void;
  refreshInterval?: number;
}

const formatBytes = (bytes: number): string => {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

const formatLatency = (ms: number): string => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(1)} ms`;
};

const getStatusColor = (value: number, thresholds: { warn: number; crit: number }): string => {
  if (value >= thresholds.crit) return styles.statusCritical;
  if (value >= thresholds.warn) return styles.statusWarning;
  return styles.statusGood;
};

export const PerformanceDashboard: React.FC<PerformanceDashboardProps> = ({
  metrics,
  onRefresh,
  refreshInterval = 1000,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [history, setHistory] = useState<number[]>([]);

  useEffect(() => {
    setHistory((prev) => {
      const next = [...prev, metrics.cpuUsage];
      return next.slice(-30);
    });
  }, [metrics.cpuUsage]);

  useEffect(() => {
    if (onRefresh && refreshInterval > 0) {
      const interval = setInterval(onRefresh, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [onRefresh, refreshInterval]);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const memoryPercent = metrics.memoryTotal > 0
    ? (metrics.memoryUsed / metrics.memoryTotal) * 100
    : 0;

  const cpuStatus = getStatusColor(metrics.cpuUsage, { warn: 70, crit: 90 });
  const memoryStatus = getStatusColor(memoryPercent, { warn: 75, crit: 90 });
  const latencyStatus = getStatusColor(metrics.processingLatency, { warn: 10, crit: 20 });

  return (
    <div className={styles.dashboard}>
      <div className={styles.header} onClick={toggleExpanded}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>Performance</span>
          <div className={styles.miniIndicators}>
            <span className={`${styles.miniDot} ${cpuStatus}`} title={`CPU: ${metrics.cpuUsage.toFixed(0)}%`} />
            <span className={`${styles.miniDot} ${memoryStatus}`} title={`Memory: ${memoryPercent.toFixed(0)}%`} />
            <span className={`${styles.miniDot} ${latencyStatus}`} title={`Latency: ${formatLatency(metrics.processingLatency)}`} />
          </div>
        </div>
        <span className={styles.expandIcon}>{isExpanded ? "▼" : "▶"}</span>
      </div>

      {isExpanded && (
        <div className={styles.content}>
          <div className={styles.metricRow}>
            <div className={styles.metricLabel}>
              <span className={styles.metricName}>CPU</span>
              <span className={`${styles.metricValue} ${cpuStatus}`}>
                {metrics.cpuUsage.toFixed(1)}%
              </span>
            </div>
            <div className={styles.metricBar}>
              <div
                className={`${styles.metricFill} ${cpuStatus}`}
                style={{ width: `${Math.min(metrics.cpuUsage, 100)}%` }}
              />
            </div>
          </div>

          <div className={styles.metricRow}>
            <div className={styles.metricLabel}>
              <span className={styles.metricName}>Memory</span>
              <span className={`${styles.metricValue} ${memoryStatus}`}>
                {formatBytes(metrics.memoryUsed)} / {formatBytes(metrics.memoryTotal)}
              </span>
            </div>
            <div className={styles.metricBar}>
              <div
                className={`${styles.metricFill} ${memoryStatus}`}
                style={{ width: `${Math.min(memoryPercent, 100)}%` }}
              />
            </div>
          </div>

          <div className={styles.metricRow}>
            <div className={styles.metricLabel}>
              <span className={styles.metricName}>Latency</span>
              <span className={`${styles.metricValue} ${latencyStatus}`}>
                {formatLatency(metrics.processingLatency)}
              </span>
            </div>
          </div>

          <div className={styles.statsGrid}>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{metrics.bufferUnderruns}</span>
              <span className={styles.statLabel}>Buffer Underruns</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue}>{metrics.activeVoices}</span>
              <span className={styles.statLabel}>Active Voices</span>
            </div>
          </div>

          {history.length > 1 && (
            <div className={styles.historySection}>
              <span className={styles.historyLabel}>CPU History</span>
              <div className={styles.sparkline}>
                {history.map((value, index) => (
                  <div
                    key={index}
                    className={styles.sparklineBar}
                    style={{ height: `${Math.min(value, 100)}%` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
