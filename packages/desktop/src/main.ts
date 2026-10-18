/**
 * Electron 主进程。
 *
 * 职责边界（刻意保持窄）：
 * - 创建窗口、加载界面
 * - 持有音频引擎桥（AudioEngineBridge），**不在主线程直接跑音频**
 * - 通过 preload 暴露白名单 API 给渲染进程
 *
 * 不在主进程做：任何音乐逻辑、任何工程数据处理 —— 那些属于 ui / core 包。
 */
import { app, BrowserWindow, ipcMain } from "electron";
import * as path from "node:path";
import { AudioEngineBridge } from "./audio-bridge";

const isDev = !app.isPackaged;
/** 开发时加载 vite dev server；打包后加载 ui 的构建产物 */
const DEV_URL = process.env.COLLINX_DEV_URL ?? "http://localhost:5181";

const audio = new AudioEngineBridge();
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#0a0a0a",
    title: "Collinx",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // 安全基线：渲染进程没有 Node 能力，只能通过 preload 的白名单 API
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 需要 require electron 模块
    },
  });

  // 等首帧就绪再显示，避免白屏闪烁
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  if (isDev) {
    void mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "..", "ui", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── IPC：渲染进程 → 主进程 ───────────────────────────────────
// 统一走 invoke/handle（异步），不用 send/on（同步语义容易在主线程上卡住）

ipcMain.handle("audio:load", async () => audio.load());
ipcMain.handle("audio:info", () => audio.info());
ipcMain.handle("audio:start", async () => audio.start());
ipcMain.handle("audio:stop", async () => audio.stop());

// 播放驱动：返回共享内存，渲染进程据此建 AudioWorkletNode
ipcMain.handle("audio:startPlayback", () => audio.startPlayback());
ipcMain.handle("audio:stopPlayback", () => audio.stopPlayback());
ipcMain.handle("audio:playbackStats", () => audio.playbackStats());

// SharedArrayBuffer 需要 crossOriginIsolated（COOP + COEP）。
// 没有这两个头时 Chromium 不暴露 SharedArrayBuffer，音频管线只能退化成静音。
// 注意：加了 COEP: require-corp 后所有子资源都必须带 CORP 头，
// 因此只对本地界面（dev server / file://）启用，外部资源会因此被拦。
app.on("web-contents-created", (_e, contents) => {
  contents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Cross-Origin-Opener-Policy": ["same-origin"],
        "Cross-Origin-Embedder-Policy": ["require-corp"],
      },
    });
  });
});

// ── 生命周期 ─────────────────────────────────────────────────
void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void audio.stop();
  if (process.platform !== "darwin") app.quit();
});
