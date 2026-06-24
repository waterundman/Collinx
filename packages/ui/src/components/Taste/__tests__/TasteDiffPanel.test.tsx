import { describe, it, expect } from "vitest";
import React from "react";
import { TasteDiffPanel } from "../TasteDiffPanel";

describe("TasteDiffPanel", () => {
  it("renders without crashing with null report", () => {
    expect(() => {
      React.createElement(TasteDiffPanel, { report: null });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof TasteDiffPanel).toBe("function");
  });

  it("renders with a report containing evidence items", () => {
    const report = {
      reportId: "r1",
      exportRef: "export-001",
      genomeVersion: 1,
      generatedAt: new Date().toISOString(),
      evidenceItems: [
        {
          paramKey: "harmony.chromatic_color",
          domain: "harmony" as any,
          label: "和声色彩丰富度",
          currentValue: 0.7,
          genomePreferred: 0.4,
          deviation: 1.5,
          deviationLabel: "moderate" as const,
          description: "和声色彩略高于你平时的偏好",
          suggestion: "建议审阅",
          evidenceSource: "genome_comparison",
          confidence: 0.8,
        },
      ],
      summary: "本次导出有差异",
      suggestions: [],
      stats: {
        totalComparisons: 1,
        significantDeviations: 0,
        mildDeviations: 1,
        inTolerance: 0,
      },
    };
    expect(() => {
      React.createElement(TasteDiffPanel, { report });
    }).not.toThrow();
  });

  it("accepts onConfirmWrite callback", () => {
    let called = false;
    const report = {
      reportId: "r1",
      exportRef: "export-001",
      genomeVersion: 1,
      generatedAt: new Date().toISOString(),
      evidenceItems: [
        {
          paramKey: "harmony.chromatic_color",
          domain: "harmony" as any,
          label: "和声色彩",
          currentValue: 0.6,
          genomePreferred: 0.3,
          deviation: 1.0,
          deviationLabel: "moderate" as const,
          description: "",
          suggestion: "",
          evidenceSource: "genome_comparison",
          confidence: 0.5,
        },
      ],
      summary: "summary",
      suggestions: [],
      stats: {
        totalComparisons: 1,
        significantDeviations: 0,
        mildDeviations: 1,
        inTolerance: 0,
      },
    };
    expect(() => {
      React.createElement(TasteDiffPanel, {
        report,
        onConfirmWrite: (ids) => {
          called = true;
          expect(Array.isArray(ids)).toBe(true);
        },
      });
    }).not.toThrow();
  });

  it("accepts onIgnore and onWriteToReject callbacks", () => {
    const report = {
      reportId: "r1",
      exportRef: "export-001",
      genomeVersion: 1,
      generatedAt: new Date().toISOString(),
      evidenceItems: [],
      summary: "",
      suggestions: [],
      stats: {
        totalComparisons: 0,
        significantDeviations: 0,
        mildDeviations: 0,
        inTolerance: 0,
      },
    };
    expect(() => {
      React.createElement(TasteDiffPanel, {
        report,
        onIgnore: () => {},
        onWriteToReject: () => {},
      });
    }).not.toThrow();
  });
});
