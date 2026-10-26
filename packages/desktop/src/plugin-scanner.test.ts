/**
 * 插件扫描器测试（主进程侧）。
 *
 * 运行：node --test --experimental-strip-types src/plugin-scanner.test.ts
 *
 * 覆盖的是**真实文件系统语义**，不是造数据：
 * 1. 只认 .vst3 / .clap，其它扩展名一律忽略
 * 2. 目录不存在 → 空数组（不是错误、也不是兜底假数据）
 * 3. 多目录去重 —— 同一路径只出现一次
 * 4. id 稳定 —— 同一路径两次扫描得到同一个 id
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { scanDir, scanPluginDirs } from "./plugin-scanner.ts";

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "collinx-plugins-"));
}

test("scans only .vst3 and .clap entries", async () => {
  const dir = await makeTempDir();
  await fs.writeFile(path.join(dir, "Alpha.clap"), "");
  await fs.mkdir(path.join(dir, "Beta.vst3"));
  await fs.writeFile(path.join(dir, "notes.txt"), "");

  const found = await scanDir(dir);
  const names = found.map((p) => p.name).sort();
  assert.deepEqual(names, ["Alpha", "Beta"]);

  const formats = found.map((p) => p.format).sort();
  assert.deepEqual(formats, ["clap", "vst3"]);

  await fs.rm(dir, { recursive: true, force: true });
});

test("missing directory yields an empty list (no fallback data)", async () => {
  const found = await scanDir(path.join(os.tmpdir(), "collinx-definitely-missing-dir"));
  assert.deepEqual(found, []);
});

test("dedupes across directories and keeps ids stable", async () => {
  const dir = await makeTempDir();
  await fs.writeFile(path.join(dir, "Gamma.clap"), "");

  const first = await scanPluginDirs([dir, dir]);
  const second = await scanPluginDirs([dir]);

  assert.equal(first.length, 1, "同一目录传两次不应产生两条记录");
  assert.equal(first[0].id, second[0].id, "同一路径的 id 必须稳定");

  await fs.rm(dir, { recursive: true, force: true });
});

test("vst3 bundle without a binary is flagged, not dropped", async () => {
  const dir = await makeTempDir();
  await fs.mkdir(path.join(dir, "Empty.vst3"));

  const found = await scanDir(dir);
  assert.equal(found.length, 1);
  assert.equal(found[0].hasBinary, false);

  await fs.rm(dir, { recursive: true, force: true });
});
