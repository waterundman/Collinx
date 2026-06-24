import React, { useState, useMemo, useCallback } from "react";
import type { DiffEnvelope } from "@collinx/core";
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
  explanation?: ExplanationSection;
  alternatives?: AlternativeApproach[];
  relatedConcepts?: string[];
}

const LEVEL_LABELS: Record<UserLevel, string> = {
  beginner: "入门",
  intermediate: "进阶",
  advanced: "高级",
  professional: "专业",
};

const LEVELS: UserLevel[] = ["beginner", "intermediate", "advanced", "professional"];

const DEFAULT_EXPLANATION: ExplanationSection = {
  title: "教学面板",
  overview: "选择一个编曲方案或差异操作来查看详细的教学解释。系统会根据您的水平自动调整解释的详细程度和术语使用。",
  detail: "Collinx 教学系统提供上下文感知的音乐理论解释、替代方案对比和相关概念推荐。当您应用编排、编曲或混音变更时，系统会生成对应的教学材料和概念说明。",
  conceptTags: ["编曲", "和声进行", "配器法", "声部写作", "混音平衡", "音乐形式"],
  examples: [
    "使用 IV-V-I 终止式增强段落结束感",
    "大提琴与低音提琴的八度间隔避免音域重叠",
    "通过声部交换创造更流畅的内声部线条",
  ],
};

const DEFAULT_ALTERNATIVES: AlternativeApproach[] = [
  {
    name: "方案 A: 密集和声排列",
    pros: ["音色融合度高", "和声效果饱满"],
    cons: ["声部辨识度低", "内声部容易被覆盖"],
  },
  {
    name: "方案 B: 开放和声排列",
    pros: ["声部独立性强", "各乐器音色清晰可辨"],
    cons: ["和声凝聚力略弱", "需要更大音域跨度"],
  },
];

const DEFAULT_CONCEPTS = [
  "和声排列",
  "声部交换",
  "八度重复",
  "可演奏性",
  "音域重叠",
  "配器密度",
  "段落过渡",
  "终止式",
  "力度设计",
  "情感曲线",
];

export const TeachingPanel: React.FC<TeachingPanelProps> = ({
  activeDiff,
  userLevel,
  onLevelChange,
  explanation = DEFAULT_EXPLANATION,
  alternatives = DEFAULT_ALTERNATIVES,
  relatedConcepts = DEFAULT_CONCEPTS,
}) => {
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

  const levelExplanation = useMemo(() => {
    const depthMap: Record<UserLevel, string> = {
      beginner: "基础说明 (入门级) — 使用通俗易懂的语言解释核心概念，避免专业术语。",
      intermediate: "进阶说明 (进阶级) — 引入音乐理论术语，提供更多上下文和对比分析。",
      advanced: "高级说明 (高级) — 深入分析技术细节，包括和声功能、配器原则和结构分析。",
      professional: "专业说明 (专业级) — 完整的专业分析，包括前人实践、风格对比和理论依据。",
    };
    return depthMap[userLevel];
  }, [userLevel]);

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
        {activeDiff ? (
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
                  <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--text-muted)" }}>
                    {levelExplanation}
                  </div>
                </div>

                <div className={styles.conceptTags}>
                  {explanation.conceptTags.map((tag) => (
                    <span key={tag} className={styles.conceptTag}>
                      {tag}
                    </span>
                  ))}
                </div>

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
              </div>

              <div className={styles.sidebarSection}>
                <span className={styles.sidebarTitle}>相关概念</span>
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
              </div>
            </div>
          </>
        ) : (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>&#9835;</div>
            <div className={styles.emptyText}>
              暂无活跃的编曲方案<br />
              应用编排、编曲或混音方案后，<br />
              教学面板将显示对应的解释和对比内容
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
