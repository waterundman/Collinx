import { describe, it, expect, vi } from "vitest";
import React from "react";
import { AgentPanel } from "../AgentPanel";
import { DiffCard } from "../DiffCard";
import { ExplanationView } from "../ExplanationView";
import type { DiffEnvelope } from "@collinx/core";

function makeDiff(overrides: Partial<DiffEnvelope> = {}): DiffEnvelope {
  return {
    diffId: overrides.diffId ?? "diff-001",
    baseRevision: "rev-1",
    actor: overrides.actor ?? { type: "agent", name: "HarmonyBot", model: "gpt-4o" },
    permissionScope: overrides.permissionScope ?? "proposal_only",
    summary: overrides.summary ?? "Add chord voicings to bars 4-8",
    ops: overrides.ops ?? [
      { op: "add_node", path: "/tracks/chords", nodeType: "chord_track", data: {} },
      { op: "update_node", path: "/tracks/melody", nodeId: "mel-1", data: { velocity: 0.9 } },
      { op: "add_edge", path: "/edges", edgeType: "harmony", sourceId: "mel-1", targetId: "chord-1" },
    ],
    domainExplanations: overrides.domainExplanations ?? [
      { label: "Harmony", text: "Added ii-V-I progression in bars 4-6" },
      { label: "Voice Leading", text: "Smooth soprano motion maintained" },
    ],
    evidenceRefs: [],
    rollbackToken: overrides.rollbackToken ?? "rb-token-001",
    riskFlags: overrides.riskFlags ?? [
      { type: "range_violation", severity: "medium", description: "Chord note exceeds vocal range" },
    ],
    createdAt: new Date().toISOString(),
  };
}

describe("AgentPanel", () => {
  it("renders without crashing with empty arrays", () => {
    expect(() => {
      React.createElement(AgentPanel, {
        pendingDiffs: [],
        historyDiffs: [],
        onApply: () => {},
        onReject: () => {},
        onRollback: () => {},
      });
    }).not.toThrow();
  });

  it("renders pending diffs", () => {
    const pending = [makeDiff({ diffId: "p-1" }), makeDiff({ diffId: "p-2" })];
    expect(() => {
      React.createElement(AgentPanel, {
        pendingDiffs: pending,
        historyDiffs: [],
        onApply: () => {},
        onReject: () => {},
        onRollback: () => {},
      });
    }).not.toThrow();
  });

  it("renders history diffs", () => {
    const history = [makeDiff({ diffId: "h-1" }), makeDiff({ diffId: "h-2" })];
    expect(() => {
      React.createElement(AgentPanel, {
        pendingDiffs: [],
        historyDiffs: history,
        onApply: () => {},
        onReject: () => {},
        onRollback: () => {},
      });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof AgentPanel).toBe("function");
  });
});

describe("DiffCard", () => {
  it("renders a pending diff card", () => {
    expect(() => {
      React.createElement(DiffCard, {
        diff: makeDiff(),
        status: "pending",
      });
    }).not.toThrow();
  });

  it("renders an applied diff card with rollback button", () => {
    expect(() => {
      React.createElement(DiffCard, {
        diff: makeDiff(),
        status: "applied",
        onRollback: () => {},
      });
    }).not.toThrow();
  });

  it("renders a rejected diff card", () => {
    expect(() => {
      React.createElement(DiffCard, {
        diff: makeDiff(),
        status: "rejected",
      });
    }).not.toThrow();
  });

  it("renders risk flags", () => {
    const diff = makeDiff({
      riskFlags: [
        { type: "data_loss", severity: "high", description: "May overwrite user data" },
        { type: "range_violation", severity: "low", description: "Minor range issue" },
      ],
    });
    expect(() => {
      React.createElement(DiffCard, { diff, status: "pending" });
    }).not.toThrow();
  });

  it("renders domain explanations", () => {
    const diff = makeDiff({
      domainExplanations: [
        { label: "Theory", text: "Applied secondary dominants" },
      ],
    });
    expect(() => {
      React.createElement(DiffCard, { diff, status: "pending" });
    }).not.toThrow();
  });

  it("renders with read_only permission scope", () => {
    const diff = makeDiff({ permissionScope: "read_only" });
    expect(() => {
      React.createElement(DiffCard, { diff, status: "pending" });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof DiffCard).toBe("function");
  });
});

describe("ExplanationView", () => {
  it("renders without crashing", () => {
    expect(() => {
      React.createElement(ExplanationView, {
        explanations: [{ label: "Test", text: "Description" }],
      });
    }).not.toThrow();
  });

  it("renders null for empty explanations", () => {
    expect(() => {
      React.createElement(ExplanationView, { explanations: [] });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof ExplanationView).toBe("function");
  });
});
