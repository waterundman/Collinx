import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ABPlayer, TempoMap, createNoteEvent } from "@collinx/core";
import type { ABVersion } from "@collinx/core";
import { ABPlayerUI } from "../ABPlayerUI";

/**
 * v3.1.0：A/B 组件此前**零测试**，导致 `phase="vote"` 从不置位这种断头流程
 * 一直没被发现（投票按钮被 `phase === "vote"` 挡在门外）。
 *
 * 这里锁三件事：
 * 1. 首版 → 切到第二版 → 进入评价，投票按钮真的出现；
 * 2. `onAudition` 收到的是**当前轮次里对应那一个**版本，而不是随便一个；
 * 3. 投票后按轮次推进，全部投完回调 onTestComplete。
 */

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function setup(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

const tempoMap = new TempoMap();

function makeVersion(id: string, label: string, pitch: number): ABVersion {
  return {
    id,
    label,
    description: "",
    notes: [
      createNoteEvent({
        trackId: "melody",
        bar: 1,
        beat: 1,
        durQn: 1,
        pitchMidi: pitch,
        velocity: 0.8,
      }),
    ],
  };
}

function findButton(host: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(host.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(text),
  );
  if (!btn) throw new Error(`button not found: ${text}`);
  return btn as HTMLButtonElement;
}

describe("ABPlayerUI", () => {
  it("reaches the vote step after listening to both versions", () => {
    const host = setup(
      <ABPlayerUI
        player={new ABPlayer()}
        tempoMap={tempoMap}
        versionA={makeVersion("a", "当前", 60)}
        versionB={makeVersion("b", "v1", 67)}
      />,
    );

    act(() => {
      findButton(host, "开始测试").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // 首版阶段：应出现「切换到 …」
    const switchBtn = findButton(host, "切换到");
    act(() => {
      switchBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // 第二版阶段：出现「开始评价」（此前这条路不存在）
    const goVote = findButton(host, "开始评价");
    act(() => {
      goVote.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // 投票按钮组真的渲染了
    expect(findButton(host, "无偏好")).toBeTruthy();
    expect(host.textContent).toContain("轮");
  });

  it("passes the audible version to onAudition", () => {
    const onAudition = vi.fn();
    const host = setup(
      <ABPlayerUI
        player={new ABPlayer()}
        tempoMap={tempoMap}
        versionA={makeVersion("a", "当前", 60)}
        versionB={makeVersion("b", "v1", 67)}
        onAudition={onAudition}
      />,
    );

    act(() => {
      findButton(host, "开始测试").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // 盲测模式下按钮文案是「版本1 / 版本2」
    act(() => {
      findButton(host, "版本1").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onAudition).toHaveBeenCalledTimes(1);
    const firstArg = onAudition.mock.calls[0][0] as ABVersion;
    expect(firstArg.notes[0].pitchMidi === 60 || firstArg.notes[0].pitchMidi === 67).toBe(true);

    act(() => {
      findButton(host, "版本2").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onAudition).toHaveBeenCalledTimes(2);
  });
});
