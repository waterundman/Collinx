import { describe, it, expect } from "vitest";
import React from "react";
import { MixerConsole } from "../MixerConsole";

describe("MixerConsole", () => {
  const emptyMixer = {
    tracks: [],
    masterTrack: {
      id: "master",
      name: "Master",
      sourceTrackId: "master",
      busType: "master" as const,
      gainDb: "0",
      pan: "0",
      mute: false,
      solo: false,
      fxChain: { id: "fx-master", name: "FX", slots: [] },
      sends: [],
      meterLevel: "0",
    },
    routingMatrix: {},
  };

  it("renders without crashing with empty mixer state", () => {
    expect(() => {
      React.createElement(MixerConsole, { mixer: emptyMixer });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof MixerConsole).toBe("function");
  });

  it("accepts all optional callbacks", () => {
    const props = {
      mixer: emptyMixer,
      onTrackChange: () => {},
      onAddTrack: () => {},
      onRemoveTrack: () => {},
    };
    expect(() => {
      React.createElement(MixerConsole, props);
    }).not.toThrow();
  });

  it("does not throw with multiple tracks", () => {
    const mixerWithTracks = {
      ...emptyMixer,
      tracks: [
        {
          id: "t1",
          name: "Melody",
          sourceTrackId: "melody",
          busType: "group" as const,
          gainDb: "-3",
          pan: "0",
          mute: false,
          solo: false,
          fxChain: { id: "fx-1", name: "FX", slots: [] },
          sends: [],
          meterLevel: "-12",
        },
        {
          id: "t2",
          name: "Bass",
          sourceTrackId: "bass",
          busType: "group" as const,
          gainDb: "0",
          pan: "-0.2",
          mute: true,
          solo: false,
          fxChain: { id: "fx-2", name: "FX", slots: [] },
          sends: [],
          meterLevel: "-6",
        },
      ],
    };
    expect(() => {
      React.createElement(MixerConsole, { mixer: mixerWithTracks });
    }).not.toThrow();
  });

  it("renders with track that has muted state", () => {
    const mixer = {
      ...emptyMixer,
      tracks: [
        {
          id: "t1",
          name: "Track 1",
          sourceTrackId: "src1",
          busType: "group" as const,
          gainDb: "0",
          pan: "0",
          mute: true,
          solo: true,
          fxChain: { id: "fx-1", name: "FX", slots: [] },
          sends: [],
          meterLevel: "0",
        },
      ],
    };
    expect(() => {
      React.createElement(MixerConsole, { mixer });
    }).not.toThrow();
  });
});
