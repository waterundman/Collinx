import React, { useState, useCallback } from "react";
import { TasteDiffReport, EvidenceItem, TasteDomain } from "@collinx/core";
import styles from "./TastePanel.module.css";
import { getCSSVar } from "../../utils/cssVar";

interface TasteDiffPanelProps {
  report: TasteDiffReport | null;
  onConfirmWrite?: (evidenceIds: string[]) => void;
  onIgnore?: (evidenceIds: string[]) => void;
}

const DOMAIN_LABELS: Record<string, string> = {
  harmony: "和声",
  melody: "旋律",
  rhythm: "节奏",
  texture: "织体",
  timbre: "音色",
  form: "曲式",
  mix: "混音",
  reject: "排除项",
};

const DOMAIN_COLOR_VARS: Record<string, string> = {
  harmony: "--domain-harmony",
  melody: "--domain-melody",
  rhythm: "--domain-rhythm",
  texture: "--domain-texture",
  timbre: "--domain-timbre",
  form: "--domain-form",
  mix: "--domain-mix",
  reject: "--domain-reject",
};

const DEVIATION_LABELS: Record<string, string> = {
  high: "显著偏离",
  moderate: "中等偏离",
  mild: "轻微偏离",
  none: "正常",
};

function getDomainLabel(domain: TasteDomain): string {
  return DOMAIN_LABELS[domain] ?? domain;
}

function getDomainColor(domain: TasteDomain): string {
  const varName = DOMAIN_COLOR_VARS[domain];
  return varName ? getCSSVar(varName) : getCSSVar("--text-muted");
}

function getDeviationLabel(label: string): string {
  return DEVIATION_LABELS[label] ?? label;
}

function getDeviationClass(label: string): string {
  switch (label) {
    case "high": return styles.deviationHigh;
    case "moderate": return styles.deviationModerate;
    case "mild": return styles.deviationMild;
    default: return styles.deviationNone;
  }
}

function groupByDomain(items: EvidenceItem[]): Map<TasteDomain, EvidenceItem[]> {
  const map = new Map<TasteDomain, EvidenceItem[]>();
  for (const item of items) {
    const list = map.get(item.domain) ?? [];
    list.push(item);
    map.set(item.domain, list);
  }
  return map;
}

export const TasteDiffPanel: React.FC<TasteDiffPanelProps> = ({
  report,
  onConfirmWrite,
  onIgnore,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAllState] = useState(true);

  const toggleItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (!report) return;
    if (selectAll) {
      setSelectedIds(new Set());
      setSelectAllState(false);
    } else {
      setSelectedIds(new Set(report.evidenceItems.map((e) => e.paramKey)));
      setSelectAllState(true);
    }
  }, [report, selectAll]);

  const handleConfirmWrite = useCallback(() => {
    onConfirmWrite?.(Array.from(selectedIds));
  }, [selectedIds, onConfirmWrite]);

  const handleIgnore = useCallback(
    (id: string) => {
      onIgnore?.([id]);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
    [onIgnore]
  );


  if (!report) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyStateIcon}>✓</div>
        <div className={styles.emptyStateText}>
          没有检测到显著差异，本次导出与你的口味吻合
        </div>
      </div>
    );
  }

  const domains = groupByDomain(report.evidenceItems);
  const domainOrder = Object.values(TasteDomain) as TasteDomain[];

  // Initialize all as selected
  if (selectedIds.size === 0 && report.evidenceItems.length > 0 && selectAll) {
    setSelectedIds(new Set(report.evidenceItems.map((e) => e.paramKey)));
  }

  const selectedCount = selectedIds.size;

  return (
    <div className={styles.diffPanelOverlay}>
      <div className={styles.diffPanelModal}>
        <div className={styles.diffHeader}>
          <div className={styles.diffTitle}>品味差异报告</div>
          <div className={styles.diffSubtitle}>
            导出 {report.exportRef} · Genome v{report.genomeVersion} ·{" "}
            {new Date(report.generatedAt).toLocaleDateString("zh-CN")}
          </div>
          <div className={styles.diffStats}>
            <span className={styles.diffStat}>
              显著偏离: <span className={`${styles.diffStatCount} ${styles.diffStatRed}`}>{report.stats.significantDeviations}</span>
            </span>
            <span className={styles.diffStat}>
              中等偏离: <span className={`${styles.diffStatCount} ${styles.diffStatYellow}`}>{report.stats.mildDeviations}</span>
            </span>
            <span className={styles.diffStat}>
              正常: <span className={`${styles.diffStatCount} ${styles.diffStatGreen}`}>{report.stats.inTolerance}</span>
            </span>
            <span className={styles.diffStat}>
              总计: <span className={styles.diffStatCount}>{report.stats.totalComparisons}</span>
            </span>
          </div>
        </div>

        <div className={styles.diffBody}>
          <div className={styles.diffSummary}>
            {report.summary}
          </div>

          {domainOrder.map((domain) => {
            const items = domains.get(domain);
            if (!items || items.length === 0) return null;
            return (
              <div key={domain} className={styles.diffGroup}>
                <div className={styles.diffGroupHeader}>
                  {getDomainLabel(domain)} ({items.length})
                </div>
                {items.map((item) => {
                  const isSelected = selectedIds.has(item.paramKey);
                  return (
                    <div key={item.paramKey}>
                      <div className={styles.diffItem}>
                        <input
                          type="checkbox"
                          className={styles.diffItemCheck}
                          checked={isSelected}
                          onChange={() => toggleItem(item.paramKey)}
                        />
                        <span
                          className={styles.diffDomainBadge}
                          style={{
                            background: `${getDomainColor(domain)}22`,
                            color: getDomainColor(domain),
                          }}
                        >
                          {getDomainLabel(domain)}
                        </span>
                        <span className={styles.diffParamLabel}>{item.label}</span>

                        <div className={styles.compareBar}>
                          <div className={styles.compareBarRow}>
                            <span className={styles.compareBarLabel}>本次导出</span>
                            <div className={styles.compareBarTrack}>
                              <div
                                className={`${styles.compareBarFill} ${styles.compareBarFillExport}`}
                                style={{ width: `${item.currentValue * 100}%` }}
                              />
                            </div>
                            <span className={styles.compareBarValue}>
                              {(item.currentValue * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className={styles.compareBarRow}>
                            <span className={styles.compareBarLabel}>你的偏好</span>
                            <div className={styles.compareBarTrack}>
                              <div
                                className={`${styles.compareBarFill} ${styles.compareBarFillGenome}`}
                                style={{ width: `${item.genomePreferred * 100}%` }}
                              />
                            </div>
                            <span className={styles.compareBarValue}>
                              {(item.genomePreferred * 100).toFixed(0)}%
                            </span>
                          </div>
                        </div>

                        <span
                          className={`${styles.deviationBadge} ${getDeviationClass(item.deviationLabel)}`}
                        >
                          {item.deviationLabel !== "none"
                            ? `${item.currentValue > item.genomePreferred ? "+" : "-"}${Math.abs(item.currentValue - item.genomePreferred) > 0 ? ((item.currentValue - item.genomePreferred) / Math.max(0.01, item.genomePreferred) * 100).toFixed(0) : 0}%`
                            : "—"}
                        </span>

                        <div className={styles.diffActions}>
                          <button
                            className={`${styles.diffActionBtn} ${styles.diffActionConfirm}`}
                            data-testid={`taste-diff-select-${item.paramKey}`}
                            onClick={() => toggleItem(item.paramKey)}
                          >
                            {selectedIds.has(item.paramKey) ? "已选" : "选择"}
                          </button>
                          <button
                            className={styles.diffActionBtn}
                            onClick={() => handleIgnore(item.paramKey)}
                          >
                            忽略
                          </button>
                        </div>
                      </div>
                      <div className={styles.diffDescription}>
                        {item.description}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className={styles.diffFooter}>
          <div className={styles.diffFooterLeft}>
            <label>
              <input
                type="checkbox"
                checked={selectAll && selectedIds.size === report.evidenceItems.length}
                onChange={handleSelectAll}
                className={styles.selectAllCheckbox}
              />
              全选 ({selectedCount}/{report.evidenceItems.length})
            </label>
          </div>
          <button
            className={styles.diffSubmitBtn}
            disabled={selectedCount === 0}
            onClick={handleConfirmWrite}
          >
            确认写入品味库 ({selectedCount} 项)
          </button>
        </div>
      </div>
    </div>
  );
};
