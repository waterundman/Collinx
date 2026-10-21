/**
 * transport 播放状态机 hook (v2.0.0 Stage 0 / D0-4~D0-7)
 *
 * 项目首个全局 transport：play / pause / stop / seek + 播放头位置 + lookahead 调度。
 * 从"可编辑 + 可试听"跃迁到"可播放"。
 *
 * 时钟域（D0-5）：
 * - 统一使用 now() 域（生产默认 performance.now()，DOMHighResTimeStamp，
 *   页面加载基准的毫秒）。绝不可与 AudioContext.currentTime 混用 —— 跨时钟域
 *   混用是经典 bug。本实现不引入 AudioContext（Web MIDI 自带 timestamp 调度器，
 *   精度来自 MIDIOutput.send(data, ts)，JS 定时器只需粗粒度 lookahead）。
 * - timestamp = startPerfNow + (event.atSeconds - startSeconds) * 1000
 *   其中 startPerfNow = play() 时刻的 now()，startSeconds = 该刻的谱面秒。
 *
 * lookahead 调度（D0-5）：
 * - setInterval(schedulerTickMs = 26) 驱动（可被 vi.useFakeTimers() 驱动）。
 * - 每次 tick 投递 [已排程水位, now + lookaheadMs] 窗口内事件；水位为下一个待
 *   排程事件索引，避免重复投递；seek / 重排程时重算。
 *
 * 抗卡音（D0-6，严格复用 v1.29.0 useMidiOutput 模式）：
 * - 维护 soundingNotesRef: Map<`${pitch}:${channel}`, 已换算通道 0-15>（存换算
 *   后通道，避免通道变更后补发错通道 —— v1.29 教训）。键含通道：S3 引入第二
 *   通道（click 走 9 / 音符走 settings 通道）后，单 pitch 键不再诚实 —— 若
 *   click(pitch34,ch9) 与音符(pitch34,chN) 同 pitch 异通道，单 pitch 键会互相
 *   覆盖，stop() 漏发一路 noteOff → 卡音。故键 = `${pitch}:${channel}`。
 * - pause / stop / 卸载 / seek / 通道变更时：先 port.clear?.()，再遍历 Map 逐条
 *   补发 encodeNoteOff，最后 Map.clear()。顺序不可颠倒：clear() 只清空"已调度
 *   未发出"的待发队列（含各音 noteOff），已发出的 noteOn 无法被取消，故必须
 *   补发 noteOff；补发在 clear() 之后（无 timestamp 的立即 send）必不被取消。
 * - 说明：Map 条目在补发/清空时才移除（不在 noteOff 排程时移除）—— 因为排程
 *   是"未来投递"，若此时移除条目，pause 恰在投递前发生时将漏补 noteOff → 卡音。
 *   Map 规模受 MIDI 音高上限（0-127）约束，量级可忽略。
 *
 * 位置刷新（D0-4）：position 允许小数 beat（连续播放头），由独立轻量定时器
 * （POSITION_TICK_MS = 50）从 elapsedSeconds 经 tempoMap.barBeatAt 反查，
 * 与调度循环分离（调度循环只关心投递，不做 UI 刷新）。
 *
 * 失败语义（对齐 useMidiInput / useMidiOutput，全程静默不 throw）：
 * - getOutputPort 未提供 / 返回 null → 调度仍推进（水位 + 播放头），只是不发声
 * - port.send / port.clear 抛异常 → 静默 catch
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { NoteEvent, TempoMap } from "@collinx/core";
import { encodeNoteOn, encodeNoteOff } from "../services/midi-output";
import { AudioPreview } from "../services/audio-preview";
import { instrumentForTrack } from "../services/instruments";
import {
  buildPlaybackEvents,
  buildClickEvents,
  CLICK_CHANNEL,
  CLICK_STRONG_VELOCITY,
  CLICK_WEAK_VELOCITY,
  type ScheduledEvent,
} from "../services/midi-schedule";

/** 调度器唤醒周期（ms）：参照 soniqaudio/tone PlaybackController 实测值 */
export const SCHEDULER_TICK_MS = 26;
/** 前瞻窗口（ms）：把 now + lookahead 内的事件提前投递给端口的时间戳调度器 */
export const LOOKAHEAD_MS = 180;
/** 播放头刷新周期（ms）：独立于调度循环的轻量 UI 刷新（见文件头） */
export const POSITION_TICK_MS = 50;

/** transport 相位：idle（停止）/ playing / paused / count-in（预备小节） */
export type TransportPhase = "idle" | "playing" | "paused" | "count-in";

/**
 * MIDI 输出端口最小结构（依赖注入契约，D0-7）。
 * clear 可选：部分实现 / 旧浏览器无此方法。
 */
export interface MidiOutputPortLike {
  id?: string;
  name?: string | null;
  send(data: Uint8Array | number[], timestamp?: number): void;
  clear?: () => void;
}

export interface UseTransportOptions {
  notes: NoteEvent[];
  tempoMap: TempoMap;
  /** settings.midi.midiChannel（人类语义 1-16）；hook 内负责 -1 换算为 0-15 */
  channel: number;
  /** 输出端口访问器；测试注入假 port，生产由 useMidiOutput.getOutputPort 提供 */
  getOutputPort?: () => MidiOutputPortLike | null;
  /** 可注入时钟，默认 () => performance.now() */
  now?: () => number;
  /** 调度器唤醒周期（ms），默认 SCHEDULER_TICK_MS */
  schedulerTickMs?: number;
  /** 前瞻窗口（ms），默认 LOOKAHEAD_MS */
  lookaheadMs?: number;
  /** v2.1.0 S2 (D12-4)：播放期节拍器（settings.midi.playback.metronome） */
  metronome?: boolean;
  /** v2.2.0 S0 (D21)：录制 take 自动提交回调（stop/pause 防丢） */
  onRecordingCommit?: (take: RecordedTake) => void;
}

export interface UseTransportResult {
  phase: TransportPhase;
  /** 播放头位置；beat 允许小数（连续播放头），bar/beat 均从 1 开始 */
  position: { bar: number; beat: number };
  /**
   * 当前谱面秒（v2.0.0 Stage 1 / D1-8 additive）：供 TransportBar 显示 M:SS.S。
   * 与 position 同源同步 —— playing 时随定位置 tick 更新；pause() 冻结在暂停
   * 时刻；stop() 归 0；seek(pos) 取 tempoMap.timeAt(pos.bar, pos.beat)；
   * idle 初始为 0。既有字段 / 行为不变。
   */
  positionSeconds: number;
  isPlaying: boolean;
  play: (opts?: { countInBars?: number }) => void;
  pause: () => void;
  stop: () => void;
  seek: (pos: { bar: number; beat: number }) => void;
  /** v2.1.0 S2 (D12-1)：loop 区间与开关；null = 未设置（不循环） */
  loop: TransportLoop | null;
  /** v2.1.0 S2 (D12-1)：设置/清除 loop。会话活跃时**即时生效**（重算折返参数） */
  setLoop: (loop: TransportLoop | null) => void;
  // ── v2.2.0 S0 (D21)：实时录制 ──
  /** 录制中（armed 且缓冲开启） */
  isRecording: boolean;
  /** 精确当前谱面秒（读会话锚点，亚毫秒；无会话 = timeAt(positionRef)） */
  getPositionSecondsNow: () => number;
  /** 开始缓冲（不影响播放状态；播放由调用方决定是否同时 play） */
  startRecording: () => void;
  /** 结束缓冲并返回本 take（未闭合 noteOff 以当前时刻闭合） */
  stopRecording: () => RecordedTake | null;
  /** 硬件 noteOn 捕获（录制中才生效；App 的 onNoteOn 处理器调用） */
  captureRecordedNoteOn: (pitchMidi: number, velocity: number) => void;
  /** 硬件 noteOff 捕获（配对最近未闭合同 pitch） */
  captureRecordedNoteOff: (pitchMidi: number) => void;
}

/** v2.2.0 S0 (D21-3)：一次录制的 take 缓冲 */
export interface RecordedTakeNote {
  pitchMidi: number;
  velocity: number;
  /** 谱面秒（.getPositionSecondsNow 域） */
  onSeconds: number;
  /** null = 尚未闭合（按住未松） */
  offSeconds: number | null;
}
export interface RecordedTake {
  notes: RecordedTakeNote[];
  /** 提交时刻（谱面秒）：缺失 off 的闭合基准 */
  endSeconds: number;
}

/** v2.1.0 S2 (D12-1)：loop 区间（bar/beat；含 start、不含 end——DAW 惯例） */
export interface TransportLoop {
  enabled: boolean;
  start: { bar: number; beat: number };
  end: { bar: number; beat: number };
}


/** 一次播放会话的可变状态（经 ref 持有，不触发渲染） */
interface PlaybackSession {
  /** 自起播位置编译的事件序列（click + 音符，同处一条时间轴） */
  events: ScheduledEvent[];
  /** 已排程水位：下一个待排程事件索引 */
  index: number;
  /** play() 时刻的 now() */
  startPerfNow: number;
  /** 会话时间轴锚点（谱面秒）：count-in 起点；countInBars=0 时 = timeAt(from) */
  startSeconds: number;
  /** count-in 持续秒数（0 表示无 count-in，直进 playing） */
  countInDuration: number;
  /** v2.1.0 S2 (D12-2)：loop 折返参数（谱面秒）；null = 本会话不循环 */
  loop: { enabled: boolean; startSeconds: number; endSeconds: number } | null;
  /** loop 起点之后的首个事件索引（折返时 index 回卷至此重放区间内事件） */
  loopStartIndex: number;
}

const defaultNow = (): number => performance.now();

export function useTransport(options: UseTransportOptions): UseTransportResult {
  const {
    notes,
    tempoMap,
    channel,
    getOutputPort,
    now,
    schedulerTickMs,
    lookaheadMs,
    metronome,
    onRecordingCommit,
  } = options;

  // ── 最新入参经 ref 读取：使 play/pause/seek 等回调引用稳定（不随渲染重建） ──
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const tempoMapRef = useRef(tempoMap);
  tempoMapRef.current = tempoMap;
  const channelRef = useRef(channel); // 人类语义 1-16
  channelRef.current = channel;
  const getOutputPortRef = useRef(getOutputPort);
  getOutputPortRef.current = getOutputPort;
  const nowRef = useRef<() => number>(now ?? defaultNow);
  nowRef.current = now ?? defaultNow;
  const tickRef = useRef(schedulerTickMs ?? SCHEDULER_TICK_MS);
  tickRef.current = schedulerTickMs ?? SCHEDULER_TICK_MS;
  const lookaheadRef = useRef(lookaheadMs ?? LOOKAHEAD_MS);
  lookaheadRef.current = lookaheadMs ?? LOOKAHEAD_MS;
  /** v2.1.0 S2 (D12-4)：播放期节拍器开关（ref 供会话构建读取） */
  const metronomeRef = useRef(metronome ?? false);
  metronomeRef.current = metronome ?? false;

  // ── v2.1.0 S2 (D12-1)：loop 状态（对 UI 暴露 + ref 供会话构建/折返读取） ──
  const [loop, setLoopState] = useState<TransportLoop | null>(null);
  const loopRef = useRef<TransportLoop | null>(null);

  // ── v2.2.0 S0 (D21)：实时录制状态机 ──
  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const recordingBufferRef = useRef<RecordedTakeNote[]>([]);
  const recordingCommitRef = useRef<((take: RecordedTake) => void) | null>(null);
  recordingCommitRef.current = onRecordingCommit ?? null;

  /** 精确当前谱面秒（D21-1）：读会话锚点（loop 折返改写 startSeconds 后自动正确） */
  const getPositionSecondsNow = useCallback((): number => {
    const session = sessionRef.current;
    if (session) {
      return (
        session.startSeconds + (nowRef.current() - session.startPerfNow) / 1000
      );
    }
    return tempoMapRef.current.timeAt(
      positionRef.current.bar,
      positionRef.current.beat
    );
  }, []);

  /** 结束缓冲并产出 take（未闭合 noteOff 以当前时刻闭合）；提交回调后返回 */
  const commitRecording = useCallback((): RecordedTake | null => {
    if (!isRecordingRef.current) return null;
    const endSeconds = getPositionSecondsNow();
    const notes = recordingBufferRef.current.map((n) => ({
      ...n,
      offSeconds: n.offSeconds ?? endSeconds,
    }));
    recordingBufferRef.current = [];
    isRecordingRef.current = false;
    setIsRecording(false);
    const take: RecordedTake = { notes, endSeconds };
    recordingCommitRef.current?.(take);
    return take;
  }, [getPositionSecondsNow]);

  const startRecording = useCallback((): void => {
    recordingBufferRef.current = [];
    isRecordingRef.current = true;
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback((): RecordedTake | null => {
    return commitRecording();
  }, [commitRecording]);

  /** 硬件 noteOn 捕获（录制中才缓冲） */
  const captureRecordedNoteOn = useCallback(
    (pitchMidi: number, velocity: number): void => {
      if (!isRecordingRef.current) return;
      recordingBufferRef.current.push({
        pitchMidi,
        velocity,
        onSeconds: getPositionSecondsNow(),
        offSeconds: null,
      });
    },
    [getPositionSecondsNow]
  );

  /** 硬件 noteOff 捕获：配对最近未闭合同 pitch */
  const captureRecordedNoteOff = useCallback(
    (pitchMidi: number): void => {
      if (!isRecordingRef.current) return;
      for (
        let i = recordingBufferRef.current.length - 1;
        i >= 0;
        i--
      ) {
        const n = recordingBufferRef.current[i]!;
        if (n.pitchMidi === pitchMidi && n.offSeconds === null) {
          n.offSeconds = getPositionSecondsNow();
          return;
        }
      }
    },
    [getPositionSecondsNow]
  );

  const [phase, setPhase] = useState<TransportPhase>("idle");
  const [position, setPosition] = useState<{ bar: number; beat: number }>({
    bar: 1,
    beat: 1,
  });
  /** 当前谱面秒（v2.0.0 Stage 1 / D1-8）；与 position 同源同步，见 UseTransportResult */
  const [positionSeconds, setPositionSeconds] = useState(0);

  // ── 与状态并行的 ref（供定时器回调读取最新值，避免闭包过期） ──
  const phaseRef = useRef<TransportPhase>("idle");
  const positionRef = useRef<{ bar: number; beat: number }>({ bar: 1, beat: 1 });
  const sessionRef = useRef<PlaybackSession | null>(null);
  /**
   * v2.8.0：浏览器内预览合成器（Web Audio）。
   *
   * 存在的原因：本 hook 全程依赖 Web MIDI 把音符发给**外部音源**，
   * 没有 MIDI 设备时用户按播放键完全听不到声音（实测 AudioContext 创建 0 次）。
   * 合成器是**并行**的第二条通路：有 MIDI 设备时两者都响，没有时至少能听到。
   *
   * 两条约束：
   * 1. **不改时钟** —— 时间轴仍由既有 lookahead 调度器掌管，
   *    合成器只接收"何时该响"的相对秒数
   * 2. **jsdom 下是 no-op** —— AudioPreview 内部对缺失 AudioContext 静默降级，
   *    因此不会影响既有 599 条测试
   */
  const previewRef = useRef<AudioPreview | null>(null);
  if (previewRef.current === null) {
    previewRef.current = new AudioPreview();
  }
  /** 已发出 noteOn 的音符：键 `${pitch}:${channel}` → 已换算通道（0-15）。
   *  两通道并存后单 pitch 键不诚实，故键含通道（见文件头抗卡音说明）。 */
  const soundingNotesRef = useRef<Map<string, number>>(new Map());
  const schedulerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const positionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 停全部在鸣音：先 clear() 再逐条补发 noteOff，最后清空 Map（顺序不可颠倒） */
  const allSoundOff = useCallback((): void => {
    // v2.8.0：内部合成器也要停 —— 它不走 MIDI 端口，
    // 若只停端口，无设备时合成器的音会一直挂着（卡音）。
    previewRef.current?.allNotesOff();

    const port = getOutputPortRef.current?.() ?? null;
    if (!port) {
      soundingNotesRef.current.clear();
      return;
    }
    try {
      port.clear?.();
      for (const [noteKey, ch] of soundingNotesRef.current) {
        // 两通道并存后单 pitch 键不诚实：键为 `${pitch}:${channel}`，
        // 此处解析回 pitch（channel 用存值 ch）。逐条补发 noteOff 防卡音。
        const pitch = Number(noteKey.split(":")[0]);
        try {
          port.send(encodeNoteOff(pitch, ch)); // 无 timestamp = 立即发送
        } catch {
          // 静默
        }
      }
    } catch {
      // 静默
    }
    soundingNotesRef.current.clear();
  }, []);

  const clearTimers = useCallback((): void => {
    if (schedulerTimerRef.current !== null) {
      clearInterval(schedulerTimerRef.current);
      schedulerTimerRef.current = null;
    }
    if (positionTimerRef.current !== null) {
      clearInterval(positionTimerRef.current);
      positionTimerRef.current = null;
    }
  }, []);

  /** 调度 tick：投递 [水位, now + lookahead] 窗口内事件 */
  const schedulerTick = useCallback((): void => {
    const session = sessionRef.current;
    if (!session) return;
    const port = getOutputPortRef.current?.() ?? null;
    const ch = channelRef.current - 1; // 人类语义 1-16 → MIDI status 0-15
    const n = nowRef.current();
    const windowEndSeconds =
      session.startSeconds + (n - session.startPerfNow + lookaheadRef.current) / 1000;

    while (
      session.index < session.events.length &&
      session.events[session.index]!.atSeconds <= windowEndSeconds
    ) {
      // v2.1.0 S2 (D12-2)：loop 右缘之后的事件不投递 —— positionTick 折返后
      // index 回卷至 loopStartIndex 重放区间内事件（同一时间轴，不重启会话）。
      if (
        session.loop?.enabled &&
        session.events[session.index]!.atSeconds >=
          session.loop.endSeconds - 1e-9
      ) {
        break;
      }
      const ev = session.events[session.index]!;
      session.index += 1;

      // 通道与时间戳必须**先**算 —— 内部合成器与 MIDI 端口共用同一份判定
      // 通道：click 事件显式带 9（GM 打击乐，A1）；音符事件省略 → 按设置通道。
      const evChannel = ev.channel ?? ch;
      // 统一 now() 域时间戳（生产 = performance.now()）
      const timestamp =
        session.startPerfNow + (ev.atSeconds - session.startSeconds) * 1000;

      // v2.8.0：内部合成器（并行通路）。
      // 没有 MIDI 设备时这是唯一能听到声音的路径 —— 此前 `if (!port) continue`
      // 会让音符在无设备时彻底静音（实测 AudioContext 创建 0 次）。
      // 时钟域转换只在这一处：MIDI 时间戳属 performance.now() 域，
      // Web Audio 属 AudioContext.currentTime 域，两者不可混算；
      // 这里只换算「还有多久该响」的秒数，排程交给合成器按音频时钟自己做。
      const preview = previewRef.current;
      const delaySec = Math.max(0, (timestamp - performance.now()) / 1000);
      const voiceKey = `${ev.pitchMidi}:${evChannel}`;
      if (ev.kind === "on") {
        preview?.noteOn(
          voiceKey,
          ev.pitchMidi,
          ev.velocity,
          delaySec,
          // 按来源轨道选音色：旋律明亮、贝斯饱满、和弦铺底
          instrumentForTrack(ev.trackId),
        );
      } else {
        preview?.noteOff(voiceKey, delaySec);
      }

      // 在鸣记录不受端口有无影响 —— 合成器也在响，pause/stop 必须能停掉它
      if (ev.kind === "on") {
        soundingNotesRef.current.set(voiceKey, evChannel);
      }

      if (!port) {
        continue; // 无端口：MIDI 不投递，但合成器已发声、水位仍推进
      }

      try {
        if (ev.kind === "on") {
          port.send(encodeNoteOn(ev.pitchMidi, ev.velocity, evChannel), timestamp);
        } else {
          port.send(encodeNoteOff(ev.pitchMidi, evChannel), timestamp);
        }
      } catch {
        // 静默
      }
    }
  }, []);

  /** 位置 tick：由流逝秒数经 TempoMap 反查连续播放头位置 */
  const positionTick = useCallback((): void => {
    const session = sessionRef.current;
    if (!session) return;
    const elapsed = (nowRef.current() - session.startPerfNow) / 1000;
    let seconds = session.startSeconds + elapsed;
    // ── v2.1.0 S2 (D12-2)：loop 折返（同一时间轴，不重启会话） ──
    // 到达 loopEnd 时把会话锚点**回退**一个循环长度（等价于把播放头拉回
    // loopStart），并把调度索引回卷至 loopStartIndex —— 区间内事件在下一轮
    // 循环重放。折返后 seconds 落回 loopStart 附近，条件自然不再成立，故每次
    // 跨越只折返一次。锚点回退后 (atSeconds - startSeconds) 增大量与流逝时间
    // 增大量相互抵消，事件 timestamp 仍落在 now() 域的正确位置。
    if (session.loop?.enabled && seconds >= session.loop.endSeconds - 1e-9) {
      session.startSeconds -= session.loop.endSeconds - session.loop.startSeconds;
      session.index = session.loopStartIndex;
      seconds = session.startSeconds + (nowRef.current() - session.startPerfNow) / 1000;
    }
    // count-in → playing 自动转场（D3-2 核心不变量）：当流逝时间到达 from 起点
    // （elapsed >= countInDuration）时，phase 切 'playing'。此刻 seconds =
    // startSeconds + countInDuration = timeAt(from)，经 barBeatAt 反查得到
    // 的位置**精确等于 from**（无漂移）——这是"count-in 与正片共用一条时间轴"
    // 的直接推论（两者都用同一 TempoMap，起点锚定一致）。
    if (
      phaseRef.current === "count-in" &&
      elapsed >= session.countInDuration - 1e-9
    ) {
      phaseRef.current = "playing";
      setPhase("playing");
    }
    const pos = tempoMapRef.current.barBeatAt(seconds);
    positionRef.current = pos;
    setPosition(pos);
    setPositionSeconds(seconds);
  }, []);

  /**
   * 从 from 位置开始（或继续）播放：编译事件、建立会话、启动定时器。
   *
   * 快照语义（v2.0.0 Stage 1 / D1-7，清偿 S0 验证期登记的 P3-2）：
   * 事件序列在 play() 时经 buildPlaybackEvents 一次性编译（快照语义）；
   * 播放中 notes 变更**不会**实时重排 —— 需 stop→play 或 seek 后重新起播
   * 才会反映最新音符。sessionRef.events 整个播放会话内保持不变。
   *
   * count-in（v2.0.0 Stage 3 / D3-2）：countInBars > 0 时先在同一条时间轴上
   * 播 N 小节 click（Cakewalk 惯例：count-in 与正片共用一条时间轴，非独立
   * 计时器），N 小节后自动转 'playing'。实现要点：
   * - click 与音符事件合并进同一 events 数组，由**同一个** lookahead 调度器
   *   （output.send(data, timestamp)）投递，不新起独立计时器。
   * - 会话锚点 startSeconds = timeAt(from) - countInDuration（count-in 起点，
   *   可能为负秒——TempoMap 对 bar<1 折叠为 0，但负秒对调度/位置反查无害，
   *   仅 barBeatAt 会把负秒夹回 {1,1}；这恰是 count-in 的"前导小节"表示法，
   *   见下方 position 段）。
   * - 转入 playing 时刻 position/positionSeconds 精确等于 from（无漂移）：
   *   由 positionTick 的 elapsed >= countInDuration 转场保证（见 positionTick）。
   * - countInBars=0 → countInDuration=0 → 直进 'playing'（无 count-in 阶段）。
   */
  const beginPlayback = useCallback(
    (from: { bar: number; beat: number }, countInBars: number = 0): void => {
      const tm = tempoMapRef.current;
      const fromSeconds = tm.timeAt(from.bar, from.beat);
      const meter = tm.meterAt(from.bar);
      const countInBarsFloor = Math.max(0, Math.floor(countInBars));
      // count-in 跨度逐小节累计：前导小节各自取 tempoMap.meterAt(bar)（拍号变化
      // 时各小节拍数不同，旧实现以单个 from.bar meter 恒推 beatsPerBar 会错位）。
      // 4/4 下每小节恒 4 拍 → 与旧实现等价（T20/T21/T22 不受影响）。
      let countInBeats = 0;
      for (let b = 0; b < countInBarsFloor; b++) {
        const m = tm.meterAt(from.bar - countInBarsFloor + b);
        countInBeats += m.numerator * (4 / m.denominator);
      }
      const beatSec = 60 / tm.bpmAt(from.bar, from.beat);
      const countInDuration = countInBeats * beatSec;
      // 会话锚点 = count-in 起点（可能为负秒）。
      const sessionStartSeconds = fromSeconds - countInDuration;

      const events: ScheduledEvent[] = [];

      if (countInBeats > 0) {
        // ── v2.1.0 S2 (S2-D1 修复)：count-in click 逐拍**反向**走并直接携带时刻 ──
        // 旧实现 = buildClickEvents(clickFrom)+shift：timeAt 对 bar<1 折叠为 0
        // （tempo-map.ts:109），从 bar 1 起播时 clickFrom 落在 bar 0 → 4 个 click
        // 的 timeAt 全为 0 → shift 后**全部塌缩到同一时刻**（用户听到 1 声而非
        // 4 声预备拍）。T20 只断言首 click 的音高/时刻故未发现；S2 的 T37 以
        // 「click 时间戳严格递增」断言暴露（S2-D1，v2.0.0 S3 以来的真缺陷）。
        //
        // 新实现：与 S4 的 clickFrom 反向推演同一走法（逐小节 meterAt 取拍数），
        // 但每退一拍直接 `t -= 60 / bpmAt(该拍)` —— bar<1 时 bpmAt 回落 120
        // （findActive 无命中 → 120），时刻单调正确，不再塌缩。
        // 强拍判定沿用 `beat === 1`（与 buildClickEvents 一致）；复合拍号
        // （7/8 → beatsPerBar=3.5）下强拍仍会失效 —— S4-F1 仍开放，由 S4
        // 以"拍内位置判定强拍"闭合（S0 数据层 + S1 拍号编辑已使其可达）。
        const fromSeconds = tm.timeAt(from.bar, from.beat);
        let bar = from.bar;
        let beat = Math.max(1, Math.floor(from.beat));
        let t = fromSeconds;
        // S4-F1 闭合（v2.1.0 S4）：只点**整数拍**——floor(countInBeats)。7/8 的
        // beatsPerBar=3.5 → 3 次；否则第 4 次会越界到 bar -1。
        const clickCount = Math.floor(countInBeats);
        for (let k = 0; k < clickCount; k++) {
          beat -= 1;
          if (beat < 1) {
            bar -= 1;
            const m = tm.meterAt(bar);
            // S4-F1：floor —— 7/8 → 3（跳过 0.5 的半拍位），保证整数拍与强拍命中
            beat = Math.floor(m.numerator * (4 / m.denominator));
          }
          t -= 60 / tm.bpmAt(bar, beat);
          const isDownbeat = beat === 1;
          events.push({
            atSeconds: t,
            kind: "on",
            pitchMidi: isDownbeat ? 34 : 33,
            velocity: isDownbeat ? CLICK_STRONG_VELOCITY : CLICK_WEAK_VELOCITY,
            channel: CLICK_CHANNEL,
          });
        }
      }

      // 音符事件：buildPlaybackEvents 返回的 atSeconds 已是 TempoMap 绝对秒
      // （>= timeAt(from) >= 0），与 sessionStartSeconds 同处一条时间轴；
      // 调度器以 atSeconds 直接作绝对秒、以 startSeconds = sessionStartSeconds
      // 作参考，故无需对音符事件额外偏移——它们自然落在 count-in 结束之后。
      const noteEvents = buildPlaybackEvents(notesRef.current, tm, from);
      for (const ev of noteEvents) {
        events.push(ev);
      }

      // ── v2.1.0 S2 (D12-4)：播放期节拍器（metronome=true 时） ──
      // 复用 buildClickEvents 前向走（逐拍 timeAt，正确处理变拍）。视界 =
      // max(最后一个音符的结束, from) + 8 小节尾部（无音符时也至少有 8 小节
      // click）。与 count-in click（[sessionStart, from) 段）天然不重叠 →
      // 不双触发同一拍（T37）。
      if (metronomeRef.current) {
        const fromSeconds = tm.timeAt(from.bar, from.beat);
        const lastNoteEnd = notesRef.current.reduce((max, n) => {
          const end =
            tm.timeAt(n.bar, n.beat) + (n.durQn * 60) / tm.bpmAt(n.bar, n.beat);
          return Math.max(max, end);
        }, fromSeconds);
        const meter = tm.meterAt(from.bar);
        const beatsPerBar = meter.numerator * (4 / meter.denominator);
        const beatSec = 60 / tm.bpmAt(from.bar, from.beat);
        const horizonSeconds =
          Math.max(lastNoteEnd, fromSeconds) + 8 * beatsPerBar * beatSec;
        const horizonBeats = Math.ceil(
          (horizonSeconds - fromSeconds) / beatSec
        );
        for (const ev of buildClickEvents(tm, from, horizonBeats, meter)) {
          events.push(ev);
        }
      }

      events.sort((a, b) => a.atSeconds - b.atSeconds);

      // ── v2.1.0 S2 (D12-2)：会话捕获 loop（起播时设置的快照语义；
      // setLoop 在会话活跃时会即时改写 session.loop，见 setLoop） ──
      const loopCfg = loopRef.current;
      const loopEnabled = !!loopCfg?.enabled;
      const loopStartSeconds = loopEnabled
        ? tm.timeAt(loopCfg!.start.bar, loopCfg!.start.beat)
        : 0;
      const loopEndSeconds = loopEnabled
        ? tm.timeAt(loopCfg!.end.bar, loopCfg!.end.beat)
        : 0;
      const found = loopEnabled
        ? events.findIndex((ev) => ev.atSeconds >= loopStartSeconds - 1e-9)
        : 0;
      const loopStartIndex = found < 0 ? events.length : found;

      sessionRef.current = {
        events,
        index: 0,
        startPerfNow: nowRef.current(),
        startSeconds: sessionStartSeconds,
        countInDuration,
        loop: loopEnabled
          ? {
              enabled: true,
              startSeconds: loopStartSeconds,
              endSeconds: loopEndSeconds,
            }
          : null,
        loopStartIndex,
      };

      // count-in 表示法（D3-2 设计选择，供 T20/T21 断言）：
      // phase='count-in' 期间 position 取 barBeatAt(sessionStartSeconds)，
      // 即 count-in 的"前导小节"位置（from 之前的小节）。对 from={1,1} 因
      // TempoMap 无 bar<1，该位置夹为 {1,1}；对 from>={2,1} 则显示前导小节
      // （如 from={2,1} 的 count-in 显示 bar 1），符合"count-in 是你进奏前的
      // 预备小节"直觉。转场瞬间（elapsed=countInDuration）position 精确等于
      // from（无漂移）。
      if (countInDuration > 0) {
        phaseRef.current = "count-in";
        setPhase("count-in");
      } else {
        phaseRef.current = "playing";
        setPhase("playing");
      }
      const startPos = tm.barBeatAt(sessionStartSeconds);
      positionRef.current = startPos;
      setPosition(startPos);
      setPositionSeconds(sessionStartSeconds);

      clearTimers();
      schedulerTick(); // 立即投递 lookahead 窗口内事件（含首批 click）
      schedulerTimerRef.current = setInterval(schedulerTick, tickRef.current);
      positionTimerRef.current = setInterval(positionTick, POSITION_TICK_MS);
    },
    [clearTimers, schedulerTick, positionTick]
  );

  const stop = useCallback((): void => {
    // v2.2.0 S0 (D21)：录制中先提交 take（需在清会话前读精确时刻，防丢）
    commitRecording();
    clearTimers();
    sessionRef.current = null;
    allSoundOff();
    positionRef.current = { bar: 1, beat: 1 };
    setPosition({ bar: 1, beat: 1 });
    setPositionSeconds(0);
    phaseRef.current = "idle";
    setPhase("idle");
  }, [clearTimers, allSoundOff]);

  const play = useCallback(
    (opts?: { countInBars?: number }): void => {
      const countInBars = opts?.countInBars ?? 0;
      // 向后兼容：无参 play() = countInBars 取 0 → 直进 playing（既有测试
      // h.getResult().play() 期望直接进 playing 不受影响）。count-in 进行中
      // 再次 play 视为幂等空操作。
      if (phaseRef.current === "playing" || phaseRef.current === "count-in") return;

      // v2.8.0：必须在**用户手势的同步调用栈**里创建 AudioContext。
      // 浏览器自动播放策略下，非手势创建的上下文会停在 suspended 且不发声。
      // 这里不 await —— 创建是同步的，resume 是异步的，播放不等它；
      // 合成器在未 running 期间的所有 noteOn 都是 no-op（静默降级）。
      void previewRef.current?.ensureStarted();

      // D4：暂停后续播不得重走 count-in（count-in 仅用于"起播"，DAW 惯例）。
      // 引擎侧强制 countInBars=0：从暂停位置直进 playing 续播，不重复预备小节。
      // 不改对外签名、不改 App 传参（App 仍按惯例传 countInBars）。
      const effectiveCountInBars =
        phaseRef.current === "paused" ? 0 : countInBars;
      beginPlayback(positionRef.current, effectiveCountInBars);
    },
    [beginPlayback]
  );

  const pause = useCallback((): void => {
    // count-in 期间 pause = 中断预备（与 stop 同效：回 idle，并由 allSoundOff
    // 清在鸣 Map 防卡音）。TransportBar 在 count-in 态显示可中断按钮即调用本方法。
    if (phaseRef.current === "count-in") {
      stop();
      return;
    }
    if (phaseRef.current !== "playing") return;
    // v2.2.0 S0 (D21)：录制中 pause → 先提交 take（需在清会话前读精确时刻）
    commitRecording();
    // 先按当前时刻定格播放头位置（position 保持不变）
    const session = sessionRef.current;
    if (session) {
      const seconds =
        session.startSeconds + (nowRef.current() - session.startPerfNow) / 1000;
      const pos = tempoMapRef.current.barBeatAt(seconds);
      positionRef.current = pos;
      setPosition(pos);
      setPositionSeconds(seconds);
    }
    clearTimers();
    sessionRef.current = null;
    allSoundOff();
    phaseRef.current = "paused";
    setPhase("paused");
  }, [clearTimers, allSoundOff, stop]);

  const seek = useCallback(
    (pos: { bar: number; beat: number }): void => {
      const wasPlaying = phaseRef.current === "playing";
      positionRef.current = pos;
      setPosition(pos);
      setPositionSeconds(tempoMapRef.current.timeAt(pos.bar, pos.beat));
      allSoundOff(); // 停止在鸣音
      clearTimers();
      sessionRef.current = null;
      if (wasPlaying) {
        beginPlayback(pos); // 原在播放 → 从新位置继续排程
      }
    },
    [allSoundOff, clearTimers, beginPlayback]
  );

  // ── v2.1.0 S2 (D12-1)：设置/清除 loop ──
  // 会话活跃时**即时生效**（重算折返秒与 loopStartIndex）；否则下次起播生效。
  // end ≤ start 视为无效（关闭 loop，防御）。清 loop 后已越出区间的播放头
  // 保持当前位置继续播放（不回卷）。
  const setLoop = useCallback((next: TransportLoop | null): void => {
    const tm = tempoMapRef.current;
    const valid =
      !!next &&
      next.enabled &&
      tm.timeAt(next.end.bar, next.end.beat) >
        tm.timeAt(next.start.bar, next.start.beat);
    const normalized = valid ? next : null;
    loopRef.current = normalized;
    setLoopState(normalized);
    const session = sessionRef.current;
    if (!session) return; // 无活跃会话：下次起播时经 beginPlayback 捕获
    if (!normalized) {
      session.loop = null;
      return;
    }
    const startSeconds = tm.timeAt(normalized.start.bar, normalized.start.beat);
    const endSeconds = tm.timeAt(normalized.end.bar, normalized.end.beat);
    session.loop = { enabled: true, startSeconds, endSeconds };
    const found = session.events.findIndex(
      (ev) => ev.atSeconds >= startSeconds - 1e-9
    );
    session.loopStartIndex = found < 0 ? session.events.length : found;
  }, []);

  // 通道变更：对旧通道在鸣音补发 noteOff 防卡音；播放中从当前位置按新通道重排程
  const prevChannelRef = useRef(channel);
  useEffect(() => {
    if (prevChannelRef.current === channel) return;
    prevChannelRef.current = channel;
    const wasPlaying =
      phaseRef.current === "playing" || phaseRef.current === "count-in";
    const pos = positionRef.current;
    allSoundOff();
    if (wasPlaying) {
      clearTimers();
      sessionRef.current = null;
      beginPlayback(pos);
    }
  }, [channel, allSoundOff, clearTimers, beginPlayback]);

  // 卸载：停定时器 + 抗卡音（clear + 补发 noteOff）
  useEffect(() => {
    return () => {
      clearTimers();
      sessionRef.current = null;
      allSoundOff();
    };
  }, [clearTimers, allSoundOff]);

  return {
    phase,
    position,
    positionSeconds,
    isPlaying: phase === "playing",
    play,
    pause,
    stop,
    seek,
    loop,
    setLoop,
    // ── v2.2.0 S0 (D21)：实时录制 ──
    isRecording,
    getPositionSecondsNow,
    startRecording,
    stopRecording,
    captureRecordedNoteOn,
    captureRecordedNoteOff,
  };
}
