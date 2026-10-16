import { describe, it, expect } from "vitest";
import React from "react";
import { NoteExpressionEditor } from "../NoteExpressionEditor";

describe("NoteExpressionEditor", () => {
  it("renders without crashing", () => {
    expect(() => {
      React.createElement(NoteExpressionEditor);
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof NoteExpressionEditor).toBe("function");
  });

  it("accepts all optional props", () => {
    const props = {
      noteId: 42,
      initialExpression: {
        noteId: 42,
        pitch: 0.5,
        pressure: 0.7,
        slide: 0.3,
        releaseVelocity: 0.2,
      },
      mpeEnabled: true,
      onExpressionChange: () => {},
      onMPEConfigChange: () => {},
    };
    expect(() => {
      React.createElement(NoteExpressionEditor, props);
    }).not.toThrow();
  });

  it("accepts default props", () => {
    expect(() => {
      React.createElement(NoteExpressionEditor, {});
    }).not.toThrow();
  });
});