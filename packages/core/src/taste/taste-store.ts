import { TasteGenome, type TasteGenomeData } from "./taste-genome";
import type { TasteEvidence } from "./taste-types";

export interface GenomeVersionEntry {
  version: number;
  genomeJson: TasteGenomeData;
  timestamp: string;
  message: string;
}

export interface TastePackage {
  packageVersion: 1;
  exportedAt: string;
  genome: TasteGenomeData;
  evidence: TasteEvidence[];
  versionHistory: GenomeVersionEntry[];
}

export interface ParameterDiff {
  paramKey: string;
  fromValue: string | null;
  toValue: string | null;
  changed: boolean;
}

export interface FileSystemAdapter {
  exists(path: string): boolean;
  mkdir(path: string, options?: { recursive?: boolean }): void;
  readFile(path: string, encoding: string): string;
  writeFile(path: string, data: string, encoding: string): void;
}

function createNodeFsAdapter(): FileSystemAdapter {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  return {
    exists: (p: string) => fs.existsSync(p),
    mkdir: (p: string, opts?: { recursive?: boolean }) => {
      fs.mkdirSync(p, { recursive: opts?.recursive ?? false });
    },
    readFile: (p: string, encoding: string) =>
      fs.readFileSync(p, encoding as BufferEncoding),
    writeFile: (p: string, data: string, encoding: string) => {
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(p, data, encoding as BufferEncoding);
    },
  };
}

export class TasteStore {
  private _genome: TasteGenome | null;
  private _versionHistory: GenomeVersionEntry[];
  private _storagePath: string | null;
  private _fs: FileSystemAdapter | null;

  constructor(storagePath?: string, fsAdapter?: FileSystemAdapter) {
    this._genome = null;
    this._versionHistory = [];
    this._storagePath = storagePath ?? null;
    this._fs = fsAdapter ?? (storagePath ? createNodeFsAdapter() : null);
  }

  // ---------------------------------------------------------------------------
  // Core operations
  // ---------------------------------------------------------------------------

  load(): TasteGenome | null {
    if (!this._storagePath) return null;
    this._loadFromDisk();
    return this._genome ? TasteGenome.fromJSON(this._genome.toJSON()) : null;
  }

  save(genome: TasteGenome): void {
    genome.incrementVersion();
    const snapshot: GenomeVersionEntry = {
      version: genome.version,
      genomeJson: genome.toJSON(),
      timestamp: new Date().toISOString(),
      message: `v${genome.version}`,
    };
    this._versionHistory.push(snapshot);
    this._genome = TasteGenome.fromJSON(genome.toJSON());
    if (this._storagePath) {
      this._saveToDisk();
    }
  }

  getCurrentGenome(): TasteGenome | null {
    if (!this._genome) return null;
    return TasteGenome.fromJSON(this._genome.toJSON());
  }

  hasGenome(): boolean {
    return this._genome !== null;
  }

  // ---------------------------------------------------------------------------
  // Version management
  // ---------------------------------------------------------------------------

  getVersion(): number {
    return this._genome?.version ?? 0;
  }

  getVersionHistory(): GenomeVersionEntry[] {
    return [...this._versionHistory];
  }

  revertTo(version: number): TasteGenome | null {
    const entry = this._versionHistory.find((e) => e.version === version);
    if (!entry) return null;
    this._genome = TasteGenome.fromJSON(entry.genomeJson);
    if (this._storagePath) {
      this._saveToDisk();
    }
    return TasteGenome.fromJSON(this._genome.toJSON());
  }

  getDiff(fromVersion: number, toVersion: number): ParameterDiff[] {
    const fromEntry = this._versionHistory.find(
      (e) => e.version === fromVersion
    );
    const toEntry = this._versionHistory.find((e) => e.version === toVersion);
    if (!fromEntry || !toEntry) return [];

    const diffs: ParameterDiff[] = [];
    const fromDomains = fromEntry.genomeJson.domains;
    const toDomains = toEntry.genomeJson.domains;
    const allKeys = new Set([
      ...Object.keys(fromDomains),
      ...Object.keys(toDomains),
    ]);

    for (const key of allKeys) {
      const fromValue = fromDomains[key]?.value ?? null;
      const toValue = toDomains[key]?.value ?? null;
      diffs.push({
        paramKey: key,
        fromValue,
        toValue,
        changed: fromValue !== toValue,
      });
    }

    return diffs;
  }

  // ---------------------------------------------------------------------------
  // Export / Import
  // ---------------------------------------------------------------------------

  exportPackage(): TastePackage {
    if (!this._genome) {
      throw new Error("No genome to export");
    }
    const evidence: TasteEvidence[] = [];
    const domains = this._genome.domains;
    for (const key of Object.keys(domains)) {
      for (const ev of domains[key].evidence) {
        evidence.push(ev);
      }
    }
    return {
      packageVersion: 1 as const,
      exportedAt: new Date().toISOString(),
      genome: this._genome.toJSON(),
      evidence,
      versionHistory: this._versionHistory.map((e) => ({ ...e })),
    };
  }

  importPackage(pkg: TastePackage): void {
    this._genome = TasteGenome.fromJSON(pkg.genome);
    this._versionHistory = pkg.versionHistory.map((e) => ({ ...e }));
    if (this._storagePath) {
      this._saveToDisk();
    }
  }

  exportToJSON(): string {
    return JSON.stringify(
      {
        genome: this._genome?.toJSON() ?? null,
        versionHistory: this._versionHistory,
        storagePath: this._storagePath,
      },
      null,
      2
    );
  }

  static importFromJSON(json: string): TasteStore {
    const data = JSON.parse(json);
    const store = new TasteStore(data.storagePath ?? undefined);
    if (data.genome) {
      store._genome = TasteGenome.fromJSON(data.genome);
    }
    store._versionHistory = data.versionHistory ?? [];
    return store;
  }

  // ---------------------------------------------------------------------------
  // Data governance (GDPR)
  // ---------------------------------------------------------------------------

  deleteGenome(): void {
    this._genome = null;
    this._versionHistory = [];
    if (this._storagePath) {
      this._saveToDisk();
    }
  }

  deleteEvidence(paramKey: string, evidenceId: string): void {
    if (!this._genome) return;
    const param = this._genome.getParameter(paramKey);
    if (!param) return;
    param.evidence = param.evidence.filter((e) => e.id !== evidenceId);
    this._genome.setParameter(paramKey, param);
    if (this._storagePath) {
      this._saveToDisk();
    }
  }

  listAllEvidence(): { paramKey: string; evidence: TasteEvidence }[] {
    if (!this._genome) return [];
    const result: { paramKey: string; evidence: TasteEvidence }[] = [];
    const domains = this._genome.domains;
    for (const [key, param] of Object.entries(domains)) {
      for (const ev of param.evidence) {
        result.push({ paramKey: key, evidence: ev });
      }
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Internal persistence helpers
  // ---------------------------------------------------------------------------

  private _saveToDisk(): void {
    if (!this._fs || !this._storagePath) return;

    const dir = this._storagePath;
    if (!this._fs.exists(dir)) {
      this._fs.mkdir(dir, { recursive: true });
    }

    const genomePath = `${dir}/genome.json`;
    this._fs.writeFile(
      genomePath,
      JSON.stringify(
        {
          genome: this._genome?.toJSON() ?? null,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      "utf-8"
    );

    const versionsPath = `${dir}/versions.jsonl`;
    const lines = this._versionHistory.map((e) => JSON.stringify(e));
    this._fs.writeFile(versionsPath, lines.join("\n") + "\n", "utf-8");
  }

  private _loadFromDisk(): void {
    if (!this._fs || !this._storagePath) return;

    const genomePath = `${this._storagePath}/genome.json`;
    if (this._fs.exists(genomePath)) {
      const content = this._fs.readFile(genomePath, "utf-8");
      const data = JSON.parse(content);
      if (data.genome) {
        this._genome = TasteGenome.fromJSON(data.genome);
      }
    }

    const versionsPath = `${this._storagePath}/versions.jsonl`;
    if (this._fs.exists(versionsPath)) {
      const content = this._fs.readFile(versionsPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      this._versionHistory = lines.map((line: string) => JSON.parse(line) as GenomeVersionEntry);
    }
  }
}
