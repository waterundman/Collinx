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
import { Icon } from "../Icon/Icon";
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
  /**
   * v2.1.0 S3 (D13-1)：速度/拍号/loop 控件。**全部可选** —— 任一缺省即不渲染
   * 对应控件，既有 T11a-e / count-in 行为零变化（D13-2）。
   */
  bpm?: number;
  onBpmChange?: (bpm: number) => void;
  meter?: { numerator: number; denominator: number };
  onMeterChange?: (numerator: number, denominator: number) => void;
  loop?: { enabled: boolean; start: { bar: number; beat: number }; end: { bar: number; beat: number } } | null;
  onLoopToggle?: () => void;
  /** v2.2.0 S2 (D23-1)：录制中（红点态）。可选 → 缺省零变化 */
  isRecording?: boolean;
  /** v2.2.0 S2 (D23-1)：录制开关（未在播时由调用方先起播） */
  onToggleRecord?: () => void;
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
  bpm,
  onBpmChange,
  meter,
  onMeterChange,
  loop,
  onLoopToggle,
  isRecording = false,
  onToggleRecord,
}) => {
  const { t } = useI18n();

  const playLabel = t("transport.play", { defaultValue: "播放" });
  const pauseLabel = t("transport.pause", { defaultValue: "暂停" });
  const stopLabel = t("transport.stop", { defaultValue: "停止" });
  const positionLabel = t("transport.position", { defaultValue: "位置" });
  // count-in 态文案（D3-4）：显示"预备…"并可断言锚点；defaultValue 与 zh locale
  // 的 transport.countIn 保持一致（保留 {defaultValue} 形式，禁用 t(k) || '默认' 死兜底）。
  const countInLabel = t("transport.countIn", { defaultValue: "预备…" });
  // v2.1.0 S3 (D13-3)：新控件文案（defaultValue 与 zh locale 一致）
  const bpmLabel = t("transport.bpm", { defaultValue: "速度" });
  const meterLabel = t("transport.meter", { defaultValue: "拍号" });
  const loopLabel = t("transport.loop", { defaultValue: "循环" });
  const recordLabel = t("transport.record", { defaultValue: "录制" });

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
            <Icon name="pause" size={15} aria-hidden />
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
            <Icon name="play" size={15} aria-hidden />
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
          <Icon name="stop" size={15} aria-hidden />
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

      {/* v2.2.0 S2 (D23-1)：录制按钮——只要有 onToggleRecord 就渲染（首次启用
          需要入口）；录制中红点实心 + aria-pressed */}
      {onToggleRecord ? (
        <button
          type="button"
          className={styles.button}
          data-testid="transport-record"
          aria-label={recordLabel}
          title={recordLabel}
          aria-pressed={isRecording}
          onClick={onToggleRecord}
        >
          <Icon name="record" size={13} aria-hidden />
        </button>
      ) : null}

      {/*
       * v2.1.0 S3 (D13-1)：速度/拍号/loop 控件。仅在对应 props 提供时渲染
       * （D13-2：缺省零变化）。BPM 越界 clamp 到 [20, 300]；拍号选项覆盖
       * SPEC 列表（4/4、3/4、2/4、6/8、5/4、7/8）。
       */}
      {bpm !== undefined && onBpmChange ? (
        <div className={styles.position} data-testid="transport-tempo">
          <label className={styles.barBeat} htmlFor="transport-bpm">
            {bpmLabel}
          </label>
          <input
            id="transport-bpm"
            data-testid="transport-bpm"
            type="number"
            min={20}
            max={300}
            value={bpm}
            className={styles.time}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0) {
                onBpmChange(Math.min(300, Math.max(20, Math.round(v))));
              }
            }}
          />
        </div>
      ) : null}

      {meter && onMeterChange ? (
        <div className={styles.position} data-testid="transport-meter-wrap">
          <label className={styles.barBeat} htmlFor="transport-meter">
            {meterLabel}
          </label>
          <select
            id="transport-meter"
            data-testid="transport-meter"
            className={styles.time}
            value={`${meter.numerator}/${meter.denominator}`}
            onChange={(e) => {
              const [n, d] = e.target.value.split("/").map(Number);
              if (Number.isFinite(n) && Number.isFinite(d)) onMeterChange(n, d);
            }}
          >
            {["4/4", "3/4", "2/4", "6/8", "5/4", "7/8"].map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* v2.1.0 S3 (D13-1)：loop 按钮——只要有 onLoopToggle 就渲染（否则首次启用
          没有入口）；aria-pressed 反映当前 loop 是否启用（无 loop = 未启用） */}
      {onLoopToggle ? (
        <button
          type="button"
          className={styles.button}
          data-testid="transport-loop"
          aria-label={loopLabel}
          title={loopLabel}
          aria-pressed={!!loop?.enabled}
          onClick={onLoopToggle}
        >
          <Icon name="loop" size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  );
};

export default TransportBar;
