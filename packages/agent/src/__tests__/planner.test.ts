import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry, AgentBus } from "@collinx/core";
import { Planner } from "../planner";
import { registerBuiltinTools } from "../tools";
import type { TaskGraph } from "../planner";

describe("Planner", () => {
  let registry: ToolRegistry;
  let bus: AgentBus;
  let planner: Planner;

  beforeEach(() => {
    registry = new ToolRegistry();
    bus = new AgentBus();
    registerBuiltinTools(registry, bus);
    planner = new Planner(registry, bus);
  });

  describe("planTask", () => {
    it("should generate task graph for melody generation intent", () => {
      const graph = planner.planTask("帮我生成一个旋律动机", {});
      expect(graph.steps.length).toBeGreaterThan(0);
      expect(graph.steps[0].toolName).toBe("composer.generateMotif");
      expect(graph.steps[0].status).toBe("pending");
    });

    it("should generate task graph for orchestration intent", () => {
      const graph = planner.planTask("给这首曲子做管弦乐配器", {});
      expect(graph.steps.length).toBeGreaterThan(0);
      expect(graph.steps[0].toolName).toBe("orchestrator.voicingPlan");
    });

    it("should generate task graph for mixing intent", () => {
      const graph = planner.planTask("混音时需要加入混响和压缩效果", {});
      expect(graph.steps.length).toBeGreaterThan(0);
      expect(graph.steps[0].toolName).toBe("mixing.suggestChain");
    });

    it("should generate task graph for engraving intent", () => {
      const graph = planner.planTask("把记谱重新排一下", {});
      expect(graph.steps.length).toBeGreaterThan(0);
      expect(graph.steps[0].toolName).toBe("engraving.reflowLayout");
    });

    it("should generate task graph for development intent", () => {
      const graph = planner.planTask("把这段旋律扩展开来", {});
      expect(graph.steps.length).toBeGreaterThan(0);
      expect(graph.steps[0].toolName).toBe("arranger.expandSection");
    });

    it("should handle English keywords", () => {
      const graph = planner.planTask("generate a motif for the intro", {});
      expect(graph.steps.length).toBeGreaterThan(0);
      expect(graph.steps[0].toolName).toBe("composer.generateMotif");
    });

    it("should match multiple intents", () => {
      const graph = planner.planTask("生成旋律后进行配器编排", {});
      expect(graph.steps.length).toBeGreaterThanOrEqual(2);
    });

    it("should include scope information in params", () => {
      const graph = planner.planTask("写旋律", { barRange: [1, 5] });
      expect(graph.steps.length).toBeGreaterThan(0);
      expect(graph.steps[0].params.bars).toBe(5);
    });

    it("should use provided scope over extracted scope", () => {
      const graph = planner.planTask("生成旋律", { barRange: [1, 8] });
      expect(graph.steps.length).toBeGreaterThan(0);
      expect(graph.steps[0].params.bars).toBe(8);
    });

    it("should respect maxSteps config", () => {
      const limitedPlanner = new Planner(registry, bus, { maxSteps: 1 });
      const graph = limitedPlanner.planTask("生成旋律然后配器然后混音", {});
      expect(graph.steps.length).toBeLessThanOrEqual(1);
    });

    it("should return empty steps for unrecognized intent", () => {
      const graph = planner.planTask("今天天气怎么样", {});
      expect(graph.steps).toHaveLength(0);
    });

    it("should generate valid TaskGraph structure", () => {
      const graph = planner.planTask("生成一段旋律动机", {});
      expect(graph.id).toBeTruthy();
      expect(graph.intent).toBe("生成一段旋律动机");
      expect(graph.createdAt).toBeTruthy();
      expect(Array.isArray(graph.steps)).toBe(true);
    });
  });

  describe("execute", () => {
    it("should execute a simple task graph", async () => {
      bus.registerAgent("test-listener", async () => {});

      const graph: TaskGraph = {
        id: "test-graph-1",
        intent: "generate a motif",
        steps: [
          {
            id: "step-1",
            description: "Generate motif",
            toolName: "composer.generateMotif",
            params: { bars: 2, register: "mid" },
            dependsOn: [],
            status: "pending",
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const results = await planner.execute(graph);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe("ok");
    });

    it("should update status after execution", async () => {
      bus.registerAgent("test-listener", async () => {});

      const graph: TaskGraph = {
        id: "test-graph-2",
        intent: "test",
        steps: [
          {
            id: "step-1",
            description: "Plan task",
            toolName: "planner.planTask",
            params: { intent: "生成旋律" },
            dependsOn: [],
            status: "pending",
          },
        ],
        createdAt: new Date().toISOString(),
      };

      await planner.execute(graph);
      const status = planner.getStatus();
      expect(status.completedTasks).toBeGreaterThanOrEqual(1);
      expect(status.failedTasks).toBe(0);
      expect(status.activeTaskId).toBeNull();
    });

    it("should handle failed tool calls", async () => {
      bus.registerAgent("test-listener", async () => {});

      const graph: TaskGraph = {
        id: "test-graph-3",
        intent: "test",
        steps: [
          {
            id: "step-1",
            description: "Non-existent tool",
            toolName: "nonexistent.tool",
            params: {},
            dependsOn: [],
            status: "pending",
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const results = await planner.execute(graph);
      expect(results[0].status).toBe("error");
      expect(planner.getStatus().failedTasks).toBe(1);
    });
  });

  describe("getStatus", () => {
    it("should return initial empty status", () => {
      const status = planner.getStatus();
      expect(status.activeTaskId).toBeNull();
      expect(status.completedTasks).toBe(0);
      expect(status.failedTasks).toBe(0);
    });
  });
});
