import React, { useState, useCallback, useMemo } from "react";
import type { MidiEffectChainState, MidiEffectInfo, MidiEffectType } from "./types";
import { MIDI_EFFECT_TYPES } from "./types";
import { MidiEffectCard } from "./MidiEffectCard";
import styles from "./MidiEffectPanel.module.css";

export interface MidiEffectPanelProps {
  chain: MidiEffectChainState;
  onAddEffect?: (effectType: MidiEffectType) => void;
  onRemoveEffect?: (effectId: number) => void;
  onToggleBypass?: (effectId: number) => void;
  onToggleChainBypass?: () => void;
  onMoveEffect?: (fromIndex: number, toIndex: number) => void;
  onParamChange?: (effectId: number, paramIndex: number, value: number) => void;
  onSelectEffect?: (effectId: number | null) => void;
}

export const MidiEffectPanel: React.FC<MidiEffectPanelProps> = ({
  chain,
  onAddEffect,
  onRemoveEffect,
  onToggleBypass,
  onToggleChainBypass,
  onMoveEffect,
  onParamChange,
  onSelectEffect,
}) => {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const handleSelect = useCallback(
    (id: number) => {
      const newId = selectedId === id ? null : id;
      setSelectedId(newId);
      onSelectEffect?.(newId);
    },
    [selectedId, onSelectEffect],
  );

  const handleDragStart = useCallback(
    (id: number) => {
      const idx = chain.effects.findIndex((e) => e.id === id);
      if (idx >= 0) setDragIndex(idx);
    },
    [chain.effects],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, id: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    },
    [],
  );

  const handleDrop = useCallback(
    (id: number) => {
      if (dragIndex === null) return;
      const toIndex = chain.effects.findIndex((e) => e.id === id);
      if (toIndex >= 0 && toIndex !== dragIndex) {
        onMoveEffect?.(dragIndex, toIndex);
      }
      setDragIndex(null);
    },
    [dragIndex, chain.effects, onMoveEffect],
  );

  const handleAddClick = useCallback(() => {
    setShowAddMenu((prev) => !prev);
  }, []);

  const handleAddEffectType = useCallback(
    (effectType: MidiEffectType) => {
      onAddEffect?.(effectType);
      setShowAddMenu(false);
    },
    [onAddEffect],
  );

  const activeCount = useMemo(
    () => chain.effects.filter((e) => !e.bypassed).length,
    [chain.effects],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>MIDI Effects</span>
        <span className={styles.panelSubtitle}>
          {chain.effects.length} effect{chain.effects.length !== 1 ? "s" : ""}
          {activeCount < chain.effects.length && ` (${activeCount} active)`}
        </span>
        <div className={styles.headerActions}>
          <button
            className={`${styles.chainBypassBtn} ${chain.chainBypassed ? styles.chainBypassBtnActive : ""}`}
            onClick={onToggleChainBypass}
            title={chain.chainBypassed ? "Enable chain" : "Bypass chain"}
          >
            {chain.chainBypassed ? "⊙ Chain" : "⊘ Chain"}
          </button>
          <button className={styles.addBtn} onClick={handleAddClick} title="Add MIDI effect">
            + Add
          </button>
        </div>
      </div>

      {showAddMenu && (
        <div className={styles.addMenu}>
          {MIDI_EFFECT_TYPES.map((type) => (
            <button
              key={type.id}
              className={styles.addMenuItem}
              onClick={() => handleAddEffectType(type)}
            >
              <span className={styles.addMenuName}>{type.name}</span>
              <span className={styles.addMenuDesc}>{type.description}</span>
            </button>
          ))}
        </div>
      )}

      <div className={styles.chainContainer}>
        {chain.effects.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>🎵</span>
            <span className={styles.emptyText}>No MIDI effects</span>
            <button className={styles.emptyAddBtn} onClick={handleAddClick}>
              + Add Effect
            </button>
          </div>
        ) : (
          <div className={styles.effectList}>
            {chain.effects.map((effect) => (
              <MidiEffectCard
                key={effect.id}
                effect={effect}
                isSelected={selectedId === effect.id}
                onSelect={handleSelect}
                onToggleBypass={onToggleBypass}
                onRemove={onRemoveEffect}
                onParamChange={onParamChange}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              />
            ))}
          </div>
        )}

        {chain.effects.length > 0 && (
          <div className={styles.chainFlow}>
            <span className={styles.flowLabel}>Signal Flow</span>
            <div className={styles.flowPath}>
              <span className={styles.flowNode}>IN</span>
              {chain.effects.map((effect, idx) => (
                <React.Fragment key={effect.id}>
                  <span className={styles.flowArrow}>→</span>
                  <span
                    className={`${styles.flowNode} ${effect.bypassed ? styles.flowNodeBypassed : ""}`}
                  >
                    {effect.name.slice(0, 4)}
                  </span>
                </React.Fragment>
              ))}
              <span className={styles.flowArrow}>→</span>
              <span className={styles.flowNode}>OUT</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
