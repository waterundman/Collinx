import React, { useState, useCallback, useMemo } from "react";
import type { Vst3Parameter } from "../../services/Vst3HostService";
import styles from "./PluginParamEditor.module.css";

interface AutomationPoint {
  time: number;
  value: number;
}

interface ParamMapping {
  sourceParamId: number;
  targetParamId: number;
  min: number;
  max: number;
  curve: "linear" | "exponential" | "logarithmic";
}

interface ParamPreset {
  id: string;
  name: string;
  values: Record<number, number>;
}

interface PluginParamEditorProps {
  parameters: Vst3Parameter[];
  onParameterChange: (paramId: number, value: number) => void;
  onAutomationChange?: (paramId: number, points: AutomationPoint[]) => void;
  onMappingChange?: (mapping: ParamMapping) => void;
  onPresetSave?: (preset: ParamPreset) => void;
  onPresetLoad?: (preset: ParamPreset) => void;
}

export const PluginParamEditor: React.FC<PluginParamEditorProps> = ({
  parameters,
  onParameterChange,
  onAutomationChange,
  onMappingChange,
  onPresetSave,
  onPresetLoad,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedParamId, setSelectedParamId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<"params" | "automation" | "mapping" | "presets">("params");
  const [automationPoints, setAutomationPoints] = useState<Map<number, AutomationPoint[]>>(new Map());
  const [mappings, setMappings] = useState<ParamMapping[]>([]);
  const [presets, setPresets] = useState<ParamPreset[]>([]);
  const [presetName, setPresetName] = useState("");

  const filteredParams = useMemo(() => {
    if (!searchQuery) return parameters;
    const query = searchQuery.toLowerCase();
    return parameters.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.label.toLowerCase().includes(query)
    );
  }, [parameters, searchQuery]);

  const selectedParam = useMemo(
    () => parameters.find((p) => p.id === selectedParamId),
    [parameters, selectedParamId]
  );

  const handleParamClick = useCallback((paramId: number) => {
    setSelectedParamId((prev) => (prev === paramId ? null : paramId));
  }, []);

  const handleAddAutomationPoint = useCallback(
    (paramId: number) => {
      setAutomationPoints((prev) => {
        const next = new Map(prev);
        const points = next.get(paramId) ?? [];
        const newPoint: AutomationPoint = {
          time: points.length,
          value: 0.5,
        };
        next.set(paramId, [...points, newPoint]);
        onAutomationChange?.(paramId, next.get(paramId)!);
        return next;
      });
    },
    [onAutomationChange]
  );

  const handleRemoveAutomationPoint = useCallback(
    (paramId: number, index: number) => {
      setAutomationPoints((prev) => {
        const next = new Map(prev);
        const points = next.get(paramId) ?? [];
        next.set(paramId, points.filter((_, i) => i !== index));
        onAutomationChange?.(paramId, next.get(paramId)!);
        return next;
      });
    },
    [onAutomationChange]
  );

  const handleAddMapping = useCallback(() => {
    if (!selectedParamId || parameters.length < 2) return;

    const targetParam = parameters.find((p) => p.id !== selectedParamId);
    if (!targetParam) return;

    const newMapping: ParamMapping = {
      sourceParamId: selectedParamId,
      targetParamId: targetParam.id,
      min: 0,
      max: 1,
      curve: "linear",
    };

    setMappings((prev) => [...prev, newMapping]);
    onMappingChange?.(newMapping);
  }, [selectedParamId, parameters, onMappingChange]);

  const handleRemoveMapping = useCallback((index: number) => {
    setMappings((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSavePreset = useCallback(() => {
    if (!presetName) return;

    const values: Record<number, number> = {};
    parameters.forEach((p) => {
      values[p.id] = p.value;
    });

    const preset: ParamPreset = {
      id: Date.now().toString(),
      name: presetName,
      values,
    };

    setPresets((prev) => [...prev, preset]);
    onPresetSave?.(preset);
    setPresetName("");
  }, [presetName, parameters, onPresetSave]);

  const handleLoadPreset = useCallback(
    (preset: ParamPreset) => {
      Object.entries(preset.values).forEach(([paramId, value]) => {
        onParameterChange(parseInt(paramId), value);
      });
      onPresetLoad?.(preset);
    },
    [onParameterChange, onPresetLoad]
  );

  const handleDeletePreset = useCallback((presetId: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== presetId));
  }, []);

  const getParamById = useCallback(
    (id: number) => parameters.find((p) => p.id === id),
    [parameters]
  );

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <div className={styles.searchContainer}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search parameters..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <span className={styles.searchCount}>
            {filteredParams.length}/{parameters.length}
          </span>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === "params" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("params")}
          >
            Params
          </button>
          <button
            className={`${styles.tab} ${activeTab === "automation" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("automation")}
          >
            Auto
          </button>
          <button
            className={`${styles.tab} ${activeTab === "mapping" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("mapping")}
          >
            Map
          </button>
          <button
            className={`${styles.tab} ${activeTab === "presets" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("presets")}
          >
            Presets
          </button>
        </div>
      </div>

      <div className={styles.content}>
        {activeTab === "params" && (
          <div className={styles.paramList}>
            {filteredParams.map((param) => (
              <div
                key={param.id}
                className={`${styles.paramItem} ${
                  selectedParamId === param.id ? styles.paramItemSelected : ""
                }`}
                onClick={() => handleParamClick(param.id)}
              >
                <div className={styles.paramItemHeader}>
                  <span className={styles.paramItemName}>{param.label}</span>
                  <span className={styles.paramItemValue}>{param.value.toFixed(3)}</span>
                </div>
                <input
                  type="range"
                  className={styles.paramSlider}
                  min={param.minValue}
                  max={param.maxValue}
                  step={param.step}
                  value={param.value}
                  onChange={(e) => {
                    e.stopPropagation();
                    onParameterChange(param.id, parseFloat(e.target.value));
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <div className={styles.paramItemMeta}>
                  <span className={styles.paramItemRange}>
                    {param.minValue.toFixed(1)} - {param.maxValue.toFixed(1)}
                  </span>
                  {param.isAutomatable && (
                    <span className={styles.paramItemAuto}>Auto</span>
                  )}
                  <button
                    className={styles.paramResetBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      onParameterChange(param.id, param.defaultValue);
                    }}
                    title="Reset to default"
                  >
                    Reset
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "automation" && (
          <div className={styles.automationPanel}>
            {selectedParam ? (
              <>
                <div className={styles.automationHeader}>
                  <span className={styles.automationTitle}>
                    Automation: {selectedParam.label}
                  </span>
                  <button
                    className={styles.automationAddBtn}
                    onClick={() => handleAddAutomationPoint(selectedParam.id)}
                  >
                    + Add Point
                  </button>
                </div>
                <div className={styles.automationTimeline}>
                  <div className={styles.timelineGrid}>
                    {(automationPoints.get(selectedParam.id) ?? []).map((point, index) => (
                      <div
                        key={index}
                        className={styles.automationPoint}
                        style={{ left: `${(point.time / 10) * 100}%`, bottom: `${point.value * 100}%` }}
                      >
                        <div className={styles.pointDot} />
                        <div className={styles.pointTooltip}>
                          T:{point.time.toFixed(1)} V:{point.value.toFixed(2)}
                        </div>
                        <button
                          className={styles.pointDelete}
                          onClick={() => handleRemoveAutomationPoint(selectedParam.id, index)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={styles.automationInfo}>
                  <span>{automationPoints.get(selectedParam.id)?.length ?? 0} points</span>
                </div>
              </>
            ) : (
              <div className={styles.automationEmpty}>
                <span>Select a parameter to edit automation</span>
              </div>
            )}
          </div>
        )}

        {activeTab === "mapping" && (
          <div className={styles.mappingPanel}>
            <div className={styles.mappingHeader}>
              <span className={styles.mappingTitle}>Parameter Mappings</span>
              <button
                className={styles.mappingAddBtn}
                onClick={handleAddMapping}
                disabled={!selectedParamId}
              >
                + Add Mapping
              </button>
            </div>
            <div className={styles.mappingList}>
              {mappings.length === 0 ? (
                <div className={styles.mappingEmpty}>
                  <span>No mappings configured</span>
                </div>
              ) : (
                mappings.map((mapping, index) => {
                  const source = getParamById(mapping.sourceParamId);
                  const target = getParamById(mapping.targetParamId);
                  return (
                    <div key={index} className={styles.mappingItem}>
                      <div className={styles.mappingItemHeader}>
                        <span className={styles.mappingSource}>{source?.label ?? "?"}</span>
                        <span className={styles.mappingArrow}>→</span>
                        <span className={styles.mappingTarget}>{target?.label ?? "?"}</span>
                        <button
                          className={styles.mappingDelete}
                          onClick={() => handleRemoveMapping(index)}
                        >
                          ×
                        </button>
                      </div>
                      <div className={styles.mappingConfig}>
                        <select
                          className={styles.mappingCurve}
                          value={mapping.curve}
                          onChange={(e) => {
                            const updated = { ...mapping, curve: e.target.value as ParamMapping["curve"] };
                            setMappings((prev) =>
                              prev.map((m, i) => (i === index ? updated : m))
                            );
                          }}
                        >
                          <option value="linear">Linear</option>
                          <option value="exponential">Exponential</option>
                          <option value="logarithmic">Logarithmic</option>
                        </select>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === "presets" && (
          <div className={styles.presetsPanel}>
            <div className={styles.presetsHeader}>
              <input
                type="text"
                className={styles.presetNameInput}
                placeholder="Preset name..."
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
              <button
                className={styles.presetSaveBtn}
                onClick={handleSavePreset}
                disabled={!presetName}
              >
                Save
              </button>
            </div>
            <div className={styles.presetList}>
              {presets.length === 0 ? (
                <div className={styles.presetEmpty}>
                  <span>No presets saved</span>
                </div>
              ) : (
                presets.map((preset) => (
                  <div key={preset.id} className={styles.presetItem}>
                    <span className={styles.presetItemName}>{preset.name}</span>
                    <div className={styles.presetItemActions}>
                      <button
                        className={styles.presetLoadBtn}
                        onClick={() => handleLoadPreset(preset)}
                      >
                        Load
                      </button>
                      <button
                        className={styles.presetDeleteBtn}
                        onClick={() => handleDeletePreset(preset.id)}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
