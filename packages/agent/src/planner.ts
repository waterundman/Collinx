import type { ToolRegistry, ToolResult, AgentBus } from "@collinx/core";
import { randomUUID } from "@collinx/core";

export interface TaskStep {
  id: string;
  description: string;
  toolName: string;
  params: Record<string, unknown>;
  dependsOn: string[];
  status: "pending" | "running" | "completed" | "failed";
}

export interface TaskGraph {
  id: string;
  intent: string;
  steps: TaskStep[];
  createdAt: string;
}

export interface PlannerConfig {
  tasteProfileRef?: string;
  maxSteps?: number;
  contextTokens?: number;
}

interface KeywordRule {
  keywords: string[];
  toolName: string;
  description: string;
  params: Record<string, unknown>;
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    keywords: ["生成旋律", "动机", "motif", "旋律种子", "写旋律", "创作旋律"],
    toolName: "composer.generateMotif",
    description: "生成旋律动机/种子",
    params: { bars: 4, register: "mid" },
  },
  {
    keywords: ["配器", "orchestrate", "乐器", "编制", "管弦乐", "配器编排"],
    toolName: "orchestrator.voicingPlan",
    description: "生成配器/声部编排方案",
    params: {},
  },
  {
    keywords: ["混音", "mix", "效果", "效果器", "混响", "均衡", "压缩"],
    toolName: "mixing.suggestChain",
    description: "建议效果链",
    params: {},
  },
  {
    keywords: ["排谱", "记谱", "score", "制谱", "乐谱", "打谱"],
    toolName: "engraving.reflowLayout",
    description: "重新排布乐谱布局",
    params: {},
  },
  {
    keywords: ["扩段", "展开", "develop", "发展", "变奏", "段落扩展"],
    toolName: "arranger.expandSection",
    description: "展开/扩展乐段",
    params: {},
  },
];

function matchIntent(intent: string): KeywordRule[] {
  const lowerIntent = intent.toLowerCase();
  const matched: KeywordRule[] = [];

  for (const rule of KEYWORD_RULES) {
    const matchedKeywords = rule.keywords.filter((kw) =>
      lowerIntent.includes(kw.toLowerCase())
    );
    if (matchedKeywords.length > 0) {
      matched.push(rule);
    }
  }

  return matched;
}

function extractScope(intent: string): { barRange?: [number, number]; tracks?: string[] } {
  const scope: { barRange?: [number, number]; tracks?: string[] } = {};

  const barRangeMatch = intent.match(/(\d+)\s*[-~到至]\s*(\d+)\s*(小节|bar[s]?)/i);
  if (barRangeMatch) {
    scope.barRange = [parseInt(barRangeMatch[1], 10), parseInt(barRangeMatch[2], 10)];
  }

  const barSingleMatch = intent.match(/(?:前|第)?\s*(\d+)\s*(小节|bar)/i);
  if (barSingleMatch && !scope.barRange) {
    const bar = parseInt(barSingleMatch[1], 10);
    scope.barRange = [bar, bar];
  }

  const trackMatch = intent.match(/轨道\s*[：:]\s*([^\s,，]+(?:[,\s,，]+[^\s,，]+)*)/);
  if (trackMatch) {
    scope.tracks = trackMatch[1].split(/[\s,，]+/).filter(Boolean);
  }

  return scope;
}

export class Planner {
  private registry: ToolRegistry;
  private bus: AgentBus;
  private config: PlannerConfig;
  private activeTaskId: string | null = null;
  private completedTasks = 0;
  private failedTasks = 0;

  constructor(
    registry: ToolRegistry,
    bus: AgentBus,
    config?: PlannerConfig
  ) {
    this.registry = registry;
    this.bus = bus;
    this.config = config ?? {};
  }

  planTask(
    intent: string,
    scope: { barRange?: [number, number]; tracks?: string[] }
  ): TaskGraph {
    const rules = matchIntent(intent);
    const scopeFromIntent = extractScope(intent);
    const mergedScope = {
      barRange: scope.barRange ?? scopeFromIntent.barRange,
      tracks: scope.tracks ?? scopeFromIntent.tracks,
    };

    const steps: TaskStep[] = rules.map((rule, index) => {
      const params = { ...rule.params };

      if (mergedScope.barRange) {
        params.bars = mergedScope.barRange[1] - mergedScope.barRange[0] + 1;
      }
      if (mergedScope.tracks) {
        params.tracks = mergedScope.tracks;
      }

      return {
        id: randomUUID(),
        description: rule.description,
        toolName: rule.toolName,
        params,
        dependsOn: index > 0 ? [rules[index - 1].toolName] : [],
        status: "pending" as const,
      };
    });

    const maxSteps = this.config.maxSteps ?? 10;
    const limitedSteps = steps.slice(0, maxSteps);

    return {
      id: randomUUID(),
      intent,
      steps: limitedSteps,
      createdAt: new Date().toISOString(),
    };
  }

  async execute(graph: TaskGraph): Promise<ToolResult[]> {
    this.activeTaskId = graph.id;
    const results: ToolResult[] = [];
    const completed = new Set<string>();

    while (completed.size < graph.steps.length) {
      for (const step of graph.steps) {
        if (completed.has(step.id)) continue;

        const depsReady = step.dependsOn.every((depToolName) => {
          return graph.steps
            .filter((s) => s.toolName === depToolName)
            .every((s) => completed.has(s.id));
        });

        if (!depsReady) continue;

        step.status = "running";
        this.bus.emit("planner", "step:started", {
          taskId: graph.id,
          stepId: step.id,
          toolName: step.toolName,
        });

        const result = await this.registry.call(
          step.toolName,
          step.params,
          { type: "agent", name: "planner" }
        );

        step.status = result.status === "ok" ? "completed" : "failed";
        if (step.status === "completed") {
          this.completedTasks++;
        } else {
          this.failedTasks++;
        }

        this.bus.emit("planner", "step:completed", {
          taskId: graph.id,
          stepId: step.id,
          status: step.status,
        });

        results.push(result);
        completed.add(step.id);
      }
    }

    this.activeTaskId = null;
    return results;
  }

  getStatus(): {
    activeTaskId: string | null;
    completedTasks: number;
    failedTasks: number;
  } {
    return {
      activeTaskId: this.activeTaskId,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
    };
  }
}
