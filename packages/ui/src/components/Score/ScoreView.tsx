/**
 * ⚠️ 已被 `ScoreRenderer` 取代（v2.9.2 审计）。
 *
 * 这是 v1.x 的 VexFlow 直出版本：单页、无分页/系统规划/播放头/小节锚点。
 * `ScorePanel → ScoreRenderer`（511 行）已覆盖其全部能力并多出分页与小节点击定位，
 * 因此本文件在生产代码里零引用。
 *
 * 保留而非删除：v2.8.0 曾按「零引用」误删规格内交付物。删除前需在 Obsidian
 * 规格库确认它不是某次 Stage 的验收物；确认后应整体删除（不要只摘 import）。
 */
import React, { useRef, useEffect } from "react";
import { NoteEvent, TempoMap } from "@collinx/core";

interface ScoreViewProps {
  notes: NoteEvent[];
  tempoMap: TempoMap;
  viewType: "full_score" | "part";
  staves?: { clef: "treble" | "bass" | "alto" | "tenor"; name: string }[];
}

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function midiKey(midi: number): string {
  const idx = ((midi % 12) + 12) % 12;
  const oct = Math.floor(midi / 12) - 4;
  return `${NOTE_NAMES_SHARP[idx]}${oct > 0 ? `+${oct}` : oct}`;
}

function noteToVexFlowKey(note: NoteEvent): string {
  return `${NOTE_NAMES_SHARP[note.pitchMidi % 12].toLowerCase()}/${Math.floor(note.pitchMidi / 12) - 3}`;
}

export const ScoreView: React.FC<ScoreViewProps> = ({ notes, tempoMap, viewType, staves }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderVexFlow() {
      try {
        const VF = await import("vexflow");
        const container = containerRef.current;
        if (!container || cancelled) return;

        container.innerHTML = "";

        const defaultStaves =
          staves ??
          (viewType === "part"
            ? [{ clef: "treble" as const, name: "Part" }]
            : [
                { clef: "treble" as const, name: "Treble" },
                { clef: "bass" as const, name: "Bass" },
              ]);

        for (const staff of defaultStaves) {
          const div = document.createElement("div");
          container.appendChild(div);

          const renderer = new VF.Renderer(div, VF.Renderer.Backends.SVG);
          renderer.resize(700, 150);
          const context = renderer.getContext();

          const stave = new VF.Stave(10, 40, 600);
          stave.addClef(staff.clef);

          const meter = tempoMap.meterAt(1);
          stave.addTimeSignature(`${meter.numerator}/${meter.denominator}`);

          stave.setContext(context).draw();

          const staffNotes = notes
            .filter((n) => {
              if (staff.clef === "treble") return n.pitchMidi >= 60;
              return n.pitchMidi < 60;
            })
            .slice(0, 16)
            .map((n) => {
              const keys = [noteToVexFlowKey(n)];
              const dur = n.durQn <= 0.25 ? "16" : n.durQn <= 0.5 ? "8" : n.durQn <= 1 ? "q" : "h";
              let accidental: string | undefined;
              const pitchClass = ((n.pitchMidi % 12) + 12) % 12;
              if ([1, 3, 6, 8, 10].includes(pitchClass)) {
                accidental = "#";
              }
              const staveNote = new VF.StaveNote({
                clef: staff.clef,
                keys,
                duration: dur,
                ...(accidental ? { accidentals: [accidental] } : {}),
              });
              return staveNote;
            });

          if (staffNotes.length > 0) {
            const voice = new VF.Voice({ numBeats: 4, beatValue: 4 });
            voice.addTickables(staffNotes);

            const beams = VF.Beam.generateBeams(staffNotes);
            new VF.Formatter().joinVoices([voice]).format([voice], 560);
            voice.draw(context, stave);
            beams.forEach((b) => b.setContext(context).draw());
          }
        }
      } catch {
        if (!cancelled) {
          const container = containerRef.current;
          if (container) {
            container.innerHTML = "";
            const placeholder = document.createElement("div");
            placeholder.style.cssText =
              "display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:14px;font-family:sans-serif;";
            placeholder.textContent = "Score View — VexFlow 集成待完成";
            container.appendChild(placeholder);
          }
        }
      }
    }

    renderVexFlow();
    return () => {
      cancelled = true;
    };
  }, [notes, tempoMap, viewType, staves]);

  return (
    <div
      ref={containerRef}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-primary)",
        borderRadius: "4px",
        overflow: "auto",
        minHeight: "150px",
      }}
    />
  );
};
