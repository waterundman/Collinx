import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  FormTemplate,
  FormStructure,
  Section,
  EnergyCurve,
  EnergyPoint,
  NoteEvent,
  TasteGenome,
  DiffEnvelope,
  createDiffEnvelope,
  FormRole,
  listTemplates,
  applyTemplate,
} from "@collinx/core";
import { useI18n } from "../../i18n";
import styles from "./ArrangerPanel.module.css";

interface ArrangerVariant {
  id: string;
  name: string;
  structure: FormStructure;
  score: number;
  divergence: number;
  energyCurve: EnergyCurve;
}

interface ArrangerPanelProps {
  motifs: { id: string; name: string; notes: NoteEvent[] }[];
  genome?: TasteGenome | null;
  onArrange?: (result: ArrangerVariant[]) => void;
  onApplyDiff?: (diff: DiffEnvelope) => void;
}

const TEMPLATES = listTemplates();

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const FORM_ROLE_KEYS: Record<string, string> = {
  intro: "intro",
  verse: "verse",
  prechorus: "prechorus",
  chorus: "chorus",
  bridge: "bridge",
  solo: "solo",
  outro: "outro",
  build_up: "buildUp",
  drop: "drop",
  breakdown: "breakdown",
  interlude: "interlude",
};

const ENERGY_COLOR_VARS: [number, string, string, string][] = [
  [0, "--gradient-blue-start", "--gradient-blue-end", "--gradient-blue-end"],
  [0.25, "--gradient-green-start", "--gradient-green-end", "--gradient-green-end"],
  [0.5, "--gradient-yellow-start", "--gradient-yellow-end", "--gradient-yellow-end"],
  [0.75, "--gradient-orange-start", "--gradient-orange-end", "--gradient-orange-end"],
  [1, "--gradient-red-start", "--gradient-red-end", "--gradient-red-end"],
];

function energyToColor(level: number): string {
  if (level <= 0) return getCSSVar(ENERGY_COLOR_VARS[0][1]);
  if (level >= 1) return getCSSVar(ENERGY_COLOR_VARS[ENERGY_COLOR_VARS.length - 1][1]);
  for (let i = 0; i < ENERGY_COLOR_VARS.length - 1; i++) {
    const [t0, , c0] = ENERGY_COLOR_VARS[i];
    const [t1, c1] = ENERGY_COLOR_VARS[i + 1];
    if (level >= t0 && level <= t1) {
      const frac = (level - t0) / (t1 - t0);
      return lerpColor(getCSSVar(c0), getCSSVar(c1), frac);
    }
  }
  return getCSSVar(ENERGY_COLOR_VARS[0][1]);
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function generateVariants(
  template: FormTemplate,
  motifs: { id: string; name: string; notes: NoteEvent[] }[],
  genome?: TasteGenome | null
): ArrangerVariant[] {
  const baseStructure = applyTemplate(template);
  const variants: ArrangerVariant[] = [];

  variants.push({
    id: "v_base",
    name: `${template.name} (基准)`,
    structure: baseStructure,
    score: 0.85,
    divergence: 0,
    energyCurve: EnergyCurve.fromSections(baseStructure.sections),
  });

  const sectionContrast = parseFloat(
    genome?.getParameter("form.section_contrast")?.value ?? "0.5"
  );

  for (let vi = 1; vi <= 4; vi++) {
    const variantStructure = applyTemplate(template);

    for (const section of variantStructure.sections) {
      const noise = (Math.random() - 0.5) * 0.3 * (vi / 2);
      section.energyLevel = clamp(
        section.energyLevel + noise + sectionContrast * 0.1 * (vi - 2),
        0.05,
        0.95
      );
    }

    const divergence = 0.1 + (vi - 1) * 0.15 + Math.random() * 0.1;
    const score =
      0.85 - divergence * 0.4 + (sectionContrast > 0.5 ? 0.05 : -0.05);
    const curve = EnergyCurve.fromSections(variantStructure.sections);

    const variantLabels = ["能量聚焦", "段落对比", "平滑过渡", "戏剧弧光"];
    variants.push({
      id: `v_${vi}`,
      name: `${template.name} (${variantLabels[vi - 1] ?? `变体${vi}`})`,
      structure: variantStructure,
      score: clamp(score, 0.3, 0.95),
      divergence: clamp(divergence, 0.05, 0.55),
      energyCurve: curve,
    });
  }

  return variants;
}

function sectionToDiffOps(
  structure: FormStructure,
  nodeGroupRef: string,
  t: (key: string) => string
): DiffEnvelope {
  return createDiffEnvelope({
    baseRevision: "HEAD",
    actor: { type: "system", name: "Arranger" },
    permissionScope: "proposal_only",
    summary: `编排变更: ${structure.name} (${structure.sections.length} 段落)`,
    ops: [
      {
        op: "add_node",
        path: `sections`,
        nodeType: "FormStructure",
        data: {
          name: structure.name,
          sections: structure.sections.map((s) => ({
            name: s.name,
            formRole: s.formRole,
            startBar: s.startBar,
            endBar: s.endBar,
            energyLevel: s.energyLevel,
          })),
        },
      },
    ],
    domainExplanations: structure.sections.map((s) => ({
      label: s.name,
      text: `${t(`arranger.formRoles.${FORM_ROLE_KEYS[s.formRole] ?? s.formRole}`)}: ${t('arranger.bars')} ${s.startBar}-${s.endBar}, ${t('arranger.energy')} ${(s.energyLevel * 100).toFixed(0)}%`,
    })),
    riskFlags: [],
  });
}

function drawEnergyCurve(
  canvas: HTMLCanvasElement,
  sections: Section[],
  totalBars: number
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const pad = { top: 8, right: 12, bottom: 16, left: 10 };
  const drawW = w - pad.left - pad.right;
  const drawH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = getCSSVar('--bg-primary');
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = getCSSVar('--bg-elevated');
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (drawH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  const maxBar = totalBars || Math.max(...sections.map((s) => s.endBar), 16);
  const curve = EnergyCurve.fromSections(sections);
  const points = curve.getPoints();

  if (points.length === 0 && sections.length === 0) return;

  const allPoints: EnergyPoint[] = [];
  for (let bar = 1; bar <= maxBar; bar++) {
    allPoints.push({ bar, level: curve.at(bar) });
  }

  ctx.beginPath();
  ctx.strokeStyle = getCSSVar('--accent-green');
  ctx.lineWidth = 1.5;
  let first = true;
  for (const pt of allPoints) {
    const x = pad.left + ((pt.bar - 1) / (maxBar - 1 || 1)) * drawW;
    const y = pad.top + drawH - pt.level * drawH;
    if (first) {
      ctx.moveTo(x, y);
      first = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();

  for (const pt of points) {
    const x = pad.left + ((pt.bar - 1) / (maxBar - 1 || 1)) * drawW;
    const y = pad.top + drawH - pt.level * drawH;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = getCSSVar('--accent-cyan');
    ctx.fill();
  }

  for (let bar = 1; bar <= maxBar; bar += 4) {
    const x = pad.left + ((bar - 1) / (maxBar - 1 || 1)) * drawW;
    ctx.fillStyle = getCSSVar('--text-muted');
    ctx.font = "8px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${bar}`, x, h - 2);
  }

  const yLabels = ["100%", "75%", "50%", "25%", "0%"];
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (drawH / 4) * i;
    ctx.fillStyle = getCSSVar('--text-muted');
    ctx.font = "7px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(yLabels[i], pad.left - 3, y + 3);
  }
}

export const ArrangerPanel: React.FC<ArrangerPanelProps> = ({
  motifs,
  genome,
  onApplyDiff,
}) => {
  const { t } = useI18n();
  const [selectedTemplate, setSelectedTemplate] = useState<string>(
    TEMPLATES[0]?.name ? "pop_ababcb" : ""
  );
  const [variants, setVariants] = useState<ArrangerVariant[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const currentTemplate = useMemo(
    () => TEMPLATES.find((t) => t.name === selectedTemplate),
    [selectedTemplate]
  );

  const variant = useMemo(
    () => variants.find((v) => v.id === selectedVariant) ?? null,
    [variants, selectedVariant]
  );

  const totalBars = useMemo(() => {
    if (!variant) return 16;
    return (
      Math.max(...variant.structure.sections.map((s) => s.endBar)) || 16
    );
  }, [variant]);

  useEffect(() => {
    if (canvasRef.current && variant) {
      drawEnergyCurve(canvasRef.current, variant.structure.sections, totalBars);
    }
  }, [variant, totalBars]);

  const handleGenerate = useCallback(() => {
    if (!currentTemplate) return;
    const result = generateVariants(currentTemplate, motifs, genome);
    setVariants(result);
    setSelectedVariant(result[0]?.id ?? null);
  }, [currentTemplate, motifs, genome]);

  const handleConfirm = useCallback(() => {
    if (!variant) return;
    const diff = sectionToDiffOps(variant.structure, "form_root", t);
    onApplyDiff?.(diff);
  }, [variant, onApplyDiff, t]);

  const selectedSectionId = hoveredSection;

  return (
    <div className={styles.arrangerPanel} data-testid="arranger-panel">
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>{t('arranger.title')}</span>
        <span className={styles.panelSubtitle}>{t('arranger.subtitle')}</span>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>{t('arranger.formTemplate')}</label>
        <select
          className={styles.templateSelector}
          value={selectedTemplate}
          onChange={(e) => setSelectedTemplate(e.target.value)}
        >
          {TEMPLATES.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name} — {t.description}
            </option>
          ))}
        </select>

        <button className={styles.generateBtn} onClick={handleGenerate}>
          {t('arranger.generate')}
        </button>
      </div>

      {variants.length > 0 && (
        <div className={styles.section}>
          <label className={styles.label}>
            {t('arranger.arrangementPlans')} ({variants.length})
          </label>
          <div className={styles.variantList}>
            {variants.map((v) => (
              <div
                key={v.id}
                className={`${styles.variantCard} ${v.id === selectedVariant ? styles.variantCardActive : ""}`}
                onClick={() => setSelectedVariant(v.id)}
              >
                <div className={styles.variantName}>{v.name}</div>
                <div className={styles.variantMeta}>
                  <span
                    className={styles.variantScore}
                    style={{
                      color: v.score >= 0.7 ? "var(--accent-green)" : v.score >= 0.5 ? "var(--accent-yellow)" : "var(--accent-red)",
                    }}
                  >
                    {t('arranger.fitness')} {(v.score * 100).toFixed(0)}%
                  </span>
                  <span className={styles.variantDivergence}>
                    {t('arranger.divergence')} {(v.divergence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {variant && (
        <>
          <div className={styles.section}>
            <label className={styles.label}>{t('arranger.sectionOverview')}</label>
            <div className={styles.sectionTimeline}>
              {variant.structure.sections.map((section) => {
                const leftPct =
                  ((section.startBar - 1) / totalBars) * 100;
                const widthPct =
                  ((section.endBar - section.startBar + 1) / totalBars) * 100;
                const color = energyToColor(section.energyLevel);
                const isHovered = selectedSectionId === section.id;

                return (
                  <div
                    key={section.id}
                    className={`${styles.sectionBlock} ${isHovered ? styles.sectionBlockHovered : ""}`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      background: color,
                    }}
                    onClick={() =>
                      setHoveredSection(
                        selectedSectionId === section.id ? null : section.id
                      )
                    }
                    title={`${section.name}\n${t('arranger.role')}: ${t(`arranger.formRoles.${FORM_ROLE_KEYS[section.formRole] ?? section.formRole}`)}\n${t('arranger.bars')}: ${section.startBar}-${section.endBar}\n${t('arranger.energy')}: ${(section.energyLevel * 100).toFixed(0)}%`}
                  >
                    <span className={styles.sectionRoleLabel}>
                      {t(`arranger.formRoles.${FORM_ROLE_KEYS[section.formRole] ?? section.formRole}`)}
                    </span>
                  </div>
                );
              })}
            </div>

            {selectedSectionId && (() => {
              const sec = variant.structure.sections.find((s) => s.id === selectedSectionId);
              if (!sec) return null;
              return (
                <div className={styles.sectionTooltip}>
                  <div className={styles.tooltipRow}>
                    <span className={styles.tooltipKey}>{t('arranger.role')}</span>
                    <span className={styles.tooltipValue}>
                      {t(`arranger.formRoles.${FORM_ROLE_KEYS[sec.formRole] ?? sec.formRole}`)}
                    </span>
                  </div>
                  <div className={styles.tooltipRow}>
                    <span className={styles.tooltipKey}>{t('arranger.bars')}</span>
                    <span className={styles.tooltipValue}>
                      {sec.startBar} — {sec.endBar}
                    </span>
                  </div>
                  <div className={styles.tooltipRow}>
                    <span className={styles.tooltipKey}>{t('arranger.energy')}</span>
                    <span className={styles.tooltipValue}>
                      {(sec.energyLevel * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className={styles.section}>
            <label className={styles.label}>{t('arranger.energyCurve')}</label>
            <canvas
              ref={canvasRef}
              className={styles.energyCanvas}
              width={280}
              height={160}
            />
          </div>

          <div className={styles.footer}>
            <button className={styles.confirmBtn} onClick={handleConfirm}>
              {t('arranger.confirm')}
            </button>
          </div>
        </>
      )}

      {variants.length === 0 && !currentTemplate && (
        <div className={styles.emptyState}>{t('arranger.selectTemplate')}</div>
      )}
    </div>
  );
};
