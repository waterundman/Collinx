import type { FileSystemAdapter } from "@collinx/core";

// ---------------------------------------------------------------------------
// Browser FileSystemAdapter for TasteStore.
//
// TasteStore persists genome.json / versions.jsonl to a virtual directory via
// the FileSystemAdapter interface. On Node the default adapter uses fs/path
// (see core createNodeFsAdapter); in the browser we back the same interface
// with localStorage (a JSON blob keyed by virtual path), falling back to an
// in-memory Map when localStorage is unavailable (privacy mode, SSR, or a
// minimal test environment). The fallback keeps construction side-effect free
// and never touches Node's `fs` module.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "collinx:taste.fs.v1";

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // localStorage getter can throw in some environments (privacy mode).
    return null;
  }
}

function readPersistedFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const storage = getLocalStorage();
  if (!storage) return files;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Record<string, string>;
      for (const [key, value] of Object.entries(data)) {
        files.set(key, value);
      }
    }
  } catch {
    // localStorage access / parse failure: start from an empty in-memory map.
  }
  return files;
}

export function createBrowserTasteFsAdapter(): FileSystemAdapter {
  const files = readPersistedFiles();

  const persist = (): void => {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
      const data: Record<string, string> = {};
      for (const [key, value] of files) {
        data[key] = value;
      }
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Quota / access errors: keep the in-memory snapshot only.
    }
  };

  return {
    exists: (path: string): boolean => files.has(path),
    mkdir: (): void => {
      // Flat virtual filesystem: directories are implicit.
    },
    readFile: (path: string): string => {
      const content = files.get(path);
      if (content === undefined) {
        throw new Error(`No such file in taste store: ${path}`);
      }
      return content;
    },
    writeFile: (path: string, data: string): void => {
      files.set(path, data);
      persist();
    },
  };
}
