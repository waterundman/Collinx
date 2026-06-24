import type { ExportAnalysisResult, GenomeComparison } from "./export-analyzer";
import { TasteGenome } from "./taste-genome";
import { TasteDomain } from "./taste-types";
import type { TasteParameter } from "./taste-types";
import { randomUUID } from "../util/random-uuid";

export interface TasteDiffReport {
  reportId: string;
  exportRef: string;
  genomeVersion: number;
  generatedAt: string;

  evidenceItems: EvidenceItem[];

  summary: string;

  suggestions: Suggestion[];

  stats: {
    totalComparisons: number;
    significantDeviations: number;
    mildDeviations: number;
    inTolerance: number;
  };
}

export interface EvidenceItem {
  paramKey: string;
  domain: TasteDomain;
  label: string;

  currentValue: number;
  genomePreferred: number;
  deviation: number;
  deviationLabel: "high" | "moderate" | "mild" | "none";

  description: string;
  suggestion: string;

  evidenceSource: string;
  confidence: number;
}

export interface Suggestion {
  action: "write_to_genome" | "write_to_reject" | "ignore" | "review";
  paramKey: string;
  reason: string;
  priority: "high" | "medium" | "low";
}

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

function getDeviationLabel(deviation: number): EvidenceItem["deviationLabel"] {
  if (deviation > 2.0) return "high";
  if (deviation > 1.0) return "moderate";
  if (deviation > 0.5) return "mild";
  return "none";
}

function getParamLabel(paramKey: string): string {
  return PARAM_LABELS[paramKey] ?? paramKey;
}

function getDomainLabel(domain: TasteDomain): string {
  return DOMAIN_LABELS[domain] ?? domain;
}

function percentChange(current: number, preferred: number): string {
  if (preferred === 0) {
    return current > 0 ? "+100%" : "0%";
  }
  const change = ((current - preferred) / preferred) * 100;
  const sign = change >= 0 ? "+" : "";
  return `${sign}${Math.round(change)}%`;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export class ReportGenerator {
  generate(result: ExportAnalysisResult, genome: TasteGenome): TasteDiffReport {
    const evidenceItems: EvidenceItem[] = result.genomeComparison.map((comparison) => {
      const param = genome.getParameter(comparison.paramKey);
      return this.formatEvidenceItem(comparison, param);
    });

    const summary = this.generateSummary(evidenceItems, result);
    const suggestions = this.generateSuggestions(evidenceItems);

    const stats = {
      totalComparisons: evidenceItems.length,
      significantDeviations: evidenceItems.filter((e) => e.deviation > 2.0).length,
      mildDeviations: evidenceItems.filter((e) => e.deviation > 1.0 && e.deviation <= 2.0).length,
      inTolerance: evidenceItems.filter((e) => e.deviation <= 1.0).length,
    };

    return {
      reportId: randomUUID(),
      exportRef: result.exportRef,
      genomeVersion: genome.version,
      generatedAt: new Date().toISOString(),
      evidenceItems,
      summary,
      suggestions,
      stats,
    };
  }

  formatEvidenceItem(
    comparison: GenomeComparison,
    param: TasteParameter | undefined
  ): EvidenceItem {
    const currentValue = parseFloat(comparison.currentValue);
    const genomePreferred = parseFloat(comparison.genomeMean);
    const deviation = comparison.deviation;
    const deviationLabel = getDeviationLabel(deviation);
    const label = getParamLabel(comparison.paramKey);
    const domainLabel = getDomainLabel(comparison.domain);
    const confidence = param ? parseFloat(param.confidence) : 0.5;

    const change = percentChange(currentValue, genomePreferred);
    const isHigher = currentValue > genomePreferred;

    let description: string;
    let suggestion: string;

    if (deviation <= 0.5) {
      description = `${label}与你平时的偏好基本一致`;
      suggestion = `${label}与你的偏好一致，无需调整`;
    } else if (deviation <= 1.0) {
      description = `${label}略${isHigher ? "高" : "低"}于你平时的偏好（${change}）`;
      suggestion = `${label}变化较小，可忽略本次差异`;
    } else if (deviation <= 2.0) {
      description = `${label}明${isHigher ? "高" : "低"}于你平时的偏好（${change}）`;
      suggestion = `${label}与你既定偏好有中等偏离，建议审阅后决定是否采纳`;
    } else {
      description = `${label}显${isHigher ? "高" : "低"}于你平时的偏好（${change}）`;
      if (comparison.domain === TasteDomain.Reject) {
        suggestion = `${label}显著触发你的反感项，强烈建议将此列入排除项`;
      } else {
        suggestion = `${label}与你既定偏好有显著偏离，建议确认后写入Genome更新偏好`;
      }
    }

    return {
      paramKey: comparison.paramKey,
      domain: comparison.domain,
      label,
      currentValue: clamp01(currentValue),
      genomePreferred: clamp01(genomePreferred),
      deviation,
      deviationLabel,
      description,
      suggestion,
      evidenceSource: "genome_comparison",
      confidence: clamp01(confidence),
    };
  }

  generateSummary(items: EvidenceItem[], _analysis: ExportAnalysisResult): string {
    if (items.length === 0) {
      return "本次导出没有发现任何特征差异。";
    }

    const byDeviation = [...items].sort((a, b) => b.deviation - a.deviation);

    const domainDeviations = new Map<string, { higher: number; lower: number; total: number }>();
    for (const item of byDeviation) {
      if (item.deviation <= 0.5) continue;
      const domainKey = item.domain;
      if (!domainDeviations.has(domainKey)) {
        domainDeviations.set(domainKey, { higher: 0, lower: 0, total: 0 });
      }
      const entry = domainDeviations.get(domainKey)!;
      entry.total++;
      if (item.currentValue > item.genomePreferred) {
        entry.higher++;
      } else {
        entry.lower++;
      }
    }

    const affectedDomains = [...domainDeviations.entries()]
      .filter(([, v]) => v.total > 0)
      .sort(([, a], [, b]) => b.total - a.total);

    const significant = byDeviation.filter((e) => e.deviation > 2.0);
    const moderate = byDeviation.filter((e) => e.deviation > 1.0 && e.deviation <= 2.0);

    if (significant.length === 0 && moderate.length === 0) {
      return "本次导出的音乐特征与你既定的品味偏好基本相符。";
    }

    const parts: string[] = [];

    if (affectedDomains.length > 0) {
      const domainParts = affectedDomains.map(([domain, v]) => {
        const domainLabel = getDomainLabel(domain as TasteDomain);
        const higherParts: string[] = [];
        const lowerParts: string[] = [];
        for (const item of byDeviation) {
          if (item.domain === domain && item.deviation > 0.5) {
            const change = percentChange(item.currentValue, item.genomePreferred);
            const dirPart = `${item.label}(${change})`;
            if (item.currentValue > item.genomePreferred) {
              higherParts.push(dirPart);
            } else {
              lowerParts.push(dirPart);
            }
          }
        }
        const summary: string[] = [];
        if (higherParts.length > 0) {
          summary.push(`偏丰富: ${higherParts.join("、")}`);
        }
        if (lowerParts.length > 0) {
          summary.push(`偏保守: ${lowerParts.join("、")}`);
        }
        return `${domainLabel}(${summary.join("; ")})`;
      });

      if (significant.length > 0) {
        parts.push(`本次导出有 ${significant.length} 项特征与你偏好有显著差异（偏差>2σ），分布在 ${affectedDomains.length} 个域中`);
      } else {
        parts.push(`本次导出有 ${moderate.length} 项特征与你偏好有中等差异`);
      }
      parts.push(domainParts.join("；"));
    }

    const top3 = byDeviation.filter((e) => e.deviation > 1.0).slice(0, 3);
    if (top3.length > 0) {
      const topParts = top3.map((item) => {
        const change = percentChange(item.currentValue, item.genomePreferred);
        return `${item.label}偏离${change}`;
      });
      parts.push(`主要差异: ${topParts.join("、")}。`);
    }

    return parts.join("。") + "";
  }

  generateSuggestions(items: EvidenceItem[]): Suggestion[] {
    const suggestions: Suggestion[] = [];

    for (const item of items) {
      if (item.deviation > 2.0) {
        if (item.domain === TasteDomain.Reject) {
          suggestions.push({
            action: "write_to_reject",
            paramKey: item.paramKey,
            reason: `${item.label}显著触发反感项，建议列入排除项`,
            priority: "high",
          });
        } else {
          suggestions.push({
            action: "write_to_genome",
            paramKey: item.paramKey,
            reason: `${item.label}有显著偏离，建议写入Genome更新偏好`,
            priority: "high",
          });
        }
      } else if (item.deviation > 1.0) {
        suggestions.push({
          action: "review",
          paramKey: item.paramKey,
          reason: `${item.label}有中等偏离，建议审阅`,
          priority: "medium",
        });
      } else {
        suggestions.push({
          action: "ignore",
          paramKey: item.paramKey,
          reason: `${item.label}偏离在容差范围内`,
          priority: "low",
        });
      }
    }

    suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const aOrder = priorityOrder[a.priority];
      const bOrder = priorityOrder[b.priority];
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.paramKey.localeCompare(b.paramKey);
    });

    return suggestions;
  }

  formatForUI(report: TasteDiffReport): {
    header: { title: string; subtitle: string };
    groups: { domain: string; label: string; items: EvidenceItem[] }[];
    summary: string;
    stats: TasteDiffReport["stats"];
  } {
    const domainList: TasteDomain[] = [
      TasteDomain.Harmony,
      TasteDomain.Melody,
      TasteDomain.Rhythm,
      TasteDomain.Texture,
      TasteDomain.Timbre,
      TasteDomain.Form,
      TasteDomain.Mix,
      TasteDomain.Reject,
    ];

    const groups = domainList.map((domain) => ({
      domain,
      label: getDomainLabel(domain),
      items: report.evidenceItems.filter((item) => item.domain === domain),
    }));

    return {
      header: {
        title: "品味差异报告",
        subtitle: `导出 ${report.exportRef} · Genome v${report.genomeVersion}`,
      },
      groups,
      summary: report.summary,
      stats: report.stats,
    };
  }
}
