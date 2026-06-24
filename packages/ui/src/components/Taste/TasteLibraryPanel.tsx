import React, { useState, useMemo, useCallback } from "react";
import { TasteGenome, TasteDomain, TASTE_DOMAINS, TasteParameter } from "@collinx/core";
import styles from "./TastePanel.module.css";

interface TasteLibraryPanelProps {
  genome: TasteGenome | null;
  onParameterEdit?: (paramKey: string, value: string) => void;
  onDeleteEvidence?: (paramKey: string, evidenceId: string) => void;
}

const DOMAIN_META: Record<TasteDomain, { label: string; icon: string }> = {
  [TasteDomain.Harmony]: { label: "和声", icon: "♪" },
  [TasteDomain.Melody]: { label: "旋律", icon: "♫" },
  [TasteDomain.Rhythm]: { label: "节奏", icon: "♩" },
  [TasteDomain.Texture]: { label: "织体", icon: "▦" },
  [TasteDomain.Timbre]: { label: "音色", icon: "◇" },
  [TasteDomain.Form]: { label: "曲式", icon: "◧" },
  [TasteDomain.Mix]: { label: "混音", icon: "◉" },
  [TasteDomain.Reject]: { label: "排除项", icon: "⊘" },
};

const PARAM_LABELS: Record<string, string> = {
  "harmony.chromatic_color": "和声色彩丰富度",
  "harmony.chord_density": "和弦密度",
  "harmony.non_diatonic_tolerance": "非自然音容忍度",
  "harmony.modal_preference": "调式偏好",
  "melody.range_width": "旋律音域宽度",
  "melody.leap_ratio": "旋律跳进比例",
  "melody.repetition_tolerance": "旋律重复容忍度",
  "rhythm.syncopation": "切分节奏量",
  "rhythm.swing_amount": "摇摆感",
  "rhythm.polyrhythm_tendency": "复合节奏倾向",
  "texture.density": "织体密度",
  "texture.pad_layering": "Pad 层次感",
  "timbre.brightness": "音色亮度",
  "timbre.transient_softness": "瞬态柔软度",
  "form.section_contrast": "段落对比度",
  "form.bridge_length": "桥段长度",
  "mix.reverb_amount": "混响量",
  "mix.compression_tendency": "压缩倾向",
  "mix.stereo_width": "立体声宽度",
  "reject.triplet_fill_before_drop": "Drop前三连音填充",
  "reject.excessive_sidechain": "过度侧链压缩",
};

const DIST_LABELS: Record<string, string> = {
  beta: "Beta",
  dirichlet: "Dirichlet",
  von_mises: "VonMises",
  bernoulli: "Bernoulli",
  gaussian: "Gaussian",
};

function getParamLabel(key: string): string {
  return PARAM_LABELS[key] ?? key;
}

function getDistLabel(param: TasteParameter): string {
  return DIST_LABELS[param.distribution.family] ?? param.distribution.family;
}

function confidenceStars(confidence: number): number {
  return Math.round(confidence * 5);
}

export const TasteLibraryPanel: React.FC<TasteLibraryPanelProps> = ({
  genome,
  onParameterEdit,
  onDeleteEvidence,
}) => {
  const [activeDomain, setActiveDomain] = useState<TasteDomain>(TasteDomain.Harmony);
  const [expandedParam, setExpandedParam] = useState<string | null>(null);
  const [editingParam, setEditingParam] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const domainParams = useMemo(() => {
    if (!genome) return new Map<TasteDomain, [string, TasteParameter][]>();
    const map = new Map<TasteDomain, [string, TasteParameter][]>();
    for (const domain of TASTE_DOMAINS) {
      map.set(domain, genome.listParameters(domain));
    }
    return map;
  }, [genome]);

  const toggleExpand = useCallback((key: string) => {
    setExpandedParam((prev) => (prev === key ? null : key));
  }, []);

  const startEdit = useCallback((key: string, currentValue: string) => {
    setEditingParam(key);
    setEditValue(currentValue);
  }, []);

  const confirmEdit = useCallback(() => {
    if (editingParam) {
      onParameterEdit?.(editingParam, editValue);
      setEditingParam(null);
      setEditValue("");
    }
  }, [editingParam, editValue, onParameterEdit]);

  const cancelEdit = useCallback(() => {
    setEditingParam(null);
    setEditValue("");
  }, []);

  if (!genome) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyStateIcon}>🎵</div>
        <div className={styles.emptyStateText}>
          尚无口味数据，导出你的第一首歌来开始建立口味档案
        </div>
      </div>
    );
  }

  const params = domainParams.get(activeDomain) ?? [];

  return (
    <div className={styles.tastePanel} data-testid="taste-library">
      <div className={styles.domainList}>
        {TASTE_DOMAINS.map((domain) => {
          const meta = DOMAIN_META[domain];
          const count = domainParams.get(domain)?.length ?? 0;
          const isReject = domain === TasteDomain.Reject;
          return (
            <div
              key={domain}
              className={`${styles.domainItem} ${activeDomain === domain ? styles.domainItemActive : ""}`}
              onClick={() => setActiveDomain(domain)}
            >
              <span className={styles.domainIcon}>{meta.icon}</span>
              <span className={isReject ? styles.rejectTag : undefined}>
                {meta.label}
              </span>
              <span className={styles.domainBadge}>{count}</span>
            </div>
          );
        })}
      </div>

      <div className={styles.paramPanel}>
        <div className={styles.paramHeader}>
          <span className={styles.domainIcon}>{DOMAIN_META[activeDomain].icon}</span>
          <span>{DOMAIN_META[activeDomain].label}</span>
          <span style={{ fontSize: "11px", color: "var(--text-disabled)" }}>
            ({params.length} 个参数)
          </span>
        </div>

        <div className={styles.paramList}>
          {params.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyStateText}>
                该域中尚无参数
              </div>
            </div>
          ) : (
            params.map(([key, param]) => {
              const value = parseFloat(param.value);
              const confidence = parseFloat(param.confidence);
              const stars = confidenceStars(confidence);
              const starCount = Math.min(5, Math.max(0, stars));
              const distLabel = getDistLabel(param);
              const isExpanded = expandedParam === key;
              const isEditing = editingParam === key;

              return (
                <div key={key} className={styles.paramCard}>
                  <div
                    className={styles.paramCardHeader}
                    onClick={() => toggleExpand(key)}
                  >
                    <span className={styles.paramCardTitle}>
                      {getParamLabel(key)}
                    </span>
                    <div className={styles.paramCardMeta}>
                      <span className={styles.distTag}>{distLabel}</span>
                      <span className={styles.evidenceBadge}>
                        {param.evidence.length} 证据
                      </span>
                    </div>
                  </div>

                  <div className={styles.paramCardBody}>
                    <div>
                      {isEditing ? (
                        <div className={styles.valueEdit}>
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") confirmEdit();
                              if (e.key === "Escape") cancelEdit();
                            }}
                          />
                          <button onClick={confirmEdit}>确认</button>
                          <button onClick={cancelEdit}>取消</button>
                        </div>
                      ) : (
                        <>
                          <div
                            className={styles.valueBar}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              startEdit(key, param.value);
                            }}
                            title="双击编辑值"
                          >
                            <div
                              className={styles.valueBarFill}
                              style={{ width: `${(1 - value) * 100}%` }}
                            />
                          </div>
                          <div className={styles.valueBarLabel}>
                            当前值: {(value * 100).toFixed(0)}%
                          </div>
                        </>
                      )}

                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>置信度:</span>
                        <div className={styles.confidenceStars}>
                          {Array.from({ length: 5 }, (_, i) => (
                            <span
                              key={i}
                              className={
                                i < starCount ? styles.confidenceStarFilled : styles.confidenceStar
                              }
                            >
                              ★
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                    {isExpanded && param.evidence.length > 0 && (
                      <div className={styles.evidenceList}>
                        {param.evidence.map((ev) => (
                          <div key={ev.id} className={styles.evidenceItem}>
                            <span
                              className={styles.evidenceItemDot}
                              style={{
                                background: ev.confirmed ? "var(--accent-green)" : "var(--accent-yellow)",
                              }}
                            />
                            <span className={styles.evidenceItemType}>
                              {ev.type}
                            </span>
                            <span className={styles.evidenceItemTimestamp}>
                              {new Date(ev.timestamp).toLocaleDateString("zh-CN")}
                            </span>
                            <button
                              className={styles.deleteEvidenceBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteEvidence?.(key, ev.id);
                              }}
                              title="删除此证据"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {isExpanded && param.evidence.length === 0 && (
                      <div className={styles.evidenceList}>
                        <div className={styles.evidenceItem}>
                          <span style={{ color: "var(--text-disabled)", fontStyle: "italic" }}>
                            暂无证据数据
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
