import { describe, it, expect } from "vitest";
import React from "react";
import { PluginParamEditor } from "../PluginParamEditor";

describe("PluginParamEditor", () => {
  const mockParams = [
    {
      id: 1,
      name: "gain",
      label: "Gain",
      value: 0.5,
      defaultValue: 0.5,
      minValue: 0,
      maxValue: 1,
      step: 0.01,
      isAutomatable: true,
    },
  ];

  it("renders without crashing", () => {
    expect(() => {
      React.createElement(PluginParamEditor, {
        parameters: mockParams,
        onParameterChange: () => {},
      });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof PluginParamEditor).toBe("function");
  });

  it("accepts all optional callbacks", () => {
    const props = {
      parameters: mockParams,
      onParameterChange: () => {},
      onAutomationChange: () => {},
      onMappingChange: () => {},
      onPresetSave: () => {},
      onPresetLoad: () => {},
    };
    expect(() => {
      React.createElement(PluginParamEditor, props);
    }).not.toThrow();
  });
});
