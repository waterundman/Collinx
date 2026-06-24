import { describe, it, expect } from "vitest";
import React from "react";
import { PerformanceDashboard } from "../PerformanceDashboard";

describe("PerformanceDashboard", () => {
  const defaultMetrics = {
    cpuUsage: 45,
    memoryUsed: 2147483648,
    memoryTotal: 8589934592,
    processingLatency: 5.2,
    bufferUnderruns: 0,
    activeVoices: 8,
  };

  it("renders without crashing", () => {
    expect(() => {
      React.createElement(PerformanceDashboard, { metrics: defaultMetrics });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof PerformanceDashboard).toBe("function");
  });

  it("accepts all optional props", () => {
    expect(() => {
      React.createElement(PerformanceDashboard, {
        metrics: defaultMetrics,
        onRefresh: () => {},
        refreshInterval: 2000,
      });
    }).not.toThrow();
  });

  it("handles high CPU usage metrics", () => {
    expect(() => {
      React.createElement(PerformanceDashboard, {
        metrics: { ...defaultMetrics, cpuUsage: 95 },
      });
    }).not.toThrow();
  });

  it("handles zero memory", () => {
    expect(() => {
      React.createElement(PerformanceDashboard, {
        metrics: { ...defaultMetrics, memoryUsed: 0, memoryTotal: 0 },
      });
    }).not.toThrow();
  });
});
