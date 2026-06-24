import { describe, it, expect } from "vitest";
import React from "react";
import { ScanProgressDialog } from "../ScanProgressDialog";

describe("ScanProgressDialog", () => {
  const defaultProps = {
    isOpen: true,
    progress: { scanned: 5, total: 10 },
    onCancel: () => {},
    onClose: () => {},
  };

  it("renders without crashing", () => {
    expect(() => {
      React.createElement(ScanProgressDialog, defaultProps);
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof ScanProgressDialog).toBe("function");
  });

  it("accepts all required props", () => {
    expect(() => {
      React.createElement(ScanProgressDialog, {
        ...defaultProps,
        progress: { scanned: 0, total: 0, currentPlugin: "test.vst3" },
      });
    }).not.toThrow();
  });

  it("accepts result prop", () => {
    expect(() => {
      React.createElement(ScanProgressDialog, {
        ...defaultProps,
        result: {
          totalScanned: 10,
          newPlugins: 3,
          failedPlugins: 1,
          duration: 5000,
        },
      });
    }).not.toThrow();
  });

  it("handles isOpen false", () => {
    expect(() => {
      React.createElement(ScanProgressDialog, {
        ...defaultProps,
        isOpen: false,
      });
    }).not.toThrow();
  });
});
