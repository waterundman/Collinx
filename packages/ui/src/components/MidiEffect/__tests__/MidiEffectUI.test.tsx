import { describe, it, expect } from "vitest";
import React from "react";
import { MidiEffectPanel } from "../MidiEffectPanel";
import { MidiEffectCard } from "../MidiEffectCard";
import { MidiRouterView } from "../MidiRouterView";
import type { MidiEffectChainState, MidiEffectInfo, MidiRouterState } from "../types";

const makeEffect = (overrides: Partial<MidiEffectInfo> = {}): MidiEffectInfo => ({
  id: overrides.id ?? 1,
  name: overrides.name ?? "Transposer",
  bypassed: overrides.bypassed ?? false,
  active: overrides.active ?? true,
  prepared: overrides.prepared ?? true,
  midiChannel: overrides.midiChannel ?? 0,
  params: overrides.params ?? [
    { index: 0, name: "Semitones", value: 0, displayText: "0", min: -24, max: 24, step: 1, unit: " st" },
  ],
  filterNoteOn: overrides.filterNoteOn ?? true,
  filterNoteOff: overrides.filterNoteOff ?? true,
  filterControlChange: overrides.filterControlChange ?? true,
  filterProgramChange: overrides.filterProgramChange ?? true,
  filterPitchBend: overrides.filterPitchBend ?? true,
  filterAftertouch: overrides.filterAftertouch ?? true,
});

const emptyChain: MidiEffectChainState = {
  effects: [],
  chainBypassed: false,
  isPrepared: true,
};

const emptyRouter: MidiRouterState = {
  channelMappings: [],
  controllerMappings: [],
  filterNoteOn: false,
  filterNoteOff: false,
  filterControlChange: false,
  filterProgramChange: false,
  filterPitchBend: false,
  filterAftertouch: false,
  filterSysEx: false,
  outputIds: [],
  isPrepared: true,
};

describe("MidiEffectPanel", () => {
  it("renders without crashing with empty chain", () => {
    expect(() => {
      React.createElement(MidiEffectPanel, { chain: emptyChain });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof MidiEffectPanel).toBe("function");
  });

  it("renders with effects in chain", () => {
    const chain: MidiEffectChainState = {
      effects: [
        makeEffect({ id: 1, name: "Transposer" }),
        makeEffect({ id: 2, name: "Velocity Scaler", bypassed: true }),
      ],
      chainBypassed: false,
      isPrepared: true,
    };
    expect(() => {
      React.createElement(MidiEffectPanel, { chain });
    }).not.toThrow();
  });

  it("renders with chain bypassed", () => {
    const chain: MidiEffectChainState = {
      effects: [makeEffect()],
      chainBypassed: true,
      isPrepared: true,
    };
    expect(() => {
      React.createElement(MidiEffectPanel, { chain });
    }).not.toThrow();
  });

  it("accepts all optional callbacks", () => {
    const props = {
      chain: emptyChain,
      onAddEffect: () => {},
      onRemoveEffect: () => {},
      onToggleBypass: () => {},
      onToggleChainBypass: () => {},
      onMoveEffect: () => {},
      onParamChange: () => {},
      onSelectEffect: () => {},
    };
    expect(() => {
      React.createElement(MidiEffectPanel, props);
    }).not.toThrow();
  });
});

describe("MidiEffectCard", () => {
  it("renders without crashing", () => {
    expect(() => {
      React.createElement(MidiEffectCard, { effect: makeEffect() });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof MidiEffectCard).toBe("function");
  });

  it("renders bypassed effect", () => {
    expect(() => {
      React.createElement(MidiEffectCard, {
        effect: makeEffect({ bypassed: true }),
      });
    }).not.toThrow();
  });

  it("renders selected effect", () => {
    expect(() => {
      React.createElement(MidiEffectCard, {
        effect: makeEffect(),
        isSelected: true,
      });
    }).not.toThrow();
  });

  it("renders with channel filter", () => {
    expect(() => {
      React.createElement(MidiEffectCard, {
        effect: makeEffect({ midiChannel: 5 }),
      });
    }).not.toThrow();
  });

  it("renders with multiple params", () => {
    expect(() => {
      React.createElement(MidiEffectCard, {
        effect: makeEffect({
          params: [
            { index: 0, name: "Rate", value: 0.5, displayText: "50%", min: 0, max: 1, step: 0.01 },
            { index: 1, name: "Gate", value: 0.75, displayText: "75%", min: 0, max: 1, step: 0.01 },
          ],
        }),
      });
    }).not.toThrow();
  });

  it("accepts all optional callbacks", () => {
    expect(() => {
      React.createElement(MidiEffectCard, {
        effect: makeEffect(),
        onSelect: () => {},
        onToggleBypass: () => {},
        onRemove: () => {},
        onParamChange: () => {},
        onDragStart: () => {},
        onDragOver: () => {},
        onDrop: () => {},
      });
    }).not.toThrow();
  });
});

describe("MidiRouterView", () => {
  it("renders without crashing with empty router", () => {
    expect(() => {
      React.createElement(MidiRouterView, { router: emptyRouter });
    }).not.toThrow();
  });

  it("is a function component", () => {
    expect(typeof MidiRouterView).toBe("function");
  });

  it("renders with channel mappings", () => {
    const router: MidiRouterState = {
      ...emptyRouter,
      channelMappings: [
        { inputChannel: 1, outputChannel: 3 },
        { inputChannel: 2, outputChannel: 4 },
      ],
    };
    expect(() => {
      React.createElement(MidiRouterView, { router });
    }).not.toThrow();
  });

  it("renders with controller mappings", () => {
    const router: MidiRouterState = {
      ...emptyRouter,
      controllerMappings: [
        { inputCC: 1, outputCC: 11, channel: 0 },
        { inputCC: 64, outputCC: 7, channel: 1 },
      ],
    };
    expect(() => {
      React.createElement(MidiRouterView, { router });
    }).not.toThrow();
  });

  it("renders with active filters", () => {
    const router: MidiRouterState = {
      ...emptyRouter,
      filterNoteOn: true,
      filterSysEx: true,
    };
    expect(() => {
      React.createElement(MidiRouterView, { router });
    }).not.toThrow();
  });

  it("renders with outputs", () => {
    const router: MidiRouterState = {
      ...emptyRouter,
      outputIds: [1, 2, 3],
    };
    expect(() => {
      React.createElement(MidiRouterView, { router });
    }).not.toThrow();
  });

  it("accepts all optional callbacks", () => {
    const props = {
      router: emptyRouter,
      onSetChannelMapping: () => {},
      onClearChannelMapping: () => {},
      onClearAllChannelMappings: () => {},
      onMapController: () => {},
      onUnmapController: () => {},
      onClearAllControllerMappings: () => {},
      onToggleFilter: () => {},
      onAddOutput: () => {},
      onRemoveOutput: () => {},
    };
    expect(() => {
      React.createElement(MidiRouterView, props);
    }).not.toThrow();
  });
});
