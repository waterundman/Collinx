import type { DiffEnvelope, NoteEvent, Instrument } from "@collinx/core";
import { createDiffEnvelope, randomUUID, INSTRUMENTS } from "@collinx/core";

export interface CollisionWarning {
  type:
    | "voice_crossing"
    | "range_violation"
    | "overlap"
    | "spacing"
    | "stem_direction"
    | "accidental_conflict";
  bar: number;
  beat: number;
  description: string;
  severity: "error" | "warning" | "info";
  fix?: string;
}

interface StaffSystem {
  systems: StaffLine[];
  pageWidth: number;
  pageHeight: number;
}

interface StaffLine {
  instrumentId: string;
  staves: number;
  bars: BarLayout[];
}

interface BarLayout {
  barNumber: number;
  width: number;
  notes: PlacedNote[];
  clef: string;
  keySignature: string;
  timeSignature: string;
}

interface PlacedNote {
  note: NoteEvent;
  x: number;
  y: number;
  accidental?: string;
  stemDirection: "up" | "down";
  voiceIndex: number;
}

class EngravingEngine {
  layoutSystem(
    notes: NoteEvent[],
    instruments: Instrument[],
    options: { houseStyle: string; pageWidth: number; pageHeight: number }
  ): StaffSystem {
    const minBar = Math.min(...notes.map((n) => n.bar), 0);
    const maxBar = Math.max(...notes.map((n) => n.bar), 0);
    const barCount = maxBar - minBar + 1;

    const barsPerSystem = Math.min(4, barCount);
    const systemCount = Math.ceil(barCount / barsPerSystem);

    const systems: StaffLine[] = [];

    for (let sys = 0; sys < systemCount; sys++) {
      for (const inst of instruments) {
        const startBar = minBar + sys * barsPerSystem;
        const endBar = Math.min(startBar + barsPerSystem, maxBar + 1);

        const bars: BarLayout[] = [];
        for (let b = startBar; b < endBar; b++) {
          const barNotes = this.placeNotesInBar(
            notes.filter((n) => n.bar === b && n.trackId === inst.id),
            inst
          );
          bars.push({
            barNumber: b,
            width: options.pageWidth / barsPerSystem - 20,
            notes: barNotes,
            clef: inst.clef,
            keySignature: "C",
            timeSignature: "4/4",
          });
        }

        systems.push({
          instrumentId: inst.id,
          staves: inst.isPolyphonic ? 2 : 1,
          bars,
        });
      }
    }

    return {
      systems,
      pageWidth: options.pageWidth,
      pageHeight: options.pageHeight,
    };
  }

  private placeNotesInBar(notes: NoteEvent[], _instrument: Instrument): PlacedNote[] {
    const placed: PlacedNote[] = [];
    const sorted = [...notes].sort((a, b) => a.bar - b.bar || a.beat - b.beat);

    for (let i = 0; i < sorted.length; i++) {
      const note = sorted[i];
      const x = (note.bar - 1) * 100 + (note.beat - 1) * 25;
      const y = 50 - (note.pitchMidi - 60) * 3;

      placed.push({
        note,
        x,
        y,
        stemDirection: note.pitchMidi >= 73 ? "down" : "up",
        voiceIndex: note.voice === "rh" ? 0 : 1,
      });
    }

    return placed;
  }

  detectCollisions(system: StaffSystem): CollisionWarning[] {
    const collisions: CollisionWarning[] = [];

    for (const staff of system.systems) {
      const inst = INSTRUMENTS[staff.instrumentId];
      const instName = inst?.name ?? staff.instrumentId;

      for (const bar of staff.bars) {
        const placedNotes = [...bar.notes].sort((a, b) => a.y - b.y);

        for (let i = 0; i < placedNotes.length - 1; i++) {
          const current = placedNotes[i];
          const next = placedNotes[i + 1];

          if (Math.abs(current.y - next.y) < 10) {
            collisions.push({
              type: "overlap",
              bar: bar.barNumber,
              beat: current.note.beat,
              description: `音符重叠: ${instName} 小节 ${bar.barNumber} 在 y=${current.y} 处与相邻音符冲突`,
              severity: "warning",
              fix: "调整音符水平位移或增大行间距",
            });
          }

          if (current.stemDirection === next.stemDirection && current.voiceIndex !== next.voiceIndex) {
            collisions.push({
              type: "stem_direction",
              bar: bar.barNumber,
              beat: current.note.beat,
              description: `${instName}: 小节 ${bar.barNumber} 不同声部符干方向相同`,
              severity: "info",
              fix: "upper voice stems up, lower voice stems down",
            });
          }
        }

        for (const placed of bar.notes) {
          if (inst) {
            if (placed.note.pitchMidi < inst.range.minMidi) {
              collisions.push({
                type: "range_violation",
                bar: bar.barNumber,
                beat: placed.note.beat,
                description: `${instName}: 音符 ${placed.note.pitchSpelling} 低于乐器最低音域 ${inst.range.minMidi}`,
                severity: "error",
                fix: "移高八度或更换乐器",
              });
            }
            if (placed.note.pitchMidi > inst.range.maxMidi) {
              collisions.push({
                type: "range_violation",
                bar: bar.barNumber,
                beat: placed.note.beat,
                description: `${instName}: 音符 ${placed.note.pitchSpelling} 超出乐器最高音域 ${inst.range.maxMidi}`,
                severity: "error",
                fix: "移低八度或更换乐器",
              });
            }
          }

          if (placed.voiceIndex === 0 && placed.stemDirection === "down") {
            collisions.push({
              type: "spacing",
              bar: bar.barNumber,
              beat: placed.note.beat,
              description: `${instName}: 小节 ${bar.barNumber} 高音声部符干应向上`,
              severity: "info",
              fix: "flip stem direction",
            });
          }
        }
      }
    }

    return collisions;
  }

  extractParts(system: StaffSystem, instrumentId: string): StaffSystem {
    return {
      pageWidth: system.pageWidth,
      pageHeight: system.pageHeight,
      systems: system.systems.filter((s) => s.instrumentId === instrumentId),
    };
  }

  getStaffGroups(system: StaffSystem): { instrumentId: string; name: string }[] {
    const seen = new Set<string>();
    const groups: { instrumentId: string; name: string }[] = [];
    for (const staff of system.systems) {
      if (!seen.has(staff.instrumentId)) {
        seen.add(staff.instrumentId);
        const inst = INSTRUMENTS[staff.instrumentId];
        groups.push({
          instrumentId: staff.instrumentId,
          name: inst?.name ?? staff.instrumentId,
        });
      }
    }
    return groups;
  }
}

export class EngravingAgent {
  private engine: EngravingEngine;

  constructor() {
    this.engine = new EngravingEngine();
  }

  reflowLayout(
    layoutId: string,
    houseStyle: string,
    collisionPolicy: "auto_fix" | "report_only"
  ): DiffEnvelope {
    const pageDims = this.houseStyleDims(houseStyle);
    const notes: NoteEvent[] = this.generateDemoNotes(layoutId);

    const instruments = this.getDemoInstruments();

    const system = this.engine.layoutSystem(notes, instruments, {
      houseStyle,
      pageWidth: pageDims.width,
      pageHeight: pageDims.height,
    });

    const collisions = this.engine.detectCollisions(system);
    const ops: DiffEnvelope["ops"] = [];

    if (collisionPolicy === "auto_fix") {
      for (const c of collisions) {
        ops.push({
          op: "update_node",
          path: `layout/${layoutId}/bar_${c.bar}`,
          nodeId: layoutId,
          data: { fixApplied: c.fix ?? "auto adjusted", collisionType: c.type },
        });
      }
    }

    ops.push({
      op: "add_node",
      path: `layout/${layoutId}/reflow`,
      nodeType: "LayoutMeta",
      data: {
        barsPerSystem: 4,
        systemCount: system.systems.length,
        partCount: this.engine.getStaffGroups(system).length,
        collisionCount: collisions.length,
      },
    });

    const riskFlags = collisions
      .filter((c) => c.severity === "error")
      .map((c) => ({
        type: c.type,
        severity: c.severity as "low" | "medium" | "high",
        description: c.description,
      }));

    return createDiffEnvelope({
      baseRevision: "HEAD",
      actor: { type: "agent", name: "engraving" },
      permissionScope: "proposal_only",
      summary: `乐谱重排: ${layoutId}, 风格=${houseStyle}, 策略=${collisionPolicy}, 冲突=${collisions.length}`,
      ops,
      domainExplanations: [
        {
          label: "Layout",
          text: `${this.engine.getStaffGroups(system).length} 个声部, ${collisions.length} 个冲突 (${collisions.filter((c) => c.severity === "error").length} error, ${collisions.filter((c) => c.severity === "warning").length} warning)`,
        },
      ],
      riskFlags,
    });
  }

  extractParts(fullScoreLayoutId: string): DiffEnvelope[] {
    const notes = this.generateDemoNotes(fullScoreLayoutId);
    const instruments = this.getDemoInstruments();
    const pageDims = { width: 210, height: 297 };

    const fullSystem = this.engine.layoutSystem(notes, instruments, {
      houseStyle: "henle",
      pageWidth: pageDims.width,
      pageHeight: pageDims.height,
    });

    const staffGroups = this.engine.getStaffGroups(fullSystem);
    const diffs: DiffEnvelope[] = [];

    for (const group of staffGroups) {
      const partSystem = this.engine.extractParts(fullSystem, group.instrumentId);

      diffs.push(
        createDiffEnvelope({
          baseRevision: "HEAD",
          actor: { type: "agent", name: "engraving" },
          permissionScope: "proposal_only",
          summary: `分谱: ${group.name} (${group.instrumentId})`,
          ops: [
            {
              op: "add_node",
              path: `parts/${group.instrumentId}`,
              nodeType: "PartLayout",
              data: {
                instrumentId: group.instrumentId,
                instrumentName: group.name,
                barCount: partSystem.systems[0]?.bars.length ?? 0,
              },
            },
          ],
          domainExplanations: [
            {
              label: group.name,
              text: `分谱: ${group.instrumentId}, ${partSystem.systems.flatMap((s) => s.bars).length} 小节`,
            },
          ],
        })
      );
    }

    return diffs;
  }

  reportCollisions(layoutId: string): {
    collisions: CollisionWarning[];
    suggestions: string[];
  } {
    const notes = this.generateDemoNotes(layoutId);
    const instruments = this.getDemoInstruments();

    const system = this.engine.layoutSystem(notes, instruments, {
      houseStyle: "henle",
      pageWidth: 210,
      pageHeight: 297,
    });

    const collisions = this.engine.detectCollisions(system);
    const suggestions: string[] = [];

    const errorCollisions = collisions.filter((c) => c.severity === "error");
    const warningCollisions = collisions.filter((c) => c.severity === "warning");

    if (errorCollisions.length > 0) {
      suggestions.push(`发现 ${errorCollisions.length} 个严重冲突，建议优先修复`);
      for (const c of errorCollisions) {
        if (c.fix) suggestions.push(`[${c.type}] 小节 ${c.bar}: ${c.fix}`);
      }
    }

    if (warningCollisions.length > 0) {
      suggestions.push(`${warningCollisions.length} 个警告需要审核`);
    }

    if (collisions.length === 0) {
      suggestions.push("未发现排版冲突，布局良好");
    }

    return { collisions, suggestions };
  }

  private houseStyleDims(style: string): { width: number; height: number } {
    switch (style) {
      case "henle":
        return { width: 255, height: 325 };
      case "schirmer":
        return { width: 230, height: 305 };
      case "peters":
        return { width: 235, height: 310 };
      case "modern":
        return { width: 210, height: 297 };
      default:
        return { width: 210, height: 297 };
    }
  }

  private generateDemoNotes(layoutId: string): NoteEvent[] {
    const notes: NoteEvent[] = [];
    const instruments = ["violin", "violin", "viola", "cello"];

    for (const instId of instruments) {
      for (let bar = 1; bar <= 4; bar++) {
        for (let beat = 1; beat <= 4; beat += 1) {
          const pitch =
            60 +
            ((instruments.indexOf(instId) * 7 + bar * 2 + beat + instId.charCodeAt(0)) % 24);
          notes.push({
            id: randomUUID(),
            trackId: instId,
            phraseId: layoutId,
            bar,
            beat,
            durQn: 1,
            pitchMidi: Math.min(108, Math.max(21, pitch)),
            pitchSpelling: `C${Math.floor(pitch / 12) - 1}`,
            velocity: 0.75,
            voice: instruments.indexOf(instId) < 2 ? "rh" : "lh",
            tags: [],
          });
        }
      }
    }

    return notes;
  }

  private getDemoInstruments(): Instrument[] {
    return [
      INSTRUMENTS["violin"]!,
      INSTRUMENTS["violin"]!,
      INSTRUMENTS["viola"]!,
      INSTRUMENTS["cello"]!,
    ];
  }
}
