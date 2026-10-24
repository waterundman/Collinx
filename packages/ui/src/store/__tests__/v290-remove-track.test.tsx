/**
 * v2.9.0：删轨（S4）。
 *
 * 此前 `MixerConsole` 声明了 `onRemoveTrack` 却没人传、store 也没有对应 action ——
 * 加错的轨删不掉。这里锁定三条语义：级联删音符、可撤销、master/最后一条受保护。
 */
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createNoteEvent,
  createTrack,
  type MixerState,
  type NoteEvent,
} from "@collinx/core";
import { ProjectProvider } from "../../providers/ProjectProvider";
import { useProjectStore } from "../../hooks/useProjectStore";
import type { ProjectStoreValue } from "../../store/project-store";

function notes(): NoteEvent[] {
  return [
    createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 }),
    createNoteEvent({ trackId: "melody", bar: 2, beat: 1, durQn: 1, pitchMidi: 64 }),
    createNoteEvent({ trackId: "bass", bar: 1, beat: 1, durQn: 2, pitchMidi: 40 }),
  ];
}

function makeMixer(tracks: ReturnType<typeof createTrack>[]): MixerState {
  return {
    tracks,
    masterTrack: createTrack("Master", "master", "master"),
    routingMatrix: {},
  };
}

function setup(initialNotes: NoteEvent[], initialMixer: MixerState) {
  let current: ProjectStoreValue | null = null;
  let root: Root;
  let container: HTMLDivElement;

  function Probe() {
    current = useProjectStore();
    return null;
  }

  act(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    root.render(
      <ProjectProvider
        title="Remove Track"
        initialNotes={initialNotes}
        initialMixer={initialMixer}
        pendingDiffs={[]}
      >
        <Probe />
      </ProjectProvider>,
    );
  });

  return {
    get value(): ProjectStoreValue {
      if (!current) throw new Error("Store not initialized");
      return current;
    },
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

describe("v2.9.0 删轨", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("删除一轨：混音条消失、该轨音符从图里消失、别轨不受影响", () => {
    const s = setup(notes(), makeMixer([createTrack("Melody", "melody"), createTrack("Bass", "bass")]));
    const mixerTrack = s.value.mixer.tracks.find((t) => t.sourceTrackId === "melody")!;
    const spansBefore = s.value.graph.getNodesByType("NoteSpan").length;

    act(() => {
      s.value.actions.removeMixerTrack(mixerTrack.id);
    });

    expect(s.value.mixer.tracks.map((t) => t.sourceTrackId)).toEqual(["bass"]);
    expect(s.value.graph.getNodesByType("NoteSpan").length).toBe(spansBefore - 2);
    expect(s.value.notes.map((n) => n.trackId)).toEqual(["bass"]);
    s.cleanup();
  });

  it("可撤销：undo 恢复混音条与音符", () => {
    const s = setup(notes(), makeMixer([createTrack("Melody", "melody"), createTrack("Bass", "bass")]));
    const mixerTrack = s.value.mixer.tracks.find((t) => t.sourceTrackId === "melody")!;

    act(() => {
      s.value.actions.removeMixerTrack(mixerTrack.id);
    });
    expect(s.value.notes).toHaveLength(1);

    act(() => {
      s.value.actions.undo();
    });

    expect(s.value.mixer.tracks).toHaveLength(2);
    expect(s.value.notes).toHaveLength(3);
    s.cleanup();
  });

  it("master 不可删", () => {
    const s = setup(notes(), makeMixer([createTrack("Melody", "melody"), createTrack("Bass", "bass")]));
    const masterId = s.value.mixer.masterTrack.id;

    act(() => {
      s.value.actions.removeMixerTrack(masterId);
    });

    expect(s.value.mixer.tracks).toHaveLength(2);
    s.cleanup();
  });

  it("最后一条轨不可删（否则混音台空掉且无法再选中任何轨）", () => {
    const s = setup(
      [createNoteEvent({ trackId: "melody", bar: 1, beat: 1, durQn: 1, pitchMidi: 60 })],
      makeMixer([createTrack("Melody", "melody")]),
    );
    const onlyTrack = s.value.mixer.tracks[0];

    act(() => {
      s.value.actions.removeMixerTrack(onlyTrack.id);
    });

    expect(s.value.mixer.tracks).toHaveLength(1);
    expect(s.value.notes).toHaveLength(1);
    s.cleanup();
  });
});
