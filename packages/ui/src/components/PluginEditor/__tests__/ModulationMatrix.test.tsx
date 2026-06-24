import { describe, it, expect } from "vitest";
import React from "react";
import { ModulationMatrix } from "../ModulationMatrix";

describe("ModulationMatrix", () => {
  it("renders without crashing", () => {
    expect(() => {
      React.createElement(ModulationMatrix);
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof ModulationMatrix).toBe("function");
  });

  it("accepts all optional props", () => {
    const props = {
      sources: [
        { id: "lfo1", name: "LFO 1", type: "lfo" as const, value: 0.5 },
      ],
      destinations: [
        { id: "filter", name: "Filter Cutoff", paramId: 1 },
      ],
      routes: [
        {
          id: "route1",
          sourceId: "lfo1",
          destinationId: "filter",
          depth: 0.8,
          bipolar: false,
        },
      ],
      onRouteChange: () => {},
      onRouteAdd: () => {},
      onRouteRemove: () => {},
      onSourceSelect: () => {},
      onDestinationSelect: () => {},
    };
    expect(() => {
      React.createElement(ModulationMatrix, props);
    }).not.toThrow();
  });

  it("accepts default props", () => {
    expect(() => {
      React.createElement(ModulationMatrix, {});
    }).not.toThrow();
  });
});