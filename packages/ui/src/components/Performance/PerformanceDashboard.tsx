import React, { useState, useEffect, useCallback } from "react";
import styles from "./PerformanceDashboard.module.css";
import { useI18n } from "../../i18n/hooks";

/**
 * 性能指标。**全部可选**：浏览器拿不到的项留 undefined，UI 显示「—」。
 * 为什么不填 0：0% CPU 会被读成「很健康」，那是假数据。
 */
export interface PerformanceMetrics {
  /** 浏览器不可采集（Web Audio 不暴露音频线程耗时） */
  cpuUsage?: number;
  /** Chrome: performance.memory */
  memoryUsed?: number;
  memoryTotal?: number;
  /** ctx.baseLatency + outputLatency（ms） */
  processingLatency?: number;
  /** 浏览器不可采集（无欠载回调） */
  bufferUnderruns?: number;
  /** AudioPreview 活跃声部数 */
  activeVoices?: number;
  /** AudioContext 采样率 */
  sampleRate?: number;
}

interface PerformanceDashboardProps {
  metrics: PerformanceMetrics;
  onRefresh?: () => void;
  refreshInterval?: number;
}

const NA = "—";

const formatBytes = (bytes: number): string => {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

const formatLatency = (ms: number): string => {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(1)} ms`;
};

const getStatusColor = (value: number | undefined, thresholds: { warn: number; crit: number }): string => {
  if (value === undefined) return styles.statusGood;
  if (value >= thresholds.crit) return styles.statusCritical;
  if (value >= thresholds.warn) return styles.statusWarning;
  return styles.statusGood;
};

export const PerformanceDashboard: React.FC<PerformanceDashboardProps> = ({
  metrics,
  onRefresh,
  refreshInterval = 1000,
}) => {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const [history, setHistory] = useState<number[]>([]);

  useEffect(() => {
    if (metrics.cpuUsage === undefined) return;
    setHistory((prev) => [...prev, metrics.cpuUsage as number].slice(-30));
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

  const memoryPercent =
    metrics.memoryUsed !== undefined && metrics.memoryTotal
      ? (metrics.memoryUsed / metrics.memoryTotal) * 100
      : undefined;

  const cpuStatus = getStatusColor(metrics.cpuUsage, { warn: 70, crit: 90 });
  const memoryStatus = getStatusColor(memoryPercent, { warn: 75, crit: 90 });
  const latencyStatus = getStatusColor(metrics.processingLatency, { warn: 10, crit: 20 });

  return (
    <div className={styles.dashboard} data-testid="performance-dashboard">
      <div className={styles.header} onClick={toggleExpanded}>
        <div className={styles.headerLeft}>
          <span className={styles.title}>{t("performance.title")}</span>
          <div className={styles.miniIndicators}>
            <span
              className={`${styles.miniDot} ${latencyStatus}`}
              title={`${t("performance.latency")}: ${
                metrics.processingLatency === undefined ? NA : formatLatency(metrics.processingLatency)
              }`}
            />
            <span
              className={`${styles.miniDot} ${memoryStatus}`}
              title={`${t("performance.memory")}: ${memoryPercent === undefined ? NA : `${memoryPercent.toFixed(0)}%`}`}
            />
          </div>
        </div>
        <span className={styles.expandIcon}>{isExpanded ? "▼" : "▶"}</span>
      </div>

      {isExpanded && (
        <div className={styles.content}>
          {/* v2.9.2：CPU 在浏览器里不可采集 —— 显式「—」，不再显示假百分比 */}
          <div className={styles.metricRow}>
            <div className={styles.metricLabel}>
              <span className={styles.metricName}>{t("performance.cpu")}</span>
              <span className={`${styles.metricValue} ${cpuStatus}`} data-testid="perf-cpu">
                {metrics.cpuUsage === undefined ? NA : `${metrics.cpuUsage.toFixed(1)}%`}
              </span>
            </div>
            {metrics.cpuUsage !== undefined && (
              <div className={styles.metricBar}>
                <div
                  className={`${styles.metricFill} ${cpuStatus}`}
                  style={{ width: `${Math.min(metrics.cpuUsage, 100)}%` }}
                />
              </div>
            )}
          </div>

          <div className={styles.metricRow}>
            <div className={styles.metricLabel}>
              <span className={styles.metricName}>{t("performance.memory")}</span>
              <span className={`${styles.metricValue} ${memoryStatus}`} data-testid="perf-memory">
                {metrics.memoryUsed === undefined || metrics.memoryTotal === undefined
                  ? NA
                  : `${formatBytes(metrics.memoryUsed)} / ${formatBytes(metrics.memoryTotal)}`}
              </span>
            </div>
            {memoryPercent !== undefined && (
              <div className={styles.metricBar}>
                <div
                  className={`${styles.metricFill} ${memoryStatus}`}
                  style={{ width: `${Math.min(memoryPercent, 100)}%` }}
                />
              </div>
            )}
          </div>

          <div className={styles.metricRow}>
            <div className={styles.metricLabel}>
              <span className={styles.metricName}>{t("performance.latency")}</span>
              <span className={`${styles.metricValue} ${latencyStatus}`} data-testid="perf-latency">
                {metrics.processingLatency === undefined ? NA : formatLatency(metrics.processingLatency)}
              </span>
            </div>
          </div>

          <div className={styles.statsGrid}>
            <div className={styles.statItem}>
              <span className={styles.statValue} data-testid="perf-underruns">
                {metrics.bufferUnderruns === undefined ? NA : metrics.bufferUnderruns}
              </span>
              <span className={styles.statLabel}>{t("performance.underruns")}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue} data-testid="perf-voices">
                {metrics.activeVoices === undefined ? NA : metrics.activeVoices}
              </span>
              <span className={styles.statLabel}>{t("performance.voices")}</span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statValue} data-testid="perf-sample-rate">
                {metrics.sampleRate === undefined ? NA : `${(metrics.sampleRate / 1000).toFixed(1)} kHz`}
              </span>
              <span className={styles.statLabel}>{t("performance.sampleRate")}</span>
            </div>
          </div>

          {history.length > 1 && (
            <div className={styles.historySection}>
              <span className={styles.historyLabel}>{t("performance.history")}</span>
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
