import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * v3.1.0：插件扫描器（主进程侧，真实文件系统）。
 *
 * 为什么在主进程而不是渲染进程：渲染进程没有 fs 权限，而 VST3/CLAP 的
 * 存在形式就是磁盘上的 .vst3 包 / .clap 文件。这里只做**发现**，不做加载 ——
 * 加载需要原生宿主进程，未接线前 `plugins:load` 会明确返回失败原因，
 * 而不是像旧实现那样返回三个硬编码插件。
 */

export type PluginFormat = "vst3" | "clap";

export interface ScannedPlugin {
  /** 稳定 id：格式 + 绝对路径的短哈希（同一插件跨次扫描不变） */
  id: string;
  name: string;
  format: PluginFormat;
  path: string;
  /** 包内是否有 Windows/macOS 可执行线索；仅用于界面提示，不代表能加载 */
  hasBinary: boolean;
}

/** 各平台默认插件目录（不存在就跳过，不报错） */
export function defaultPluginDirs(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") {
    const common = process.env["CommonProgramFiles"] ?? "C:\\Program Files\\Common Files";
    const local = process.env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local");
    return [
      path.join(common, "VST3"),
      path.join(common, "CLAP"),
      path.join(local, "Programs", "Common", "VST3"),
      path.join(local, "Programs", "Common", "CLAP"),
    ];
  }
  if (platform === "darwin") {
    return [
      "/Library/Audio/Plug-Ins/VST3",
      "/Library/Audio/Plug-Ins/CLAP",
      path.join(os.homedir(), "Library", "Audio", "Plug-Ins", "VST3"),
      path.join(os.homedir(), "Library", "Audio", "Plug-Ins", "CLAP"),
    ];
  }
  return ["/usr/lib/vst3", "/usr/local/lib/vst3", "/usr/lib/clap", "/usr/local/lib/clap"];
}

function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

/** 扫描单个目录（不存在返回空数组，不做静默兜底数据） */
export async function scanDir(dir: string): Promise<ScannedPlugin[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // 目录不存在 / 无权限 —— 是正常情况，不是错误
  }

  const found: ScannedPlugin[] = [];
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    const isVst3 = lower.endsWith(".vst3");
    const isClap = lower.endsWith(".clap");
    if (!isVst3 && !isClap) continue;
    if (!entry.isDirectory() && !entry.isFile()) continue;

    const full = path.join(dir, entry.name);
    const format: PluginFormat = isVst3 ? "vst3" : "clap";
    const binaryName =
      process.platform === "win32" ? "Contents/x86_64-win" : "Contents/MacOS";
    let hasBinary = entry.isFile();
    if (isVst3 && entry.isDirectory()) {
      try {
        const inner = await fs.readdir(path.join(full, binaryName));
        hasBinary = inner.length > 0;
      } catch {
        hasBinary = false;
      }
    }

    found.push({
      id: `${format}:${shortHash(full)}`,
      name: entry.name.replace(/\.(vst3|clap)$/i, ""),
      format,
      path: full,
      hasBinary,
    });
  }
  return found;
}

/** 扫描多个目录并去重（同一插件被多个目录包含时以先命中者为准） */
export async function scanPluginDirs(dirs: string[]): Promise<ScannedPlugin[]> {
  const byId = new Map<string, ScannedPlugin>();
  for (const dir of dirs) {
    for (const plugin of await scanDir(dir)) {
      if (!byId.has(plugin.id)) byId.set(plugin.id, plugin);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
