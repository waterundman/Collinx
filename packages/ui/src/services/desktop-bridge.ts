/**
 * 桌面外壳桥接（渲染进程侧）。
 *
 * 界面需要知道两件事：
 * 1. 自己跑在浏览器里，还是跑在 Electron 外壳里 —— 决定是否显示音频相关 UI
 * 2. 如果在外壳里，怎么访问原生音频引擎
 *
 * 为什么用 `globalThis` 探测而不是 import：preload 通过 contextBridge 注入的
 * 对象只存在于运行时，不属于构建期模块图。直接 import 会在浏览器构建里报错。
 *
 * ⚠️ **当前零引用**（v2.9.1 审计实测）：UI 还没有任何地方读它。
 * 规格来自桌面外壳 Stage（原生引擎发声），阻塞于 Electron 壳接线。
 * 请勿按「零引用」删除；真正的最后一公里是给 preload 补 startPlayback
 * 并在 App 里按 isDesktop 分流（见 docs/architecture.md §五）。
 */

export type AudioEngineStatus = "unavailable" | "ready" | "error";

export interface AudioEngineInfo {
  status: AudioEngineStatus;
  reason?: string;
  sampleRate?: number;
  backend?: string;
}

export interface CollinxDesktopBridge {
  isDesktop: true;
  platform: string;
  audioEngine: {
    load(): Promise<AudioEngineInfo>;
    info(): Promise<AudioEngineInfo>;
    start(): Promise<boolean>;
    stop(): Promise<void>;
  };
  /**
   * v3.1.0：插件宿主。**可选** —— 旧版 preload 没有这一段，
   * 调用方必须按「不可用」处理，而不是假定存在。
   */
  plugins?: {
    scan(dirs?: string[]): Promise<{
      ok: boolean;
      reason?: string;
      plugins: Array<{
        id: string;
        name: string;
        format: "vst3" | "clap";
        path: string;
        hasBinary: boolean;
      }>;
    }>;
    load(pluginId: string): Promise<{ ok: boolean; pluginId: string; reason?: string }>;
  };
}

/** 取桌面桥；在浏览器中返回 null（调用方据此降级） */
export function getDesktopBridge(): CollinxDesktopBridge | null {
  const candidate = (globalThis as { collinx?: unknown }).collinx;
  if (!candidate || typeof candidate !== "object") return null;
  const bridge = candidate as Partial<CollinxDesktopBridge>;
  // 形状校验：外部注入的对象不可信，缺关键方法就当没有
  if (!bridge.isDesktop || !bridge.audioEngine?.load) return null;
  return candidate as CollinxDesktopBridge;
}

/** 是否运行在桌面外壳中 */
export function isDesktop(): boolean {
  return getDesktopBridge() !== null;
}

/**
 * 探测音频引擎可用性。浏览器中恒为 unavailable（且 reason 说明原因），
 * 桌面外壳里则反映原生引擎的真实状态。
 */
export async function probeAudioEngine(): Promise<AudioEngineInfo> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    return {
      status: "unavailable",
      reason: "当前运行在浏览器中 —— 原生音频引擎仅在桌面外壳内可用",
    };
  }
  try {
    return await bridge.audioEngine.load();
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : "音频引擎探测失败",
    };
  }
}
