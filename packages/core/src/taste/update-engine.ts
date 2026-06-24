import { TasteGenome } from "./taste-genome";
import {
  type TasteEvidence,
  type TasteParameter,
  type OverrideRule,
  type TasteContext,
  type TimeDecay,
  EVIDENCE_WEIGHTS,
  type BetaDistribution,
  type DirichletDistribution,
  type BernoulliDistribution,
  type VonMisesDistribution,
  type GaussianDistribution,
} from "./taste-types";

// ─── Decimal128 string arithmetic helpers ─────────────────────

function trimTrailing(s: string): string {
  return s.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

function safeRound(n: number): string {
  // Round to 15 significant decimal digits to eliminate floating-point noise
  const rounded = Math.round(n * 1e15) / 1e15;
  return trimTrailing(rounded.toFixed(15));
}

export function decAdd(a: string, b: string): string {
  return safeRound(parseFloat(a) + parseFloat(b));
}

export function decSub(a: string, b: string): string {
  return safeRound(parseFloat(a) - parseFloat(b));
}

export function decMul(a: string, b: string): string {
  return safeRound(parseFloat(a) * parseFloat(b));
}

export function decDiv(a: string, b: string): string {
  const denominator = parseFloat(b);
  if (denominator === 0) return "0";
  return safeRound(parseFloat(a) / denominator);
}

export function decExp(lambda: string, dt: number): string {
  return safeRound(Math.exp(-parseFloat(lambda) * dt));
}

function decToNum(s: string): number {
  return parseFloat(s);
}

function numToDec(n: number): string {
  return safeRound(n);
}

// ─── Types ────────────────────────────────────────────────────

export interface UpdateConfig {
  confirmed: boolean;
  contextMatchMultiplier?: number;
  sourceQualityMultiplier?: number;
  recencyMultiplier?: number;
}

export interface UpdateResult {
  genome: TasteGenome;
  updatedParams: string[];
  skippedParams: string[];
  versionIncremented: boolean;
}

// ─── UpdateEngine ─────────────────────────────────────────────

export class UpdateEngine {
  /**
   * 主更新方法：根据一组证据更新 Genome
   */
  update(
    genome: TasteGenome,
    evidenceSet: TasteEvidence[],
    config: UpdateConfig,
  ): UpdateResult {
    const resultGenome = genome.clone();
    const updatedParams: string[] = [];
    const skippedParams: string[] = [];

    if (!config.confirmed) {
      return {
        genome: genome.clone(),
        updatedParams: [],
        skippedParams: evidenceSet.map((e) => e.id),
        versionIncremented: false,
      };
    }

    for (const evidence of evidenceSet) {
      if (!evidence || !evidence.paramKey) {
        skippedParams.push(evidence?.id ?? "unknown");
        continue;
      }

      const weight = this.computeWeight(evidence, config);

      const existing = resultGenome.getParameter(evidence.paramKey);
      if (!existing) {
        skippedParams.push(evidence.id);
        continue;
      }

      let param = structuredClone(existing);

      param = this.applyOverrideRule(param, evidence.context);

      // Bayesian / EMA update depending on distribution family
      const distFamily = param.distribution.family;

      if (distFamily === "beta") {
        param = this.updateBetaParameter(param, evidence, weight);
      } else if (distFamily === "dirichlet") {
        param = this.updateDirichletParameter(param, evidence, weight);
      } else if (distFamily === "bernoulli") {
        param = this.updateBernoulliParameter(param, evidence, weight);
      } else if (distFamily === "von_mises") {
        param = this.updateVonMisesParameter(param, evidence, weight);
      } else if (distFamily === "gaussian") {
        param = this.updateGaussianParameter(param, evidence, weight);
      } else {
        param = this.updateWithEma(param, evidence, weight);
      }

      const confidenceGain = numToDec(0.03 * weight);
      param.confidence = this.updateConfidence(param, confidenceGain);

      param.evidence = [...param.evidence, evidence];

      resultGenome.setParameter(evidence.paramKey, param);
      updatedParams.push(evidence.paramKey);
    }

    if (updatedParams.length > 0) {
      resultGenome.incrementVersion();
    }

    return {
      genome: resultGenome,
      updatedParams,
      skippedParams,
      versionIncremented: updatedParams.length > 0,
    };
  }

  /**
   * Beta distribution Bayesian posterior update
   * alpha += weight * positiveMass, beta += weight * negativeMass
   * value = alpha / (alpha + beta)
   */
  updateBetaParameter(
    param: TasteParameter,
    evidence: TasteEvidence,
    weight: number,
  ): TasteParameter {
    const dist = param.distribution as BetaDistribution;
    const weightStr = numToDec(weight);

    if (evidence.positiveMass) {
      const inc = decMul(weightStr, evidence.positiveMass);
      dist.alpha = decAdd(dist.alpha, inc);
    }
    if (evidence.negativeMass) {
      const inc = decMul(weightStr, evidence.negativeMass);
      dist.beta = decAdd(dist.beta, inc);
    }

    const alpha = decToNum(dist.alpha);
    const beta = decToNum(dist.beta);
    const sum = alpha + beta;
    param.value = sum > 0 ? numToDec(alpha / sum) : "0.5";

    return param;
  }

  /**
   * Dirichlet distribution Bayesian posterior update
   * alphas[bucket] += weight * categoryMass[bucket]
   * value = normalize(alphas) as JSON string
   */
  updateDirichletParameter(
    param: TasteParameter,
    evidence: TasteEvidence,
    weight: number,
  ): TasteParameter {
    const dist = param.distribution as DirichletDistribution;
    const weightStr = numToDec(weight);

    if (evidence.categoryMass) {
      for (const bucket of Object.keys(evidence.categoryMass)) {
        const inc = decMul(weightStr, evidence.categoryMass[bucket]);
        if (dist.alphas[bucket] !== undefined) {
          dist.alphas[bucket] = decAdd(dist.alphas[bucket], inc);
        } else {
          dist.alphas[bucket] = inc;
        }
      }
    }

    // normalize alphas to produce value (JSON of proportions)
    const entries = Object.entries(dist.alphas);
    const total = entries.reduce((sum, [, v]) => sum + decToNum(v), 0);
    const normalized: Record<string, number> = {};
    if (total > 0) {
      for (const [k, v] of entries) {
        normalized[k] = decToNum(v) / total;
      }
    }
    param.value = JSON.stringify(normalized);

    return param;
  }

  /**
   * Bernoulli distribution update
   * p += weight * (pointEstimate - p)
   */
  updateBernoulliParameter(
    param: TasteParameter,
    evidence: TasteEvidence,
    weight: number,
  ): TasteParameter {
    const dist = param.distribution as BernoulliDistribution;

    if (evidence.pointEstimate) {
      const diff = decSub(evidence.pointEstimate, dist.p);
      const update = decMul(numToDec(weight), diff);
      const newP = decAdd(dist.p, update);
      const pNum = decToNum(newP);

      // Clamp to [0, 1]
      dist.p = numToDec(Math.max(0, Math.min(1, pNum)));
    }

    param.value = dist.p;
    return param;
  }

  /**
   * Von Mises distribution update (EMA on mu, kappa)
   */
  updateVonMisesParameter(
    param: TasteParameter,
    evidence: TasteEvidence,
    weight: number,
  ): TasteParameter {
    const dist = param.distribution as VonMisesDistribution;

    if (evidence.pointEstimate) {
      const alpha = Number(this.adaptiveAlpha(param.confidence, weight));
      dist.mu = this.ema(dist.mu, evidence.pointEstimate, numToDec(alpha));

      // Kappa increases with more evidence
      const kappaGain = decMul(numToDec(weight), "0.1");
      dist.kappa = decAdd(dist.kappa, kappaGain);
    }

    param.value = dist.mu;
    return param;
  }

  /**
   * Gaussian distribution update (EMA on mean and variance)
   */
  updateGaussianParameter(
    param: TasteParameter,
    evidence: TasteEvidence,
    weight: number,
  ): TasteParameter {
    const dist = param.distribution as GaussianDistribution;

    if (evidence.pointEstimate) {
      const alpha = Number(this.adaptiveAlpha(param.confidence, weight));
      const oldMean = dist.mean;
      const newMean = evidence.pointEstimate;

      dist.mean = this.ema(oldMean, newMean, numToDec(alpha));

      // Update variance with squared deviation
      const dev = decSub(newMean, oldMean);
      const sqDev = decMul(dev, dev);
      const oldVar = dist.variance;
      dist.variance = this.ema(oldVar, sqDev, numToDec(alpha * 0.3));
    }

    param.value = dist.mean;
    return param;
  }

  /**
   * EMA update for distributions without specialized Bayesian formulas
   * new_value = alpha * new + (1 - alpha) * old
   */
  updateWithEma(
    param: TasteParameter,
    evidence: TasteEvidence,
    weight: number,
  ): TasteParameter {
    if (evidence.pointEstimate) {
      const alpha = this.adaptiveAlpha(param.confidence, weight);
      param.value = this.ema(param.value, evidence.pointEstimate, alpha);
    }
    return param;
  }

  /**
   * EMA: new_value = alpha * new + (1 - alpha) * old
   */
  ema(oldValue: string, newValue: string, alpha: string): string {
    const alphaNum = decToNum(alpha);
    const oldNum = decToNum(oldValue);
    const newNum = decToNum(newValue);
    const result = alphaNum * newNum + (1 - alphaNum) * oldNum;
    return numToDec(result);
  }

  /**
   * Adaptive alpha: higher confidence → smaller alpha (less change)
   * alpha = weight * (1 - confidence) * 0.5
   * Clamped to [0.01, 0.5]
   */
  adaptiveAlpha(confidence: string, weight: number): string {
    const conf = decToNum(confidence);
    const raw = weight * (1 - conf) * 0.5;
    const clamped = Math.max(0.01, Math.min(0.5, raw));
    return numToDec(clamped);
  }

  /**
   * Compute composite evidence weight
   */
  computeWeight(evidence: TasteEvidence, config: UpdateConfig): number {
    const baseWeight = EVIDENCE_WEIGHTS[evidence.type] ?? 0.15;
    const contextMult = config.contextMatchMultiplier ?? 1.0;
    const sourceMult = config.sourceQualityMultiplier ?? evidence.sourceQuality;
    const recencyMult = config.recencyMultiplier ?? 1.0;

    return baseWeight * contextMult * sourceMult * recencyMult;
  }

  /**
   * Apply time decay to all parameters in genome
   * w_t = exp(-lambda * Δt)
   * value += w_t * (0.5 - value)   // regress toward 0.5 (neutral)
   * confidence *= exp(-lambda * Δt * 0.5)
   */
  applyTimeDecay(genome: TasteGenome, now?: Date): TasteGenome {
    const nowDate = now ?? new Date();
    const result = genome.clone();

    for (const [key, param] of result.listParameters()) {
      const dd = param as TasteParameter;
      const td = dd.timeDecay;

      if (td.policy === "none") continue;

      const lastUpdated = new Date(dd.lastUpdatedAt);
      const dtMs = nowDate.getTime() - lastUpdated.getTime();
      const dtDays = dtMs / (1000 * 60 * 60 * 24);

      if (dtDays <= 0) continue;

      const lambdaNum = decToNum(td.lambda);

      // Slow decay uses half the lambda
      const effectiveLambda = td.policy === "slow_exp" ? lambdaNum * 0.5 : lambdaNum;

      // Decay weight
      const wt = decExp(numToDec(effectiveLambda), dtDays);
      const wtNum = decToNum(wt);

      // Regress value toward 0.5 (neutral)
      const oldVal = decToNum(dd.value);
      const newVal = oldVal + wtNum * (0.5 - oldVal);
      dd.value = numToDec(newVal);

      // Decay confidence
      const confDecay = Math.exp(-effectiveLambda * dtDays * 0.5);
      dd.confidence = numToDec(decToNum(dd.confidence) * confDecay);

      // Update timestamp so subsequent calls don't double-decay
      dd.lastUpdatedAt = nowDate.toISOString();

      result.setParameter(key, dd);
    }

    return result;
  }

  /**
   * Apply context override rule
   * Checks if evidence context matches override rule's 'when' condition
   */
  applyOverrideRule(
    param: TasteParameter,
    context: Partial<TasteContext>,
  ): TasteParameter {
    const rule = param.overrideRule;
    if (!rule) return param;

    if (!this.contextMatch(rule.when, context)) {
      return param;
    }

    // Rule matched — apply modifier
    const factor = decToNum(rule.factor ?? "0.5");

    switch (rule.mode) {
      case "suspend": {
        // Zero out the effective value for this update
        break;
      }
      case "downweight": {
        // Reduce confidence to downweight influence
        param.confidence = decMul(param.confidence, numToDec(factor));
        break;
      }
      case "boost": {
        // Boost confidence
        param.confidence = decAdd(param.confidence, numToDec(factor));
        // Clamp to [0, 1]
        const c = Math.max(0, Math.min(1, decToNum(param.confidence)));
        param.confidence = numToDec(c);
        break;
      }
    }

    return param;
  }

  /**
   * Check if a context matches an override rule's 'when' condition
   * Returns true if ALL non-empty fields in 'when' intersect with 'context'
   */
  private contextMatch(
    when: Partial<TasteContext>,
    ctx: Partial<TasteContext>,
  ): boolean {
    const whenKeys = (Object.keys(when) as (keyof TasteContext)[]).filter(
      (k) => when[k] !== undefined,
    );

    if (whenKeys.length === 0) return false;

    for (const key of whenKeys) {
      const whenVal = when[key];
      const ctxVal = ctx[key];

      if (whenVal === undefined || ctxVal === undefined) return false;

      if (typeof whenVal === "string" && typeof ctxVal === "string") {
        if (whenVal !== ctxVal) return false;
      } else if (Array.isArray(whenVal) && Array.isArray(ctxVal)) {
        const whenArr = whenVal as string[];
        const ctxArr = ctxVal as string[];
        const hasIntersection = whenArr.some((v) => ctxArr.includes(v));
        if (!hasIntersection) return false;
      }
    }

    return true;
  }

  /**
   * Confidence saturation function
   * confidence = saturate(oldConf + gain)
   * Uses logistic-style saturation: 1 / (1 + exp(-c))
   * where c is scaled linearly but capped
   */
  updateConfidence(param: TasteParameter, gain: string): string {
    const current = decToNum(param.confidence);
    const gainNum = decToNum(gain);

    // Simple saturating add with cap at 1.0
    const raw = current + gainNum;
    const saturated = Math.min(1.0, raw);
    const minimum = Math.max(0.0, saturated);

    return numToDec(minimum);
  }

  /**
   * Update a single parameter with a weighted evidence
   * Convenience wrapper that dispatches to appropriate distribution handler
   */
  updateParameter(
    param: TasteParameter,
    evidence: TasteEvidence,
    weight: number,
  ): TasteParameter {
    const distFamily = param.distribution.family;

    if (distFamily === "beta") {
      return this.updateBetaParameter(param, evidence, weight);
    } else if (distFamily === "dirichlet") {
      return this.updateDirichletParameter(param, evidence, weight);
    } else if (distFamily === "bernoulli") {
      return this.updateBernoulliParameter(param, evidence, weight);
    } else if (distFamily === "von_mises") {
      return this.updateVonMisesParameter(param, evidence, weight);
    } else if (distFamily === "gaussian") {
      return this.updateGaussianParameter(param, evidence, weight);
    } else {
      return this.updateWithEma(param, evidence, weight);
    }
  }
}
