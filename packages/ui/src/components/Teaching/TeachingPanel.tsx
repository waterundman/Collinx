import React, { useState, useCallback } from "react";
import type { DiffEnvelope } from "@collinx/core";
import { useI18n } from "../../i18n";
import styles from "./TeachingPanel.module.css";

export type UserLevel = "beginner" | "intermediate" | "advanced" | "professional";

export interface ExplanationSection {
  title: string;
  overview: string;
  detail: string;
  conceptTags: string[];
  examples: string[];
}

export interface AlternativeApproach {
  name: string;
  pros: string[];
  cons: string[];
}

export interface TeachingPanelProps {
  activeDiff?: DiffEnvelope;
  userLevel: UserLevel;
  onLevelChange?: (level: UserLevel) => void;
  /** Real explanation produced by the teaching.explainDecision tool. When
   *  null (and the panel is not loading/errored) the panel shows an explicit
   *  "no explanation yet" empty state instead of any hardcoded template. */
  explanation?: ExplanationSection | null;
  alternatives?: AlternativeApproach[];
  relatedConcepts?: string[];
  loading?: boolean;
  error?: string | null;
  /** v1.18.0 Stage 0: harmony explanation block fed by the real
   *  teaching.explainHarmony tool (never template content). Independent of
   *  the activeDiff explanation above: the block renders for every project
   *  that has notes on the chords track. */
  harmonyExplanation?: ExplanationSection | null;
  harmonyLoading?: boolean;
  harmonyError?: string | null;
  /** Triggers the store's runTeachingHarmony action. Absent = block hidden
   *  (tests / minimal embeds render the panel without the harmony block). */
  onExplainHarmony?: () => void;
  /** False when the chords track has no notes: the trigger button is
   *  disabled instead of letting the tool run on an empty progression. */
  canExplainHarmony?: boolean;
}

const LEVEL_LABELS: Record<UserLevel, string> = {
  beginner: "入门",
  intermediate: "进阶",
  advanced: "高级",
  professional: "专业",
};

const LEVELS: UserLevel[] = ["beginner", "intermediate", "advanced", "professional"];

export const TeachingPanel: React.FC<TeachingPanelProps> = ({
  activeDiff,
  userLevel,
  onLevelChange,
  explanation,
  alternatives = [],
  relatedConcepts = [],
  loading = false,
  error = null,
  harmonyExplanation = null,
  harmonyLoading = false,
  harmonyError = null,
  onExplainHarmony,
  canExplainHarmony = false,
}) => {
  const { t } = useI18n();
  const [selectedConcept, setSelectedConcept] = useState<string | null>(null);

  const handleLevelChange = useCallback(
    (level: UserLevel) => {
      onLevelChange?.(level);
    },
    [onLevelChange],
  );

  const handleConceptClick = useCallback((concept: string) => {
    setSelectedConcept((prev) => (prev === concept ? null : concept));
  }, []);

  return (
    <div className={styles.teachingPanel} data-testid="teaching-panel">
      <div className={styles.header}>
        <span className={styles.headerTitle}>教学面板</span>
        <div className={styles.levelGroup} data-testid="teaching-level-group">
          {LEVELS.map((level) => (
            <button
              key={level}
              data-testid={`teaching-level-${level}`}
              className={`${styles.levelBtn} ${level === userLevel ? styles.levelBtnActive : ""}`}
              onClick={() => handleLevelChange(level)}
            >
              {LEVEL_LABELS[level]}
            </button>
          ))}
        </div>
        <span className={styles.spacer} />
        {activeDiff && (
          <span className={styles.diffBadge}>
            当前方案: {activeDiff.summary.slice(0, 24)}
          </span>
        )}
      </div>

      <div className={styles.body}>
        {!activeDiff ? (
          <div className={styles.emptyState} data-testid="teaching-empty">
            <div className={styles.emptyIcon}>&#9835;</div>
            <div className={styles.emptyText}>
              暂无活跃的编曲方案<br />
              应用编排、编曲或混音方案后，<br />
              教学面板将显示对应的解释和对比内容
            </div>
          </div>
        ) : loading ? (
          <div className={styles.statusState} data-testid="teaching-loading">
            <span className={styles.statusSpinner} aria-hidden="true" />
            正在生成教学解释…
          </div>
        ) : error ? (
          <div className={styles.statusState} data-testid="teaching-error">
            <span className={styles.statusIcon} aria-hidden="true">
              !
            </span>
            {error}
          </div>
        ) : explanation ? (
          <>
            <div className={styles.mainContent}>
              <div className={styles.explanationCard}>
                <div className={styles.explanationTitle}>
                  {activeDiff.summary ?? explanation.title}
                </div>
                <div className={styles.explanationOverview}>
                  {explanation.overview}
                </div>
                <div className={styles.explanationDetail}>
                  {explanation.detail}
                </div>

                {explanation.conceptTags.length > 0 && (
                  <div className={styles.conceptTags}>
                    {explanation.conceptTags.map((tag) => (
                      <span key={tag} className={styles.conceptTag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {explanation.examples.length > 0 && (
                  <div className={styles.examplesSection}>
                    <div className={styles.examplesTitle}>示例</div>
                    {explanation.examples.map((example, idx) => (
                      <div key={idx} className={styles.exampleItem}>
                        {example}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {activeDiff.domainExplanations.length > 0 && (
                <div className={styles.explanationCard}>
                  <div className={styles.explanationTitle}>段落说明</div>
                  {activeDiff.domainExplanations.map((de, idx) => (
                    <div key={idx} style={{ marginBottom: "10px" }}>
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--accent-cyan)", marginBottom: "4px" }}>
                        {de.label}
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-primary)", lineHeight: "1.5" }}>
                        {de.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeDiff.riskFlags.length > 0 && (
                <div className={styles.explanationCard}>
                  <div className={styles.explanationTitle}>风险提示</div>
                  {activeDiff.riskFlags.map((rf, idx) => (
                    <div
                      key={idx}
                      style={{
                        fontSize: "12px",
                        color: rf.severity === "high" ? "var(--accent-red)" : rf.severity === "medium" ? "var(--accent-yellow)" : "var(--text-secondary)",
                        padding: "4px 0",
                        display: "flex",
                        gap: "6px",
                        alignItems: "baseline",
                      }}
                    >
                      <span style={{ fontSize: "10px", fontWeight: 600, minWidth: "36px" }}>
                        {rf.severity === "high" ? "高风险" : rf.severity === "medium" ? "中风险" : "低风险"}
                      </span>
                      <span>{rf.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.sidebar}>
              <div className={styles.sidebarSection}>
                <span className={styles.sidebarTitle}>替代方案</span>
                {alternatives.length > 0 ? (
                  <div className={styles.alternativeList}>
                    {alternatives.map((alt, idx) => (
                      <div key={idx} className={styles.alternativeCard}>
                        <div className={styles.alternativeName}>{alt.name}</div>
                        <div className={styles.alternativeCols}>
                          <div className={styles.alternativeCol}>
                            <span className={`${styles.alternativeColLabel} ${styles.colPros}`}>优势</span>
                            {alt.pros.map((p, pi) => (
                              <div key={pi} className={`${styles.alternativeItem} ${styles.alternativeItemPros}`}>
                                {p}
                              </div>
                            ))}
                          </div>
                          <div className={styles.alternativeCol}>
                            <span className={`${styles.alternativeColLabel} ${styles.colCons}`}>劣势</span>
                            {alt.cons.map((c, ci) => (
                              <div key={ci} className={`${styles.alternativeItem} ${styles.alternativeItemCons}`}>
                                {c}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.sidebarEmpty}>暂无替代方案对比</div>
                )}
              </div>

              <div className={styles.sidebarSection}>
                <span className={styles.sidebarTitle}>相关概念</span>
                {relatedConcepts.length > 0 ? (
                  <div className={styles.tagCloud}>
                    {relatedConcepts.map((concept) => (
                      <button
                        key={concept}
                        className={styles.tagCloudItem}
                        onClick={() => handleConceptClick(concept)}
                        style={
                          concept === selectedConcept
                            ? { background: "rgba(0, 212, 255, 0.22)", borderColor: "var(--accent-cyan)", color: "var(--text-primary)" }
                            : undefined
                        }
                      >
                        {concept}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className={styles.sidebarEmpty}>暂无相关概念</div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className={styles.emptyState} data-testid="teaching-no-explanation">
            <div className={styles.emptyIcon}>&#9835;</div>
            <div className={styles.emptyText}>
              尚未生成解释<br />
              等待教学系统返回当前方案的解释内容
            </div>
          </div>
        )}
      </div>

      {onExplainHarmony && (
        <div className={styles.harmonySection} data-testid="teaching-harmony-section">
          <div className={styles.harmonyHeader}>
            <span className={styles.sidebarTitle}>
              {t("app.teaching.harmonyTitle")}
            </span>
            <button
              type="button"
              className={styles.harmonyTrigger}
              data-testid="teaching-harmony-trigger"
              disabled={!canExplainHarmony || harmonyLoading}
              onClick={onExplainHarmony}
            >
              {t("app.teaching.harmonyAction")}
            </button>
          </div>

          {!canExplainHarmony && !harmonyLoading ? (
            <div className={styles.harmonyEmpty} data-testid="teaching-harmony-empty">
              {t("app.teaching.harmonyNoChords")}
            </div>
          ) : harmonyLoading ? (
            <div className={styles.statusState} data-testid="teaching-harmony-loading">
              <span className={styles.statusSpinner} aria-hidden="true" />
              {t("app.teaching.harmonyLoading")}
            </div>
          ) : harmonyError ? (
            <div className={styles.statusState} data-testid="teaching-harmony-error">
              <span className={styles.statusIcon} aria-hidden="true">!</span>
              {harmonyError}
            </div>
          ) : harmonyExplanation ? (
            <div className={styles.harmonyResult} data-testid="teaching-harmony-result">
              <div className={styles.explanationCard}>
                <div className={styles.explanationTitle}>
                  {harmonyExplanation.title}
                </div>
                <div className={styles.explanationOverview}>
                  {harmonyExplanation.overview}
                </div>
                <div className={styles.explanationDetail}>
                  {harmonyExplanation.detail}
                </div>
                {harmonyExplanation.conceptTags.length > 0 && (
                  <div className={styles.conceptTags}>
                    {harmonyExplanation.conceptTags.map((tag) => (
                      <span key={tag} className={styles.conceptTag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {harmonyExplanation.examples.length > 0 && (
                  <div className={styles.examplesSection}>
                    <div className={styles.examplesTitle}>
                      {t("app.teaching.harmonyExamples")}
                    </div>
                    {harmonyExplanation.examples.map((example, idx) => (
                      <div key={idx} className={styles.exampleItem}>
                        {example}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className={styles.harmonyEmpty} data-testid="teaching-harmony-empty">
              {t("app.teaching.harmonyEmpty")}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
