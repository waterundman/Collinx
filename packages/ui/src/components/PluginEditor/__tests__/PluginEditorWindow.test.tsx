import { describe, it, expect } from "vitest";
import React from "react";
import { PluginEditorWindow } from "../PluginEditorWindow";

describe("PluginEditorWindow", () => {
  it("renders without crashing", () => {
    expect(() => {
      React.createElement(PluginEditorWindow, { pluginId: "test-plugin" });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof PluginEditorWindow).toBe("function");
  });

  it("accepts all optional callbacks", () => {
    const props = {
      pluginId: "test-plugin",
      onClose: () => {},
      onParameterChange: () => {},
    };
    expect(() => {
      React.createElement(PluginEditorWindow, props);
    }).not.toThrow();
  });
});
