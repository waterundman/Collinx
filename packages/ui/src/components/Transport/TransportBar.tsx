/**
 * TransportBar（v2.0.0 Stage 1 / D1-1）
 *
 * 项目首个全局 transport 的最小 UI 表面：play/pause 互斥按钮 + 独立 stop
 * 按钮 + 位置双形态显示（`m{bar}.{beat}` 小节/拍 + `M:SS.S` 分钟秒）。
 * 播放状态与位置由 useTransport 提供（props 单向流入，组件本身无状态）。
 *
 * - play/pause 互斥显示（DAW 惯例，DAW-coreengine / SynthV 一致）：isPlaying
 *   为 true 显示暂停按钮，否则显示播放按钮；stop 始终独立。
 * - beat 取 Math.floor（连续播放头的小数分位不显示）；bar/beat 均从 1 开始。
 * - positionSeconds 格式化为 M:SS.S（分:秒.十分位，如 3.5 → "0:03.5"）。
 * - 文案经 i18n（transport.*），带中文兜底（对齐 MidiSettings 既有写法）。
 * - 交互锚点 data-testid + aria-label，供测试与可访问性使用。
 */
import React from "react";
import { useI18n } from "../../i18n";
import styles from "./TransportBar.module.css";

export interface TransportBarProps {
  isPlaying: boolean;
  position: { bar: number; beat: number };
  positionSeconds: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  /**
   * v2.0.0 Stage 3 (D3-4)：count-in（预备小节）态。
   * - 缺省 false → 既有 T11a-e 行为零变化。
   * - true 时渲染可断言锚点 `data-testid="transport-count-in"` + i18n 文案，
   *   并显示暂停按钮（用户可中断 count-in → 由 onPause 处理，回到 idle）。
   */
  isCountingIn?: boolean;
}

/**
 * 当前谱面秒 → `M:SS.S`（分:秒.十分位，截断到十分位）。
 * 非有限 / 负数按 0 处理（防御，正常路径 positionSeconds >= 0）。
 */
export function formatTransportSeconds(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalTenths = Math.floor(safe * 10);
  const tenth = totalTenths % 10;
  const totalSeconds = Math.floor(totalTenths / 10);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}.${tenth}`;
}

export const TransportBar: React.FC<TransportBarProps> = ({
  isPlaying,
  position,
  positionSeconds,
  onPlay,
  onPause,
  onStop,
  isCountingIn = false,
}) => {
  const { t } = useI18n();

  const playLabel = t("transport.play", { defaultValue: "播放" });
  const pauseLabel = t("transport.pause", { defaultValue: "暂停" });
  const stopLabel = t("transport.stop", { defaultValue: "停止" });
  const positionLabel = t("transport.position", { defaultValue: "位置" });
  // count-in 态文案（D3-4）：显示"预备…"并可断言锚点；defaultValue 与 zh locale
  // 的 transport.countIn 保持一致（保留 {defaultValue} 形式，禁用 t(k) || '默认' 死兜底）。
  const countInLabel = t("transport.countIn", { defaultValue: "预备…" });

  // 小节/拍：beat 允许小数（连续播放头）→ 显示取整；bar/beat 均从 1 开始。
  const barBeat = `m${position.bar}.${Math.floor(position.beat)}`;
  const time = formatTransportSeconds(positionSeconds);

  return (
    <div className={styles.transportBar} data-testid="transport-bar">
      <div className={styles.controls}>
        {isCountingIn || isPlaying ? (
          <button
            type="button"
            className={styles.button}
            data-testid="transport-pause"
            aria-label={pauseLabel}
            title={pauseLabel}
            onClick={onPause}
          >
            <span aria-hidden="true">❚❚</span>
          </button>
        ) : (
          <button
            type="button"
            className={styles.button}
            data-testid="transport-play"
            aria-label={playLabel}
            title={playLabel}
            onClick={onPlay}
          >
            <span aria-hidden="true">▶</span>
          </button>
        )}
        <button
          type="button"
          className={styles.button}
          data-testid="transport-stop"
          aria-label={stopLabel}
          title={stopLabel}
          onClick={onStop}
        >
          <span aria-hidden="true">■</span>
        </button>
      </div>

      <div
        className={styles.position}
        data-testid="transport-position"
        aria-label={positionLabel}
      >
        <span className={styles.barBeat} data-testid="transport-bar-beat">
          {barBeat}
        </span>
        <span className={styles.time} data-testid="transport-time">
          {time}
        </span>
      </div>

      {isCountingIn ? (
        <div
          className={styles.position}
          data-testid="transport-count-in"
          aria-label={countInLabel}
        >
          <span className={styles.barBeat} data-testid="transport-count-in-label">
            {countInLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
};

export default TransportBar;
