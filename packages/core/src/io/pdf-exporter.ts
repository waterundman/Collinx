import PDFDocument from "pdfkit";
import type { Layout } from "../model/score-model";
import type { NoteEvent } from "../model/note-event";
import type { TempoMap } from "../model/tempo-map";

export interface PDFExportOptions {
  pageSize?: "A4" | "Letter";
  orientation?: "portrait" | "landscape";
  title?: string;
  composer?: string;
}

interface PageDimensions {
  width: number;
  height: number;
}

const PAGE_SIZES: Record<string, PageDimensions> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
};

const STAFF_LINE_SPACING = 10;
const STAFF_SPACING = 80;
const MARGIN = 60;
const BAR_NUMBER_SIZE = 8;
const NOTE_HEAD_RX = 5;
const NOTE_HEAD_RY = 3.5;
const STEM_LENGTH = 30;
const CLEF_SIZE = 40;
const TIME_SIG_SIZE = 28;
const BARS_PER_SYSTEM = 4;

function getMidiOctave(pitchMidi: number): number {
  return Math.floor(pitchMidi / 12) - 1;
}

function getMidiNoteName(pitchMidi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return names[pitchMidi % 12];
}

function isBlackKey(pitchMidi: number): boolean {
  const n = pitchMidi % 12;
  return [1, 3, 6, 8, 10].includes(n);
}

interface StaffPosition {
  line: number;
  offset: number;
}

function midiToStaffPosition(pitchMidi: number, clef: string): StaffPosition {
  const noteNames = ["C", "D", "E", "F", "G", "A", "B"];
  const octave = getMidiOctave(pitchMidi);
  const noteName = getMidiNoteName(pitchMidi).replace("#", "");
  const noteIndex = noteNames.indexOf(noteName);

  let stepsFromC4: number;
  if (clef === "treble" || clef === "treble_8vb") {
    stepsFromC4 = (octave - 4) * 7 + noteIndex;
  } else {
    stepsFromC4 = (octave - 3) * 7 + noteIndex;
  }

  const line = -stepsFromC4 / 2;
  const offset = stepsFromC4 % 2 === 0 ? 0 : 0.5;
  return { line, offset };
}

function isFilledNote(durQn: number): boolean {
  return durQn < 2;
}

function shouldStemUp(pitchMidi: number): boolean {
  return pitchMidi >= 60;
}

export class PDFExporter {
  exportToPDF(
    layout: Layout,
    notes: NoteEvent[],
    tempoMap: TempoMap,
    options?: PDFExportOptions,
  ): Promise<Buffer> {
    const pageSize = options?.pageSize ?? "A4";
    const orientation = options?.orientation ?? "portrait";
    const dims = PAGE_SIZES[pageSize] ?? PAGE_SIZES.A4;

    const pageWidth = orientation === "landscape" ? dims.height : dims.width;
    const pageHeight = orientation === "landscape" ? dims.width : dims.height;

    const drawWidth = pageWidth - MARGIN * 2;
    const staves = layout.staves.length > 0
      ? layout.staves
      : [
          { id: "treble", clef: "treble" as const, voices: 1, lines: 5 },
          { id: "bass", clef: "bass" as const, voices: 1, lines: 5 },
        ];

    const totalStaves = staves.length;
    const systemHeight = totalStaves * STAFF_SPACING + 40;

    const maxBars = this.getMaxBar(notes);
    const totalBars = Math.max(maxBars, 1);

    const systems: number[][] = [];
    let currentSystem: number[] = [];
    for (let bar = 1; bar <= totalBars; bar++) {
      currentSystem.push(bar);
      if (currentSystem.length === BARS_PER_SYSTEM || bar === totalBars) {
        systems.push(currentSystem);
        currentSystem = [];
      }
    }

    const systemsPerPage = Math.max(
      1,
      Math.floor((pageHeight - MARGIN * 2 - 60) / systemHeight),
    );

    const pages: number[][][] = [];
    let currentPage: number[][] = [];
    for (const sys of systems) {
      currentPage.push(sys);
      if (currentPage.length === systemsPerPage || sys === systems[systems.length - 1]) {
        pages.push(currentPage);
        currentPage = [];
      }
    }

    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const doc = new PDFDocument({
        size: [pageWidth, pageHeight],
        margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        autoFirstPage: false,
      });

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err: Error) => reject(err));

      if (options?.title) {
        this.renderTitlePage(doc, pageWidth, pageHeight, options.title, options.composer);
      }

      for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
        doc.addPage();
        const pageSystems = pages[pageIdx];

        for (let sysIdx = 0; sysIdx < pageSystems.length; sysIdx++) {
          const bars = pageSystems[sysIdx];
          const yOffset = MARGIN + 40 + sysIdx * systemHeight;

          this.renderSystem(
            doc,
            layout,
            notes,
            tempoMap,
            staves,
            bars,
            MARGIN,
            yOffset,
            drawWidth,
          );
        }

        doc.fontSize(9).fillColor("#666");
        doc.text(`${pageIdx + 1}`, 0, pageHeight - 30, { align: "center" });
      }

      doc.end();
    });
  }

  private renderTitlePage(
    doc: PDFKit.PDFDocument,
    pageWidth: number,
    pageHeight: number,
    title: string,
    composer?: string,
  ): void {
    doc.addPage();
    const centerX = pageWidth / 2;

    doc.fontSize(32).fillColor("#000");
    doc.text(title, MARGIN, pageHeight / 2 - 80, {
      align: "center",
      width: pageWidth - MARGIN * 2,
    });

    if (composer) {
      doc.fontSize(18).fillColor("#333");
      doc.text(composer, MARGIN, pageHeight / 2 - 20, {
        align: "center",
        width: pageWidth - MARGIN * 2,
      });
    }

    const dateStr = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    doc.fontSize(12).fillColor("#666");
    doc.text(dateStr, MARGIN, pageHeight / 2 + 30, {
      align: "center",
      width: pageWidth - MARGIN * 2,
    });
  }

  private renderSystem(
    doc: PDFKit.PDFDocument,
    layout: Layout,
    notes: NoteEvent[],
    tempoMap: TempoMap,
    staves: { id: string; clef: string; voices: number; lines: number }[],
    bars: number[],
    xStart: number,
    yStart: number,
    totalWidth: number,
  ): void {
    const systemNotes = notes.filter((n) => bars.includes(n.bar));
    const barWidth = totalWidth / bars.length;

    for (let staffIdx = 0; staffIdx < staves.length; staffIdx++) {
      const staff = staves[staffIdx];
      const staffY = yStart + staffIdx * STAFF_SPACING;
      const staffNotes = systemNotes.filter((n) => {
        if (n.voice === "rh" || n.voice === "1") return staffIdx === 0;
        if (n.voice === "lh" || n.voice === "2") return staffIdx === staves.length - 1;
        return staffIdx === 0;
      });

      this.renderStaffLines(doc, xStart, staffY, totalWidth);

      const clefX = xStart + 4;
      this.renderClef(doc, staff.clef, clefX, staffY);

      if (bars[0] === 1 || (bars[0] > 1 && this.isMeterChange(tempoMap, bars[0]))) {
        const meter = tempoMap.meterAt(bars[0]);
        const timeSigX = clefX + CLEF_SIZE + 8;
        this.renderTimeSignature(doc, meter.numerator, meter.denominator, timeSigX, staffY);
      }

      for (let barIdx = 0; barIdx < bars.length; barIdx++) {
        const barNum = bars[barIdx];
        const barX = xStart + barIdx * barWidth;

        if (barIdx > 0) {
          this.renderBarLine(doc, barX, staffY);
        }

        if (staffIdx === 0) {
          doc.fontSize(BAR_NUMBER_SIZE).fillColor("#999");
          doc.text(`${barNum}`, barX, staffY - 15, {
            width: barWidth,
            align: "center",
          });
        }

        const barNotes = staffNotes.filter((n) => n.bar === barNum);
        const meter = tempoMap.meterAt(barNum);
        const beatsPerBar = meter.numerator * (4 / meter.denominator);

        for (const note of barNotes) {
          const beatFrac = (note.beat - 1) / beatsPerBar;
          const noteX = barX + beatFrac * barWidth + 20;
          const pos = midiToStaffPosition(note.pitchMidi, staff.clef);
          const noteY = staffY + pos.line * (STAFF_LINE_SPACING / 2);

          this.renderNoteHead(doc, noteX, noteY, isFilledNote(note.durQn));
          this.renderStem(doc, noteX, noteY, shouldStemUp(note.pitchMidi));
        }
      }
    }

    if (staves.length > 1) {
      const braceX = xStart - 2;
      const topY = yStart;
      const bottomY = yStart + (staves.length - 1) * STAFF_SPACING + 4 * STAFF_LINE_SPACING;
      this.renderBrace(doc, braceX, topY, bottomY);
    }
  }

  private renderStaffLines(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
  ): void {
    doc.lineWidth(0.5).strokeColor("#000");
    for (let i = 0; i < 5; i++) {
      const lineY = y + i * STAFF_LINE_SPACING;
      doc.moveTo(x, lineY).lineTo(x + width, lineY).stroke();
    }
  }

  private renderClef(
    doc: PDFKit.PDFDocument,
    clef: string,
    x: number,
    y: number,
  ): void {
    doc.fontSize(CLEF_SIZE).fillColor("#000");
    if (clef === "treble" || clef === "treble_8vb") {
      doc.text("\u{1D11E}", x, y - 6, { lineBreak: false });
    } else if (clef === "bass" || clef === "bass_8vb") {
      doc.text("\u{1D122}", x, y + 2, { lineBreak: false });
    } else {
      doc.text("\u{1D11E}", x, y - 6, { lineBreak: false });
    }
  }

  private renderTimeSignature(
    doc: PDFKit.PDFDocument,
    numerator: number,
    denominator: number,
    x: number,
    y: number,
  ): void {
    doc.fontSize(TIME_SIG_SIZE).fillColor("#000");
    doc.text(`${numerator}`, x, y - 2, { lineBreak: false });
    doc.text(`${denominator}`, x, y + STAFF_LINE_SPACING * 2 - TIME_SIG_SIZE + 6, {
      lineBreak: false,
    });
  }

  private renderBarLine(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
  ): void {
    doc.lineWidth(1).strokeColor("#000");
    doc.moveTo(x, y).lineTo(x, y + 4 * STAFF_LINE_SPACING).stroke();
  }

  private renderNoteHead(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    filled: boolean,
  ): void {
    if (filled) {
      doc.ellipse(x, y, NOTE_HEAD_RX, NOTE_HEAD_RY).fill("#000");
    } else {
      doc.ellipse(x, y, NOTE_HEAD_RX, NOTE_HEAD_RY).lineWidth(1.2).stroke("#000");
    }
  }

  private renderStem(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    up: boolean,
  ): void {
    doc.lineWidth(1.2).strokeColor("#000");
    const stemX = up ? x + NOTE_HEAD_RX - 1 : x - NOTE_HEAD_RX + 1;
    const stemY1 = y;
    const stemY2 = up ? y - STEM_LENGTH : y + STEM_LENGTH;
    doc.moveTo(stemX, stemY1).lineTo(stemX, stemY2).stroke();
  }

  private renderBrace(
    doc: PDFKit.PDFDocument,
    x: number,
    topY: number,
    bottomY: number,
  ): void {
    doc.lineWidth(1.5).strokeColor("#000");
    const midY = (topY + bottomY) / 2;
    const height = bottomY - topY;
    doc.moveTo(x, topY)
      .bezierCurveTo(x - 8, topY + height * 0.25, x - 8, midY - height * 0.1, x, midY)
      .bezierCurveTo(x + 8, midY + height * 0.1, x + 8, bottomY - height * 0.25, x, bottomY)
      .stroke();
  }

  private isMeterChange(tempoMap: TempoMap, bar: number): boolean {
    const prevMeter = tempoMap.meterAt(bar - 1);
    const curMeter = tempoMap.meterAt(bar);
    return prevMeter.numerator !== curMeter.numerator || prevMeter.denominator !== curMeter.denominator;
  }

  private getMaxBar(notes: NoteEvent[]): number {
    if (notes.length === 0) return 16;
    return Math.max(...notes.map((n) => n.bar));
  }
}
