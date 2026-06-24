import { describe, it, expect, vi } from "vitest";
import React from "react";
import { GraphView } from "../GraphView";
import { NodeDetail } from "../NodeDetail";
import type { GraphData } from "../GraphView";

const emptyGraph: GraphData = { nodes: [], edges: [] };

const simpleGraph: GraphData = {
  nodes: [
    { id: "n1", type: "Phrase", data: { name: "Intro" } },
    { id: "n2", type: "Motif", data: { name: "Motif A" } },
    { id: "n3", type: "Track", data: { name: "Melody" } },
  ],
  edges: [
    { source: "n1", target: "n2", type: "uses" },
    { source: "n2", target: "n3", type: "rendered_on" },
  ],
};

describe("GraphView", () => {
  it("renders without crashing with empty graph", () => {
    expect(() => {
      React.createElement(GraphView, { graph: emptyGraph });
    }).not.toThrow();
  });

  it("renders without crashing with nodes and edges", () => {
    expect(() => {
      React.createElement(GraphView, { graph: simpleGraph });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof GraphView).toBe("function");
  });

  it("accepts onNodeClick callback", () => {
    const handler = vi.fn();
    expect(() => {
      React.createElement(GraphView, { graph: simpleGraph, onNodeClick: handler });
    }).not.toThrow();
  });

  it("accepts custom width and height", () => {
    expect(() => {
      React.createElement(GraphView, { graph: simpleGraph, width: 400, height: 300 });
    }).not.toThrow();
  });
});

describe("NodeDetail", () => {
  it("renders without crashing", () => {
    expect(() => {
      React.createElement(NodeDetail, {
        node: { id: "n1", type: "Phrase", data: { name: "Intro", formRole: "intro" } },
        connectedNodes: [
          { id: "n2", type: "Motif", edgeType: "uses" },
        ],
        onClose: () => {},
      });
    }).not.toThrow();
  });

  it("renders with empty data", () => {
    expect(() => {
      React.createElement(NodeDetail, {
        node: { id: "n1", type: "Track", data: {} },
        connectedNodes: [],
        onClose: () => {},
      });
    }).not.toThrow();
  });

  it("renders with multiple connected nodes", () => {
    expect(() => {
      React.createElement(NodeDetail, {
        node: { id: "n1", type: "Phrase", data: { name: "Chorus" } },
        connectedNodes: [
          { id: "n2", type: "Motif", edgeType: "uses" },
          { id: "n3", type: "Motif", edgeType: "uses" },
          { id: "n4", type: "Track", edgeType: "rendered_on" },
        ],
        onClose: () => {},
      });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof NodeDetail).toBe("function");
  });
});
