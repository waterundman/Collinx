import React, { useRef, useEffect, useMemo } from "react";
import type { NoteEvent, TempoMap } from "@collinx/core";
import styles from "./ScoreRenderer.module.css";

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const MIDI_TO_VF_KEY: Record<number, string> = {};
for (let midi = 21; midi <= 108; midi++) {
  const pitchClass = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES_SHARP[pitchClass].toLowerCase();
  MIDI_TO_VF_KEY[midi] = `${name}/${octave}`;
}

function durQnToVfDuration(durQn: number): { duration: string; isDotted: boolean } {
  const tolerance = 0.01;
  const isDottedFn = (base: number) => Math.abs(durQn - base * 1.5) < tolerance;

  if (isDottedFn(4)) return { duration: "w", isDotted: true };
  if (Math.abs(durQn - 4) < tolerance) return { duration: "w", isDotted: false };
  if (isDottedFn(2)) return { duration: "h", isDotted: true };
  if (Math.abs(durQn - 2) < tolerance) return { duration: "h", isDotted: false };
  if (isDottedFn(1)) return { duration: "q", isDotted: true };
  if (Math.abs(durQn - 1) < tolerance) return { duration: "q", isDotted: false };
  if (isDottedFn(0.5)) return { duration: "8", isDotted: true };
  if (Math.abs(durQn - 0.5) < tolerance) return { duration: "8", isDotted: false };
  if (Math.abs(durQn - 0.25) < tolerance) return { duration: "16", isDotted: false };
  if (durQn < 0.5) return { duration: "16", isDotted: false };
  return { duration: "q", isDotted: false };
}

function getAccidental(pitchMidi: number, pitchSpelling?: string): string | undefined {
  if (pitchSpelling) {
    const match = pitchSpelling.match(/^([A-G])([#b]+)/);
    if (match) {
      return match[2];
    }
  }
  const pitchClass = ((pitchMidi % 12) + 12) % 12;
  if ([1, 3, 6, 8, 10].includes(pitchClass)) {
    return "#";
  }
  return undefined;
}

export interface StaffConfig {
  clef: "treble" | "bass";
  name: string;
  bars: number;
}

export interface ScoreRendererLayout {
  staffConfig: StaffConfig[];
  notationSize?: number;
}

export interface ScoreRendererProps {
  notes: NoteEvent[];
  layout: ScoreRendererLayout;
  tempoMap?: TempoMap;
  width?: number;
  height?: number;
  scale?: number;
}

const STAVE_WIDTH = 550;
const STAVE_PADDING_LEFT = 10;
const STAVE_HEIGHT = 120;
const STAVE_GAP = 20;

export const ScoreRenderer: React.FC<ScoreRendererProps> = ({
  notes,
  layout,
  tempoMap,
  width,
  height,
  scale = 1,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(0);

  const meter = useMemo(() => {
    if (tempoMap) {
      return tempoMap.meterAt(1);
    }
    return { numerator: 4, denominator: 4 };
  }, [tempoMap]);

  const notesByStaff = useMemo(() => {
    return layout.staffConfig.map((staff) => {
      return notes.filter((n) => {
        if (staff.clef === "treble") return n.pitchMidi >= 60;
        return n.pitchMidi < 60;
      });
    });
  }, [notes, layout.staffConfig]);

  const maxBars = useMemo(() => {
    return Math.max(...layout.staffConfig.map((s) => s.bars), 4);
  }, [layout.staffConfig]);

  useEffect(() => {
    let cancelled = false;
    const currentRenderId = ++renderIdRef.current;

    async function render() {
      try {
        const VF = await import("vexflow");
        const container = containerRef.current;
        if (!container || cancelled || currentRenderId !== renderIdRef.current) return;

        container.innerHTML = "";

        const staves = layout.staffConfig;
        const staveWidth = STAVE_WIDTH;
        const totalHeight = staves.length * (STAVE_HEIGHT + STAVE_GAP) + 20;

        const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
        renderer.resize(staveWidth + STAVE_PADDING_LEFT * 2, totalHeight);
        const context = renderer.getContext();

        const vfStaves: InstanceType<typeof VF.Stave>[] = [];

        for (let staffIdx = 0; staffIdx < staves.length; staffIdx++) {
          const staff = staves[staffIdx];
          const staffNotes = notesByStaff[staffIdx] ?? [];
          const yOffset = staffIdx * (STAVE_HEIGHT + STAVE_GAP) + 30;

          const stave = new VF.Stave(STAVE_PADDING_LEFT, yOffset, staveWidth);
          if (staffIdx === 0) {
            stave.addClef(staff.clef);
            stave.addTimeSignature(`${meter.numerator}/${meter.denominator}`);
          }
          stave.setContext(context).draw();
          vfStaves.push(stave);

          if (staffNotes.length > 0) {
            const groupedByBar: Record<number, NoteEvent[]> = {};
            for (const note of staffNotes) {
              const bar = note.bar;
              if (!groupedByBar[bar]) groupedByBar[bar] = [];
              groupedByBar[bar].push(note);
            }

            const barNumbers = Object.keys(groupedByBar)
              .map(Number)
              .sort((a, b) => a - b)
              .slice(0, maxBars);

            const allVfNotes: InstanceType<typeof VF.StaveNote>[] = [];

            for (const barNum of barNumbers) {
              const barNotes = groupedByBar[barNum].sort((a, b) => a.beat - b.beat);

              for (const note of barNotes) {
                const vfKey = MIDI_TO_VF_KEY[note.pitchMidi] ?? `c/${Math.floor(note.pitchMidi / 12) - 1}`;
                const { duration, isDotted } = durQnToVfDuration(note.durQn);
                const accidental = getAccidental(note.pitchMidi, note.pitchSpelling);

                const staveNote = new VF.StaveNote({
                  clef: staff.clef,
                  keys: [vfKey],
                  duration: duration,
                });

                if (accidental) {
                  staveNote.addModifier(new VF.Accidental(accidental));
                }
                if (isDotted) {
                  VF.Dot.buildAndAttach([staveNote]);
                }

                allVfNotes.push(staveNote);
              }
            }

            if (allVfNotes.length > 0) {
              const voice = new VF.Voice({
                numBeats: meter.numerator,
                beatValue: meter.denominator,
              });
              voice.setStrict(false);
              voice.addTickables(allVfNotes);

              new VF.Formatter().joinVoices([voice]).format([voice], staveWidth - 20);
              voice.draw(context, stave);

              const beams = VF.Beam.generateBeams(allVfNotes, {
                groups: [new VF.Fraction(meter.numerator, meter.denominator)],
              });
              beams.forEach((b) => b.setContext(context).draw());
            }
          }
        }

        if (staves.length >= 2 && vfStaves.length >= 2) {
          const connector = new VF.StaveConnector(vfStaves[0], vfStaves[1]);
          connector.setType(VF.StaveConnector.type.BRACE);
          connector.setContext(context).draw();
        }
      } catch (err) {
        if (!cancelled && currentRenderId === renderIdRef.current) {
          const container = containerRef.current;
          if (container) {
            container.innerHTML = "";
            const placeholder = document.createElement("div");
            placeholder.className = styles.errorPlaceholder;
            placeholder.textContent = `VexFlow 渲染失败: ${err instanceof Error ? err.message : String(err)}`;
            container.appendChild(placeholder);
          }
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [notes, layout, meter, notesByStaff, maxBars]);

  const containerStyle: React.CSSProperties = {
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    width: width ? `${width}px` : undefined,
    height: height ? `${height}px` : undefined,
  };

  return (
    <div className={styles.rendererContainer}>
      <div ref={containerRef} className={styles.rendererCanvas} style={containerStyle} />
    </div>
  );
};
