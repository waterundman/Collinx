import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../App";
import { I18nProvider } from "../providers/I18nProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { ThemeProvider } from "../providers/ThemeProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { useProjectStore } from "../hooks/useProjectStore";
import type { ProjectStoreValue } from "../store/project-store";
import {
  AgentMusicIO,
  ProjectGraph,
  createNoteEvent,
  createTrack,
  TasteStore,
  TasteGenome,
  type MixerState,
  type NoteEvent,
} from "@collinx/core";
import { collectAgentMusicData } from "../services/agentmusic-bridge";

// ---------------------------------------------------------------------------
// Render helpers (mirrors app-integration.test.tsx)
// ---------------------------------------------------------------------------

function stubBrowserApis() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}

function stubUrlObjectApi() {
  const createObjectURL = vi.fn((_blob: Blob) => "blob:mock-agentmusic");
  const revokeObjectURL = vi.fn((_url: string) => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  });
  return { createObjectURL, revokeObjectURL };
}

async function makeDistinctProject(): Promise<{ bytes: Uint8Array; note: NoteEvent }> {
  const note = createNoteEvent({ trackId: "lead", bar: 1, beat: 1, durQn: 2, pitchMidi: 72, pitchSpelling: "C5", velocity: 0.9, voice: "rh" });
  const graph = ProjectGraph.create("Loaded Project");
  graph.addNode("NoteSpan", { ...note });
  const mixer: MixerState = {
    tracks: [createTrack("Lead", "lead")],
    masterTrack: createTrack("Master", "master", "master"),
    routingMatrix: {},
  };
  const tasteStore = new TasteStore();
  tasteStore.save(TasteGenome.createDefault());
  const data = collectAgentMusicData({
    graph,
    notes: [note],
    mixer,
    tasteStore,
    appliedDiffs: [],
  });
  const bytes = await new AgentMusicIO().save(data);
  return { bytes, note };
}

function renderAppWithProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let liveStore: ProjectStoreValue | null = null;
  function Probe() {
    liveStore = useProjectStore();
    return null;
  }
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <SettingsProvider>
          <ThemeProvider>
            <ProjectProvider>
              <App />
              <Probe />
            </ProjectProvider>
          </ThemeProvider>
        </SettingsProvider>
      </I18nProvider>
    );
  });
  return {
    container,
    getStore: () => liveStore!,
    cleanup: () => {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

function click(el: Element | null) {
  if (!el) throw new Error("click target not found");
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// ---------------------------------------------------------------------------
// T03 (component, critical): 保存按钮触发下载 (mock URL.createObjectURL)
// ---------------------------------------------------------------------------
describe("agentmusic UI save (T03)", () => {
  beforeAll(() => stubBrowserApis());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T03: 点击保存工程按钮触发 Blob 下载 (application/octet-stream, project.agentmusic)", async () => {
    const { createObjectURL } = stubUrlObjectApi();
    const anchors: HTMLAnchorElement[] = [];
    const origCreate = document.createElement.bind(document);
    const createSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string) => {
        const el = origCreate(tag);
        if (tag === "a") anchors.push(el as HTMLAnchorElement);
        return el;
      });

    const { container, cleanup } = renderAppWithProbe();
    try {
      const saveBtn = container.querySelector('[data-testid="save-project"]');
      expect(saveBtn).not.toBeNull();

      // 条件等待：保存链路含 fflate 动态 import（多跳微/宏任务）+ Blob 下载，
      // 单次 flush 覆盖不了，改用 vi.waitFor 轮询至 createObjectURL 被调用。
      // 整个交互+轮询包进 act，确保异步 store/下载更新在 act 内 flush。
      await act(async () => {
        click(saveBtn);
        await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
      });

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("application/octet-stream");

      const anchor = anchors.find((a) => a.download === "project.agentmusic");
      expect(anchor).toBeDefined();
    } finally {
      createSpy.mockRestore();
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// T04 (component, critical): 加载文件触发 restore
// ---------------------------------------------------------------------------
describe("agentmusic UI load (T04)", () => {
  beforeAll(() => stubBrowserApis());
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T04: 选择 .agentmusic 文件后 store 被还原 (notes 替换为文件内容)", async () => {
    const { bytes, note } = await makeDistinctProject();

    const { container, getStore, cleanup } = renderAppWithProbe();
    try {
      // 初始 demo 工程有多条 notes
      const before = getStore();
      expect(before.notes.length).toBeGreaterThan(0);

      const input = container.querySelector(
        '[data-testid="project-file-input"]'
      ) as HTMLInputElement | null;
      expect(input).not.toBeNull();

      // jsdom File.arrayBuffer 不一定可靠，按需求 mock 之
      const file = new File([bytes as unknown as BlobPart], "loaded.agentmusic", {
        type: "application/octet-stream",
      });
      Object.defineProperty(file, "arrayBuffer", {
        configurable: true,
        writable: true,
        value: () => Promise.resolve(bytes as unknown as ArrayBuffer),
      });

      Object.defineProperty(input!, "files", {
        configurable: true,
        value: [file],
      });

      // 触发 change 事件（React 合成事件），flush 异步 restore 的状态更新，
      // 随后在 act 外 vi.waitFor 轮询至 store 被还原（notes 来自文件）。
      act(() => {
        input!.dispatchEvent(
          new Event("change", { bubbles: true } as EventInit)
        );
      });
      await act(async () => {});

      await vi.waitFor(() => {
        const s = getStore();
        expect(s.notes.length).toBe(1);
        expect(s.notes[0].trackId).toBe(note.trackId);
        expect(s.notes[0].pitchMidi).toBe(note.pitchMidi);
      });

      const after = getStore();
      // 还原后 notes 应来自文件（单条 lead 音符），而非初始 demo
      expect(after.notes.length).toBe(1);
      expect(after.notes[0].trackId).toBe(note.trackId);
      expect(after.notes[0].pitchMidi).toBe(note.pitchMidi);
    } finally {
      cleanup();
    }
  });
});
