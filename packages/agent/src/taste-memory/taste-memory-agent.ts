import type { NoteEvent, TempoMap } from "@collinx/core";
import {
  TasteGenome,
  TasteStore,
  ExportAnalyzer,
  UpdateEngine,
  ScoringEngine,
  TentativeBuffer,
  ProjectTasteOverlay,
  type GenomeVersionEntry,
  type TastePackage,
  type TasteContext,
  type TasteEvidence,
  type ExportAnalysisResult,
  type CandidateFeatures,
  type ScoreResult,
} from "@collinx/core";

export interface RankedCandidate {
  candidates: CandidateFeatures[];
  score: ScoreResult;
  rank: number;
}

export interface UpdateResult {
  genome: TasteGenome;
  updatedParams: string[];
  skippedParams: string[];
  versionIncremented: boolean;
}

export class TasteMemoryAgent {
  private store: TasteStore;
  private analyzer: ExportAnalyzer;
  private engine: UpdateEngine;
  private scorer: ScoringEngine;
  private buffer: TentativeBuffer;
  private pendingAnalyses: Map<string, ExportAnalysisResult>;

  constructor(storagePath?: string) {
    this.store = new TasteStore(storagePath);
    this.analyzer = new ExportAnalyzer();
    this.engine = new UpdateEngine();
    this.scorer = new ScoringEngine();
    this.buffer = new TentativeBuffer(30);
    this.pendingAnalyses = new Map();
  }

  analyzeExport(
    notes: NoteEvent[],
    tempoMap: TempoMap,
    exportRef: string
  ): ExportAnalysisResult {
    const genome = this.store.getCurrentGenome() ?? TasteGenome.createDefault();
    const result = this.analyzer.analyze(notes, tempoMap, genome, undefined, exportRef);
    this.pendingAnalyses.set(result.exportId, result);
    return result;
  }

  confirmWrite(
    evidenceIds: string[],
    genome: TasteGenome
  ): UpdateResult {
    const evidenceSet: TasteEvidence[] = [];

    // Search in store and pending analyses for evidence
    const allEvidence = this.store.listAllEvidence();
    for (const eid of evidenceIds) {
      const found = allEvidence.find((e) => e.evidence.id === eid);
      if (found) {
        evidenceSet.push(found.evidence);
      }
    }

    // Also check pending analyses
    if (evidenceSet.length === 0) {
      for (const [, analysis] of this.pendingAnalyses) {
        for (const ev of analysis.evidenceSet) {
          if (evidenceIds.includes(ev.id)) {
            evidenceSet.push(ev);
          }
        }
      }
    }

    if (!this.store.hasGenome()) {
      this.store.save(genome);
    }

    const currentGenome = this.store.getCurrentGenome() ?? genome;

    if (evidenceSet.length === 0) {
      this.store.save(currentGenome);
      return {
        genome: currentGenome,
        updatedParams: [],
        skippedParams: evidenceIds,
        versionIncremented: true,
      };
    }

    const result = this.engine.update(currentGenome, evidenceSet, {
      confirmed: true,
    });

    if (result.versionIncremented) {
      this.store.save(result.genome);
    }

    return {
      genome: result.genome,
      updatedParams: result.updatedParams,
      skippedParams: result.skippedParams,
      versionIncremented: result.versionIncremented,
    };
  }

  rejectEvidence(evidenceIds: string[]): void {
    for (const eid of evidenceIds) {
      const allEvidence = this.store.listAllEvidence();
      const found = allEvidence.find((e) => e.evidence.id === eid);
      if (found) {
        this.buffer.addEvidence(found.evidence);
        this.store.deleteEvidence(found.paramKey, found.evidence.id);
      }
    }
  }

  rollbackGenome(version: number): TasteGenome {
    const restored = this.store.revertTo(version);
    if (!restored) {
      throw new Error(`版本 ${version} 不存在，无法回滚`);
    }
    return restored;
  }

  getTimeline(): GenomeVersionEntry[] {
    return this.store.getVersionHistory();
  }

  exportPackage(): TastePackage {
    return this.store.exportPackage();
  }

  rankWithTaste(
    candidatesList: CandidateFeatures[][],
    context: TasteContext
  ): RankedCandidate[] {
    const genome = this.store.getCurrentGenome() ?? TasteGenome.createDefault();

    const ranked = this.scorer.rank(candidatesList, genome, context);

    return ranked.map((item, index) => ({
      candidates: item.candidates,
      score: item.score,
      rank: index + 1,
    }));
  }

  getEffectiveTaste(
    context: TasteContext,
    overlay?: ProjectTasteOverlay
  ): TasteGenome {
    const genome = this.store.getCurrentGenome() ?? TasteGenome.createDefault();

    if (overlay) {
      return overlay.applyTo(genome);
    }

    return genome;
  }

  getStore(): TasteStore {
    return this.store;
  }

  getBuffer(): TentativeBuffer {
    return this.buffer;
  }

  getAnalyzer(): ExportAnalyzer {
    return this.analyzer;
  }

  getScorer(): ScoringEngine {
    return this.scorer;
  }
}
