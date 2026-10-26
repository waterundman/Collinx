/**
 * 预加载脚本 —— 渲染进程与主进程之间的唯一通道。
 *
 * 安全约定：
 * - 渲染进程拿不到 Node / Electron 的任何能力，只能用这里显式暴露的方法
 * - 暴露的是**收敛的领域 API**（audioEngine.*），不是 ipcRenderer 本身
 *   （直接暴露 ipcRenderer 等于把整个 IPC 面开放给页面脚本）
 * - 所有方法返回 Promise —— 与将来「引擎移出主进程」的实现保持同一形状
 */
import { contextBridge, ipcRenderer } from "electron";

export type AudioEngineStatus = "unavailable" | "ready" | "error";

export interface AudioEngineInfo {
  status: AudioEngineStatus;
  reason?: string;
  sampleRate?: number;
  backend?: string;
}

const api = {
  /** 是否运行在桌面外壳里（浏览器里为 false，界面据此决定是否显示音频开关） */
  isDesktop: true,

  platform: process.platform,

  audioEngine: {
    /** 惰性加载原生引擎；失败时返回 status="unavailable" 与原因，不抛错 */
    load: (): Promise<AudioEngineInfo> => ipcRenderer.invoke("audio:load"),
    info: (): Promise<AudioEngineInfo> => ipcRenderer.invoke("audio:info"),
    start: (): Promise<boolean> => ipcRenderer.invoke("audio:start"),
    stop: (): Promise<void> => ipcRenderer.invoke("audio:stop"),

    /** 启动播放，返回共享内存与采样参数；需先 start() 初始化合成器 */
    startPlayback: (): Promise<{
      buffer: SharedArrayBuffer;
      sampleRate: number;
      blockSize: number;
    } | null> => ipcRenderer.invoke("audio:startPlayback"),

    stopPlayback: (): Promise<void> => ipcRenderer.invoke("audio:stopPlayback"),

    /** 播放健康度：水位 / 溢出 / 欠载 */
    playbackStats: (): Promise<{
      producedFrames: number;
      availableFrames: number;
      overflowCount: number;
      underrunCount: number;
      uptimeMs: number;
    } | null> => ipcRenderer.invoke("audio:playbackStats"),
  },

  /**
   * v3.1.0：插件宿主（真实文件系统扫描）。
   *
   * 只暴露领域方法，不暴露 ipcRenderer。scan 返回磁盘上真实存在的
   * .vst3/.clap；load 在原生宿主接线前恒返回 ok:false + 原因。
   */
  plugins: {
    scan: (
      dirs?: string[],
    ): Promise<{
      ok: boolean;
      reason?: string;
      plugins: Array<{
        id: string;
        name: string;
        format: "vst3" | "clap";
        path: string;
        hasBinary: boolean;
      }>;
    }> => ipcRenderer.invoke("plugins:scan", dirs),

    load: (
      pluginId: string,
    ): Promise<{ ok: boolean; pluginId: string; reason?: string }> =>
      ipcRenderer.invoke("plugins:load", pluginId),
  },
};

contextBridge.exposeInMainWorld("collinx", api);

export type CollinxBridge = typeof api;
