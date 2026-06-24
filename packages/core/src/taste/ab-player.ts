import { randomUUID } from "../util/random-uuid";
import { NoteEvent } from "../model/note-event";
import { TasteEvidence, EvidenceType } from "./taste-types";

export interface ABTestConfig {
  mode: "blind" | "labeled";
  loopRange: { startBar: number; endBar: number };
  matchedLoudness: boolean;
  numTrials: number;
}

export interface ABVersion {
  id: string;
  label: string;
  notes: NoteEvent[];
  description: string;
  diffRef?: string;
  exportRef?: string;
}

export interface ABTrial {
  trialId: string;
  versionA: ABVersion;
  versionB: ABVersion;
  config: ABTestConfig;
  playedOrder: ["A", "B"] | ["B", "A"];
  startedAt: string;
  completedAt?: string;
  choice?: "A" | "B" | "no_preference";
}

export interface ABTestResult {
  testId: string;
  trials: ABTrial[];
  config: ABTestConfig;
  startedAt: string;
  completedAt?: string;
  summary: {
    versionAWins: number;
    versionBWins: number;
    noPreference: number;
    confidence: number;
  };
}

const DEFAULT_CONFIG: ABTestConfig = {
  mode: "blind",
  loopRange: { startBar: 1, endBar: 8 },
  matchedLoudness: true,
  numTrials: 5,
};

export class ABPlayer {
  private currentTrial: ABTrial | null = null;
  private trials: ABTrial[] = [];
  private config: ABTestConfig;
  private testId: string | null = null;
  private versionA: ABVersion | null = null;
  private versionB: ABVersion | null = null;

  constructor(config?: Partial<ABTestConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setVersions(versionA: ABVersion, versionB: ABVersion): void {
    this.versionA = versionA;
    this.versionB = versionB;
  }

  createTest(
    versionA: ABVersion,
    versionB: ABVersion,
    config?: Partial<ABTestConfig>
  ): ABTestResult {
    this.config = { ...this.config, ...config };
    this.versionA = versionA;
    this.versionB = versionB;
    this.testId = randomUUID();
    this.trials = this.generateTrials(
      versionA,
      versionB,
      this.config.numTrials
    );
    return this.getResult();
  }

  generateTrials(
    versionA: ABVersion,
    versionB: ABVersion,
    numTrials?: number
  ): ABTrial[] {
    const count = numTrials ?? this.config.numTrials;
    const trials: ABTrial[] = [];
    for (let i = 0; i < count; i++) {
      const trial: ABTrial = {
        trialId: randomUUID(),
        versionA,
        versionB,
        config: { ...this.config },
        playedOrder: ["A", "B"],
        startedAt: new Date().toISOString(),
      };
      trials.push(this.randomizeOrder(trial));
    }
    return trials;
  }

  randomizeOrder(trial: ABTrial): ABTrial {
    const swap = Math.random() < 0.5;
    return {
      ...trial,
      playedOrder: swap ? ["B", "A"] : ["A", "B"],
    };
  }

  vote(trialId: string, choice: "A" | "B" | "no_preference"): void {
    const trial = this.trials.find((t) => t.trialId === trialId);
    if (!trial) return;

    let resolvedChoice = choice;
    if (this.config.mode === "blind" && choice !== "no_preference") {
      resolvedChoice = trial.playedOrder[choice === "A" ? 0 : 1];
    }

    trial.choice = resolvedChoice;
    trial.completedAt = new Date().toISOString();
  }

  getCurrentTrial(): ABTrial | null {
    return this.currentTrial;
  }

  getCurrentVersion(trial: ABTrial, progress: "first" | "second"): ABVersion {
    const label = trial.playedOrder[progress === "first" ? 0 : 1];
    return label === "A" ? trial.versionA : trial.versionB;
  }

  isTestComplete(_testId: string): boolean {
    return this.trials.every((t) => t.completedAt != null);
  }

  getResult(): ABTestResult {
    let versionAWins = 0;
    let versionBWins = 0;
    let noPreference = 0;

    for (const trial of this.trials) {
      if (trial.choice === "A") versionAWins++;
      else if (trial.choice === "B") versionBWins++;
      else noPreference++;
    }

    const totalDecisive = versionAWins + versionBWins;
    const confidence = this.computeConfidence(
      Math.max(versionAWins, versionBWins),
      totalDecisive || 1
    );

    return {
      testId: this.testId ?? randomUUID(),
      trials: [...this.trials],
      config: { ...this.config },
      startedAt:
        this.trials[0]?.startedAt ?? new Date().toISOString(),
      completedAt: this.isTestComplete("") ? new Date().toISOString() : undefined,
      summary: {
        versionAWins,
        versionBWins,
        noPreference,
        confidence,
      },
    };
  }

  toTasteEvidence(
    result: ABTestResult,
    paramKey: string
  ): TasteEvidence[] {
    const evidences: TasteEvidence[] = [];

    for (const trial of result.trials) {
      if (!trial.choice || trial.choice === "no_preference") {
        if (trial.choice === "no_preference") {
          evidences.push({
            id: randomUUID(),
            type: "ab_listen_choice" as EvidenceType,
            paramKey,
            context: {},
            sourceQuality: 0.65,
            timestamp: trial.completedAt ?? new Date().toISOString(),
            ref: trial.versionA.diffRef ?? trial.versionA.id,
            confirmed: false,
          });
        }
        continue;
      }

      const chosen =
        trial.choice === "A" ? trial.versionA : trial.versionB;
      const unchosen =
        trial.choice === "A" ? trial.versionB : trial.versionA;

      const positiveEvidence: TasteEvidence = {
        id: randomUUID(),
        type: "ab_listen_choice" as EvidenceType,
        paramKey,
        pointEstimate: "1.0",
        positiveMass: "0.65",
        context: {},
        sourceQuality: 0.65,
        timestamp: trial.completedAt ?? new Date().toISOString(),
        ref: chosen.diffRef ?? chosen.id,
        confirmed: true,
      };

      const negativeEvidence: TasteEvidence = {
        id: randomUUID(),
        type: "ab_listen_choice" as EvidenceType,
        paramKey,
        pointEstimate: "0.0",
        negativeMass: "0.65",
        context: {},
        sourceQuality: 0.65,
        timestamp: trial.completedAt ?? new Date().toISOString(),
        ref: unchosen.diffRef ?? unchosen.id,
        confirmed: true,
      };

      evidences.push(positiveEvidence);
      evidences.push(negativeEvidence);
    }

    return evidences;
  }

  computeConfidence(wins: number, trials: number): number {
    if (trials <= 0) return 0;
    const p = wins / trials;

    // Standard error of proportion
    const se = Math.sqrt((p * (1 - p)) / trials);
    if (se === 0) return trials > 0 ? 1 : 0;

    // Z-score for the proportion exceeding 0.5 (chance level)
    const z = (p - 0.5) / se;

    // Approximate p-value from z-score (one-tailed)
    // Using the standard normal CDF approximation
    const pValue = 0.5 * (1 + this._erf(z / Math.SQRT2));
    const confidence = pValue;

    return Math.min(1, Math.max(0, confidence));
  }

  inferLoopRange(notes: NoteEvent[]): { startBar: number; endBar: number } {
    if (notes.length === 0) {
      return { startBar: 1, endBar: 8 };
    }

    let minBar = Infinity;
    let maxBar = -Infinity;

    for (const note of notes) {
      if (note.bar < minBar) minBar = note.bar;
      const noteEndBar =
        note.bar + Math.ceil((note.beat - 1 + note.durQn) / 4) - 1;
      if (noteEndBar > maxBar) maxBar = noteEndBar;
    }

    if (minBar === Infinity) minBar = 1;
    if (maxBar === -Infinity) maxBar = 8;

    // Ensure at least 4 bars of range
    if (maxBar - minBar + 1 < 4) {
      maxBar = minBar + 3;
    }

    return { startBar: minBar, endBar: maxBar };
  }

  reset(): void {
    this.currentTrial = null;
    this.trials = [];
    this.testId = null;
    this.versionA = null;
    this.versionB = null;
  }

  private _erf(x: number): number {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }
}
