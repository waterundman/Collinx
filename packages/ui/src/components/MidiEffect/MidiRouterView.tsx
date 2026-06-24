import React, { useState, useCallback, useMemo } from "react";
import type { MidiRouterState, ChannelMapping, ControllerMapping } from "./types";
import { MIDI_CHANNELS, MIDI_CC_NAMES } from "./types";
import styles from "./MidiRouterView.module.css";

export interface MidiRouterViewProps {
  router: MidiRouterState;
  onSetChannelMapping?: (inputChannel: number, outputChannel: number) => void;
  onClearChannelMapping?: (inputChannel: number) => void;
  onClearAllChannelMappings?: () => void;
  onMapController?: (inputCC: number, outputCC: number, channel: number) => void;
  onUnmapController?: (inputCC: number, channel: number) => void;
  onClearAllControllerMappings?: () => void;
  onToggleFilter?: (filter: keyof Pick<MidiRouterState, "filterNoteOn" | "filterNoteOff" | "filterControlChange" | "filterProgramChange" | "filterPitchBend" | "filterAftertouch" | "filterSysEx">) => void;
  onAddOutput?: (outputId: number) => void;
  onRemoveOutput?: (outputId: number) => void;
}

const FILTER_LABELS: Record<string, string> = {
  filterNoteOn: "Note On",
  filterNoteOff: "Note Off",
  filterControlChange: "CC",
  filterProgramChange: "PC",
  filterPitchBend: "Pitch Bend",
  filterAftertouch: "Aftertouch",
  filterSysEx: "SysEx",
};

export const MidiRouterView: React.FC<MidiRouterViewProps> = ({
  router,
  onSetChannelMapping,
  onClearChannelMapping,
  onClearAllChannelMappings,
  onMapController,
  onUnmapController,
  onClearAllControllerMappings,
  onToggleFilter,
  onAddOutput,
  onRemoveOutput,
}) => {
  const [activeTab, setActiveTab] = useState<"channels" | "controllers" | "filters" | "outputs">("channels");
  const [newInputCC, setNewInputCC] = useState(1);
  const [newOutputCC, setNewOutputCC] = useState(11);
  const [newCCChannel, setNewCCChannel] = useState(0);
  const [newOutputId, setNewOutputId] = useState(1);

  const channelMappingMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of router.channelMappings) {
      map.set(m.inputChannel, m.outputChannel);
    }
    return map;
  }, [router.channelMappings]);

  const handleChannelChange = useCallback(
    (inputChannel: number, outputChannel: number) => {
      if (outputChannel === 0) {
        onClearChannelMapping?.(inputChannel);
      } else {
        onSetChannelMapping?.(inputChannel, outputChannel);
      }
    },
    [onSetChannelMapping, onClearChannelMapping],
  );

  const handleAddCCMapping = useCallback(() => {
    onMapController?.(newInputCC, newOutputCC, newCCChannel);
  }, [newInputCC, newOutputCC, newCCChannel, onMapController]);

  const handleAddOutput = useCallback(() => {
    onAddOutput?.(newOutputId);
  }, [newOutputId, onAddOutput]);

  const getCCName = (cc: number): string => MIDI_CC_NAMES[cc] ?? `CC${cc}`;

  return (
    <div className={styles.routerView}>
      <div className={styles.header}>
        <span className={styles.title}>MIDI Router</span>
        <span className={styles.subtitle}>
          {router.isPrepared ? "Ready" : "Not prepared"}
        </span>
      </div>

      <div className={styles.tabBar}>
        {(["channels", "controllers", "filters", "outputs"] as const).map((tab) => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {activeTab === "channels" && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Channel Mapping</span>
              {router.channelMappings.length > 0 && (
                <button
                  className={styles.clearBtn}
                  onClick={onClearAllChannelMappings}
                >
                  Clear All
                </button>
              )}
            </div>
            <div className={styles.channelGrid}>
              {MIDI_CHANNELS.map((ch) => {
                const mapped = channelMappingMap.get(ch);
                return (
                  <div key={ch} className={styles.channelRow}>
                    <span className={styles.chLabel}>Ch {ch}</span>
                    <span className={styles.chArrow}>→</span>
                    <select
                      className={styles.chSelect}
                      value={mapped ?? ch}
                      onChange={(e) => handleChannelChange(ch, parseInt(e.target.value))}
                    >
                      <option value={ch}>Ch {ch} (thru)</option>
                      {MIDI_CHANNELS.map((out) => (
                        <option key={out} value={out}>
                          Ch {out}
                        </option>
                      ))}
                    </select>
                    {mapped !== undefined && mapped !== ch && (
                      <button
                        className={styles.chClearBtn}
                        onClick={() => onClearChannelMapping?.(ch)}
                        title="Reset to pass-through"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "controllers" && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Controller Mapping</span>
              {router.controllerMappings.length > 0 && (
                <button
                  className={styles.clearBtn}
                  onClick={onClearAllControllerMappings}
                >
                  Clear All
                </button>
              )}
            </div>

            <div className={styles.ccAddRow}>
              <div className={styles.ccInputGroup}>
                <label className={styles.ccLabel}>In CC</label>
                <input
                  type="number"
                  className={styles.ccInput}
                  min={0}
                  max={127}
                  value={newInputCC}
                  onChange={(e) => setNewInputCC(parseInt(e.target.value) || 0)}
                />
                <span className={styles.ccName}>{getCCName(newInputCC)}</span>
              </div>
              <span className={styles.ccArrow}>→</span>
              <div className={styles.ccInputGroup}>
                <label className={styles.ccLabel}>Out CC</label>
                <input
                  type="number"
                  className={styles.ccInput}
                  min={0}
                  max={127}
                  value={newOutputCC}
                  onChange={(e) => setNewOutputCC(parseInt(e.target.value) || 0)}
                />
                <span className={styles.ccName}>{getCCName(newOutputCC)}</span>
              </div>
              <div className={styles.ccInputGroup}>
                <label className={styles.ccLabel}>Ch</label>
                <select
                  className={styles.ccInput}
                  value={newCCChannel}
                  onChange={(e) => setNewCCChannel(parseInt(e.target.value))}
                >
                  <option value={0}>All</option>
                  {MIDI_CHANNELS.map((ch) => (
                    <option key={ch} value={ch}>{ch}</option>
                  ))}
                </select>
              </div>
              <button className={styles.ccAddBtn} onClick={handleAddCCMapping}>
                +
              </button>
            </div>

            {router.controllerMappings.length === 0 ? (
              <div className={styles.emptySection}>No controller mappings</div>
            ) : (
              <div className={styles.ccList}>
                {router.controllerMappings.map((m, idx) => (
                  <div key={idx} className={styles.ccItem}>
                    <span className={styles.ccItemText}>
                      {m.channel > 0 ? `Ch${m.channel} ` : ""}
                      {getCCName(m.inputCC)} → {getCCName(m.outputCC)}
                    </span>
                    <button
                      className={styles.ccRemoveBtn}
                      onClick={() => onUnmapController?.(m.inputCC, m.channel)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "filters" && (
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Message Filters</span>
            <p className={styles.filterNote}>
              Toggled filters will be <strong>blocked</strong> (filtered out).
            </p>
            <div className={styles.filterGrid}>
              {(Object.keys(FILTER_LABELS) as Array<keyof typeof FILTER_LABELS>).map((key) => {
                const isFiltered = router[key as keyof MidiRouterState] as boolean;
                return (
                  <button
                    key={key}
                    className={`${styles.filterBtn} ${isFiltered ? styles.filterBtnActive : ""}`}
                    onClick={() => onToggleFilter?.(key as keyof Pick<MidiRouterState, "filterNoteOn" | "filterNoteOff" | "filterControlChange" | "filterProgramChange" | "filterPitchBend" | "filterAftertouch" | "filterSysEx">)}
                  >
                    <span className={styles.filterDot} />
                    <span>{FILTER_LABELS[key]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "outputs" && (
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Output Destinations</span>
            </div>

            <div className={styles.outputAddRow}>
              <input
                type="number"
                className={styles.ccInput}
                min={1}
                value={newOutputId}
                onChange={(e) => setNewOutputId(parseInt(e.target.value) || 1)}
                placeholder="Output ID"
              />
              <button className={styles.ccAddBtn} onClick={handleAddOutput}>
                + Add Output
              </button>
            </div>

            {router.outputIds.length === 0 ? (
              <div className={styles.emptySection}>No outputs configured</div>
            ) : (
              <div className={styles.outputList}>
                {router.outputIds.map((id) => (
                  <div key={id} className={styles.outputItem}>
                    <span className={styles.outputDot} />
                    <span className={styles.outputLabel}>Output #{id}</span>
                    <button
                      className={styles.ccRemoveBtn}
                      onClick={() => onRemoveOutput?.(id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
