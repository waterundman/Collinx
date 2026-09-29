#!/usr/bin/env node
/**
 * Collinx 资源下载器（manifest 驱动）。
 *
 * 用法：
 *   node scripts/resources/fetch.mjs all          # 下载全部
 *   node scripts/resources/fetch.mjs fluidr3-gm   # 指定 id（可多个）
 *   node scripts/resources/fetch.mjs list         # 列出清单
 *
 * 落盘：仓库根 resources/<id>/（gitignore，不入库）。
 * 清单：同目录 manifest.json（id/url/license/verified 逐条标注）。
 *
 * 行为约定：
 * - 已存在且大小 > 0 的目标文件 → 跳过（幂等，可重复运行）。
 * - verified=unverified 的条目失败 → 跳过并提示回填新直链，不中断其余下载。
 * - github-release 型：经 GitHub API 取最新 release，按 assetPattern 匹配资产。
 */
import { createWriteStream, existsSync, statSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DEST_ROOT = path.join(ROOT, "resources");
const manifest = JSON.parse(
  await readFile(path.join(__dirname, "manifest.json"), "utf8")
);

const args = process.argv.slice(2);
const ids = args.filter((a) => a !== "all" && a !== "list");

if (args[0] === "list" || args.length === 0) {
  console.log("资源清单（scripts/resources/manifest.json）：\n");
  for (const r of manifest.resources) {
    console.log(
      `  [${r.verified === "ok" ? "✓" : "?"}] ${r.id.padEnd(16)} ${r.category.padEnd(16)} ${r.name}`
    );
    console.log(`        ${" ".repeat(0)}license: ${r.license}`);
  }
  console.log("\n用法：node scripts/resources/fetch.mjs <id...|all>");
  process.exit(0);
}

const targets =
  args[0] === "all"
    ? manifest.resources
    : manifest.resources.filter((r) => ids.includes(r.id));
const missing = ids.filter((id) => !manifest.resources.some((r) => r.id === id));
if (missing.length > 0) {
  console.error(`未知 id：${missing.join(", ")}`);
  process.exit(1);
}

function destDir(r) {
  const dir = path.join(DEST_ROOT, r.id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function alreadyDownloaded(r) {
  const f = path.join(destDir(r), r.out);
  try {
    return statSync(f).size > 0;
  } catch {
    return false;
  }
}

async function download(url, outFile) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(outFile));
}

async function resolveGithubAsset(r) {
  const api = `https://api.github.com/repos/${r.repo}/releases/latest`;
  const res = await fetch(api, {
    headers: { "user-agent": "collinx-resource-fetcher" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const release = await res.json();
  const re = new RegExp(r.assetPattern);
  const asset = (release.assets ?? []).find((a) => re.test(a.name));
  if (!asset) {
    throw new Error(
      `最新 release 无匹配资产（pattern=${r.assetPattern}）；可用：${(release.assets ?? [])
        .map((a) => a.name)
        .join(", ")}`
    );
  }
  return asset.browser_download_url;
}

let okCount = 0;
let skipCount = 0;
let failCount = 0;

for (const r of targets) {
  const head = `[${r.id}] ${r.name}`;
  if (alreadyDownloaded(r)) {
    console.log(`→ 已存在，跳过：${head}`);
    skipCount += 1;
    continue;
  }
  try {
    let url = r.url;
    if (r.type === "github-release") {
      url = await resolveGithubAsset(r);
      console.log(`→ ${head}\n   资产：${url}`);
    } else {
      console.log(`→ ${head}\n   ${url}`);
    }
    const out = path.join(destDir(r), r.out);
    await download(url, out);
    const size = statSync(out).size;
    if (size === 0) throw new Error("下载为空文件");
    console.log(
      `   ✓ 完成：${(size / 1024 / 1024).toFixed(1)} MB → ${path.relative(ROOT, out)}`
    );
    okCount += 1;
  } catch (err) {
    failCount += 1;
    console.error(
      `   ✗ 失败：${err.message}${r.notes ? `\n   提示：${r.notes}` : ""}`
    );
  }
}

console.log(
  `\n完成：${okCount} 成功 / ${skipCount} 跳过 / ${failCount} 失败（共 ${targets.length}）`
);
process.exit(failCount > 0 ? 1 : 0);
