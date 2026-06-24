import React, { useState, useCallback } from "react";
import type { MidiEffectInfo, MidiEffectParam } from "./types";
import styles from "./MidiEffectCard.module.css";

export interface MidiEffectCardProps {
  effect: MidiEffectInfo;
  isSelected?: boolean;
  onSelect?: (id: number) => void;
  onToggleBypass?: (id: number) => void;
  onRemove?: (id: number) => void;
  onParamChange?: (effectId: number, paramIndex: number, value: number) => void;
  onDragStart?: (id: number) => void;
  onDragOver?: (e: React.DragEvent, id: number) => void;
  onDrop?: (id: number) => void;
}

export const MidiEffectCard: React.FC<MidiEffectCardProps> = ({
  effect,
  isSelected = false,
  onSelect,
  onToggleBypass,
  onRemove,
  onParamChange,
  onDragStart,
  onDragOver,
  onDrop,
}) => {
  const [expanded, setExpanded] = useState(false);

  const handleClick = useCallback(() => {
    onSelect?.(effect.id);
  }, [effect.id, onSelect]);

  const handleToggleBypass = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleBypass?.(effect.id);
    },
    [effect.id, onToggleBypass],
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemove?.(effect.id);
    },
    [effect.id, onRemove],
  );

  const handleToggleExpand = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpanded((prev) => !prev);
    },
    [],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move";
      onDragStart?.(effect.id);
    },
    [effect.id, onDragStart],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      onDragOver?.(e, effect.id);
    },
    [effect.id, onDragOver],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDrop?.(effect.id);
    },
    [effect.id, onDrop],
  );

  const handleParamChange = useCallback(
    (paramIndex: number, value: number) => {
      onParamChange?.(effect.id, paramIndex, value);
    },
    [effect.id, onParamChange],
  );

  const channelLabel = effect.midiChannel === 0 ? "All" : `Ch${effect.midiChannel}`;

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.cardSelected : ""} ${effect.bypassed ? styles.cardBypassed : ""}`}
      onClick={handleClick}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className={styles.cardHeader}>
        <span className={styles.dragHandle}>⋮⋮</span>
        <span className={styles.effectName}>{effect.name}</span>
        <span className={styles.channelBadge}>{channelLabel}</span>
        <div className={styles.cardActions}>
          <button
            className={`${styles.actionBtn} ${effect.bypassed ? styles.bypassBtnActive : ""}`}
            onClick={handleToggleBypass}
            title={effect.bypassed ? "Enable" : "Bypass"}
          >
            {effect.bypassed ? "⊙" : "⊘"}
          </button>
          <button
            className={styles.actionBtn}
            onClick={handleToggleExpand}
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? "▴" : "▾"}
          </button>
          <button
            className={`${styles.actionBtn} ${styles.removeBtn}`}
            onClick={handleRemove}
            title="Remove"
          >
            ✕
          </button>
        </div>
      </div>

      <div className={styles.statusRow}>
        <span className={`${styles.statusDot} ${effect.active ? styles.statusDotActive : styles.statusDotInactive}`} />
        <span className={styles.statusText}>
          {effect.bypassed ? "Bypassed" : effect.active ? "Active" : "Inactive"}
        </span>
      </div>

      {expanded && effect.params.length > 0 && (
        <div className={styles.paramSection}>
          {effect.params.map((param) => (
            <ParamSlider
              key={param.index}
              param={param}
              effectId={effect.id}
              onChange={handleParamChange}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface ParamSliderProps {
  param: MidiEffectParam;
  effectId: number;
  onChange: (paramIndex: number, value: number) => void;
}

const ParamSlider: React.FC<ParamSliderProps> = ({ param, onChange }) => {
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(param.index, parseFloat(e.target.value));
    },
    [param.index, onChange],
  );

  const min = param.min ?? 0;
  const max = param.max ?? 1;
  const step = param.step ?? 0.01;

  return (
    <div className={styles.paramRow}>
      <div className={styles.paramLabel}>
        <span>{param.name}</span>
        <span className={styles.paramValue}>
          {param.displayText || `${param.value.toFixed(2)}${param.unit ?? ""}`}
        </span>
      </div>
      <input
        type="range"
        className={styles.paramSlider}
        min={min}
        max={max}
        step={step}
        value={param.value}
        onChange={handleChange}
      />
    </div>
  );
};
