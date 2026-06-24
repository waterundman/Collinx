import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  MixerState,
  MixerTrack,
  FXSlot,
  FXType,
  FX_TYPES,
  createTrack,
  createFXSlot,
} from "@collinx/core";
import { useI18n } from "../../i18n";
import styles from "./MixerConsole.module.css";

interface MixerConsoleProps {
  mixer: MixerState;
  onTrackChange?: (trackId: string, changes: Partial<MixerTrack>) => void;
  onAddTrack?: (name: string, sourceId: string) => void;
  onRemoveTrack?: (trackId: string) => void;
}

interface FXEditorState {
  trackId: string;
  slotId: string;
}

const FX_LABELS: Record<FXType, string> = {
  eq: "EQ",
  compressor: "COMP",
  reverb: "REV",
  delay: "DLY",
  saturator: "SAT",
  limiter: "LIM",
};

const FX_PARAMS: Record<FXType, { key: string; label: string; min: number; max: number; step: number; unit: string }[]> = {
  eq: [
    { key: "lowGain", label: "Low", min: -12, max: 12, step: 0.1, unit: " dB" },
    { key: "lowFreq", label: "L Freq", min: 20, max: 500, step: 1, unit: " Hz" },
    { key: "midGain", label: "Mid", min: -12, max: 12, step: 0.1, unit: " dB" },
    { key: "midFreq", label: "M Freq", min: 200, max: 8000, step: 1, unit: " Hz" },
    { key: "midQ", label: "M Q", min: 0.1, max: 5, step: 0.1, unit: "" },
    { key: "highGain", label: "High", min: -12, max: 12, step: 0.1, unit: " dB" },
    { key: "highFreq", label: "H Freq", min: 1000, max: 20000, step: 1, unit: " Hz" },
  ],
  compressor: [
    { key: "threshold", label: "Thresh", min: -60, max: 0, step: 0.1, unit: " dB" },
    { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.1, unit: ":1" },
    { key: "attack", label: "Attack", min: 0.1, max: 100, step: 0.1, unit: " ms" },
    { key: "release", label: "Release", min: 1, max: 500, step: 0.1, unit: " ms" },
    { key: "makeup", label: "Makeup", min: -12, max: 24, step: 0.1, unit: " dB" },
  ],
  reverb: [
    { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, unit: "" },
    { key: "decay", label: "Decay", min: 0, max: 1, step: 0.01, unit: "" },
  ],
  delay: [
    { key: "mix", label: "Mix", min: 0, max: 1, step: 0.01, unit: "" },
    { key: "time", label: "Time", min: 10, max: 1000, step: 1, unit: " ms" },
    { key: "feedback", label: "Feedback", min: 0, max: 0.95, step: 0.01, unit: "" },
  ],
  saturator: [
    { key: "drive", label: "Drive", min: 0, max: 24, step: 0.1, unit: " dB" },
  ],
  limiter: [
    { key: "ceiling", label: "Ceiling", min: -12, max: 0, step: 0.1, unit: " dB" },
    { key: "release", label: "Release", min: 1, max: 200, step: 0.1, unit: " ms" },
  ],
};

function dbToPercent(db: number): number {
  const minDb = -60;
  const maxDb = 6;
  return ((db - minDb) / (maxDb - minDb)) * 100;
}

function percentToDb(pct: number): number {
  const minDb = -60;
  const maxDb = 6;
  return minDb + (pct / 100) * (maxDb - minDb);
}

function panToPercent(pan: number): number {
  return ((pan + 1) / 2) * 100;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export const MixerConsole: React.FC<MixerConsoleProps> = ({
  mixer,
  onTrackChange,
  onAddTrack,
  onRemoveTrack,
}) => {
  const { t } = useI18n();
  const [fxEditor, setFxEditor] = useState<FXEditorState | null>(null);
  const [dragSlot, setDragSlot] = useState<{ trackId: string; slotIdx: number } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTrackName, setNewTrackName] = useState("");
  const [newTrackSource, setNewTrackSource] = useState("");
  const [hoveredTrack, setHoveredTrack] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const faderRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const allTracks = useMemo(() => [...mixer.tracks, mixer.masterTrack], [mixer]);

  const handleFaderChange = useCallback(
    (trackId: string, clientY: number) => {
      const el = faderRefs.current.get(trackId);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = 100 - ((clientY - rect.top) / rect.height) * 100;
      const db = percentToDb(Math.max(0, Math.min(100, pct)));
      const gainDb = db <= -60 ? "-Infinity" : db.toFixed(1);
      onTrackChange?.(trackId, { gainDb });
    },
    [onTrackChange],
  );

  const handleFaderMouseDown = useCallback(
    (trackId: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      handleFaderChange(trackId, e.clientY);
      const onMove = (me: MouseEvent) => handleFaderChange(trackId, me.clientY);
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [handleFaderChange],
  );

  const handleMute = useCallback(
    (track: MixerTrack) => {
      onTrackChange?.(track.id, { mute: !track.mute });
    },
    [onTrackChange],
  );

  const handleSolo = useCallback(
    (track: MixerTrack) => {
      onTrackChange?.(track.id, { solo: !track.solo });
    },
    [onTrackChange],
  );

  const handleFXSlotClick = useCallback(
    (trackId: string, slotId: string) => {
      setFxEditor((prev) =>
        prev?.trackId === trackId && prev?.slotId === slotId ? null : { trackId, slotId },
      );
    },
    [],
  );

  const handleFXParamChange = useCallback(
    (trackId: string, slotId: string, key: string, value: string) => {
      const track = mixer.tracks.find((t) => t.id === trackId) ?? mixer.masterTrack;
      if (track.id !== trackId) return;
      const slot = track.fxChain.slots.find((s) => s.id === slotId);
      if (!slot) return;

      const newParams = { ...slot.params, [key]: value };
      const newSlots = track.fxChain.slots.map((s) =>
        s.id === slotId ? { ...s, params: newParams } : s,
      );
      onTrackChange?.(trackId, { fxChain: { ...track.fxChain, slots: newSlots } });
    },
    [mixer, onTrackChange],
  );

  const handleFXSlotToggle = useCallback(
    (trackId: string, slotId: string) => {
      const track = mixer.tracks.find((t) => t.id === trackId) ?? mixer.masterTrack;
      if (track.id !== trackId) return;
      const newSlots = track.fxChain.slots.map((s) =>
        s.id === slotId ? { ...s, enabled: !s.enabled } : s,
      );
      onTrackChange?.(trackId, { fxChain: { ...track.fxChain, slots: newSlots } });
    },
    [mixer, onTrackChange],
  );

  const handleAddFX = useCallback(
    (trackId: string, type: FXType) => {
      const track = mixer.tracks.find((t) => t.id === trackId) ?? mixer.masterTrack;
      if (track.id !== trackId) return;
      const slot = createFXSlot(type);
      const newSlots = [...track.fxChain.slots, slot];
      onTrackChange?.(trackId, { fxChain: { ...track.fxChain, slots: newSlots } });
    },
    [mixer, onTrackChange],
  );

  const handleRemoveFX = useCallback(
    (trackId: string, slotId: string) => {
      const track = mixer.tracks.find((t) => t.id === trackId) ?? mixer.masterTrack;
      if (track.id !== trackId) return;
      const newSlots = track.fxChain.slots.filter((s) => s.id !== slotId);
      onTrackChange?.(trackId, { fxChain: { ...track.fxChain, slots: newSlots } });
      if (fxEditor?.slotId === slotId) setFxEditor(null);
    },
    [mixer, onTrackChange, fxEditor],
  );

  const handleDragStart = useCallback(
    (trackId: string, slotIdx: number) => {
      setDragSlot({ trackId, slotIdx });
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, trackId: string, slotIdx: number) => {
      e.preventDefault();
      if (!dragSlot || dragSlot.trackId !== trackId) return;
      e.dataTransfer.dropEffect = "move";
    },
    [dragSlot],
  );

  const handleDrop = useCallback(
    (trackId: string, toIdx: number) => {
      if (!dragSlot || dragSlot.trackId !== trackId) return;
      const track = mixer.tracks.find((t) => t.id === trackId) ?? mixer.masterTrack;
      if (track.id !== trackId) return;

      const newSlots = [...track.fxChain.slots];
      const [moved] = newSlots.splice(dragSlot.slotIdx, 1);
      newSlots.splice(toIdx, 0, moved);
      onTrackChange?.(trackId, { fxChain: { ...track.fxChain, slots: newSlots } });
      setDragSlot(null);
    },
    [dragSlot, mixer, onTrackChange],
  );

  const handleAddTrackClick = useCallback(() => {
    setShowAddModal(true);
    setNewTrackName("");
    setNewTrackSource("");
  }, []);

  const handleConfirmAdd = useCallback(() => {
    if (newTrackName.trim() && newTrackSource.trim()) {
      onAddTrack?.(newTrackName.trim(), newTrackSource.trim());
    }
    setShowAddModal(false);
  }, [newTrackName, newTrackSource, onAddTrack]);

  const getFaderGainDb = (track: MixerTrack): number => {
    const v = parseFloat(track.gainDb);
    return isNaN(v) ? 0 : v;
  };

  const renderFader = (track: MixerTrack) => {
    const db = getFaderGainDb(track);
    const pct = dbToPercent(db);
    const displayDb = db <= -60 ? "-∞" : `${db >= 0 ? "+" : ""}${db.toFixed(1)}`;

    return (
      <div className={styles.faderSection}>
        <div
          className={styles.faderTrack}
          ref={(el) => {
            if (el) {
              faderRefs.current.set(track.id, el);
            } else {
              faderRefs.current.delete(track.id);
            }
          }}
          onMouseDown={handleFaderMouseDown(track.id)}
        >
          <div className={styles.faderFill} style={{ height: `${pct}%` }} />
          <div className={styles.faderThumb} style={{ bottom: `${pct}%` }} />
        </div>
        <div className={styles.faderValue}>{displayDb}</div>
      </div>
    );
  };

  const renderMeter = (track: MixerTrack) => {
    const level = parseFloat(track.meterLevel || "0");
    const pct = Math.max(0, Math.min(100, (1 - Math.abs(level)) * 100));

    return (
      <div className={styles.meterContainer}>
        <div className={styles.meterBar}>
          <div
            className={styles.meterFill}
            style={{
              width: `${pct}%`,
              background: pct > 80 ? "var(--accent-red)" : pct > 60 ? "var(--accent-yellow)" : "var(--accent-green)",
            }}
          />
        </div>
        <div className={styles.meterDb}>{level.toFixed(1)} dB</div>
      </div>
    );
  };

  const renderPan = (track: MixerTrack) => {
    const pan = parseFloat(track.pan || "0");
    const angle = pan * 45;
    const display = pan === 0 ? "C" : pan < 0 ? `L${Math.abs(pan * 100).toFixed(0)}` : `R${(pan * 100).toFixed(0)}`;

    return (
      <div className={styles.panSection}>
        <div className={styles.panKnob}>
          <div
            className={styles.panIndicator}
            style={{ transform: `rotate(${angle}deg)`, transformOrigin: "50% 100%", height: "10px" }}
          />
        </div>
        <div className={styles.panLabel}>{display}</div>
      </div>
    );
  };

  const renderFXSlots = (track: MixerTrack) => {
    return (
      <div className={styles.fxSection}>
        <span className={styles.fxSlotLabel}>FX</span>
        {track.fxChain.slots.map((slot, idx) => {
          const isActive = fxEditor?.trackId === track.id && fxEditor?.slotId === slot.id;
          return (
            <div
              key={slot.id}
              className={`${styles.fxSlot} ${isActive ? styles.fxSlotActive : ""} ${!slot.enabled ? styles.fxSlotDisabled : ""}`}
              onClick={() => handleFXSlotClick(track.id, slot.id)}
              draggable
              onDragStart={() => handleDragStart(track.id, idx)}
              onDragOver={(e) => handleDragOver(e, track.id, idx)}
              onDrop={() => handleDrop(track.id, idx)}
              onDoubleClick={(e) => { e.stopPropagation(); handleFXSlotToggle(track.id, slot.id); }}
              title="Click to edit | Double-click to toggle on/off | Drag to reorder"
            >
              <span className={styles.fxSlotDragHandle}>⋮⋮</span>
              <span className={styles.fxSlotType}>{FX_LABELS[slot.type as FXType] ?? slot.type}</span>
            </div>
          );
        })}
        <div className={styles.fxAddBtn} onClick={(e) => {
          e.stopPropagation();
          const next = FX_TYPES[0];
          handleAddFX(track.id, next as FXType);
        }} title="Add FX (click for EQ, shift+click for menu)">
          + FX
        </div>
      </div>
    );
  };

  const renderFXEditor = (track: MixerTrack, slot: FXSlot) => {
    if (!fxEditor || fxEditor.trackId !== track.id || fxEditor.slotId !== slot.id) return null;
    const paramDefs = FX_PARAMS[slot.type as FXType] ?? [];

    return (
      <div
        className={styles.fxEditorOverlay}
        onClick={(e) => e.stopPropagation()}
        style={{ bottom: "auto", top: "100%", marginBottom: 0, marginTop: "4px" }}
      >
        <div className={styles.fxEditorHeader}>
          <span className={styles.fxEditorTitle}>
            {FX_LABELS[slot.type as FXType] ?? slot.type}
            {!slot.enabled && " (Bypassed)"}
          </span>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              className={styles.fxEditorClose}
              onClick={() => handleFXSlotToggle(track.id, slot.id)}
              title="Toggle bypass"
            >
              {slot.enabled ? "⊘" : "⊙"}
            </button>
            <button
              className={styles.fxEditorClose}
              onClick={() => handleRemoveFX(track.id, slot.id)}
              title="Remove"
            >
              ✕
            </button>
          </div>
        </div>
        {paramDefs.map((def) => {
          const rawVal = slot.params[def.key] ?? "0";
          const val = parseFloat(rawVal) || 0;
          return (
            <div key={def.key} className={styles.fxParamRow}>
              <div className={styles.fxParamLabel}>
                <span>{def.label}</span>
                <span className={styles.fxParamValue}>{val}{def.unit}</span>
              </div>
              <div className={styles.fxParamKnob}>
                <input
                  type="range"
                  className={styles.fxParamKnobInput}
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  value={val}
                  onChange={(e) =>
                    handleFXParamChange(track.id, slot.id, def.key, e.target.value)
                  }
                />
              </div>
            </div>
          );
        })}
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "8px" }}>
          {FX_TYPES.map((ft) => (
            <button
              key={ft}
              onClick={() => {
                handleRemoveFX(track.id, slot.id);
                const newSlot = createFXSlot(ft as FXType);
                const newSlots = track.fxChain.slots.map((s) =>
                  s.id === slot.id ? newSlot : s,
                );
                onTrackChange?.(track.id, { fxChain: { ...track.fxChain, slots: newSlots } });
                setFxEditor({ trackId: track.id, slotId: newSlot.id });
              }}
              style={{
                padding: "2px 6px",
                fontSize: "9px",
                background: ft === slot.type ? "var(--bg-active)" : "var(--bg-elevated)",
                border: `1px solid ${ft === slot.type ? "var(--accent-cyan)" : "var(--border-primary)"}`,
                borderRadius: "3px",
                color: ft === slot.type ? "var(--accent-cyan)" : "var(--text-secondary)",
                cursor: "pointer",
              }}
            >
              {FX_LABELS[ft as FXType]}
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderSendSection = (track: MixerTrack) => {
    if (track.busType === "master") return null;
    return (
      <div className={styles.sendSection}>
        <span className={styles.fxSlotLabel}>Sends</span>
        {track.sends.map((send) => {
          const target = allTracks.find((t) => t.id === send.targetBusId);
          return (
            <div
              key={send.targetBusId}
              className={styles.sendItem}
              title={`Send to ${target?.name ?? send.targetBusId}: ${send.level}`}
            >
              <span>→ {target?.name ?? "?"}</span>
              <span>{parseFloat(send.level) * 100 > 0 ? `${(parseFloat(send.level) * 100).toFixed(0)}%` : ""}</span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderChannelStrip = (track: MixerTrack, isMaster: boolean) => {
    const isEditingFX = fxEditor?.trackId === track.id;

    return (
      <div
        key={track.id}
        className={`${styles.channelStrip} ${isMaster ? styles.channelStripMaster : ""} ${hoveredTrack === track.id ? styles.dragOver : ""}`}
        data-testid={`mixer-channel-${track.id}`}
        onMouseEnter={() => setHoveredTrack(track.id)}
        onMouseLeave={() => setHoveredTrack(null)}
      >
        <div className={styles.trackName}>
          {track.name}
        </div>
        <span className={styles.trackType}>{track.busType}</span>

        {renderFader(track)}
        {renderMeter(track)}
        {renderPan(track)}

        {!isMaster && (
          <div className={styles.controlButtons}>
            <button
              className={`${styles.muteBtn} ${track.mute ? styles.muteBtnActive : ""}`}
              data-testid={`mixer-mute-${track.id}`}
              onClick={() => handleMute(track)}
            >
              M
            </button>
            <button
              className={`${styles.soloBtn} ${track.solo ? styles.soloBtnActive : ""}`}
              data-testid={`mixer-solo-${track.id}`}
              onClick={() => handleSolo(track)}
            >
              S
            </button>
          </div>
        )}

        {isMaster && (
          <div className={styles.controlButtons}>
            <span style={{ fontSize: "9px", color: "var(--text-muted)" }}>MASTER</span>
          </div>
        )}

        <div style={{ position: "relative", width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
          {renderFXSlots(track)}
          {isEditingFX && track.fxChain.slots.map((slot) => renderFXEditor(track, slot))}
        </div>

        {renderSendSection(track)}
      </div>
    );
  };

  return (
    <div className={styles.mixerConsole} data-testid="mixer-console">
      <div className={styles.mixerHeader}>
        <span className={styles.mixerTitle}>{t('mixer.title')}</span>
        <span className={styles.mixerSubtitle}>
          {t('mixer.trackCount', { count: mixer.tracks.length })}
        </span>
        <button className={styles.addTrackBtn} data-testid="mixer-add-track" onClick={handleAddTrackClick}>
          {t('mixer.addTrack')}
        </button>
      </div>

      <div className={styles.stripsContainer} data-testid="mixer-strips" ref={containerRef}>
        {allTracks.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>🎛</span>
            <span>{t('mixer.noTracks')}</span>
            <button
              className={styles.addTrackBtn}
              onClick={handleAddTrackClick}
              style={{ marginLeft: 0 }}
            >
              {t('mixer.addFirstTrack')}
            </button>
          </div>
        ) : (
          <>
            {mixer.tracks.map((track) => renderChannelStrip(track, false))}
            {renderChannelStrip(mixer.masterTrack, true)}
          </>
        )}
      </div>

      {showAddModal && (
        <>
          <div className={styles.modalBackdrop} onClick={() => setShowAddModal(false)} />
          <div className={styles.addTrackModal}>
            <div className={styles.modalTitle}>{t('mixer.addTrackModal')}</div>
            <div className={styles.modalRow}>
              <label className={styles.modalLabel}>{t('mixer.trackName')}</label>
              <input
                className={styles.modalInput}
                value={newTrackName}
                onChange={(e) => setNewTrackName(e.target.value)}
                placeholder={t('mixer.trackNamePlaceholder')}
                autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirmAdd(); }}
              />
            </div>
            <div className={styles.modalRow}>
              <label className={styles.modalLabel}>{t('mixer.sourceId')}</label>
              <input
                className={styles.modalInput}
                value={newTrackSource}
                onChange={(e) => setNewTrackSource(e.target.value)}
                placeholder={t('mixer.sourceIdPlaceholder')}
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirmAdd(); }}
              />
            </div>
            <div className={styles.modalButtons}>
              <button
                className={`${styles.modalBtn} ${styles.modalBtnCancel}`}
                onClick={() => setShowAddModal(false)}
              >
                {t('common.cancel')}
              </button>
              <button
                className={`${styles.modalBtn} ${styles.modalBtnPrimary}`}
                onClick={handleConfirmAdd}
                disabled={!newTrackName.trim() || !newTrackSource.trim()}
              >
                {t('common.add')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
