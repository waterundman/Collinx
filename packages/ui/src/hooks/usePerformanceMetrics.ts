/**
 * 音频性能指标采集（v2.9.2）。
 *
 * 原则：**只显示真拿得到的数**。
 * - 声部数 / 采样率 / 输出延迟：来自活的 AudioContext（`AudioPreview`）
 * - 内存：Chrome 的 `performance.memory`（其它浏览器为 undefined）
 * - CPU 占用 / 缓冲欠载次数：浏览器**不暴露**，保持 undefined，UI 显示「—」
 *
 * 为什么不做估算：CPU% 只能从音频线程的回调耗时推算，而 Web Audio 没有
 * 暴露该回调；用主线程帧率反推会得出与声音无关的数字（假数据比没数据更糟）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioPerformanceInfo } from "../services/audio-preview";
import type { PerformanceMetrics } from "../components/Performance";

interface ChromiumPerformanceMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface MemoryReading {
  used?: number;
  total?: number;
}

function readMemory(): MemoryReading {
  const mem = (performance as Performance & { memory?: ChromiumPerformanceMemory }).memory;
  if (!mem) return {};
  return { used: mem.usedJSHeapSize, total: mem.jsHeapSizeLimit };
}

export interface UsePerformanceMetricsResult {
  metrics: PerformanceMetrics;
  refresh: () => void;
}

export function usePerformanceMetrics(
  getAudioInfo: () => AudioPerformanceInfo,
  intervalMs = 1000,
): UsePerformanceMetricsResult {
  const [audio, setAudio] = useState<AudioPerformanceInfo>(getAudioInfo);
  const [memory, setMemory] = useState<MemoryReading>(readMemory);

  const getRef = useRef(getAudioInfo);
  getRef.current = getAudioInfo;

  const refresh = useCallback(() => {
    setAudio(getRef.current());
    setMemory(readMemory());
  }, []);

  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);

  const metrics: PerformanceMetrics = {
    activeVoices: audio.activeVoices,
    sampleRate: audio.sampleRate || undefined,
    // 端到端延迟 = 基础延迟 + 输出延迟（任一缺失只在有值时相加）
    processingLatency: audio.ready ? audio.baseLatencyMs + audio.outputLatencyMs : undefined,
    memoryUsed: memory.used,
    memoryTotal: memory.total,
    // 浏览器不可采集：显式留空，由 UI 渲染「—」
    cpuUsage: undefined,
    bufferUnderruns: undefined,
  };

  return { metrics, refresh };
}
