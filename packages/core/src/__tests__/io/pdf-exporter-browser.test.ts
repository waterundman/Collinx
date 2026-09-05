import { describe, it, expect, vi } from "vitest";
import { PDFExporter } from "../../io/pdf-exporter";
import { createLayout, type Layout } from "../../model/score-model";
import { createNoteEvent, type NoteEvent } from "../../model/note-event";
import { TempoMap } from "../../model/tempo-map";

// ---------------------------------------------------------------------------
// v1.16.0 Stage 1 (T03 unit, critical): PDFExporter browser-safe byte output.
//
// The existing pdf-exporter.test.ts keeps covering the Node-only Buffer API
// (exportToPDF). This suite covers the new exportToPDFBytes API that returns
// a plain Uint8Array (Blob-safe, no Node Buffer dependency) so the UI can
// download the PDF directly in the browser.
// ---------------------------------------------------------------------------

function makeNotes(bars: number): NoteEvent[] {
  const notes: NoteEvent[] = [];
  const rhPitches = [60, 62, 64, 65];
  const lhPitches = [48, 50, 52, 53];
  for (let bar = 1; bar <= bars; bar++) {
    for (let beat = 1; beat <= 4; beat++) {
      notes.push(
        createNoteEvent({
          trackId: "piano",
          bar,
          beat,
          durQn: 1,
          pitchMidi: rhPitches[(beat - 1) % rhPitches.length],
          velocity: 0.8,
          voice: "rh",
        }),
      );
      notes.push(
        createNoteEvent({
          trackId: "piano",
          bar,
          beat,
          durQn: 1,
          pitchMidi: lhPitches[(beat - 1) % lhPitches.length],
          velocity: 0.7,
          voice: "lh",
        }),
      );
    }
  }
  return notes;
}

function makeLayout(): Layout {
  const layout = createLayout("Browser PDF", "full_score", ["piano"]);
  layout.staves = [
    { id: "treble", clef: "treble", voices: 1, lines: 5 },
    { id: "bass", clef: "bass", voices: 1, lines: 5 },
  ];
  return layout;
}

describe("PDFExporter browser byte output (exportToPDFBytes)", () => {
  const exporter = new PDFExporter();
  const tempoMap = new TempoMap(
    [{ bar: 1, bpm: 120 }],
    [{ bar: 1, numerator: 4, denominator: 4 }],
  );

  it("T03a: exportToPDFBytes 返回非空 Uint8Array 且以 %PDF- 开头", async () => {
    const bytes = await exporter.exportToPDFBytes(makeLayout(), makeNotes(8), tempoMap);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    // %PDF- header as text: 0x25 0x50 0x44 0x46 0x2d
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("T03b: 空音符输入仍产出合法 PDF 头", async () => {
    const bytes = await exporter.exportToPDFBytes(makeLayout(), [], tempoMap);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("T03c: 既有 exportToPDF(Buffer API) 与 exportToPDFBytes 字节长度与头部一致", async () => {
    const layout = makeLayout();
    const notes = makeNotes(4);

    const buffer = await exporter.exportToPDF(layout, notes, tempoMap);
    const bytes = await exporter.exportToPDFBytes(layout, notes, tempoMap);

    // 两次独立导出内嵌的 CreationDate 可能跨秒，不逐字节比较；
    // 长度一致 + 头部一致 + Buffer 包装无损即视为内容等价。
    expect(buffer.length).toBe(bytes.length);
    expect(buffer.toString("ascii", 0, 5)).toBe("%PDF-");
    expect(Buffer.from(bytes.slice(0, 5)).toString("ascii")).toBe("%PDF-");
  });

  // critical: 回归缺陷是 exportToPDFBytes 的 promise 体内使用全局
  // Buffer（Buffer.concat）—— 真实浏览器没有 Node Buffer 全局，点击
  // "导出 PDF"会抛 ReferenceError 且 Promise 永不 resolve。
  //
  // Node 版 pdfkit 运行时自身深度依赖全局 Buffer（security.js 的
  // Buffer.from、reference.js 的 Buffer.concat），无法在真 pdfkit 下直接
  // stub 掉。故用 vi.doMock 提供一个复刻 pdfkit.standalone.js 行为的
  // fake（data 事件发 Uint8Array、不触碰全局 Buffer），并在删除
  // globalThis.Buffer 后动态重新加载 pdf-exporter，忠实模拟浏览器环境：
  // 若回归（promise 体内引用全局 Buffer），此用例将抛 ReferenceError。
  // 静态导入的既有用例仍走真 pdfkit，不受 doMock 影响。
  it("T03d (critical): 无 Buffer 全局环境下 exportToPDFBytes 仍正常产出 %PDF- 头", async () => {
    const savedBuffer = (globalThis as Record<string, unknown>).Buffer;
    // 模拟浏览器：删除 Node Buffer 全局。
    delete (globalThis as Record<string, unknown>).Buffer;

    try {
      // standalone 版 pdfkit：chunk 为 Uint8Array，内部自带 Buffer shim。
      vi.doMock("pdfkit", async () => {
        const { EventEmitter } = await import("node:events");
        class FakePDFDocument extends EventEmitter {
          end(): void {
            // 模拟 standalone pdfkit 输出的 Uint8Array chunk（含 %PDF- 头）。
            this.emit("data", new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
            this.emit("data", new Uint8Array([0x31, 0x2e, 0x34]));
            queueMicrotask(() => this.emit("end"));
          }
        }
        for (const m of [
          "addPage", "fontSize", "fillColor", "text", "moveTo", "lineTo",
          "stroke", "ellipse", "fill", "lineWidth", "bezierCurveTo",
          "strokeColor",
        ]) {
          (FakePDFDocument.prototype as unknown as Record<string, unknown>)[m] =
            function (this: FakePDFDocument) {
              return this;
            };
        }
        return { default: FakePDFDocument };
      });
      vi.resetModules();
      const { PDFExporter: FreshExporter } = await import("../../io/pdf-exporter");

      const bytes = await new FreshExporter().exportToPDFBytes(
        makeLayout(),
        makeNotes(4),
        tempoMap,
      );

      expect(bytes).toBeInstanceOf(Uint8Array);
      // 头部 chunk + 尾部 chunk 经 concatUint8 无损拼接。
      expect(bytes.length).toBe(8);
      expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    } finally {
      (globalThis as Record<string, unknown>).Buffer = savedBuffer;
      vi.doUnmock("pdfkit");
      vi.resetModules();
    }
    // 恢复后确认 Node Buffer 已回到全局（不影响其他用例）。
    expect(typeof Buffer).toBe("function");
  });
});
