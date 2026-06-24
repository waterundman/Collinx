import { Section } from "./section";

export interface EnergyPoint {
  bar: number;
  level: number;
}

export type InterpolationMode =
  | "linear"
  | "ease_in"
  | "ease_out"
  | "ease_in_out"
  | "step";

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
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

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function applyMode(t: number, mode: InterpolationMode): number {
  switch (mode) {
    case "linear":
      return t;
    case "ease_in":
      return easeInQuad(t);
    case "ease_out":
      return easeOutQuad(t);
    case "ease_in_out":
      return smoothstep(t);
    case "step":
      return t < 1 ? 0 : 1;
  }
}

export class EnergyCurve {
  private points: EnergyPoint[];
  private mode: InterpolationMode;

  constructor(points?: EnergyPoint[], mode?: InterpolationMode) {
    this.points = points ? [...points].sort((a, b) => a.bar - b.bar) : [];
    this.mode = mode ?? "linear";
  }

  addPoint(bar: number, level: number): void {
    this.points = this.points.filter((p) => p.bar !== bar);
    this.points.push({ bar, level: clamp(level, 0, 1) });
    this.points.sort((a, b) => a.bar - b.bar);
  }

  removePoint(bar: number): void {
    this.points = this.points.filter((p) => p.bar !== bar);
  }

  at(bar: number): number {
    if (this.points.length === 0) return 0.5;

    const len = this.points.length;

    if (bar <= this.points[0].bar) return this.points[0].level;
    if (bar >= this.points[len - 1].bar) return this.points[len - 1].level;

    let lo = 0;
    let hi = len - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.points[mid].bar <= bar) lo = mid;
      else hi = mid;
    }

    const a = this.points[lo];
    const b = this.points[hi];
    const range = b.bar - a.bar;
    if (range === 0) return a.level;

    const t = clamp((bar - a.bar) / range, 0, 1);
    const eased = applyMode(t, this.mode);
    return lerp(a.level, b.level, eased);
  }

  getPoints(): EnergyPoint[] {
    return [...this.points];
  }

  setMode(mode: InterpolationMode): void {
    this.mode = mode;
  }

  normalize(): EnergyCurve {
    if (this.points.length === 0) return new EnergyCurve([], this.mode);

    const levels = this.points.map((p) => p.level);
    const min = Math.min(...levels);
    const max = Math.max(...levels);
    const range = max - min;

    const normalized = this.points.map((p) => ({
      bar: p.bar,
      level: range === 0 ? 0.5 : (p.level - min) / range,
    }));

    return new EnergyCurve(normalized, this.mode);
  }

  scaleToBars(totalBars: number): EnergyCurve {
    if (this.points.length === 0 || totalBars <= 0)
      return new EnergyCurve([], this.mode);

    let maxBar = Math.max(...this.points.map((p) => p.bar));
    if (maxBar < 1) maxBar = 1;
    const scale = totalBars / maxBar;

    const scaled = this.points.map((p) => ({
      bar: Math.round(p.bar * scale),
      level: p.level,
    }));

    return new EnergyCurve(scaled, this.mode);
  }

  smooth(windowSize = 3): EnergyCurve {
    if (this.points.length < 3 || windowSize < 2)
      return new EnergyCurve(this.points, this.mode);

    const half = Math.floor(windowSize / 2);
    const smoothed: EnergyPoint[] = [];

    for (let i = 0; i < this.points.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(this.points.length - 1, i + half); j++) {
        sum += this.points[j].level;
        count++;
      }
      smoothed.push({
        bar: this.points[i].bar,
        level: sum / count,
      });
    }

    return new EnergyCurve(smoothed, this.mode);
  }

  static fromSections(sections: Section[]): EnergyCurve {
    if (sections.length === 0) return new EnergyCurve([], "linear");

    const sorted = [...sections].sort((a, b) => a.startBar - b.startBar);
    const curve = new EnergyCurve([], "linear");

    for (const s of sorted) {
      const midBar = Math.round((s.startBar + s.endBar) / 2);
      curve.addPoint(midBar, s.energyLevel);
    }

    return curve;
  }

  static defaultArc(totalBars: number): EnergyCurve {
    const total = Math.max(1, totalBars);
    const points: EnergyPoint[] = [
      { bar: 1, level: 0.2 },
      { bar: Math.max(1, Math.round(total * 0.25)), level: 0.4 },
      { bar: Math.max(1, Math.round(total * 0.5)), level: 0.85 },
      { bar: Math.max(1, Math.round(total * 0.75)), level: 0.6 },
      { bar: total, level: 0.15 },
    ];
    return new EnergyCurve(points, "ease_in_out");
  }

  static buildUp(totalBars: number): EnergyCurve {
    const total = Math.max(1, totalBars);
    const points: EnergyPoint[] = [
      { bar: 1, level: 0.05 },
      { bar: Math.max(1, Math.round(total * 0.3)), level: 0.15 },
      { bar: Math.max(1, Math.round(total * 0.7)), level: 0.55 },
      { bar: total, level: 1.0 },
    ];
    return new EnergyCurve(points, "ease_in");
  }

  toJSON(): object {
    return {
      points: this.points,
      mode: this.mode,
    };
  }

  static fromJSON(json: unknown): EnergyCurve {
    const data = json as { points?: EnergyPoint[]; mode?: InterpolationMode };
    return new EnergyCurve(data.points, data.mode);
  }
}
