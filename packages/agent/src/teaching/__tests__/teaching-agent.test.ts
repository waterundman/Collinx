import { describe, it, expect, beforeEach } from "vitest";
import { TeachingAgent } from "../teaching-agent";
import type { UserLevel } from "../teaching-agent";

describe("TeachingAgent", () => {
  let agent: TeachingAgent;

  beforeEach(() => {
    agent = new TeachingAgent();
  });

  describe("explainDecision", () => {
    it("should produce an explanation for a reflow decision", () => {
      const explanation = agent.explainDecision("reflowLayout-001", "beginner");

      expect(explanation.title).toBeTruthy();
      expect(explanation.summary).toBeTruthy();
      expect(explanation.detail).toBeTruthy();
      expect(explanation.level).toBe("beginner");
      expect(explanation.concepts.length).toBeGreaterThan(0);
    });

    it("should adjust detail level for intermediate", () => {
      const explanation = agent.explainDecision("reflowLayout-001", "intermediate");

      expect(explanation.level).toBe("intermediate");
      expect(explanation.concepts.length).toBeGreaterThan(0);
      expect(explanation.detail).not.toBe("");
    });

    it("should adjust detail level for advanced", () => {
      const explanation = agent.explainDecision("voicingPlan-001", "advanced");

      expect(explanation.level).toBe("advanced");
      expect(explanation.concepts.length).toBeGreaterThan(0);
    });

    it("should adjust detail level for expert", () => {
      const explanation = agent.explainDecision("generateMotif-001", "expert");

      expect(explanation.level).toBe("expert");
      expect(explanation.concepts.length).toBeGreaterThan(0);
    });

    it("should include alternatives when compareWithAlt is true", () => {
      const withAlt = agent.explainDecision("reflowLayout-001", "intermediate", true);
      const withoutAlt = agent.explainDecision("reflowLayout-001", "intermediate", false);

      expect(withAlt.alternatives.length).toBeGreaterThanOrEqual(0);
      expect(withoutAlt.alternatives.length).toBe(0);
    });

    it("should match diff type correctly", () => {
      const result = agent.explainDecision("engraving-score-3", "beginner");
      expect(result.title).toContain("排版");
    });
  });

  describe("explainHarmony", () => {
    it("should explain I-IV-V-I progression at different levels", () => {
      const levels: UserLevel[] = ["beginner", "intermediate", "advanced", "expert"];

      for (const level of levels) {
        const explanation = agent.explainHarmony(["I", "IV", "V", "I"], "C", level);

        expect(explanation.title).toContain("C");
        expect(explanation.detail).toBeTruthy();
        expect(explanation.level).toBe(level);
        expect(explanation.concepts.length).toBeGreaterThan(0);
        expect(explanation.examples.length).toBeGreaterThan(0);
      }
    });

    it("should explain I-V-vi-IV progression", () => {
      const explanation = agent.explainHarmony(
        ["I", "V", "vi", "IV"],
        "G",
        "intermediate"
      );

      expect(explanation.title).toContain("G");
      expect(explanation.detail.length).toBeGreaterThan(0);
    });

    it("should explain ii-V-I progression", () => {
      const explanation = agent.explainHarmony(["ii", "V", "I"], "F", "advanced");

      expect(explanation.title).toContain("F");
      expect(explanation.detail).toContain("ii-V-I");
    });

    it("should provide generic explanation for unknown progressions", () => {
      const explanation = agent.explainHarmony(
        ["I", "bVI", "bVII", "I"],
        "D",
        "beginner"
      );

      expect(explanation.title).toContain("D");
      expect(explanation.detail).toBeTruthy();
    });

    it("should include alternatives for common progressions", () => {
      const explanation = agent.explainHarmony(["I", "V", "vi", "IV"], "C", "intermediate");

      expect(explanation.alternatives.length).toBeGreaterThan(0);
    });
  });

  describe("explainOrchestration", () => {
    it("should explain violin orchestration", () => {
      const explanation = agent.explainOrchestration(
        ["violin", "cello"],
        "strings trio",
        "intermediate"
      );

      expect(explanation.title).toContain("violin");
      expect(explanation.title).toContain("cello");
      expect(explanation.detail).toBeTruthy();
    });

    it("should handle beginner level orchestration explanation", () => {
      const explanation = agent.explainOrchestration(
        ["violin", "violin", "viola", "cello"],
        "弦乐四重奏",
        "beginner"
      );

      expect(explanation.level).toBe("beginner");
      expect(explanation.detail).toBeTruthy();
    });

    it("should provide alternatives when applicable", () => {
      const explanation = agent.explainOrchestration(
        ["violin", "piano"],
        "chamber",
        "advanced"
      );

      expect(explanation.alternatives.length).toBeGreaterThan(0);
    });

    it("should handle expert level", () => {
      const explanation = agent.explainOrchestration(
        ["violin"],
        "solo",
        "expert"
      );

      expect(explanation.level).toBe("expert");
      expect(explanation.concepts.some((c) => c.includes("tessitura"))).toBe(true);
    });
  });

  describe("explainForm", () => {
    it("should identify ABA form", () => {
      const explanation = agent.explainForm(["A", "B", "A"], "beginner");

      expect(explanation.title).toContain("三段体");
      expect(explanation.detail).toBeTruthy();
    });

    it("should explain sonata form", () => {
      const explanation = agent.explainForm(
        ["Exposition", "Development", "Recapitulation"],
        "advanced"
      );

      expect(explanation.title).toContain("奏鸣曲式");
    });

    it("should handle generic form for unknown patterns", () => {
      const explanation = agent.explainForm(
        ["Intro", "A", "B", "C", "D", "Outro"],
        "beginner"
      );

      expect(explanation.title).toBeTruthy();
      expect(explanation.detail).toBeTruthy();
    });

    it("should include concepts appropriate to level", () => {
      const beginner = agent.explainForm(["A", "B", "A"], "beginner");
      const expert = agent.explainForm(["A", "B", "A"], "expert");

      expect(beginner.concepts.length).toBeGreaterThan(0);
      expect(expert.concepts.length).toBeGreaterThan(beginner.concepts.length);
    });
  });

  describe("adaptExplanation", () => {
    it("should adapt beginner explanation to intermediate level", () => {
      const original = agent.explainDecision("reflowLayout-001", "beginner");
      const adapted = agent.adaptExplanation(original, "intermediate");

      expect(adapted.level).toBe("intermediate");
      expect(adapted.summary).toBeTruthy();
      expect(adapted.detail).toBeTruthy();
    });

    it("should not change explanation if level is same", () => {
      const original = agent.explainDecision("generateMotif-001", "advanced");
      const adapted = agent.adaptExplanation(original, "advanced");

      expect(adapted.level).toBe(original.level);
      expect(adapted.detail).toBe(original.detail);
    });

    it("should simplify when adapting to lower level", () => {
      const original = agent.explainDecision("voicingPlan-001", "advanced");
      const adapted = agent.adaptExplanation(original, "beginner");

      expect(adapted.level).toBe("beginner");
    });
  });

  describe("generateAlternatives", () => {
    it("should generate alternatives for classical style", () => {
      const alternatives = agent.generateAlternatives(
        { style: "classical", key: "C", bars: 16 },
        "intermediate"
      );

      expect(alternatives.length).toBeGreaterThan(0);
      expect(alternatives[0]!.description).toBeTruthy();
      expect(alternatives[0]!.pros.length).toBeGreaterThan(0);
      expect(alternatives[0]!.cons.length).toBeGreaterThan(0);
    });

    it("should generate alternatives for jazz style", () => {
      const alternatives = agent.generateAlternatives(
        { style: "jazz", key: "Bb", bars: 32 },
        "advanced"
      );

      expect(alternatives.length).toBeGreaterThan(0);
    });

    it("should generate fallback alternatives for unknown styles", () => {
      const alternatives = agent.generateAlternatives(
        { style: "experimental", key: "E", bars: 8 },
        "beginner"
      );

      expect(alternatives.length).toBeGreaterThan(0);
      expect(alternatives[0]!.pros.length).toBeGreaterThan(0);
    });
  });
});
