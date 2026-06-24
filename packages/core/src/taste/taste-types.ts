export type DistributionFamily = "beta" | "dirichlet" | "von_mises" | "bernoulli" | "gaussian";

export enum TasteDomain {
  Harmony = "harmony",
  Melody = "melody",
  Rhythm = "rhythm",
  Texture = "texture",
  Timbre = "timbre",
  Form = "form",
  Mix = "mix",
  Reject = "reject",
}

export const TASTE_DOMAINS: TasteDomain[] = [
  TasteDomain.Harmony,
  TasteDomain.Melody,
  TasteDomain.Rhythm,
  TasteDomain.Texture,
  TasteDomain.Timbre,
  TasteDomain.Form,
  TasteDomain.Mix,
  TasteDomain.Reject,
];

export interface TasteContext {
  genre?: string[];
  tempoBpmRange?: [number, number];
  sectionRoles?: string[];
  task?: string;
}

export interface BetaDistribution {
  family: "beta";
  alpha: string;
  beta: string;
}

export interface DirichletDistribution {
  family: "dirichlet";
  alphas: Record<string, string>;
}

export interface VonMisesDistribution {
  family: "von_mises";
  mu: string;
  kappa: string;
}

export interface BernoulliDistribution {
  family: "bernoulli";
  p: string;
}

export interface GaussianDistribution {
  family: "gaussian";
  mean: string;
  variance: string;
}

export type Distribution =
  | BetaDistribution
  | DirichletDistribution
  | VonMisesDistribution
  | BernoulliDistribution
  | GaussianDistribution;

export type EvidenceType =
  | "confirmed_export_diff"
  | "ab_listen_choice"
  | "explicit_reject"
  | "manual_keep"
  | "single_export"
  | "temporary_mode";

export const EVIDENCE_WEIGHTS: Record<EvidenceType, number> = {
  confirmed_export_diff: 1.0,
  ab_listen_choice: 0.65,
  explicit_reject: 1.2,
  manual_keep: 0.85,
  single_export: 0.15,
  temporary_mode: 0.0,
};

export interface TasteEvidence {
  id: string;
  type: EvidenceType;
  paramKey: string;
  pointEstimate?: string;
  positiveMass?: string;
  negativeMass?: string;
  categoryMass?: Record<string, string>;
  context: TasteContext;
  sourceQuality: number;
  timestamp: string;
  ref: string;
  confirmed: boolean;
}

export type DecayPolicy = "exp" | "slow_exp" | "none";

export interface TimeDecay {
  policy: DecayPolicy;
  lambda: string;
}

export interface OverrideRule {
  when: Partial<TasteContext>;
  mode: "suspend" | "downweight" | "boost";
  factor?: string;
}

export interface TasteParameter {
  value: string;
  distribution: Distribution;
  confidence: string;
  context: TasteContext;
  evidence: TasteEvidence[];
  timeDecay: TimeDecay;
  overrideRule?: OverrideRule;
  lastUpdatedAt: string;
}
