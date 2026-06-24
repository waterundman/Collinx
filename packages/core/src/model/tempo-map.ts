interface TempoChange {
  bar: number;
  bpm: number;
  curve?: "instant" | "linear" | "ease_in" | "ease_out";
}

interface MeterChange {
  bar: number;
  numerator: number;
  denominator: number;
}

interface KeyChange {
  bar: number;
  tonic: string;
  mode: string;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInQuad(t: number): number {
  return t * t;
}

function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function interpolateBpm(curve: string | undefined, t: number): number {
  switch (curve) {
    case "linear":
      return t;
    case "ease_in":
      return easeInQuad(t);
    case "ease_out":
      return easeOutQuad(t);
    default:
      return t < 1 ? 0 : 1;
  }
}

export class TempoMap {
  private tempoChanges: TempoChange[];
  private meterChanges: MeterChange[];
  private keyChanges: KeyChange[];

  constructor(
    tempoChanges: TempoChange[] = [],
    meterChanges: MeterChange[] = [],
    keyChanges: KeyChange[] = []
  ) {
    this.tempoChanges = [...tempoChanges].sort((a, b) => a.bar - b.bar);
    this.meterChanges = [...meterChanges].sort((a, b) => a.bar - b.bar);
    this.keyChanges = [...keyChanges].sort((a, b) => a.bar - b.bar);

    if (this.tempoChanges.length === 0) {
      this.tempoChanges.push({ bar: 1, bpm: 120 });
    }
    if (this.meterChanges.length === 0) {
      this.meterChanges.push({ bar: 1, numerator: 4, denominator: 4 });
    }
    if (this.keyChanges.length === 0) {
      this.keyChanges.push({ bar: 1, tonic: "C", mode: "major" });
    }
  }

  static default(): TempoMap {
    return new TempoMap();
  }

  bpmAt(bar: number, beat: number = 1): number {
    const tc = this.findActive(this.tempoChanges, bar, beat);
    if (!tc) return 120;

    const nextTc = this.tempoChanges.find((t) => {
      const tPos = this.positionInBars(t.bar, 1);
      const qPos = this.positionInBars(bar, beat);
      return tPos > qPos;
    });

    if (!nextTc || tc.curve === "instant" || !tc.curve) {
      return tc.bpm;
    }

    const startPos = this.positionInBars(tc.bar, 1);
    const endPos = this.positionInBars(nextTc.bar, 1);
    const currentPos = this.positionInBars(bar, beat);
    const t = (currentPos - startPos) / (endPos - startPos);
    const eased = interpolateBpm(tc.curve, Math.max(0, Math.min(1, t)));

    return lerp(tc.bpm, nextTc.bpm, eased);
  }

  meterAt(bar: number): { numerator: number; denominator: number } {
    const mc = this.findActive(this.meterChanges, bar, 1);
    if (!mc) return { numerator: 4, denominator: 4 };
    return { numerator: mc.numerator, denominator: mc.denominator };
  }

  keyAt(bar: number): { tonic: string; mode: string } {
    const kc = this.findActive(this.keyChanges, bar, 1);
    if (!kc) return { tonic: "C", mode: "major" };
    return { tonic: kc.tonic, mode: kc.mode };
  }

  timeAt(bar: number, beat: number = 1): number {
    if (bar < 1) return 0;

    const targetPos = this.positionInBars(bar, beat);
    const sortedTempo = [...this.tempoChanges].sort((a, b) => a.bar - b.bar);

    let totalSeconds = 0;
    let currentBar = 1;
    let currentBeat = 1;

    while (this.positionInBars(currentBar, currentBeat) < targetPos) {
      const meter = this.meterAt(currentBar);
      const beatsPerBar = meter.numerator * (4 / meter.denominator);

      const tc = this.findActive(sortedTempo, currentBar, currentBeat) ?? {
        bar: 1,
        bpm: 120,
      };

      const nextTc = sortedTempo.find(
        (t) => t.bar > currentBar
      );

      const isCurved =
        tc.curve && tc.curve !== "instant" && nextTc;

      const barEndBeat = 1 + beatsPerBar;
      const isLastBar = currentBar === bar;
      const endBeat = isLastBar ? beat : barEndBeat;

      if (isCurved) {
        const startPos = this.positionInBars(tc.bar, 1);
        const endPos = this.positionInBars(nextTc!.bar, 1);
        const steps = Math.max(1, Math.ceil(beatsPerBar * 2));
        const beatStep = 1 / steps;

        for (let i = 0; i < Math.floor((endBeat - currentBeat) * steps); i++) {
          const sampleBeat = currentBeat + beatStep * i;
          if (sampleBeat >= endBeat) break;

          const samplePos = this.positionInBars(currentBar, sampleBeat);
          const t = (samplePos - startPos) / (endPos - startPos);
          const eased = interpolateBpm(tc.curve!, Math.max(0, Math.min(1, t)));
          const bpmAtSample = lerp(tc.bpm, nextTc!.bpm, eased);

          const beatDur = 60 / bpmAtSample;
          totalSeconds += beatDur * beatStep;
        }
      } else {
        const bpm = tc.bpm;
        const numBeats = endBeat - currentBeat;
        totalSeconds += numBeats * (60 / bpm);
      }

      if (isLastBar) break;

      currentBar++;
      currentBeat = 1;
    }

    return totalSeconds;
  }

  barBeatAt(seconds: number): { bar: number; beat: number } {
    if (seconds <= 0) return { bar: 1, beat: 1 };

    let accumulated = 0;
    let bar = 1;

    while (bar < 10000) {
      const barStart = this.timeAt(bar, 1);
      const barEnd = this.timeAt(bar + 1, 1);

      if (seconds >= barStart && seconds < barEnd) {
        const meter = this.meterAt(bar);
        const beatsPerBar = meter.numerator * (4 / meter.denominator);

        for (let beatIdx = 0; beatIdx < beatsPerBar; beatIdx++) {
          const beatNum = 1 + beatIdx;
          const beatTime = this.timeAt(bar, beatNum);
          const nextBeatTime =
            beatIdx + 1 < beatsPerBar
              ? this.timeAt(bar, beatNum + 1)
              : barEnd;

          if (seconds >= beatTime && seconds < nextBeatTime) {
            const fraction =
              (seconds - beatTime) / (nextBeatTime - beatTime || 0.001);
            return { bar, beat: beatNum + fraction };
          }
        }

        return { bar, beat: beatsPerBar + 1 };
      }

      if (seconds >= barEnd) {
        bar++;
        continue;
      }

      break;
    }

    return { bar: Math.max(1, bar), beat: 1 };
  }

  addTempoChange(change: TempoChange): void {
    this.tempoChanges = this.tempoChanges.filter((t) => t.bar !== change.bar);
    this.tempoChanges.push(change);
    this.tempoChanges.sort((a, b) => a.bar - b.bar);
  }

  addMeterChange(change: MeterChange): void {
    this.meterChanges = this.meterChanges.filter((m) => m.bar !== change.bar);
    this.meterChanges.push(change);
    this.meterChanges.sort((a, b) => a.bar - b.bar);
  }

  addKeyChange(change: KeyChange): void {
    this.keyChanges = this.keyChanges.filter((k) => k.bar !== change.bar);
    this.keyChanges.push(change);
    this.keyChanges.sort((a, b) => a.bar - b.bar);
  }

  getBarsDuration(): number {
    const maxBar = Math.max(
      ...this.tempoChanges.map((t) => t.bar),
      ...this.meterChanges.map((m) => m.bar),
      ...this.keyChanges.map((k) => k.bar),
      1
    );
    return maxBar + 16;
  }

  getTotalSeconds(): number {
    return this.timeAt(this.getBarsDuration(), 1);
  }

  static fromNodeData(data: Record<string, unknown>): TempoMap {
    const d = data as {
      tempoChanges?: TempoChange[];
      meterChanges?: MeterChange[];
      keyChanges?: KeyChange[];
    };
    return new TempoMap(d.tempoChanges, d.meterChanges, d.keyChanges);
  }

  toNodeData(): Record<string, unknown> {
    return {
      tempoChanges: this.tempoChanges,
      meterChanges: this.meterChanges,
      keyChanges: this.keyChanges,
    };
  }

  private findActive<T extends { bar: number }>(
    items: T[],
    bar: number,
    beat: number
  ): T | undefined {
    let result: T | undefined;
    const queryPos = this.positionInBars(bar, beat);
    for (const item of items) {
      if (this.positionInBars(item.bar, 1) <= queryPos + 1e-9) {
        result = item;
      } else {
        break;
      }
    }
    return result;
  }

  private positionInBars(bar: number, beat: number): number {
    return bar + (beat - 1) / 4;
  }
}
