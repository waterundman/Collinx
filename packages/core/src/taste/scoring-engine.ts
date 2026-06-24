import { TasteGenome } from "./taste-genome";
import {
  type TasteParameter,
  type TasteContext,
  TasteDomain,
  type BetaDistribution,
  type BernoulliDistribution,
  type GaussianDistribution,
} from "./taste-types";

// ─── Types ────────────────────────────────────────────────────

export interface CandidateFeatures {
  paramKey: string;
  value: number;
}

export interface ScoreResult {
  totalScore: number;
  domainScores: Record<string, number>;
  rejectPenalties: { paramKey: string; penalty: number }[];
  contextMatchBonus: number;
  noveltyBonus: number;
}

export interface ScoreOptions {
  lambdaContextMatch?: number;
  lambdaNovelty?: number;
}

// ─── Helpers ──────────────────────────────────────────────────

function decToNum(s: string): number {
  return parseFloat(s);
}

// ─── ScoringEngine ────────────────────────────────────────────

export class ScoringEngine {
  private readonly lambdaContextMatch: number;
  private readonly lambdaNovelty: number;

  constructor(options?: ScoreOptions) {
    this.lambdaContextMatch = options?.lambdaContextMatch ?? 0.08;
    this.lambdaNovelty = options?.lambdaNovelty ?? 0.12;
  }

  /**
   * Score candidates against a taste genome with context.
   *
   * Score(c | u, ctx) =
   *   Σ w_d · conf_d · fit(c_d, μ_d, σ_d)
   *   + λ1 · ContextMatch
   *   + λ2 · NoveltyBonus
   *   − Σ β_r · RejectPenalty_r
   */
  score(
    candidates: CandidateFeatures[],
    genome: TasteGenome,
    context: TasteContext,
    options?: ScoreOptions,
  ): ScoreResult {
    const lambdaCM = options?.lambdaContextMatch ?? this.lambdaContextMatch;
    const lambdaNov = options?.lambdaNovelty ?? this.lambdaNovelty;

    const domainScores: Record<string, number> = {};
    const rejectPenalties: { paramKey: string; penalty: number }[] = [];
    let totalScore = 0;

    // Domain weights (sum to 1.0 across non-reject domains)
    const domainWeights: Record<string, number> = {
      [TasteDomain.Harmony]: 0.15,
      [TasteDomain.Melody]: 0.18,
      [TasteDomain.Rhythm]: 0.15,
      [TasteDomain.Texture]: 0.12,
      [TasteDomain.Timbre]: 0.12,
      [TasteDomain.Form]: 0.13,
      [TasteDomain.Mix]: 0.15,
    };

    for (const candidate of candidates) {
      const param = genome.getParameter(candidate.paramKey);
      if (!param) continue;

      const domain = this.extractDomain(candidate.paramKey);
      const { mean, std } = this.getDistributionMoments(param);
      const conf = decToNum(param.confidence);

      const fitVal = this.fit(candidate.value, mean, std);

      // Reject domain gets special penalty treatment
      if (domain === TasteDomain.Reject) {
        // For reject: high value = strong rejection
        // penalty = β * confidence * fit (higher when candidate matches what user rejects)
        const penalty = fitVal * conf * 0.3;
        rejectPenalties.push({
          paramKey: candidate.paramKey,
          penalty,
        });
        totalScore -= penalty;
        continue;
      }

      const domainWeight = domainWeights[domain] ?? 0.1;
      const domainScore = domainWeight * conf * fitVal;
      domainScores[domain] = (domainScores[domain] ?? 0) + domainScore;
      totalScore += domainScore;
    }

    // Context match bonus
    const contextMatchBonus = lambdaCM * this.computeContextMatch(candidates, genome, context);
    totalScore += contextMatchBonus;

    // Novelty bonus
    const noveltyBonus = lambdaNov * this.computeNovelty(candidates, genome);
    totalScore += noveltyBonus;

    return {
      totalScore: Math.max(0, totalScore),
      domainScores,
      rejectPenalties,
      contextMatchBonus,
      noveltyBonus,
    };
  }

  /**
   * Rank multiple candidate sets
   */
  rank(
    candidatesList: CandidateFeatures[][],
    genome: TasteGenome,
    context: TasteContext,
  ): { candidates: CandidateFeatures[]; score: ScoreResult }[] {
    return candidatesList
      .map((candidates) => ({
        candidates,
        score: this.score(candidates, genome, context),
      }))
      .sort((a, b) => b.score.totalScore - a.score.totalScore);
  }

  /**
   * Gaussian kernel fit function
   * fit(x, μ, σ) = exp( −(x − μ)² / (2σ² + ε) )
   */
  fit(value: number, mean: number, std: number): number {
    const epsilon = 1e-8;
    const variance = std * std;
    const denominator = 2 * variance + epsilon;

    if (denominator <= 0) return value === mean ? 1.0 : 0.0;

    const diff = value - mean;
    const exponent = -(diff * diff) / denominator;

    return Math.exp(exponent);
  }

  /**
   * Extract distribution moments from TasteParameter
   */
  getDistributionMoments(param: TasteParameter): { mean: number; std: number } {
    const family = param.distribution.family;

    switch (family) {
      case "beta": {
        const dist = param.distribution as BetaDistribution;
        const alpha = decToNum(dist.alpha);
        const beta = decToNum(dist.beta);
        const sum = alpha + beta;
        if (sum === 0) return { mean: 0.5, std: 0.29 };

        const mean = alpha / sum;
        const variance = (alpha * beta) / (sum * sum * (sum + 1));
        const std = Math.sqrt(Math.max(0, variance));

        return { mean, std };
      }

      case "dirichlet": {
        // For dirichlet, mean is the dominant bucket proportion, std from its alpha
        const mean = decToNum(param.value);
        // Simplified: use value as mean, default std
        return { mean, std: 0.2 };
      }

      case "bernoulli": {
        const dist = param.distribution as BernoulliDistribution;
        const p = decToNum(dist.p);
        const mean = p;
        const std = Math.sqrt(Math.max(0, p * (1 - p)));

        return { mean, std };
      }

      case "von_mises": {
        // VonMises direction parameter — treat mu as mean, default std
        const mean = decToNum(param.value);
        return { mean, std: 0.3 };
      }

      case "gaussian": {
        const dist = param.distribution as GaussianDistribution;
        const mean = decToNum(dist.mean);
        const std = Math.sqrt(Math.max(0, decToNum(dist.variance)));

        return { mean, std };
      }

      default: {
        const mean = decToNum(param.value);
        return { mean, std: 0.25 };
      }
    }
  }

  /**
   * Extract domain from paramKey (e.g., "harmony.chord_density" → "harmony")
   */
  private extractDomain(paramKey: string): string {
    const dotIndex = paramKey.indexOf(".");
    if (dotIndex === -1) return paramKey;
    return paramKey.substring(0, dotIndex);
  }

  /**
   * Compute context match bonus:
   * For each candidate param, check how well its context matches the genome param's context
   */
  private computeContextMatch(
    candidates: CandidateFeatures[],
    genome: TasteGenome,
    context: TasteContext,
  ): number {
    let matchCount = 0;
    let totalChecked = 0;

    for (const candidate of candidates) {
      const param = genome.getParameter(candidate.paramKey);
      if (!param) continue;

      totalChecked++;
      const paramCtx = param.context;

      // Count matching context fields
      let fieldMatches = 0;
      let totalFields = 0;

      // Genre overlap
      if (paramCtx.genre && context.genre) {
        totalFields++;
        const overlap = paramCtx.genre.some((g) => context.genre!.includes(g));
        if (overlap) fieldMatches++;
      }

      // Task match
      if (paramCtx.task && context.task) {
        totalFields++;
        if (paramCtx.task === context.task) fieldMatches++;
      }

      if (totalFields > 0) {
        matchCount += fieldMatches / totalFields;
      }
    }

    return totalChecked > 0 ? matchCount / totalChecked : 0;
  }

  /**
   * Compute novelty bonus:
   * Reward candidates that deviate from current preferences
   * (avoids overfitting to known preferences)
   */
  private computeNovelty(
    candidates: CandidateFeatures[],
    genome: TasteGenome,
  ): number {
    let totalNovelty = 0;
    let count = 0;

    for (const candidate of candidates) {
      const param = genome.getParameter(candidate.paramKey);
      if (!param) continue;

      const { mean, std } = this.getDistributionMoments(param);
      const deviation = Math.abs(candidate.value - mean);

      // Novelty: distance from mean, normalized by std
      // Cap at 1.0 (max novelty)
      const novelty = std > 0 ? Math.min(1.0, deviation / (std * 2)) : 0;
      totalNovelty += novelty;
      count++;
    }

    return count > 0 ? totalNovelty / count : 0;
  }
}
