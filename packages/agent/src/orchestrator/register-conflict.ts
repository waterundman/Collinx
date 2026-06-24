import type { NoteEvent, Instrument } from "@collinx/core";

export interface VoiceNote {
  pitchMidi: number;
  voice: string;
  bar: number;
  beat: number;
  durQn: number;
}

export type VoiceGrid = VoiceNote[][];

export interface RegisterConflict {
  type: "overlap" | "spacing" | "range_violation" | "crossing";
  players: [string, string];
  bar: number;
  beat: number;
  description: string;
  severity: "warning" | "error";
  suggestion: string;
}

export class RegisterConflictDetector {
  detectConflicts(
    perPlayerNotes: Map<string, NoteEvent[]>,
    instruments: Map<string, Instrument>,
  ): RegisterConflict[] {
    const conflicts: RegisterConflict[] = [];
    const playerIds = Array.from(perPlayerNotes.keys());

    for (const pid of playerIds) {
      const notes = perPlayerNotes.get(pid)!;
      const inst = instruments.get(pid);
      if (inst) {
        conflicts.push(...this.detectRangeViolation(notes, inst));
      }
    }

    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const a = playerIds[i];
        const b = playerIds[j];
        const aNotes = perPlayerNotes.get(a)!;
        const bNotes = perPlayerNotes.get(b)!;
        const aInst = instruments.get(a);
        const bInst = instruments.get(b);
        if (aInst && bInst) {
          conflicts.push(...this.detectOverlap(aNotes, bNotes, aInst, bInst));
        }
      }
    }

    return conflicts;
  }

  detectOverlap(
    aNotes: NoteEvent[],
    bNotes: NoteEvent[],
    aInst: Instrument,
    bInst: Instrument,
  ): RegisterConflict[] {
    const conflicts: RegisterConflict[] = [];

    const aByBeat = this.groupByBeat(aNotes);
    const bByBeat = this.groupByBeat(bNotes);

    for (const [key, aGroup] of aByBeat) {
      const bGroup = bByBeat.get(key);
      if (!bGroup) continue;

      const aMin = Math.min(...aGroup.map((n) => n.pitchMidi));
      const aMax = Math.max(...aGroup.map((n) => n.pitchMidi));
      const bMin = Math.min(...bGroup.map((n) => n.pitchMidi));
      const bMax = Math.max(...bGroup.map((n) => n.pitchMidi));

      const overlapStart = Math.max(aMin, bMin);
      const overlapEnd = Math.min(aMax, bMax);
      const overlapRange = overlapEnd - overlapStart;

      if (overlapRange > 12) {
        const sample = aGroup[0];
        conflicts.push({
          type: "overlap",
          players: [aInst.id, bInst.id],
          bar: sample.bar,
          beat: sample.beat,
          description: `${aInst.name} 与 ${bInst.name} 音域严重重叠 (${overlapRange} 半音)`,
          severity: "warning",
          suggestion: this.suggestFix({
            type: "overlap",
            players: [aInst.id, bInst.id],
            bar: sample.bar,
            beat: sample.beat,
            description: "",
            severity: "warning",
            suggestion: "",
          }),
        });
      }
    }

    return conflicts;
  }

  detectSpacing(voices: VoiceNote[]): RegisterConflict[] {
    const conflicts: RegisterConflict[] = [];
    const sorted = [...voices].sort((a, b) => b.pitchMidi - a.pitchMidi);

    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i].pitchMidi - sorted[i + 1].pitchMidi;
      if (gap > 12) {
        conflicts.push({
          type: "spacing",
          players: ["upper", "lower"],
          bar: sorted[i].bar,
          beat: sorted[i].beat,
          description: `声部间距过大: ${sorted[i].voice} (${sorted[i].pitchMidi}) 与 ${sorted[i + 1].voice} (${sorted[i + 1].pitchMidi}) 相差 ${gap} 半音`,
          severity: "warning",
          suggestion: "考虑插入和声填充声部或调整低声部上行",
        });
      }
    }

    return conflicts;
  }

  detectRangeViolation(
    notes: NoteEvent[],
    instrument: Instrument,
  ): RegisterConflict[] {
    const conflicts: RegisterConflict[] = [];

    for (const note of notes) {
      if (note.pitchMidi < instrument.range.minMidi) {
        conflicts.push({
          type: "range_violation",
          players: [instrument.id, ""],
          bar: note.bar,
          beat: note.beat,
          description: `${instrument.name}: 音符 ${note.pitchMidi} 低于最低音域 ${instrument.range.minMidi}`,
          severity: "error",
          suggestion: `将音符上移 ${instrument.range.minMidi - note.pitchMidi} 个半音，或分配给其他乐器`,
        });
      } else if (note.pitchMidi > instrument.range.maxMidi) {
        conflicts.push({
          type: "range_violation",
          players: [instrument.id, ""],
          bar: note.bar,
          beat: note.beat,
          description: `${instrument.name}: 音符 ${note.pitchMidi} 超出最高音域 ${instrument.range.maxMidi}`,
          severity: "error",
          suggestion: `将音符下移 ${note.pitchMidi - instrument.range.maxMidi} 个半音，或分配给其他乐器`,
        });
      }
    }

    return conflicts;
  }

  detectCrossing(voices: VoiceNote[][]): RegisterConflict[] {
    const conflicts: RegisterConflict[] = [];
    if (voices.length < 2) return conflicts;

    const numVoices = voices.length;
    const allBars = new Set<number>();

    for (const voice of voices) {
      for (const note of voice) {
        allBars.add(note.bar);
      }
    }

    for (const bar of allBars) {
      const barNotes: VoiceNote[][] = voices.map((voice) =>
        voice.filter((n) => n.bar === bar),
      );

      const nonEmpty = barNotes.filter((arr) => arr.length > 0);
      if (nonEmpty.length < 2) continue;

      for (let i = 0; i < nonEmpty.length - 1; i++) {
        const upperAvg = this.avgPitch(nonEmpty[i]);
        const lowerAvg = this.avgPitch(nonEmpty[i + 1]);
        if (upperAvg < lowerAvg) {
          conflicts.push({
            type: "crossing",
            players: [nonEmpty[i][0].voice, nonEmpty[i + 1][0].voice],
            bar,
            beat: 1,
            description: `声部交叉: ${nonEmpty[i][0].voice} (均${upperAvg.toFixed(0)}) 低于 ${nonEmpty[i + 1][0].voice} (均${lowerAvg.toFixed(0)})`,
            severity: "warning",
            suggestion: "调整声部音区，确保高声部高于低声部",
          });
        }
      }
    }

    return conflicts;
  }

  suggestFix(conflict: RegisterConflict): string {
    switch (conflict.type) {
      case "overlap":
        return `建议将 ${conflict.players[0]} 与 ${conflict.players[1]} 拉开八度以上距离`;
      case "spacing":
        return "建议在间距过大的声部之间加入和声填充";
      case "range_violation": {
        const playerName = conflict.players[0];
        return `调整 ${playerName} 声部使其落在音域范围内`;
      }
      case "crossing":
        return `交换 ${conflict.players[0]} 与 ${conflict.players[1]} 的声部内容，或调整八度`;
      default:
        return "检查声部编排";
    }
  }

  private groupByBeat(notes: NoteEvent[]): Map<string, NoteEvent[]> {
    const map = new Map<string, NoteEvent[]>();
    for (const note of notes) {
      const key = `${note.bar}-${note.beat}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(note);
    }
    return map;
  }

  private avgPitch(notes: VoiceNote[]): number {
    if (notes.length === 0) return 0;
    return notes.reduce((sum, n) => sum + n.pitchMidi, 0) / notes.length;
  }
}
