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
  },
};

contextBridge.exposeInMainWorld("collinx", api);

export type CollinxBridge = typeof api;
