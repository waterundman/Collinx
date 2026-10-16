import { describe, it, expect } from "vitest";
import React from "react";
import { PluginBrowser } from "../PluginBrowser";

describe("PluginBrowser", () => {
  it("renders without crashing", () => {
    expect(() => {
      React.createElement(PluginBrowser);
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof PluginBrowser).toBe("function");
  });

  it("accepts all optional callbacks", () => {
    const props = {
      onPluginLoad: () => {},
      onPluginUnload: () => {},
      onPluginSelect: () => {},
    };
    expect(() => {
      React.createElement(PluginBrowser, props);
    }).not.toThrow();
  });
});
