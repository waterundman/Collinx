import { z } from "zod";

export const TasteDomainSchema = z.enum([
  "harmony",
  "melody",
  "rhythm",
  "texture",
  "timbre",
  "form",
  "mix",
  "reject",
]);

export const EvidenceTypeSchema = z.enum([
  "confirmed_export_diff",
  "ab_listen_choice",
  "explicit_reject",
  "manual_keep",
  "single_export",
  "temporary_mode",
]);

export const TasteContextSchema = z.object({
  genre: z.array(z.string()).optional(),
  tempoBpmRange: z.tuple([z.number(), z.number()]).optional(),
  sectionRoles: z.array(z.string()).optional(),
  task: z.string().optional(),
});

export const DistributionFamilySchema = z.enum([
  "beta",
  "dirichlet",
  "von_mises",
  "bernoulli",
  "gaussian",
]);

export const BetaDistributionSchema = z.object({
  family: z.literal("beta"),
  alpha: z.string(),
  beta: z.string(),
});

export const DirichletDistributionSchema = z.object({
  family: z.literal("dirichlet"),
  alphas: z.record(z.string(), z.string()),
});

export const VonMisesDistributionSchema = z.object({
  family: z.literal("von_mises"),
  mu: z.string(),
  kappa: z.string(),
});

export const BernoulliDistributionSchema = z.object({
  family: z.literal("bernoulli"),
  p: z.string(),
});

export const GaussianDistributionSchema = z.object({
  family: z.literal("gaussian"),
  mean: z.string(),
  variance: z.string(),
});

export const DistributionSchema = z.discriminatedUnion("family", [
  BetaDistributionSchema,
  DirichletDistributionSchema,
  VonMisesDistributionSchema,
  BernoulliDistributionSchema,
  GaussianDistributionSchema,
]);



export const DecayPolicySchema = z.enum(["exp", "slow_exp", "none"]);

export const TimeDecaySchema = z.object({
  policy: DecayPolicySchema,
  lambda: z.string(),
});

export const OverrideRuleSchema = z.object({
  when: z.record(z.string(), z.unknown()),
  mode: z.enum(["suspend", "downweight", "boost"]),
  factor: z.string().optional(),
});

export const TasteEvidenceSchema = z.object({
  id: z.string(),
  type: EvidenceTypeSchema,
  paramKey: z.string(),
  pointEstimate: z.string().optional(),
  positiveMass: z.string().optional(),
  negativeMass: z.string().optional(),
  categoryMass: z.record(z.string(), z.string()).optional(),
  context: TasteContextSchema,
  sourceQuality: z.number().min(0).max(1),
  timestamp: z.string(),
  ref: z.string(),
  confirmed: z.boolean(),
});



export const TasteParameterSchema = z.object({
  value: z.string(),
  distribution: DistributionSchema,
  confidence: z.string(),
  context: TasteContextSchema,
  evidence: z.array(TasteEvidenceSchema),
  timeDecay: TimeDecaySchema,
  overrideRule: OverrideRuleSchema.optional(),
  lastUpdatedAt: z.string(),
});

export const EmbeddingLayerSchema = z.object({
  symbolicEmbeddingRef: z.string().optional(),
  audioEmbeddingRef: z.string().optional(),
  tagLayer: z.array(
    z.object({
      tag: z.string(),
      strength: z.string(),
    })
  ),
});

export const TasteGenomeSchema = z.object({
  genomeId: z.string(),
  version: z.number().int().min(0),
  numericEncoding: z.literal("decimal128_string"),
  updatedAt: z.string(),
  domains: z.record(z.string(), TasteParameterSchema),
  embeddingLayer: EmbeddingLayerSchema,
});


