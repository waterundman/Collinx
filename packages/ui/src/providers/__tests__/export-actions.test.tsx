import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "../../App";
import { I18nProvider } from "../../providers/I18nProvider";
import { SettingsProvider } from "../../contexts/SettingsContext";
import { ThemeProvider } from "../../providers/ThemeProvider";
import { ProjectProvider } from "../../providers/ProjectProvider";
import { useProjectStore } from "../../hooks/useProjectStore";
import type { ProjectStoreValue } from "../../store/project-store";

// ---------------------------------------------------------------------------
// v1.16.0 Stage 1: 导出菜单 (MIDI + PDF) — UI 接线测试。
//
//  T01 (unit, critical):      actions.exportMIDI 产出合法 .mid 字节 (MThd 头)
//  T02 (component, critical): 导出 MIDI 按钮触发下载 (project.mid)
//  T03 (unit, critical):      actions.exportPDF 产出 %PDF- 头字节
//  T04 (component, critical): 导出 PDF 按钮触发下载 (project.pdf)
//  T05 (unit, non-critical):  MusicXML 导出回归 (下载路径不破坏)
// ---------------------------------------------------------------------------

function stubBrowserApis() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({
      matches: false,
      media: "",
      onchange: null,
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
  const createObjectURL = vi.fn((_blob: Blob) => "blob:mock-export");
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

function findToolbarButton(container: HTMLElement, labels: string[]): Element {
  const btn = Array.from(container.querySelectorAll("button")).find((b) =>
    labels.some((label) => b.textContent?.includes(label)),
  );
  if (!btn) throw new Error(`no toolbar button containing "${labels.join("/")}"`);
  return btn;
}

/** jsdom 的 <a download> 点击不会真正下载；通过 createElement spy 捕获 anchor。 */
function captureAnchors() {
  const anchors: HTMLAnchorElement[] = [];
  const origCreate = document.createElement.bind(document);
  const createSpy = vi
    .spyOn(document, "createElement")
    .mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === "a") anchors.push(el as HTMLAnchorElement);
      return el;
    });
  return { anchors, createSpy };
}

async function flushAsync() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeAll(() => stubBrowserApis());
afterEach(() => {
  document.body.innerHTML = "";
});

describe("export actions (v1.16.0 Stage 1)", () => {
  // -------------------------------------------------------------------------
  // T01 (unit, critical): exportMIDI 生成合法 .mid
  // -------------------------------------------------------------------------
  it("T01: actions.exportMIDI 产出 audio/midi Blob, MThd 头 + 非空 track 数据", async () => {
    const { createObjectURL } = stubUrlObjectApi();
    const { anchors, createSpy } = captureAnchors();
    const { getStore, cleanup } = renderAppWithProbe();
    try {
      const store = getStore();
      expect(store.notes.length).toBeGreaterThan(0);

      await store.actions.exportMIDI();

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("audio/midi");

      const bytes = new Uint8Array(await blob.arrayBuffer());
      // MThd chunk header: 0x4d 0x54 0x68 0x64
      expect(bytes[0]).toBe(0x4d);
      expect(bytes[1]).toBe(0x54);
      expect(bytes[2]).toBe(0x68);
      expect(bytes[3]).toBe(0x64);
      // track data beyond the 22-byte MThd+MTrk headers is non-empty
      expect(bytes.length).toBeGreaterThan(22);
      // MTrk chunk header at offset 14: 0x4d 0x54 0x72 0x6b
      expect(bytes[14]).toBe(0x4d);
      expect(bytes[15]).toBe(0x54);
      expect(bytes[16]).toBe(0x72);
      expect(bytes[17]).toBe(0x6b);

      expect(anchors.find((a) => a.download === "project.mid")).toBeDefined();
    } finally {
      createSpy.mockRestore();
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // T02 (component, critical): 导出 MIDI 按钮触发下载
  // -------------------------------------------------------------------------
  it("T02: score 面板导出 MIDI 按钮触发 project.mid 下载", async () => {
    const { createObjectURL } = stubUrlObjectApi();
    const { anchors, createSpy } = captureAnchors();
    const { container, cleanup } = renderAppWithProbe();
    try {
      click(container.querySelector('[data-testid="tab-score"]'));
      expect(container.querySelector('[data-testid="score-layout"]')).not.toBeNull();

      const btn = findToolbarButton(container, ["导出 MIDI", "Export MIDI"]);
      click(btn);
      await flushAsync();

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe("audio/midi");
      expect(anchors.find((a) => a.download === "project.mid")).toBeDefined();
    } finally {
      createSpy.mockRestore();
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // T03 (unit, critical): exportPDF 生成 %PDF- 头输出 (真实 PDFExporter 链路)
  // -------------------------------------------------------------------------
  it("T03: actions.exportPDF 产出 application/pdf Blob, %PDF- 头", async () => {
    const { createObjectURL } = stubUrlObjectApi();
    const { anchors, createSpy } = captureAnchors();
    const { getStore, cleanup } = renderAppWithProbe();
    try {
      const store = getStore();

      await store.actions.exportPDF();

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("application/pdf");

      const bytes = new Uint8Array(await blob.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(0);
      expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");

      expect(anchors.find((a) => a.download === "project.pdf")).toBeDefined();
    } finally {
      createSpy.mockRestore();
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // T04 (component, critical): 导出 PDF 按钮触发下载
  // -------------------------------------------------------------------------
  it("T04: score 面板导出 PDF 按钮触发 project.pdf 下载", async () => {
    const { createObjectURL } = stubUrlObjectApi();
    const { anchors, createSpy } = captureAnchors();
    const { container, cleanup } = renderAppWithProbe();
    try {
      click(container.querySelector('[data-testid="tab-score"]'));

      const btn = findToolbarButton(container, ["导出 PDF", "Export PDF"]);
      click(btn);
      await flushAsync();

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe("application/pdf");
      expect(anchors.find((a) => a.download === "project.pdf")).toBeDefined();
    } finally {
      createSpy.mockRestore();
      cleanup();
    }
  });

  // -------------------------------------------------------------------------
  // T05 (non-critical): MusicXML 导出回归
  // -------------------------------------------------------------------------
  it("T05: MusicXML 导出回归 — 下载路径不破坏 (collinx-score.xml)", async () => {
    const { createObjectURL } = stubUrlObjectApi();
    const { anchors, createSpy } = captureAnchors();
    const { container, cleanup } = renderAppWithProbe();
    try {
      click(container.querySelector('[data-testid="tab-score"]'));

      const btn = findToolbarButton(container, ["导出 MusicXML", "Export MusicXML"]);
      click(btn);
      await flushAsync();

      expect(createObjectURL).toHaveBeenCalledTimes(1);
      const blob = createObjectURL.mock.calls[0][0] as Blob;
      expect(blob.type).toBe("application/xml");
      expect(anchors.find((a) => a.download === "collinx-score.xml")).toBeDefined();
    } finally {
      createSpy.mockRestore();
      cleanup();
    }
  });
});
