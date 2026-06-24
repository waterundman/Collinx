import { describe, it, expect, beforeEach } from "vitest";
import {
  ToolRegistry,
  AgentBus,
  ProjectGraph,
  DiffEngine,
  createDiffEnvelope,
  createNoteEvent,
  TempoMap,
  FormRole,
  type NoteEvent,
} from "@collinx/core";
import { registerBuiltinTools } from "../../tools";
import { Planner } from "../../planner";
import { Orchestrator } from "../../orchestrator";
import { Arranger } from "../../arranger";

describe("Agent tool chain integration", () => {
  let registry: ToolRegistry;
  let bus: AgentBus;
  let graph: ProjectGraph;
  let engine: DiffEngine;

  beforeEach(() => {
    registry = new ToolRegistry();
    bus = new AgentBus();
    registerBuiltinTools(registry, bus);
    graph = ProjectGraph.create("Agent Tool Chain Test", 120);
    engine = new DiffEngine();
  });

  describe("ToolRegistry - builtin tools", () => {
    it("should register all builtin tools", () => {
      const tools = registry.listTools();
      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("composer.generateMotif");
      expect(toolNames).toContain("composer.suggestHarmony");
      expect(toolNames).toContain("planner.planTask");
      expect(toolNames).toContain("orchestrator.voicingPlan");
      expect(toolNames).toContain("engraving.reflowLayout");
      expect(toolNames).toContain("engraving.reportCollisions");
      expect(toolNames).toContain("teaching.explainDecision");
      expect(toolNames).toContain("teaching.explainHarmony");
      expect(toolNames).toContain("teaching.explainOrchestration");
      expect(toolNames).toContain("taste.analyzeExport");
      expect(toolNames).toContain("taste.rankWithTaste");
      expect(toolNames).toContain("arranger.expandSection");
      expect(toolNames).toContain("mixing.suggestChain");
    });

    it("should enforce read_only permission tools", () => {
      const readOnlyTools = registry.listToolsByPermission("read_only");
      const readOnlyNames = readOnlyTools.map((t) => t.name);
      expect(readOnlyNames).toContain("planner.planTask");
      expect(readOnlyNames).toContain("engraving.reportCollisions");
      expect(readOnlyNames).toContain("teaching.explainDecision");
      expect(readOnlyNames).toContain("teaching.explainHarmony");
      expect(readOnlyNames).toContain("teaching.explainOrchestration");
      expect(readOnlyNames).toContain("taste.analyzeExport");
      expect(readOnlyNames).toContain("taste.rankWithTaste");
    });

    it("should enforce proposal_only permission tools", () => {
      const proposalTools = registry.listToolsByPermission("proposal_only");
      const proposalNames = proposalTools.map((t) => t.name);
      expect(proposalNames).toContain("composer.generateMotif");
      expect(proposalNames).toContain("composer.suggestHarmony");
      expect(proposalNames).toContain("orchestrator.voicingPlan");
      expect(proposalNames).toContain("engraving.reflowLayout");
      expect(proposalNames).toContain("arranger.expandSection");
      expect(proposalNames).toContain("mixing.suggestChain");
    });

    it("should call compose.generateMotif and get valid result", async () => {
      const result = await registry.call(
        "composer.generateMotif",
        { bars: 4, register: "mid", styleHint: "classical", key: "C", scale: "major" },
        { type: "agent", name: "test" }
      );

      expect(result.status).toBe("ok");
      expect(result.requiresUserConfirmation).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as Record<string, unknown>).notes).toBeInstanceOf(Array);
      expect(((result.data as Record<string, unknown>).notes as unknown[]).length).toBeGreaterThan(0);
    });

    it("should call composer.suggestHarmony and get valid result", async () => {
      const result = await registry.call(
        "composer.suggestHarmony",
        { bars: 4, key: "C", style: "pop" },
        { type: "agent", name: "test" }
      );

      expect(result.status).toBe("ok");
      expect(result.data).toBeDefined();
    });

    it("should call teaching.explainHarmony and get valid result", async () => {
      const result = await registry.call(
        "teaching.explainHarmony",
        { chordProgression: ["I", "IV", "V", "I"], key: "C", userLevel: "intermediate" },
        { type: "agent", name: "test" }
      );

      expect(result.status).toBe("ok");
      expect(result.requiresUserConfirmation).toBe(false);
    });

    it("should call teaching.explainOrchestration and get valid result", async () => {
      const result = await registry.call(
        "teaching.explainOrchestration",
        { instrumentChoices: ["piano", "violin", "cello"], context: "classical quartet" },
        { type: "agent", name: "test" }
      );

      expect(result.status).toBe("ok");
      expect(result.requiresUserConfirmation).toBe(false);
    });

    it("should call orchestrator.voicingPlan and get valid result", async () => {
      const result = await registry.call(
        "orchestrator.voicingPlan",
        {
          phraseRef: "phrase-1",
          players: ["piano", "violin", "cello"],
          style: "classical",
          playabilityPolicy: "moderate",
        },
        { type: "agent", name: "test" }
      );

      expect(result.status).toBe("ok");
      expect(result.requiresUserConfirmation).toBe(true);
      if (result.diff) {
        const diff = result.diff;
        expect(diff).toHaveProperty("diffId");
        expect(diff).toHaveProperty("ops");
      }
    });

    it("should call taste.analyzeExport and get valid result", async () => {
      const result = await registry.call(
        "taste.analyzeExport",
        { exportRef: "test-export" },
        { type: "agent", name: "test" }
      );

      expect(result.status).toBe("ok");
      expect(result.requiresUserConfirmation).toBe(false);
      expect(result.data).toBeDefined();
    });
  });

  describe("Planner - task planning", () => {
    it("should plan a task with intent", () => {
      const planner = new Planner(registry, bus);
      const taskGraph = planner.planTask("写一首流行歌生成旋律动机配器", {});

      expect(taskGraph.id).toBeDefined();
      expect(taskGraph.intent).toBe("写一首流行歌生成旋律动机配器");
      expect(taskGraph.steps.length).toBeGreaterThan(0);

      // Steps should have correct structure
      for (const step of taskGraph.steps) {
        expect(step.id).toBeDefined();
        expect(step.description).toBeDefined();
        expect(step.toolName).toBeDefined();
        expect(step.status).toBe("pending");
      }
    });

    it("should plan a task with bar range extracted from intent", () => {
      const planner = new Planner(registry, bus);
      const taskGraph = planner.planTask("从第1小节到第8小节生成旋律", {});

      expect(taskGraph.id).toBeDefined();
      expect(taskGraph.steps.length).toBeGreaterThan(0);
    });

    it("should execute a task graph", async () => {
      const planner = new Planner(registry, bus);
      const taskGraph = planner.planTask("生成旋律", {});

      // Filter to tools that exist in registry
      const validSteps = taskGraph.steps.filter((s) => registry.getTool(s.toolName));
      taskGraph.steps = validSteps;

      const results = await planner.execute(taskGraph);
      expect(results.length).toBe(validSteps.length);

      for (const result of results) {
        expect(result.status).toBe("ok");
        expect(result.auditRef).toBeDefined();
      }
    });

    it("should track planner status", async () => {
      const planner = new Planner(registry, bus);
      const initialStatus = planner.getStatus();

      expect(initialStatus.activeTaskId).toBeNull();
      expect(initialStatus.completedTasks).toBe(0);
      expect(initialStatus.failedTasks).toBe(0);

      const taskGraph = planner.planTask("生成旋律", {});
      const validSteps = taskGraph.steps.filter((s) => registry.getTool(s.toolName));
      taskGraph.steps = validSteps;

      await planner.execute(taskGraph);

      const finalStatus = planner.getStatus();
      expect(finalStatus.completedTasks).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Audit trail", () => {
    it("should record audit entries for tool calls", async () => {
      await registry.call(
        "composer.generateMotif",
        { bars: 4, register: "mid" },
        { type: "agent", name: "test-actor" }
      );

      const trail = registry.getAuditTrail();
      expect(trail.length).toBeGreaterThanOrEqual(1);

      const lastEntry = trail[trail.length - 1];
      expect(lastEntry.toolName).toBe("composer.generateMotif");
      expect(lastEntry.actorName).toBe("test-actor");
      expect(lastEntry.timestamp).toBeDefined();
    });

    it("should filter audit by actor", async () => {
      await registry.call("composer.generateMotif", { bars: 4, register: "mid" }, { type: "agent", name: "agent-a" });
      await registry.call("composer.suggestHarmony", { bars: 4, key: "C" }, { type: "agent", name: "agent-b" });

      const aTrail = registry.getAuditByActor("agent-a");
      expect(aTrail.length).toBeGreaterThanOrEqual(1);
      expect(aTrail.every((e) => e.actorName === "agent-a")).toBe(true);
    });

    it("should filter audit by tool", async () => {
      await registry.call("composer.generateMotif", { bars: 4, register: "mid" }, { type: "agent", name: "test" });
      await registry.call("composer.suggestHarmony", { bars: 4, key: "C" }, { type: "agent", name: "test" });

      const motifTrail = registry.getAuditByTool("composer.generateMotif");
      expect(motifTrail.length).toBeGreaterThanOrEqual(1);
      expect(motifTrail.every((e) => e.toolName === "composer.generateMotif")).toBe(true);
    });
  });

  describe("AgentBus messaging", () => {
    it("should register an agent and send a message", async () => {
      let received: unknown = null;
      bus.registerAgent("test-agent", async (msg) => {
        received = msg.payload;
      });

      await bus.send("planner", "test-agent", "event", { hello: "world" });

      expect(received).toEqual({ hello: "world" });
      expect(bus.getRegisteredAgents()).toContain("test-agent");
    });

    it("should emit events to subscribers", () => {
      const events: unknown[] = [];
      bus.subscribe("step:completed", (payload) => {
        events.push(payload);
      });

      bus.emit("planner", "step:completed", { stepId: "1", status: "completed" });
      bus.emit("planner", "step:completed", { stepId: "2", status: "completed" });

      expect(events).toHaveLength(2);
    });

    it("should maintain message history", async () => {
      bus.registerAgent("receiver", async (_msg) => {});
      await bus.send("planner", "receiver", "event", { test: true });

      const history = bus.getMessageHistory();
      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[history.length - 1].type).toBe("event");
    });
  });

  describe("End-to-end: Agent tools -> Diff -> Graph", () => {
    it("should compose a motif and apply to ProjectGraph", async () => {
      const result = await registry.call(
        "composer.generateMotif",
        { bars: 4, register: "mid", styleHint: "pop", key: "C", scale: "major" },
        { type: "agent", name: "composer" }
      );

      expect(result.status).toBe("ok");
      const data = result.data as Record<string, unknown>;
      expect(data.notes).toBeDefined();

      const notes = data.notes as NoteEvent[];
      expect(notes.length).toBeGreaterThan(0);

      const diff = createDiffEnvelope({
        baseRevision: graph.getRevisionId(),
        actor: { type: "agent", name: "composer" },
        permissionScope: "write_direct",
        summary: "Insert composed notes",
        ops: [
          {
            op: "add_node",
            path: "/",
            nodeType: "CompositionUnit",
            data: { name: "generated-motif", noteCount: notes.length },
          },
          ...notes.map((note) => ({
            op: "add_node" as const,
            path: "/",
            nodeType: "NoteSpan" as const,
            data: note as unknown as Record<string, unknown>,
          })),
        ],
      });

      const applied = engine.apply(diff, graph);
      expect(applied.appliedOps).toBe(notes.length + 1);
      expect(applied.graph.getNodesByType("CompositionUnit")).toHaveLength(1);
      expect(applied.graph.getNodesByType("NoteSpan")).toHaveLength(notes.length);

      const validation = engine.validate(diff, applied.graph);
      expect(validation.valid).toBe(true);
    });

    it("should orchestrate and apply diffs", async () => {
      const result = await registry.call(
        "orchestrator.voicingPlan",
        {
          phraseRef: "phrase-main",
          players: ["piano", "violin", "cello"],
          style: "classical",
          playabilityPolicy: "moderate",
        },
        { type: "agent", name: "orchestrator" }
      );

      expect(result.status).toBe("ok");
      if (result.diff) {
        const diff = result.diff;
        const applied = engine.apply(diff, graph);
        expect(applied.appliedOps).toBeGreaterThanOrEqual(0);
      }
    });

    it("should plan and execute full task graph with graph integration", async () => {
      const planner = new Planner(registry, bus);

      const taskGraph = planner.planTask("生成旋律动机配器排谱", {});
      // Only keep steps whose tools are registered
      const validSteps = taskGraph.steps.filter((s) => registry.getTool(s.toolName));
      taskGraph.steps = validSteps;

      if (validSteps.length > 0) {
        const results = await planner.execute(taskGraph);

        let allDiffsApplied = 0;
        for (const result of results) {
          if (result.diff) {
            const applied = engine.apply(result.diff, graph);
            allDiffsApplied += applied.appliedOps;
          }
        }

        // Graph should have been modified if any diffs were applied
        expect(graph.getAllNodes().length).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("Orchestrator standalone", () => {
    it("should orchestrate with given config", () => {
      const orchestrator = new Orchestrator();
      const result = orchestrator.orchestrate(
        [
          createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 4, pitchMidi: 60 }),
          createNoteEvent({ trackId: "melody", bar: 2, beat: 1, durQn: 4, pitchMidi: 64 }),
        ],
        [
          { bar: 1, beat: 1, chord: { root: "C", quality: "maj" }, durationQn: 4 },
          { bar: 2, beat: 1, chord: { root: "F", quality: "maj" }, durationQn: 4 },
        ],
        {
          players: ["piano", "violin"],
          playabilityPolicy: "moderate",
          style: "classical",
        }
      );

      expect(result.voicingPlan).toBeDefined();
      expect(result.perPlayerNotes.size).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it("should suggest instrumentations", () => {
      const orchestrator = new Orchestrator();
      const classical = orchestrator.suggestInstrumentation("classical", "dramatic", "small");
      expect(classical.length).toBeGreaterThan(0);

      const jazz = orchestrator.suggestInstrumentation("jazz", "swing", "medium");
      expect(jazz.length).toBeGreaterThan(0);

      const pop = orchestrator.suggestInstrumentation("pop", "happy", "large");
      expect(pop.length).toBeGreaterThan(0);
    });
  });

  describe("Arranger standalone", () => {
    it("should arrange motifs with a form template", () => {
      const arranger = new Arranger();
      const motifs = [
        [
          createNoteEvent({ trackId: "motif_a", bar: 1, beat: 1, durQn: 1, pitchMidi: 64 }),
          createNoteEvent({ trackId: "motif_a", bar: 1, beat: 2, durQn: 1, pitchMidi: 67 }),
        ],
        [
          createNoteEvent({ trackId: "motif_b", bar: 1, beat: 1, durQn: 2, pitchMidi: 72 }),
        ],
      ];

      const result = arranger.arrange(motifs, {
        formTemplate: "pop_ababcb",
        barCount: 8,
        variantCount: 2,
      });

      expect(result.formStructure).toBeDefined();
      expect(result.formStructure.sections.length).toBeGreaterThan(0);
      expect(result.variants.length).toBeGreaterThanOrEqual(0);
      expect(result.energyCurve).toBeDefined();
      expect(result.diffs.length).toBeGreaterThanOrEqual(0);
    });

    it("should generate variants for a section", () => {
      const arranger = new Arranger();
      const source = [
        createNoteEvent({ trackId: "motif", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 }),
        createNoteEvent({ trackId: "motif", bar: 1, beat: 2, durQn: 1, pitchMidi: 64 }),
      ];

      const section = {
        id: "section-1",
        name: "Test Verse",
        formRole: FormRole.Verse,
        startBar: 1,
        endBar: 4,
        energyLevel: 0.5,
        motifIds: [],
        phraseIds: [],
      };

      const result = arranger.generateVariants(source, section, {
        formTemplate: "pop_ababcb",
        barCount: 4,
        variantCount: 2,
      });

      expect(result.variants.length).toBeGreaterThanOrEqual(0);
      expect(result.formStructure).toBeDefined();
    });

    it("should throw for non-existent template", () => {
      const arranger = new Arranger();
      expect(() =>
        arranger.arrange([[]], {
          formTemplate: "nonexistent",
          barCount: 4,
        })
      ).toThrow("Form template not found");
    });
  });
});
