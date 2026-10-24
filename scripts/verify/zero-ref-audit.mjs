/**
 * 零生产引用审计：从真实入口出发做可达性 BFS（跟随 barrel re-export）。
 * 入口：ui/main.tsx、core/index.ts、agent/index.ts、audio-engine/index.ts、desktop/main+preload。
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const exts = [".ts", ".tsx"];
const all = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!["__tests__", "node_modules"].includes(e.name)) walk(p); }
    else if (exts.includes(path.extname(e.name)) && !/\.(test|spec)\.tsx?$/.test(e.name)) all.push(path.resolve(p));
  }
};
for (const r of ["packages/ui/src", "packages/core/src", "packages/agent/src", "packages/audio-engine/src", "packages/desktop/src"]) {
  if (fs.existsSync(r)) walk(r);
}

const set = new Set(all);
const src = new Map(all.map((f) => [f, fs.readFileSync(f, "utf8")]));

function resolveSpec(fromFile, spec) {
  let base;
  if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else if (spec === "@collinx/core") base = path.resolve(ROOT, "packages/core/src/index.ts");
  else if (spec === "@collinx/agent") base = path.resolve(ROOT, "packages/agent/src/index.ts");
  else return [];
  for (const cand of [base, base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    const n = path.resolve(cand);
    if (set.has(n)) return [n];
  }
  return [];
}

const entryList = [
  "packages/ui/src/main.tsx",
  "packages/core/src/index.ts",
  "packages/agent/src/index.ts",
  "packages/audio-engine/src/index.ts",
  "packages/desktop/src/main.ts",
  "packages/desktop/src/preload.ts",
];
const entries = entryList.map((p) => path.resolve(ROOT, p)).filter((p) => set.has(p));
const seen = new Set(entries);
const queue = [...entries];
while (queue.length) {
  const f = queue.pop();
  const text = src.get(f) ?? "";
  for (const m of text.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
    for (const t of resolveSpec(f, m[1])) if (!seen.has(t)) { seen.add(t); queue.push(t); }
  }
}

const unreachable = all.filter((f) => !seen.has(f) && !/test-utils|test-setup|vite-env/.test(f));
console.log(`源文件 ${all.length} · 可达 ${seen.size} · 零生产引用 ${unreachable.length}`);
for (const f of unreachable.sort()) console.log(" -", path.relative(ROOT, f).split(path.sep).join("/"));
