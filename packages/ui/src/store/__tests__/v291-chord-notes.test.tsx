/**
 * v2.9.1：和弦轨「点一下要出声」。
 *
 * 旧行为：SET_CHORD 只写 ChordEvent → 播放/导出都读 NoteSpan → 点了没声音。
 * 新行为：同时生成三个带 `chordGenerated` 标记的真实音符。
 */
import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createNoteEvent, createTrack, type MixerState, type NoteEvent } from "@collinx/core";
import { ProjectProvider } from "../../providers/ProjectProvider";
import { useProjectStore } from "../../hooks/useProjectStore";
import type { ProjectStoreValue } from "../../store/project-store";

function mixer(): MixerState {
  return {
    tracks: [createTrack("Chords", "chords"), createTrack("Melody", "melody")],
    masterTrack: createTrack("Master", "master", "master"),
    routingMatrix: {},
  };
}

function setup(notes: NoteEvent[] = []) {
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
      <ProjectProvider title="Chord" initialNotes={notes} initialMixer={mixer()} pendingDiffs={[]}>
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

describe("SET_CHORD 生成真实音符", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("写 C 大三和弦：图里有 ChordEvent + 3 个和弦轨音符", () => {
    const s = setup();
    act(() => {
      s.value.actions.setChord(1, { root: "C", quality: "maj" });
    });

    const chordEvents = s.value.graph.getNodesByType("ChordEvent");
    expect(chordEvents).toHaveLength(1);

    const chordNotes = s.value.notes.filter((n) => n.trackId === "chords");
    expect(chordNotes.map((n) => n.pitchMidi).sort((a, b) => a - b)).toEqual([48, 52, 55]);
    // notes 投影同步（旧实现只改 graph、不重算 notes）
    expect(s.value.notes.length).toBe(3);
    s.cleanup();
  });

  it("重设同一小节：只保留新的三音，不累积", () => {
    const s = setup();
    act(() => {
      s.value.actions.setChord(1, { root: "C", quality: "maj" });
    });
    act(() => {
      s.value.actions.setChord(1, { root: "G", quality: "7" });
    });

    const chordNotes = s.value.notes.filter((n) => n.trackId === "chords");
    expect(chordNotes).toHaveLength(4); // G7
    expect(chordNotes.map((n) => n.pitchMidi).sort((a, b) => a - b)).toEqual([55, 59, 62, 65]);
    s.cleanup();
  });

  it("删除和弦（null）会移除该小节的生成音符", () => {
    const s = setup();
    act(() => {
      s.value.actions.setChord(1, { root: "C", quality: "maj" });
    });
    act(() => {
      s.value.actions.setChord(1, null);
    });

    expect(s.value.graph.getNodesByType("ChordEvent")).toHaveLength(0);
    expect(s.value.notes.filter((n) => n.trackId === "chords")).toHaveLength(0);
    s.cleanup();
  });

  it("不误删用户手画的和弦轨音符", () => {
    const manual = createNoteEvent({
      trackId: "chords",
      bar: 1,
      beat: 3,
      durQn: 1,
      pitchMidi: 72,
    });
    const s = setup([manual]);

    act(() => {
      s.value.actions.setChord(1, { root: "C", quality: "maj" });
    });
    act(() => {
      s.value.actions.setChord(1, null);
    });

    // 手画音符（无 chordGenerated 标记）仍在
    expect(s.value.notes.filter((n) => n.trackId === "chords")).toHaveLength(1);
    expect(s.value.notes[0].pitchMidi).toBe(72);
    s.cleanup();
  });

  it("可撤销：undo 恢复上一个和弦与其音符", () => {
    const s = setup();
    act(() => {
      s.value.actions.setChord(1, { root: "C", quality: "maj" });
    });
    act(() => {
      s.value.actions.setChord(1, { root: "A", quality: "min" });
    });
    act(() => {
      s.value.actions.undo();
    });

    const pitches = s.value.notes
      .filter((n) => n.trackId === "chords")
      .map((n) => n.pitchMidi)
      .sort((a, b) => a - b);
    expect(pitches).toEqual([48, 52, 55]);
    s.cleanup();
  });
});
