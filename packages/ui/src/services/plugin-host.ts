import { getDesktopBridge } from "./desktop-bridge";

/**
 * v3.1.0：插件宿主适配层。
 *
 * 取代被删除的 `Vst3HostService` —— 后者最大的问题是 `scanDirectory()`
 * **返回三个硬编码插件**（Reverb Pro / Synth Master / Compressor X），
 * 任何界面挂上去看到的都是假数据。
 *
 * 本模块的唯一原则：**没有宿主就返回不可用，不返回任何编造条目**。
 * 浏览器里（无 Electron 壳）恒为 unavailable；桌面壳里走 preload 的真实
 * 文件系统扫描。
 */

export type PluginFormat = "vst3" | "clap";

export interface InstalledPlugin {
  id: string;
  name: string;
  format: PluginFormat;
  path: string;
  /** 包内是否有可执行线索；仅提示，不代表可加载（加载需原生宿主） */
  hasBinary: boolean;
}

export type PluginScanOutcome =
  | { status: "ok"; plugins: InstalledPlugin[] }
  | { status: "unavailable"; reason: string }
  | { status: "error"; reason: string };

/** 当前环境是否具备插件宿主（桌面壳且 preload 暴露了 plugins） */
export function isPluginHostAvailable(): boolean {
  return getDesktopBridge()?.plugins != null;
}

export async function scanInstalledPlugins(dirs?: string[]): Promise<PluginScanOutcome> {
  const bridge = getDesktopBridge();
  if (!bridge?.plugins) {
    return {
      status: "unavailable",
      reason: "当前运行在浏览器中 —— 插件宿主仅在桌面外壳内可用",
    };
  }
  try {
    const res = await bridge.plugins.scan(dirs);
    if (!res.ok) {
      return { status: "error", reason: res.reason ?? "扫描失败" };
    }
    // 只透传宿主返回的真实条目，不做任何补全
    return { status: "ok", plugins: res.plugins };
  } catch (err) {
    return { status: "error", reason: err instanceof Error ? err.message : "扫描失败" };
  }
}

export async function loadPlugin(
  pluginId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const bridge = getDesktopBridge();
  if (!bridge?.plugins) {
    return { ok: false, reason: "插件宿主不可用" };
  }
  try {
    const res = await bridge.plugins.load(pluginId);
    return res.ok ? { ok: true } : { ok: false, reason: res.reason ?? "加载失败" };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "加载失败" };
  }
}
