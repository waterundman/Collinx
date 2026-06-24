import type { ProjectGraphData } from "../schema/graph-schema";
import type { NoteEvent } from "../model/note-event";
import type { HarmonyEntry } from "../model/harmony-plan";
import type { MotifData } from "../model/motif";
import type { MixerState } from "../model/audio-routes";
import type { TasteGenomeData } from "../taste/taste-genome";
import type { GenomeVersionEntry } from "../taste/taste-store";
import type { DiffLogEntry } from "../diff/diff-log";

const FORMAT_VERSION = "1.1.0";

export interface AgentMusicManifest {
  version: string;
  createdAt: string;
  modifiedAt: string;
  title: string;
  bpm: number;
  keySignature: string;
  timeSignature: string;
  totalBars: number;
  trackCount: number;
}

export interface AgentMusicData {
  manifest: AgentMusicManifest;
  graph: ProjectGraphData;
  revisions: string[];
  notes: NoteEvent[];
  harmony?: HarmonyEntry[];
  form?: unknown;
  motifs?: MotifData[];
  tempoCurves?: unknown;
  noteControls?: unknown[];
  routing?: MixerState;
  tasteGenome?: TasteGenomeData;
  tasteVersions?: GenomeVersionEntry[];
  diffLog?: DiffLogEntry[];
}

interface ZipFileMap {
  [path: string]: Uint8Array;
}

function textEncoder(): TextEncoder {
  return new TextEncoder();
}

function textDecoder(): TextDecoder {
  return new TextDecoder();
}

function encode(str: string): Uint8Array {
  return textEncoder().encode(str);
}

function decode(bytes: Uint8Array): string {
  return textDecoder().decode(bytes);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return value;
}

function prettyJson(obj: unknown): string {
  return JSON.stringify(obj, jsonReplacer, 2);
}

function compactJson(obj: unknown): string {
  return JSON.stringify(obj);
}

export class AgentMusicIO {
  async save(data: AgentMusicData): Promise<Uint8Array> {
    const { Zip, ZipPassThrough } = await import("fflate");
    const zip = new Zip();

    const files: Uint8Array[] = [];
    const ready = new Promise<void>((resolve, reject) => {
      zip.ondata = (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        files.push(data);
        resolve();
      };
    });

    let pending = 0;
    const addFile = (name: string, content: string) => {
      pending++;
      const entry = new ZipPassThrough(name);
      zip.add(entry);
      const encoded = encode(content);
      entry.push(encoded, true);
    };

    addFile("manifest.json", prettyJson(data.manifest));

    addFile("project/graph.json", prettyJson(data.graph));
    addFile("project/revisions.jsonl", data.revisions.join("\n") + "\n");

    addFile(
      "composition/notes.jsonl",
      data.notes.map((n) => compactJson(n)).join("\n") + "\n"
    );
    if (data.harmony) {
      addFile("composition/harmony.json", prettyJson(data.harmony));
    }
    if (data.form) {
      addFile("composition/form.json", prettyJson(data.form));
    }
    if (data.motifs) {
      addFile("composition/motifs.json", prettyJson(data.motifs));
    }

    if (data.tempoCurves) {
      addFile("performance/tempo-curves.json", prettyJson(data.tempoCurves));
    }
    if (data.noteControls) {
      addFile(
        "performance/note-controls.jsonl",
        data.noteControls.map((c) => compactJson(c)).join("\n") + "\n"
      );
    }

    if (data.routing) {
      addFile("audio/routing.json", prettyJson(data.routing));
    }

    if (data.tasteGenome) {
      addFile("taste/genome-current.json", prettyJson(data.tasteGenome));
    }
    if (data.tasteVersions) {
      addFile(
        "taste/genome-versions.jsonl",
        data.tasteVersions.map((v) => compactJson(v)).join("\n") + "\n"
      );
    }

    if (data.diffLog) {
      addFile(
        "agent/diff-log.jsonl",
        data.diffLog.map((d) => compactJson(d)).join("\n") + "\n"
      );
    }

    zip.end();
    await ready;

    let totalSize = 0;
    for (const f of files) totalSize += f.length;
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const f of files) {
      result.set(f, offset);
      offset += f.length;
    }
    return result;
  }

  async load(buffer: Uint8Array): Promise<AgentMusicData> {
    const { unzipSync } = await import("fflate");
    const decompressed = unzipSync(buffer);

    const readFile = (path: string): Uint8Array | undefined => {
      return decompressed[path];
    };

    const readText = (path: string): string | undefined => {
      const data = readFile(path);
      return data ? decode(data) : undefined;
    };

    const readJson = <T>(path: string): T | undefined => {
      const text = readText(path);
      return text ? (JSON.parse(text) as T) : undefined;
    };

    const readJsonl = <T>(path: string): T[] => {
      const text = readText(path);
      if (!text) return [];
      return text
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T);
    };

    const manifest = readJson<AgentMusicManifest>("manifest.json");
    if (!manifest) {
      throw new Error("Invalid .agentmusic file: missing manifest.json");
    }

    const graph = readJson<ProjectGraphData>("project/graph.json");
    if (!graph) {
      throw new Error("Invalid .agentmusic file: missing project/graph.json");
    }

    const revisions = (() => {
      const text = readText("project/revisions.jsonl");
      if (!text) return [];
      return text
        .trim()
        .split("\n")
        .filter(Boolean);
    })();

    const notes = readJsonl<NoteEvent>("composition/notes.jsonl");
    const harmony = readJson<HarmonyEntry[]>("composition/harmony.json");
    const form = readJson<unknown>("composition/form.json");
    const motifs = readJson<MotifData[]>("composition/motifs.json");

    const tempoCurves = readJson<unknown>("performance/tempo-curves.json");
    const noteControls = readJsonl<unknown>("performance/note-controls.jsonl");

    const routing = readJson<MixerState>("audio/routing.json");

    const tasteGenome = readJson<TasteGenomeData>(
      "taste/genome-current.json"
    );
    const tasteVersions = readJsonl<GenomeVersionEntry>(
      "taste/genome-versions.jsonl"
    );

    const diffLog = readJsonl<DiffLogEntry>("agent/diff-log.jsonl");

    return {
      manifest,
      graph,
      revisions,
      notes,
      harmony,
      form,
      motifs,
      tempoCurves,
      noteControls: noteControls.length > 0 ? noteControls : undefined,
      routing,
      tasteGenome,
      tasteVersions: tasteVersions.length > 0 ? tasteVersions : undefined,
      diffLog: diffLog.length > 0 ? diffLog : undefined,
    };
  }

  createManifest(data: Partial<AgentMusicData>): AgentMusicManifest {
    const now = new Date().toISOString();
    const meta = data.graph?.meta;

    let keySignature = "C major";
    if (meta?.key_map && meta.key_map.length > 0) {
      const k = meta.key_map[0];
      keySignature = `${k.tonic} ${k.mode}`;
    }

    let timeSignature = "4/4";
    if (meta?.meter_map && meta.meter_map.length > 0) {
      const m = meta.meter_map[0];
      timeSignature = `${m.numerator}/${m.denominator}`;
    }

    let bpm = 120;
    if (meta?.tempo_map && meta.tempo_map.length > 0) {
      bpm = meta.tempo_map[0].bpm;
    }

    const trackIds = new Set<string>();
    if (data.notes) {
      for (const note of data.notes) {
        trackIds.add(note.trackId);
      }
    }

    let totalBars = 1;
    if (data.notes) {
      for (const note of data.notes) {
        if (note.bar > totalBars) totalBars = note.bar;
      }
    }

    return {
      version: FORMAT_VERSION,
      createdAt: now,
      modifiedAt: now,
      title: meta?.title ?? "Untitled",
      bpm,
      keySignature,
      timeSignature,
      totalBars,
      trackCount: trackIds.size || 1,
    };
  }
}
