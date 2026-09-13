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
import {
  buildPlaybackEvents,
  buildClickEvents,
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
  /** 已发出 noteOn 的音符：键 `${pitch}:${channel}` → 已换算通道（0-15）。
   *  两通道并存后单 pitch 键不诚实，故键含通道（见文件头抗卡音说明）。 */
  const soundingNotesRef = useRef<Map<string, number>>(new Map());
  const schedulerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const positionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 停全部在鸣音：先 clear() 再逐条补发 noteOff，最后清空 Map（顺序不可颠倒） */
  const allSoundOff = useCallback((): void => {
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
      const ev = session.events[session.index]!;
      session.index += 1;
      if (!port) {
        continue; // 无端口：静默跳过（水位仍推进，避免重复投递）
      }
      // 通道：click 事件显式带 9（GM 打击乐，A1）；音符事件省略 → 按设置通道。
      const evChannel = ev.channel ?? ch;
      // 统一 now() 域时间戳（生产 = performance.now()）
      const timestamp =
        session.startPerfNow + (ev.atSeconds - session.startSeconds) * 1000;
      try {
        if (ev.kind === "on") {
          port.send(encodeNoteOn(ev.pitchMidi, ev.velocity, evChannel), timestamp);
          // 抗卡音：click 的 noteOn 也进入在鸣 Map（否则 stop 中断 count-in 时
          // 会卡音）。stop()/pause() 经 allSoundOff 按 evChannel 补 noteOff。
          // 键含通道：两通道并存后单 pitch 键不诚实（见文件头抗卡音说明）。
          soundingNotesRef.current.set(`${ev.pitchMidi}:${evChannel}`, evChannel);
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
    const seconds = session.startSeconds + elapsed;
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
        // count-in 起点位置（可能 < bar 1；TempoMap.timeAt 对 bar<1 折叠为 0）。
        // 逐小节反向推导 clickFrom（1-based，beat >= 1）：从 from 出发，向前（时间上
        // 向后）走 countInBeats 拍；每步递减 beat，当 beat 降到 1 再减则退到上一小节、
        // 把 beat 置为该小节 tempoMap.meterAt(bar) 算出的拍数。变拍下每小节拍数取各自
        // 实际 meter，而非旧实现以 from.bar 单 meter 恒推 beatsPerBar（会错位）。
        // 4/4 下每小节恒 4 拍 → 与旧实现逐字等价（T20/T21/T22 不受影响）。
        // from.beat 为小数（连续播放头可能给出小数 beat）时的处理选择：以 Math.floor
        // 取当前所在整数拍并 clamp 到 >=1，即 count-in 起点落在整数拍、click 也全部落在
        // 整数拍；小数余量被舍去（不向前借半拍），契合"count-in 为整拍预备"语义。
        //
        // ⚠️ 已知限制（S5/D5-5 登记，源自 S4 验证 S4-F1，**当前生产不可达**）：
        // 本项目 beat 的单位是**四分音符**（见 core 的 TempoMap.positionInBars =
        // bar + (beat-1)/4），故复合拍号会给出**小数** beatsPerBar（如 7/8 → 7*(4/8)
        // = 3.5）。此时上述反向走会把 clickFromBeat 落在 3.5/2.5/1.5/0.5 这类小数拍上，
        // 而 buildClickEvents 以 `beat === 1` 判强拍 ⇒ **该 count-in 跨度重音失效**；
        // 且连续退小节可能越界到 bar 0（meterAt(0) 静默回退 4/4）。
        // **不可达依据**：App 恒用 TempoMap.default()（120bpm/4/4，见 App.tsx），
        // 故 beatsPerBar 恒为整数 4。**若未来开放拍号编辑，须改为"按整数拍反向走"
        // 或在 buildClickEvents 内以拍内位置判定强拍。**
        let clickFromBar = from.bar;
        let clickFromBeat = Math.max(1, Math.floor(from.beat));
        for (let i = 0; i < countInBeats; i++) {
          clickFromBeat -= 1;
          if (clickFromBeat < 1) {
            clickFromBar -= 1;
            const m = tm.meterAt(clickFromBar);
            clickFromBeat = m.numerator * (4 / m.denominator);
          }
        }
        const clickFrom = { bar: clickFromBar, beat: clickFromBeat };
        const clickEvents = buildClickEvents(tm, clickFrom, countInBeats, meter);
        // 重新锚定到 sessionStartSeconds：clickFrom 的 timeAt 可能因 bar<1 折叠，
        // 故用偏移把 click 事件搬到会话时间轴（count-in 起点），使其 atSeconds
        // 落在 [sessionStartSeconds, sessionStartSeconds + countInDuration)。
        const clickFromSeconds = tm.timeAt(clickFrom.bar, clickFrom.beat);
        const shift = sessionStartSeconds - clickFromSeconds;
        for (const ev of clickEvents) {
          events.push({ ...ev, atSeconds: ev.atSeconds + shift });
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

      events.sort((a, b) => a.atSeconds - b.atSeconds);

      sessionRef.current = {
        events,
        index: 0,
        startPerfNow: nowRef.current(),
        startSeconds: sessionStartSeconds,
        countInDuration,
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
  };
}
