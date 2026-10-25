import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProjectProvider } from "../../providers/ProjectProvider";
import { SettingsProvider } from "../../contexts/SettingsContext";
import { useProjectStore } from "../../hooks/useProjectStore";
import type { ProjectStoreValue } from "../../store/project-store";

/**
 * v2.9.4：`mixer.defaultFXChain` 从此生效 —— 新增轨按设置预置 FX 槽。
 * 此前这个设置只是设置页里的一段文本，没有任何消费方。
 */
function setup(defaultFXChain: string[]) {
  localStorage.setItem(
    "collinx_settings",
    JSON.stringify({ mixer: { defaultFXChain } }),
  );

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
      <SettingsProvider>
        <ProjectProvider title="FX" pendingDiffs={[]}>
          <Probe />
        </ProjectProvider>
      </SettingsProvider>,
    );
  });
  return {
    get value(): ProjectStoreValue {
      if (!current) throw new Error("not mounted");
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

describe("设置 → 新轨默认 FX 链", () => {
  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("新增轨带 EQ + Reverb 两个槽", () => {
    const s = setup(["eq", "reverb"]);
    act(() => {
      s.value.actions.addMixerTrack("Pad", "pad");
    });

    const last = s.value.mixer.tracks[s.value.mixer.tracks.length - 1]!;
    expect(last.fxChain.slots.map((slot) => slot.type)).toEqual(["eq", "reverb"]);
    // 槽必须可用：有 id、enabled
    expect(last.fxChain.slots.every((slot) => slot.id && slot.enabled)).toBe(true);
    s.cleanup();
  });

  it("未知 FX 类型被丢弃（不造渲染不出来的槽）", () => {
    const s = setup(["eq", "hologram", "reverb"]);
    act(() => {
      s.value.actions.addMixerTrack("Pad", "pad");
    });

    const last = s.value.mixer.tracks[s.value.mixer.tracks.length - 1]!;
    expect(last.fxChain.slots.map((slot) => slot.type)).toEqual(["eq", "reverb"]);
    s.cleanup();
  });

  it("设置为空 → 新轨无槽（与旧行为一致）", () => {
    const s = setup([]);
    act(() => {
      s.value.actions.addMixerTrack("Pad", "pad");
    });

    const last = s.value.mixer.tracks[s.value.mixer.tracks.length - 1]!;
    expect(last.fxChain.slots).toHaveLength(0);
    s.cleanup();
  });
});
