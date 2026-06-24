import type { ToolRegistry, AgentBus } from "@collinx/core";
import { randomUUID, TempoMap } from "@collinx/core";
import { Composer } from "./composer";
import { Planner } from "./planner";
import { Orchestrator } from "./orchestrator";
import { EngravingAgent } from "./engraving";
import { TeachingAgent } from "./teaching";
import { TasteMemoryAgent } from "./taste-memory";
import { MixingAgent } from "./mixing/mixing-agent";

function stubResult(description: string) {
  return {
    status: "ok" as const,
    resultType: "proposal" as const,
    data: { message: `${description} (stub - v0.1.0)` },
    confidence: 0.3,
    requiresUserConfirmation: true,
    auditRef: randomUUID(),
  };
}

export function registerBuiltinTools(
  registry: ToolRegistry,
  bus: AgentBus
): void {
  const composer = new Composer(registry);
  const planner = new Planner(registry, bus);

  registry.register({
    name: "composer.generateMotif",
    description: "生成旋律动机/种子",
    permission: "proposal_only",
    parameters: [
      { name: "bars", type: "number", required: true, description: "小节数" },
      { name: "register", type: "string", required: true, description: "音区: low/mid/high" },
      { name: "styleHint", type: "string", required: false, description: "风格提示" },
      { name: "key", type: "string", required: false, description: "调性" },
      { name: "scale", type: "string", required: false, description: "音阶类型" },
    ],
    handler: async (params) => {
      return composer.generateMotif({
        bars: params.bars as number,
        register: params.register as "low" | "mid" | "high",
        styleHint: params.styleHint as string | undefined,
        key: params.key as string | undefined,
        scale: params.scale as string | undefined,
      });
    },
  });

  registry.register({
    name: "composer.suggestHarmony",
    description: "生成和声进行建议",
    permission: "proposal_only",
    parameters: [
      { name: "bars", type: "number", required: true, description: "小节数" },
      { name: "key", type: "string", required: true, description: "调性" },
      { name: "style", type: "string", required: false, description: "风格" },
    ],
    handler: async (params) => {
      return composer.suggestHarmony({
        bars: params.bars as number,
        key: params.key as string,
        style: params.style as string | undefined,
      });
    },
  });

  registry.register({
    name: "planner.planTask",
    description: "将自然语言目标转为任务图",
    permission: "read_only",
    parameters: [
      { name: "intent", type: "string", required: true, description: "用户意图" },
    ],
    handler: async (params) => {
      const graph = planner.planTask(params.intent as string, {});
      return {
        status: "ok",
        resultType: "data",
        data: graph,
        confidence: 0.8,
        requiresUserConfirmation: false,
        auditRef: stubResult("").auditRef,
      };
    },
  });

  registry.register({
    name: "orchestrator.voicingPlan",
    description: "生成配器/声部编排方案",
    permission: "proposal_only",
    parameters: [
      { name: "phraseRef", type: "string", required: true, description: "乐句引用" },
      { name: "players", type: "array", required: true, description: "目标乐器ID列表" },
      { name: "style", type: "string", required: false, description: "风格: classical/pop/cinematic/jazz" },
      { name: "playabilityPolicy", type: "string", required: false, description: "可演奏性策略: strict/moderate/lenient" },
      { name: "doubleOctaves", type: "boolean", required: false, description: "允许八度重复" },
      { name: "maxVoices", type: "number", required: false, description: "最大声部数" },
    ],
    handler: async (params) => {
      const orchestrator = new Orchestrator();
      const result = orchestrator.voicingPlan(
        params.phraseRef as string,
        params.players as string[],
        {
          players: params.players as string[],
          style: (params.style as "classical" | "pop" | "cinematic" | "jazz") ?? "classical",
          playabilityPolicy: (params.playabilityPolicy as "strict" | "moderate" | "lenient") ?? "moderate",
          doubleOctaves: params.doubleOctaves as boolean | undefined,
          maxVoices: params.maxVoices as number | undefined,
        },
      );
      return {
        status: "ok",
        resultType: "proposal",
        data: {
          voicingPlan: result.voicingPlan,
          perPlayerNotes: Array.from(result.perPlayerNotes).map(([k, v]) => [k, v.length]),
          conflicts: result.conflicts,
          suggestions: result.suggestions,
          confidence: result.confidence,
        },
        diffs: result.diffs,
        confidence: result.confidence,
        requiresUserConfirmation: true,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "mixing.suggestChain",
    description: "建议效果链",
    permission: "proposal_only",
    parameters: [
      { name: "trackId", type: "string", required: false, description: "目标轨道ID" },
      { name: "style", type: "string", required: false, description: "风格提示" },
    ],
    handler: async (params) => {
      const mixing = new MixingAgent();
      const sourceId = (params.trackId as string) ?? "default";
      const chain = mixing.suggestChain(sourceId);
      return {
        status: "ok" as const,
        resultType: "proposal" as const,
        data: {
          sourceId,
          fxChain: chain,
          slotCount: chain.length,
        },
        confidence: 0.8,
        requiresUserConfirmation: true,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "engraving.reflowLayout",
    description: "重新排布乐谱布局",
    permission: "proposal_only",
    parameters: [
      { name: "layoutId", type: "string", required: true, description: "布局ID" },
      { name: "houseStyle", type: "string", required: false, description: "乐谱风格: henle/schirmer/peters/modern" },
      { name: "collisionPolicy", type: "string", required: false, description: "冲突处理策略: auto_fix/report_only" },
    ],
    handler: async (params) => {
      const engraving = new EngravingAgent();
      const diff = engraving.reflowLayout(
        params.layoutId as string,
        (params.houseStyle as string) ?? "modern",
        (params.collisionPolicy as "auto_fix" | "report_only") ?? "report_only"
      );
      return {
        status: "ok",
        resultType: "proposal",
        data: {
          layoutId: params.layoutId,
          ops: diff.ops,
          collisionSummary: diff.summary,
        },
        diff,
        confidence: 0.8,
        requiresUserConfirmation: true,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "engraving.reportCollisions",
    description: "报告乐谱排版冲突",
    permission: "read_only",
    parameters: [
      { name: "layoutId", type: "string", required: true, description: "布局ID" },
    ],
    handler: async (params) => {
      const engraving = new EngravingAgent();
      const report = engraving.reportCollisions(params.layoutId as string);
      return {
        status: "ok",
        resultType: "data",
        data: report,
        confidence: 0.9,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "teaching.explainDecision",
    description: "解释某个音乐决策",
    permission: "read_only",
    parameters: [
      { name: "diffId", type: "string", required: true, description: "Diff ID" },
      { name: "userLevel", type: "string", required: false, description: "用户水平: beginner/intermediate/advanced/expert" },
      { name: "compareWithAlt", type: "boolean", required: false, description: "是否包含替代方案" },
    ],
    handler: async (params) => {
      const teaching = new TeachingAgent();
      const explanation = teaching.explainDecision(
        params.diffId as string,
        (params.userLevel as "beginner" | "intermediate" | "advanced" | "expert") ?? "intermediate",
        (params.compareWithAlt as boolean) ?? false
      );
      return {
        status: "ok",
        resultType: "data",
        data: explanation,
        confidence: 0.85,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "teaching.explainHarmony",
    description: "解释和声进行",
    permission: "read_only",
    parameters: [
      { name: "chordProgression", type: "array", required: true, description: "和弦进行 (如 ['I','IV','V','I'])" },
      { name: "key", type: "string", required: true, description: "调性" },
      { name: "userLevel", type: "string", required: false, description: "用户水平" },
    ],
    handler: async (params) => {
      const teaching = new TeachingAgent();
      const explanation = teaching.explainHarmony(
        params.chordProgression as string[],
        params.key as string,
        (params.userLevel as "beginner" | "intermediate" | "advanced" | "expert") ?? "intermediate"
      );
      return {
        status: "ok",
        resultType: "data",
        data: explanation,
        confidence: 0.85,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "teaching.explainOrchestration",
    description: "解释配器决策",
    permission: "read_only",
    parameters: [
      { name: "instrumentChoices", type: "array", required: true, description: "乐器ID列表" },
      { name: "context", type: "string", required: false, description: "配器上下文" },
      { name: "userLevel", type: "string", required: false, description: "用户水平" },
    ],
    handler: async (params) => {
      const teaching = new TeachingAgent();
      const explanation = teaching.explainOrchestration(
        params.instrumentChoices as string[],
        (params.context as string) ?? "general",
        (params.userLevel as "beginner" | "intermediate" | "advanced" | "expert") ?? "intermediate"
      );
      return {
        status: "ok",
        resultType: "data",
        data: explanation,
        confidence: 0.85,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "taste.analyzeExport",
    description: "分析导出版本并生成口味证据",
    permission: "read_only",
    parameters: [
      { name: "exportRef", type: "string", required: true, description: "导出引用" },
    ],
    handler: async (params) => {
      const taste = new TasteMemoryAgent();
      const notes: any[] = [];
      const tempoMap = TempoMap.default();
      const result = taste.analyzeExport(notes, tempoMap, params.exportRef as string);
      return {
        status: "ok",
        resultType: "data",
        data: {
          exportId: result.exportId,
          evidenceCount: result.evidenceSet.length,
          comparisonCount: result.genomeComparison.length,
          tasteDiffSummary: result.tasteDiffSummary,
        },
        confidence: 0.75,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "taste.rankWithTaste",
    description: "使用品味排序候选方案",
    permission: "read_only",
    parameters: [
      { name: "candidates", type: "array", required: true, description: "候选方案列表" },
    ],
    handler: async (params) => {
      const taste = new TasteMemoryAgent();
      const candidatesList = (params.candidates as any[]) ?? [];
      const ranked = taste.rankWithTaste(candidatesList, {});
      return {
        status: "ok",
        resultType: "data",
        data: { ranked: ranked.map((r) => ({ rank: r.rank, totalScore: r.score.totalScore })) },
        confidence: 0.8,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "arranger.expandSection",
    description: "展开/扩展乐段",
    permission: "proposal_only",
    parameters: [
      { name: "bars", type: "number", required: false, description: "扩展小节数" },
      { name: "style", type: "string", required: false, description: "风格提示" },
    ],
    handler: async () => stubResult("段落扩展"),
  });
}
