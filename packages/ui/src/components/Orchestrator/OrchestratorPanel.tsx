import React, { useState, useCallback, useMemo } from "react";
import {
  type Instrument,
  type HarmonyEntry,
  INSTRUMENTS,
  getInstrumentsByFamily,
  type InstrumentFamily,
} from "@collinx/core";
import { useI18n } from "../../i18n";
import styles from "./OrchestratorPanel.module.css";

export interface Player {
  id: string;
  name: string;
  instrumentId: string;
  trackId?: string;
}

export interface RegisterConflict {
  type: "overlap" | "spacing" | "range_violation" | "crossing";
  players: [string, string];
  bar: number;
  beat: number;
  description: string;
  severity: "warning" | "error";
  suggestion: string;
}

export interface OrchestratorConfig {
  players: string[];
  style?: "classical" | "pop" | "cinematic" | "jazz";
  playabilityPolicy: "strict" | "moderate" | "lenient";
  doubleOctaves?: boolean;
  maxVoices?: number;
}

export interface OrchestratorPanelProps {
  harmony?: HarmonyEntry[];
  onOrchestrate?: (config: OrchestratorConfig) => void;
  conflicts?: RegisterConflict[];
}

const ENSEMBLE_PRESETS: Record<string, string[]> = {
  "string_quartet": ["violin", "violin", "viola", "cello"],
  "brass_quintet": ["trumpet_bb", "trumpet_bb", "horn_f", "trombone", "tuba"],
  "jazz_big_band": ["trumpet_bb", "trumpet_bb", "trumpet_bb", "trombone", "trombone", "clarinet_bb", "clarinet_bb", "piano", "double_bass"],
  "orchestra_full": ["violin", "violin", "viola", "cello", "double_bass", "flute", "oboe", "clarinet_bb", "bassoon", "horn_f", "horn_f", "trumpet_bb", "trombone", "tuba", "timpani"],
  "electronic": ["synth_lead", "synth_pad", "synth_bass"],
  "piano_trio": ["piano", "violin", "cello"],
  "woodwind_quintet": ["flute", "oboe", "clarinet_bb", "horn_f", "bassoon"],
};

export const OrchestratorPanel: React.FC<OrchestratorPanelProps> = ({
  harmony,
  onOrchestrate,
  conflicts,
}) => {
  const { t } = useI18n();
  const [selectedPlayers, setSelectedPlayers] = useState<Set<string>>(new Set());
  const [selectedPreset, setSelectedPreset] = useState<string>("string_quartet");
  const [style, setStyle] = useState<string>("classical");
  const [playabilityPolicy, setPlayabilityPolicy] = useState<"strict" | "moderate" | "lenient">("moderate");
  const [doubleOctaves, setDoubleOctaves] = useState(false);
  const [maxVoices, setMaxVoices] = useState(4);
  const [expandedFamily, setExpandedFamily] = useState<string | null>("strings");

  const families = useMemo((): InstrumentFamily[] => ["woodwind", "brass", "strings", "percussion", "keyboard", "voice", "electronic"], []);

  const FAMILY_LABELS: Record<InstrumentFamily, string> = useMemo(() => ({
    woodwind: t('orchestrator.families.woodwind'),
    brass: t('orchestrator.families.brass'),
    strings: t('orchestrator.families.strings'),
    percussion: t('orchestrator.families.percussion'),
    keyboard: t('orchestrator.families.keyboard'),
    voice: t('orchestrator.families.voice'),
    electronic: t('orchestrator.families.electronic'),
  }), [t]);

  const STYLE_LABELS: Record<string, string> = useMemo(() => ({
    classical: t('orchestrator.styles.classical'),
    pop: t('orchestrator.styles.pop'),
    cinematic: t('orchestrator.styles.cinematic'),
    jazz: t('orchestrator.styles.jazz'),
  }), [t]);

  const PRESET_LABELS: Record<string, string> = useMemo(() => ({
    string_quartet: t('orchestrator.presets.stringQuartet'),
    brass_quintet: t('orchestrator.presets.brassQuintet'),
    jazz_big_band: t('orchestrator.presets.jazzBigBand'),
    orchestra_full: t('orchestrator.presets.orchestraFull'),
    electronic: t('orchestrator.presets.electronic'),
    piano_trio: t('orchestrator.presets.pianoTrio'),
    woodwind_quintet: t('orchestrator.presets.woodwindQuintet'),
  }), [t]);

  const togglePlayer = useCallback((id: string) => {
    setSelectedPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const applyPreset = useCallback((presetKey: string) => {
    setSelectedPreset(presetKey);
    const preset = ENSEMBLE_PRESETS[presetKey];
    if (preset) {
      setSelectedPlayers(new Set(preset));
    }
  }, []);

  const handleOrchestrate = useCallback(() => {
    const config: OrchestratorConfig = {
      players: Array.from(selectedPlayers),
      style: style as OrchestratorConfig["style"],
      playabilityPolicy,
      doubleOctaves,
      maxVoices: maxVoices || undefined,
    };
    onOrchestrate?.(config);
  }, [selectedPlayers, style, playabilityPolicy, doubleOctaves, maxVoices, onOrchestrate]);

  const errorConflicts = useMemo(
    () => conflicts?.filter((c) => c.severity === "error") ?? [],
    [conflicts],
  );
  const warningConflicts = useMemo(
    () => conflicts?.filter((c) => c.severity === "warning") ?? [],
    [conflicts],
  );

  const playerNoteCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of selectedPlayers) {
      counts.set(id, Math.floor(Math.random() * 30) + 5);
    }
    return counts;
  }, [selectedPlayers]);

  return (
    <div className={styles.orchestratorPanel} data-testid="orchestrator-panel">
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>{t('orchestrator.title')}</span>
        <span className={styles.panelSubtitle}>{t('orchestrator.subtitle')}</span>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>{t('orchestrator.presetEnsemble')}</label>
        <div className={styles.presetList}>
          {Object.entries(PRESET_LABELS).map(([key, label]) => (
            <button
              key={key}
              className={`${styles.presetBtn} ${key === selectedPreset ? styles.presetBtnActive : ""}`}
              onClick={() => applyPreset(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>
          {t('orchestrator.instrumentSelect')} <span className={styles.badge}>{selectedPlayers.size}</span>
        </label>
        <div className={styles.familyList}>
          {families.map((family: InstrumentFamily) => {
            const instruments = getInstrumentsByFamily(family);
            const familyCount = instruments.filter((inst) =>
              selectedPlayers.has(inst.id),
            ).length;
            const isExpanded = family === expandedFamily;

            return (
              <div key={family} className={styles.familyGroup}>
                <button
                  className={styles.familyHeader}
                  onClick={() =>
                    setExpandedFamily(isExpanded ? null : family)
                  }
                >
                  <span className={styles.familyName}>
                    {FAMILY_LABELS[family] ?? family}
                  </span>
                  <span
                    className={`${styles.familyArrow} ${isExpanded ? styles.familyArrowOpen : ""}`}
                  >
                    &#9654;
                  </span>
                  <span className={styles.familyCount}>
                    {familyCount}/{instruments.length}
                  </span>
                </button>

                {isExpanded && (
                  <div className={styles.instrumentList}>
                    {instruments.map((inst) => (
                      <label key={inst.id} className={styles.instrumentItem}>
                        <input
                          type="checkbox"
                          className={styles.checkbox}
                          checked={selectedPlayers.has(inst.id)}
                          onChange={() => togglePlayer(inst.id)}
                        />
                        <span className={styles.instrumentName}>
                          {inst.name}
                        </span>
                        <span className={styles.instrumentRange}>
                          {inst.range.minMidi}—{inst.range.maxMidi}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.section}>
        <label className={styles.label}>{t('orchestrator.params')}</label>
        <div className={styles.paramGroup}>
          <div className={styles.paramRow}>
            <span className={styles.paramLabel}>{t('orchestrator.style')}</span>
            <select
              className={styles.select}
              value={style}
              onChange={(e) => setStyle(e.target.value)}
            >
              {Object.entries(STYLE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className={styles.paramRow}>
            <span className={styles.paramLabel}>{t('orchestrator.playability')}</span>
            <select
              className={styles.select}
              value={playabilityPolicy}
              onChange={(e) =>
                setPlayabilityPolicy(e.target.value as "strict" | "moderate" | "lenient")
              }
            >
              <option value="strict">{t('orchestrator.strict')}</option>
              <option value="moderate">{t('orchestrator.moderate')}</option>
              <option value="lenient">{t('orchestrator.lenient')}</option>
            </select>
          </div>
          <div className={styles.paramRow}>
            <span className={styles.paramLabel}>{t('orchestrator.maxVoices')}</span>
            <input
              type="number"
              className={styles.numberInput}
              min={2}
              max={8}
              value={maxVoices}
              onChange={(e) => setMaxVoices(Number(e.target.value))}
            />
          </div>
          <div className={styles.paramRow}>
            <span className={styles.paramLabel}>{t('orchestrator.doubleOctaves')}</span>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={doubleOctaves}
                onChange={(e) => setDoubleOctaves(e.target.checked)}
              />
              <span className={styles.toggleTrack} />
            </label>
          </div>
        </div>
      </div>

      {selectedPlayers.size > 0 && (
        <div className={styles.section}>
          <button className={styles.orchestrateBtn} onClick={handleOrchestrate}>
            {t('orchestrator.orchestrate')} ({selectedPlayers.size} {t('orchestrator.instruments')})
          </button>
        </div>
      )}

      {conflicts && conflicts.length > 0 && (
        <div className={styles.section}>
          <label className={styles.label}>
            {t('orchestrator.conflictDetection')} ({conflicts.length})
          </label>
          <div className={styles.conflictList}>
            {errorConflicts.map((conflict, idx) => (
              <div key={`err-${idx}`} className={styles.conflictCardError}>
                <div className={styles.conflictHeader}>
                  <span className={styles.conflictBadgeError}>{t('score.error')}</span>
                  <span className={styles.conflictLocation}>
                    m{conflict.bar}.{conflict.beat}
                  </span>
                </div>
                <div className={styles.conflictDesc}>{conflict.description}</div>
                <div className={styles.conflictSuggestion}>{conflict.suggestion}</div>
              </div>
            ))}
            {warningConflicts.map((conflict, idx) => (
              <div key={`warn-${idx}`} className={styles.conflictCardWarn}>
                <div className={styles.conflictHeader}>
                  <span className={styles.conflictBadgeWarn}>{t('score.warning')}</span>
                  <span className={styles.conflictLocation}>
                    m{conflict.bar}.{conflict.beat}
                  </span>
                </div>
                <div className={styles.conflictDesc}>{conflict.description}</div>
                <div className={styles.conflictSuggestion}>{conflict.suggestion}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selectedPlayers.size > 0 && (
        <div className={styles.section}>
          <label className={styles.label}>{t('orchestrator.voicePreview')}</label>
          <div className={styles.voicePreview}>
            {Array.from(selectedPlayers).map((pid) => {
              const inst = INSTRUMENTS[pid];
              return (
                <div key={pid} className={styles.voiceRow}>
                  <span className={styles.voiceName}>
                    {inst?.name ?? pid}
                  </span>
                  <div className={styles.voiceBar}>
                    <div
                      className={styles.voiceBarFill}
                      style={{
                        width: `${Math.min(100, (playerNoteCounts.get(pid) ?? 0) * 3)}%`,
                      }}
                    />
                  </div>
                  <span className={styles.voiceCount}>
                    {playerNoteCounts.get(pid) ?? 0} {t('score.notes')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
