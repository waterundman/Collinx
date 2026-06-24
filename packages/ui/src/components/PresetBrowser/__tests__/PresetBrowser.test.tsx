import { describe, it, expect } from "vitest";
import React from "react";
import { PresetBrowser } from "../PresetBrowser";
import { PresetCard } from "../PresetCard";
import { PresetEditor } from "../PresetEditor";
import type { PresetInfo } from "../PresetBrowser";

function makePreset(overrides: Partial<PresetInfo> = {}): PresetInfo {
  return {
    id: overrides.id ?? "preset-001",
    name: overrides.name ?? "Test Preset",
    description: overrides.description ?? "A test preset",
    category: overrides.category ?? "Synth Leads",
    author: overrides.author ?? "Test Author",
    pluginName: overrides.pluginName ?? "TestPlugin",
    pluginFormat: overrides.pluginFormat ?? "VST3",
    tags: overrides.tags ?? ["lead", "bright"],
    createdTime: overrides.createdTime ?? "2026-01-01T00:00:00Z",
    modifiedTime: overrides.modifiedTime ?? "2026-01-02T00:00:00Z",
  };
}

describe("PresetBrowser", () => {
  it("renders without crashing with empty presets", () => {
    expect(() => {
      React.createElement(PresetBrowser, {
        presets: [],
        categories: [],
        allTags: [],
      });
    }).not.toThrow();
  });

  it("renders with presets", () => {
    const presets = [
      makePreset({ id: "p-1", name: "Preset 1", category: "Leads" }),
      makePreset({ id: "p-2", name: "Preset 2", category: "Bass" }),
    ];
    expect(() => {
      React.createElement(PresetBrowser, {
        presets,
        categories: ["Leads", "Bass"],
        allTags: ["lead", "bass"],
      });
    }).not.toThrow();
  });

  it("renders with callback props", () => {
    expect(() => {
      React.createElement(PresetBrowser, {
        presets: [makePreset()],
        categories: ["Synth Leads"],
        allTags: ["lead"],
        onLoad: () => {},
        onDelete: () => {},
        onSave: () => {},
        onImport: () => {},
        onExport: () => {},
      });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof PresetBrowser).toBe("function");
  });
});

describe("PresetCard", () => {
  it("renders without crashing", () => {
    expect(() => {
      React.createElement(PresetCard, {
        preset: makePreset(),
      });
    }).not.toThrow();
  });

  it("renders with all callbacks", () => {
    expect(() => {
      React.createElement(PresetCard, {
        preset: makePreset(),
        onLoad: () => {},
        onDelete: () => {},
        onEdit: () => {},
        onExport: () => {},
      });
    }).not.toThrow();
  });

  it("renders preset with empty tags", () => {
    expect(() => {
      React.createElement(PresetCard, {
        preset: makePreset({ tags: [] }),
      });
    }).not.toThrow();
  });

  it("renders preset with empty description", () => {
    expect(() => {
      React.createElement(PresetCard, {
        preset: makePreset({ description: "" }),
      });
    }).not.toThrow();
  });

  it("renders preset with multiple tags", () => {
    expect(() => {
      React.createElement(PresetCard, {
        preset: makePreset({ tags: ["lead", "bright", "analog", "warm"] }),
      });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof PresetCard).toBe("function");
  });
});

describe("PresetEditor", () => {
  it("renders without crashing", () => {
    expect(() => {
      React.createElement(PresetEditor, {
        preset: makePreset(),
        categories: ["Leads", "Bass", "Pads"],
        allTags: ["lead", "bright", "warm"],
        onSave: () => {},
        onCancel: () => {},
      });
    }).not.toThrow();
  });

  it("renders with empty categories and tags", () => {
    expect(() => {
      React.createElement(PresetEditor, {
        preset: makePreset({ tags: [] }),
        categories: [],
        allTags: [],
        onSave: () => {},
        onCancel: () => {},
      });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof PresetEditor).toBe("function");
  });
});
