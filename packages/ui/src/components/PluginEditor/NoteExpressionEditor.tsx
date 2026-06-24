import React, { useState, useCallback, useMemo } from "react";
import styles from "./NoteExpressionEditor.module.css";

interface NoteExpression {
  noteId: number;
  pitch: number;
  pressure: number;
  slide: number;
  releaseVelocity: number;
}

interface MPEConfig {
  channel: number;
  pitchBendRange: number;
  notePitchBend: number;
  pressure: number;
  slide: number;
}

interface NoteExpressionEditorProps {
  noteId?: number;
  initialExpression?: NoteExpression;
  mpeEnabled?: boolean;
  onExpressionChange?: (expression: NoteExpression) => void;
  onMPEConfigChange?: (config: MPEConfig) => void;
}

const defaultExpression: NoteExpression = {
  noteId: 0,
  pitch: 0,
  pressure: 0,
  slide: 0,
  releaseVelocity: 0,
};

const defaultMPEConfig: MPEConfig = {
  channel: 1,
  pitchBendRange: 48,
  notePitchBend: 0,
  pressure: 0,
  slide: 0,
};

export const NoteExpressionEditor: React.FC<NoteExpressionEditorProps> = ({
  noteId = 0,
  initialExpression,
  mpeEnabled = false,
  onExpressionChange,
  onMPEConfigChange,
}) => {
  const [expression, setExpression] = useState<NoteExpression>(
    initialExpression ?? { ...defaultExpression, noteId }
  );
  const [mpeConfig, setMpeConfig] = useState<MPEConfig>(defaultMPEConfig);
  const [activeTab, setActiveTab] = useState<"expression" | "mpe" | "aftertouch">("expression");
  const [aftertouchChannel, setAftertouchChannel] = useState(0);
  const [aftertouchValue, setAftertouchValue] = useState(0);
  const [polyAftertouch, setPolyAftertouch] = useState<Map<number, number>>(new Map());

  const handleExpressionChange = useCallback(
    (field: keyof NoteExpression, value: number) => {
      setExpression((prev) => {
        const next = { ...prev, [field]: value };
        onExpressionChange?.(next);
        return next;
      });
    },
    [onExpressionChange]
  );

  const handleMPEChange = useCallback(
    (field: keyof MPEConfig, value: number) => {
      setMpeConfig((prev) => {
        const next = { ...prev, [field]: value };
        onMPEConfigChange?.(next);
        return next;
      });
    },
    [onMPEConfigChange]
  );

  const handleAftertouchChange = useCallback(
    (noteNum: number, value: number) => {
      setPolyAftertouch((prev) => {
        const next = new Map(prev);
        next.set(noteNum, value);
        return next;
      });
    },
    []
  );

  const expressionFields = useMemo(
    () => [
      { key: "pitch" as const, label: "Pitch Bend", min: -1, max: 1, step: 0.01 },
      { key: "pressure" as const, label: "Pressure", min: 0, max: 1, step: 0.01 },
      { key: "slide" as const, label: "Slide", min: 0, max: 1, step: 0.01 },
      { key: "releaseVelocity" as const, label: "Release Velocity", min: 0, max: 1, step: 0.01 },
    ],
    []
  );

  const mpeFields = useMemo(
    () => [
      { key: "channel" as const, label: "Channel", min: 1, max: 16, step: 1 },
      { key: "pitchBendRange" as const, label: "Pitch Bend Range", min: 0, max: 96, step: 1 },
      { key: "notePitchBend" as const, label: "Note Pitch Bend", min: -1, max: 1, step: 0.01 },
      { key: "pressure" as const, label: "Pressure", min: 0, max: 1, step: 0.01 },
      { key: "slide" as const, label: "Slide", min: 0, max: 1, step: 0.01 },
    ],
    []
  );

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <span className={styles.title}>Note Expression</span>
        <span className={styles.noteId}>Note #{noteId}</span>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === "expression" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("expression")}
        >
          Expression
        </button>
        <button
          className={`${styles.tab} ${activeTab === "mpe" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("mpe")}
          disabled={!mpeEnabled}
        >
          MPE
        </button>
        <button
          className={`${styles.tab} ${activeTab === "aftertouch" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("aftertouch")}
        >
          Aftertouch
        </button>
      </div>

      <div className={styles.content}>
        {activeTab === "expression" && (
          <div className={styles.expressionPanel}>
            {expressionFields.map((field) => (
              <div key={field.key} className={styles.expressionItem}>
                <div className={styles.expressionItemHeader}>
                  <span className={styles.expressionLabel}>{field.label}</span>
                  <span className={styles.expressionValue}>
                    {expression[field.key].toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  className={styles.expressionSlider}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={expression[field.key]}
                  onChange={(e) =>
                    handleExpressionChange(field.key, parseFloat(e.target.value))
                  }
                />
                <div className={styles.expressionRange}>
                  <span>{field.min}</span>
                  <span>{field.max}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "mpe" && (
          <div className={styles.mpePanel}>
            <div className={styles.mpeStatus}>
              <span className={styles.mpeStatusIndicator} />
              <span className={styles.mpeStatusText}>MPE Active</span>
            </div>
            {mpeFields.map((field) => (
              <div key={field.key} className={styles.mpeItem}>
                <div className={styles.mpeItemHeader}>
                  <span className={styles.mpeLabel}>{field.label}</span>
                  <span className={styles.mpeValue}>
                    {mpeConfig[field.key].toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  className={styles.mpeSlider}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={mpeConfig[field.key]}
                  onChange={(e) =>
                    handleMPEChange(field.key, parseFloat(e.target.value))
                  }
                />
              </div>
            ))}
          </div>
        )}

        {activeTab === "aftertouch" && (
          <div className={styles.aftertouchPanel}>
            <div className={styles.aftertouchSection}>
              <span className={styles.aftertouchSectionTitle}>Channel Aftertouch</span>
              <div className={styles.aftertouchItem}>
                <div className={styles.aftertouchItemHeader}>
                  <span className={styles.aftertouchLabel}>Channel</span>
                  <span className={styles.aftertouchValue}>{aftertouchChannel}</span>
                </div>
                <input
                  type="range"
                  className={styles.aftertouchSlider}
                  min={0}
                  max={15}
                  step={1}
                  value={aftertouchChannel}
                  onChange={(e) => setAftertouchChannel(parseInt(e.target.value))}
                />
              </div>
              <div className={styles.aftertouchItem}>
                <div className={styles.aftertouchItemHeader}>
                  <span className={styles.aftertouchLabel}>Pressure</span>
                  <span className={styles.aftertouchValue}>
                    {aftertouchValue.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  className={styles.aftertouchSlider}
                  min={0}
                  max={1}
                  step={0.01}
                  value={aftertouchValue}
                  onChange={(e) => setAftertouchValue(parseFloat(e.target.value))}
                />
              </div>
            </div>

            <div className={styles.aftertouchSection}>
              <span className={styles.aftertouchSectionTitle}>Polyphonic Aftertouch</span>
              <div className={styles.polyAftertouchGrid}>
                {Array.from({ length: 128 }, (_, i) => i).map((noteNum) => (
                  <div
                    key={noteNum}
                    className={styles.polyAftertouchCell}
                    style={{
                      opacity: (polyAftertouch.get(noteNum) ?? 0) * 0.8 + 0.2,
                    }}
                    onClick={() =>
                      handleAftertouchChange(
                        noteNum,
                        polyAftertouch.get(noteNum) === 1 ? 0 : 1
                      )
                    }
                  >
                    <span className={styles.polyAftertouchNoteNum}>{noteNum}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};