# @collinx/desktop — Electron 外壳

承载 **JUCE C++ 音频引擎**（`packages/audio` → `@collinx/audio-native`）与
现有 Web 界面（`packages/ui`）。

## 为什么需要外壳

C++ 引擎只能跑在原生环境：浏览器里没有它的运行位置（除非编成 WASM，另一条路）。
外壳的职责就是把原生引擎与 Web 界面接在一起，同时**不把音频塞进主线程**。

## ⚠️ 必须知道的一条约束

参考开源项目 slopsmith-desktop（Electron + JUCE VST3 宿主）的公开设计文档：

> JUCE requires the `MessageManager` to be created on the OS main thread.
> In the Node.js addon, **V8 owns the main thread, which can lead to deadlocks
> or initialization failures.**

因此本包的实现遵守三条硬约束（见 `src/audio-bridge.ts` 注释）：

1. **惰性加载** —— addon 不在启动路径上 require，只在需要发声时加载
2. **全异步** —— 所有跨边界调用返回 Promise，不阻塞主线程事件循环
3. **可降级** —— addon 不存在时进入 `unavailable`，界面照常可用（编辑/导出 MIDI 不受影响），只是不出声；且**不静默失败**，会把原因透传给界面

**阶段 2/3**（见 `docs/architecture.md` §五）：把引擎移出主进程，音频走共享内存
环形缓冲、控制走命名管道。届时只替换 `audio-bridge.ts` 的实现，对外 API 形状不变。

## 结构

```
src/
├── main.ts          Electron 主进程：建窗口、持有音频桥、注册 IPC
├── preload.ts       唯一通道：contextBridge 暴露白名单 API（不暴露 ipcRenderer 本身）
└── audio-bridge.ts  原生引擎桥：惰性加载 + 异步 + 可降级
```

渲染进程侧对应 `packages/ui/src/services/desktop-bridge.ts`，它通过
`globalThis.collinx` 探测外壳是否存在，浏览器中自动降级。

## 运行

```bash
# 1) 先起界面（开发态）
cd packages/ui && npx vite --port 5181 --strictPort

# 2) 装依赖并启动外壳
cd packages/desktop
pnpm install
pnpm dev            # = tsc 编译 + electron dist/main.js
```

环境变量：

| 变量 | 用途 | 默认 |
|---|---|---|
| `COLLINX_DEV_URL` | 开发态加载的界面地址 | `http://localhost:5181` |
| `COLLINX_AUDIO_ADDON` | 原生 addon 的模块名/路径 | `@collinx/audio-native` |

## 当前状态（v2.8.0）

| 能力 | 状态 |
|---|---|
| 窗口 + 安全基线（contextIsolation / 无 nodeIntegration） | ✅ 已实现 |
| preload 白名单 API + IPC | ✅ 已实现 |
| 音频引擎桥（惰性 / 异步 / 可降级） | ✅ 已实现 |
| 原生 addon 实际发声 | ⏳ **阻塞于两件事**（见下） |

阻塞项：

1. `packages/audio` 需先编译通过（CI 正在迭代，见 `.github/workflows/ci-audio.yml`）
2. 需补 **N-API 合成器接口** —— 现有 N-API 只暴露了 VST3 插件宿主
   （`PluginManagerBridge` / `AudioProcessorBridge`），没有 `noteOn` / `noteOff` /
   `transport`。引擎顶层的 `AudioEngine` 已有这些能力（`handleMidiMessage` 等），
   只需包一层绑定（约 200 行 C++）
