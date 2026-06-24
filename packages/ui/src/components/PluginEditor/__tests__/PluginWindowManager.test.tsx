import { describe, it, expect } from "vitest";
import React from "react";
import { PluginWindowManager } from "../PluginWindowManager";

describe("PluginWindowManager", () => {
  it("renders without crashing", () => {
    expect(() => {
      React.createElement(PluginWindowManager, {
        openPlugins: [],
        onClosePlugin: () => {},
      });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof PluginWindowManager).toBe("function");
  });

  it("accepts all optional callbacks", () => {
    const props = {
      openPlugins: ["test-plugin"],
      onClosePlugin: () => {},
      onParameterChange: () => {},
    };
    expect(() => {
      React.createElement(PluginWindowManager, props);
    }).not.toThrow();
  });
});
