import React, { useRef, useEffect, useMemo, useState, useCallback } from "react";
import type { NoteEvent, TempoMap } from "@collinx/core";
import styles from "./ScoreRenderer.module.css";
import { planBarSlots, barBeatFromX } from "./bar-anchors";
import type { BarAnchor } from "./bar-anchors";
import { ScorePlayhead } from "./ScorePlayhead";

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const MIDI_TO_VF_KEY: Record<number, string> = {};
for (let midi = 21; midi <= 108; midi++) {
  const pitchClass = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES_SHARP[pitchClass].toLowerCase();
  MIDI_TO_VF_KEY[midi] = `${name}/${octave}`;
}

function durQnToVfDuration(durQn: number): { duration: string; isDotted: boolean } {
  const tolerance = 0.01;
  const isDottedFn = (base: number) => Math.abs(durQn - base * 1.5) < tolerance;

  if (isDottedFn(4)) return { duration: "w", isDotted: true };
  if (Math.abs(durQn - 4) < tolerance) return { duration: "w", isDotted: false };
  if (isDottedFn(2)) return { duration: "h", isDotted: true };
  if (Math.abs(durQn - 2) < tolerance) return { duration: "h", isDotted: false };
  if (isDottedFn(1)) return { duration: "q", isDotted: true };
  if (Math.abs(durQn - 1) < tolerance) return { duration: "q", isDotted: false };
  if (isDottedFn(0.5)) return { duration: "8", isDotted: true };
  if (Math.abs(durQn - 0.5) < tolerance) return { duration: "8", isDotted: false };
  if (Math.abs(durQn - 0.25) < tolerance) return { duration: "16", isDotted: false };
  if (durQn < 0.5) return { duration: "16", isDotted: false };
  return { duration: "q", isDotted: false };
}

function getAccidental(pitchMidi: number, pitchSpelling?: string): string | undefined {
  if (pitchSpelling) {
    const match = pitchSpelling.match(/^([A-G])([#b]+)/);
    if (match) {
      return match[2];
    }
  }
  const pitchClass = ((pitchMidi % 12) + 12) % 12;
  if ([1, 3, 6, 8, 10].includes(pitchClass)) {
    return "#";
  }
  return undefined;
}

export interface StaffConfig {
  clef: "treble" | "bass";
  name: string;
  bars: number;
}

export interface ScoreRendererLayout {
  staffConfig: StaffConfig[];
  notationSize?: number;
}

export interface ScoreRendererProps {
  notes: NoteEvent[];
  layout: ScoreRendererLayout;
  tempoMap?: TempoMap;
  width?: number;
  height?: number;
  scale?: number;
  /**
   * 渲染成功后回调小节锚点（`{bar, x0, x1}`）。多谱表共用同一 bar→x，
   * 故只回调一次。渲染失败或被取消时不回调。缺省时零行为变化。
   *
   * 按值去重：新锚点序列与上一次完全相同（同值）时不再回调，避免「父组件用
   * state 接收锚点 → layout 身份变化 → 重排版 → 再次回调」的自触发循环。
   */
  onBarAnchorsChange?: (anchors: BarAnchor[]) => void;
  /**
   * 谱面播放头位置（只读跟随）。null/undefined → 不渲染覆盖层。缺省零行为变化。
   */
  playheadPosition?: { bar: number; beat: number } | null;
  /**
   * 谱面点击定位（Stage 2）：点击落在乐谱内容上时回调反演出的 `{bar, beat}`。
   *
   * 只读/缺省语义：不传时**不绑定**任何点击处理（`onClick` 为 undefined，而非空
   * 函数），DOM 结构与行为零变化。
   */
  onSeek?: (pos: { bar: number; beat: number }) => void;
}

const STAVE_WIDTH = 550;
const STAVE_PADDING_LEFT = 10;
const STAVE_HEIGHT = 120;
const STAVE_GAP = 20;
/** 右侧留白（供可分配宽度扣减，避免末小节顶到画布边缘）。 */
const STAVE_RIGHT_PADDING = 10;

export const ScoreRenderer: React.FC<ScoreRendererProps> = ({
  notes,
  layout,
  tempoMap,
  width,
  height,
  scale = 1,
  onBarAnchorsChange,
  playheadPosition,
  onSeek,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(0);
  // 用 ref 持有最新回调，避免把它塞进渲染 useEffect 的 deps 引发重排版。
  const onBarAnchorsChangeRef =
    useRef<ScoreRendererProps["onBarAnchorsChange"]>(onBarAnchorsChange);

  useEffect(() => {
    onBarAnchorsChangeRef.current = onBarAnchorsChange;
  }, [onBarAnchorsChange]);

  // onSeek 同样用 ref 持有最新值：点击处理只需在「是否传入」上切换绑定，
  // 无需因父级每次换新函数而重建 handler。
  const onSeekRef = useRef<ScoreRendererProps["onSeek"]>(onSeek);
  useEffect(() => {
    onSeekRef.current = onSeek;
  }, [onSeek]);

  // 内部持有的锚点（供播放头定位）。仅在「按值不同」时更新，避免自触发循环。
  const [anchors, setAnchors] = useState<BarAnchor[]>([]);
  // 上一次已上报锚点的序列化值（按值去重的判据）。null 表示尚未上报过。
  const lastAnchorsKeyRef = useRef<string | null>(null);

  const meter = useMemo(() => {
    if (tempoMap) {
      return tempoMap.meterAt(1);
    }
    return { numerator: 4, denominator: 4 };
  }, [tempoMap]);

  const notesByStaff = useMemo(() => {
    return layout.staffConfig.map((staff) => {
      return notes.filter((n) => {
        if (staff.clef === "treble") return n.pitchMidi >= 60;
        return n.pitchMidi < 60;
      });
    });
  }, [notes, layout.staffConfig]);

  // 渲染小节数沿用既有 maxBars 公式（不从音符推导），保证无音符小节也占槽位。
  const renderBars = useMemo(() => {
    return Math.max(...layout.staffConfig.map((s) => s.bars), 4);
  }, [layout.staffConfig]);

  // v2.3.0 S4b (D34-5)：画布**未缩放**布局高提到渲染作用域，成为唯一来源——
  // 既喂给 VexFlow 的 `renderer.resize(_, totalHeight)`，又用于给 `.rendererStack`
  // 设定**画布可视高** = totalHeight × scale（`.rendererCanvas` 经 `transform: scale()`
  // 缩放，但 CSS transform **不改变布局盒**，故其布局高恒为 totalHeight）。
  // 覆盖层（`ScorePlayhead` 的 `.layer`）靠 `top:0;bottom:0` 撑满 `.rendererStack`，
  // 于是高度**由解析式决定**，不再依赖 `height: ${scale*100}%` 这类相对启发式
  // （旧实现相对的是 `.rendererStack` 的 `min-height:100%`，容器比谱面高时会越出）。
  const totalHeight = useMemo(
    () => layout.staffConfig.length * (STAVE_HEIGHT + STAVE_GAP) + 20,
    [layout.staffConfig],
  );

  // 拍号派生：单行谱面各小节共用同一拍号（tempoMap.meterAt(1)）。
  //
  // 关键：NoteEvent.beat 的单位是「四分音符」，而非「拍号分母所指的拍」。
  // 依据 TempoMap.positionInBars(bar, beat) = bar + (beat - 1) / 4 —— beat 每 +1
  // 前进一个四分音符。故「每小节的四分音符拍数」必须换算为 numerator * 4 / denominator：
  //   3/4 → 3 * 4 / 4 = 3     ✔（与旧式 meter.numerator 侥幸一致）
  //   6/8 → 6 * 4 / 8 = 3     （旧式错给 6）
  //   7/8 → 7 * 4 / 8 = 3.5   （旧式错给 7）
  // 该值直接喂给 ScorePlayhead 的 fraction = (beat - 1) / beatsPerBarAt(bar)，
  // 故复合拍号下不换算会让覆盖层落点系统性偏移。
  // denominator 缺失或为 0 时回落到 4/4 语义（此时 == numerator）。
  const beatsPerBarAt = useCallback(() => {
    const denominator = meter.denominator || 4;
    return (meter.numerator * 4) / denominator;
  }, [meter]);

  /**
   * 点击定位换算（Stage 2）。
   *
   * 坐标系：点击事件绑定在滚动容器（`.rendererContainer`，overflow: auto）上。
   * 画布经 `transform: scale(scale)` 缩放，故：
   *   localX = (e.clientX - rect.left) / scale + scrollLeft
   * 其中 rect 为滚动容器视口矩形，scrollLeft 为容器横向滚动量，localX 即
   * `barBeatFromX` 期望的「未缩放内容坐标系」x。
   *
   * 反演返回 null（未就绪/未命中/守卫触发）时**不调用** onSeek。
   */
  const handleSeekClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const seek = onSeekRef.current;
      if (!seek) return;
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const scrollLeft = el.scrollLeft || 0;
      const localX = (e.clientX - rect.left) / scale + scrollLeft;
      const pos = barBeatFromX({ anchors, localX, beatsPerBarAt });
      if (pos) seek(pos);
    },
    [anchors, beatsPerBarAt, scale],
  );

  useEffect(() => {
    let cancelled = false;
    const currentRenderId = ++renderIdRef.current;

    async function render() {
      try {
        const VF = await import("vexflow");
        const container = containerRef.current;
        if (!container || cancelled || currentRenderId !== renderIdRef.current) return;

        container.innerHTML = "";

        const staves = layout.staffConfig;
        const staveWidth = STAVE_WIDTH;
        // totalHeight 由渲染作用域的 useMemo 提供（唯一来源，见其注释）。

        const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
        renderer.resize(staveWidth + STAVE_PADDING_LEFT * 2, totalHeight);
        const context = renderer.getContext();

        // 逐小节等宽槽位：按 renderBars 生成全部槽位（含无音符小节）。多谱表
        // 共用同一 bar→x 映射，故只规划一次。
        // 可分配宽 = (staveX + staveWidth) - 首小节左缘 - 右侧留白。
        // 注意 slot.x 是 Stave 片段左缘，而非音符起始——谱号/拍号占位由 VexFlow
        // 在 getNoteStartX 内部处理，此处不额外扣减。
        const staveX = STAVE_PADDING_LEFT;
        const firstBarLeft = STAVE_PADDING_LEFT;
        const availableWidth = staveX + staveWidth - firstBarLeft - STAVE_RIGHT_PADDING;
        const slots = planBarSlots({
          startX: firstBarLeft,
          availableWidth,
          bars: renderBars,
        });

        // 每个谱表「第一小节」的 Stave（用于双谱表 BRACE 连接）。
        const vfStaves: InstanceType<typeof VF.Stave>[] = [];

        // D32-5：越界 bar 音符计数。旧实现把所有音符无差别塞进 groupedByBar，
        // 其中 bar <= 0 / 非整数 / bar > renderBars 的音符会被「静默丢弃」（既不
        // 画出来也无任何提示）。新实现改为渲染前显式统计并在结束时 warn 一次，
        // 使「丢弃」这一旧行为显式化 —— 不新增对外 prop，仅用于诊断。
        let outOfRangeBarCount = 0;

        for (let staffIdx = 0; staffIdx < staves.length; staffIdx++) {
          const staff = staves[staffIdx];
          const staffNotes = notesByStaff[staffIdx] ?? [];
          const yOffset = staffIdx * (STAVE_HEIGHT + STAVE_GAP) + 30;

          const groupedByBar: Record<number, NoteEvent[]> = {};
          for (const note of staffNotes) {
            const bar = note.bar;
            // D32-5 显式忽略：bar < 1 / 非整数 / 超出 renderBars 的音符不属于任何
            // 槽位，保留在 groupedByBar 中也只会被后续 `groupedByBar[slot.bar]` 取
            // 不到而丢弃；此处提前剔除并把丢弃行为显式化（计数 + 末尾 warn）。
            if (bar < 1 || !Number.isInteger(bar) || bar > renderBars) {
              outOfRangeBarCount++;
              continue;
            }
            if (!groupedByBar[bar]) groupedByBar[bar] = [];
            groupedByBar[bar].push(note);
          }

          for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
            const slot = slots[slotIdx];
            // 每个小节一个独立 Stave 片段（x/y/width 取槽位），首尾相接拼成一行。
            const barStave = new VF.Stave(slot.x, yOffset, slot.width);

            // 小节线由 Stave 自带：首小节左缘无（BRACE/谱号所在），末小节右缘收尾，
            // 中间为单线。BarlineType 从 vexflow 命名空间取，禁止写死魔数。
            barStave.setBegBarType(slotIdx === 0 ? VF.BarlineType.NONE : VF.BarlineType.SINGLE);
            barStave.setEndBarType(
              slotIdx === slots.length - 1 ? VF.BarlineType.END : VF.BarlineType.SINGLE,
            );

            // 首谱表首小节挂谱号 + 拍号（其余不加），与既有行为一致。
            if (staffIdx === 0 && slotIdx === 0) {
              barStave.addClef(staff.clef);
              barStave.addTimeSignature(`${meter.numerator}/${meter.denominator}`);
            }

            barStave.setContext(context).draw();
            if (slotIdx === 0) vfStaves.push(barStave);

            // 空小节只画 Stave、不建 Voice；落在 bar > renderBars 的音符自然被跳过。
            const barNotes = (groupedByBar[slot.bar] ?? [])
              .slice()
              .sort((a, b) => a.beat - b.beat);
            if (barNotes.length === 0) continue;

            const vfNotes: InstanceType<typeof VF.StaveNote>[] = [];
            for (const note of barNotes) {
              const vfKey =
                MIDI_TO_VF_KEY[note.pitchMidi] ?? `c/${Math.floor(note.pitchMidi / 12) - 1}`;
              const { duration, isDotted } = durQnToVfDuration(note.durQn);
              const accidental = getAccidental(note.pitchMidi, note.pitchSpelling);

              const staveNote = new VF.StaveNote({
                clef: staff.clef,
                keys: [vfKey],
                duration: duration,
              });

              if (accidental) {
                staveNote.addModifier(new VF.Accidental(accidental));
              }
              if (isDotted) {
                VF.Dot.buildAndAttach([staveNote]);
              }

              vfNotes.push(staveNote);
            }

            // 每小节独立 Voice + Formatter（不再把全曲音符展平进单个 Voice）。
            const voice = new VF.Voice({
              numBeats: meter.numerator,
              beatValue: meter.denominator,
            });
            voice.setStrict(false);
            voice.addTickables(vfNotes);

            new VF.Formatter().joinVoices([voice]).format([voice], slot.width - 20);
            voice.draw(context, barStave);

            // 梁只在本小节音符内生成。
            const beams = VF.Beam.generateBeams(vfNotes, {
              groups: [new VF.Fraction(meter.numerator, meter.denominator)],
            });
            beams.forEach((b) => b.setContext(context).draw());
          }
        }

        // D32-5：越界 bar 音符统计一次性告知（仅在有越界音符时输出，含条数）。
        // 这是对旧「静默丢弃」行为的显式化，不改变渲染结果、不新增对外 prop。
        if (outOfRangeBarCount > 0) {
          console.warn(
            `[ScoreRenderer] 忽略 ${outOfRangeBarCount} 个越界 bar 音符` +
              `（bar < 1 或非整数或 > renderBars=${renderBars}）。`,
          );
        }

        if (staves.length >= 2 && vfStaves.length >= 2) {
          const connector = new VF.StaveConnector(vfStaves[0], vfStaves[1]);
          connector.setType(VF.StaveConnector.type.BRACE);
          connector.setContext(context).draw();
        }

        // 渲染成功后上报小节锚点（多谱表共用同一 bar→x，只上报一次）。
        // 渲染失败（异常 → catch）或被取消（cancelled）时不得回调。
        //
        // 按值去重：序列化比对，与上一次完全相同时既不再回调、也不 setState，
        // 否则「父组件用 state 接收锚点 → layout 身份变化 → 重排版 → 再回调」
        // 会形成永不收敛的自触发循环（S0 验证者实测 300ms 内 15 次回调）。
        if (!cancelled && currentRenderId === renderIdRef.current) {
          const nextAnchors = slots.map((s) => ({
            bar: s.bar,
            x0: s.x,
            x1: s.x + s.width,
          }));
          const key = JSON.stringify(nextAnchors);
          if (key !== lastAnchorsKeyRef.current) {
            lastAnchorsKeyRef.current = key;
            setAnchors(nextAnchors);
            onBarAnchorsChangeRef.current?.(nextAnchors);
          }
        }
      } catch (err) {
        if (!cancelled && currentRenderId === renderIdRef.current) {
          const container = containerRef.current;
          if (container) {
            container.innerHTML = "";
            const placeholder = document.createElement("div");
            placeholder.className = styles.errorPlaceholder;
            placeholder.textContent = `VexFlow 渲染失败: ${err instanceof Error ? err.message : String(err)}`;
            container.appendChild(placeholder);
          }
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [notes, layout, meter, notesByStaff, renderBars, totalHeight]);

  const containerStyle: React.CSSProperties = {
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    width: width ? `${width}px` : undefined,
    height: height ? `${height}px` : undefined,
  };

  return (
    // 点击处理仅在有 onSeek 时绑定（undefined 而非空函数）→ 缺省零行为变化。
    <div
      className={styles.rendererContainer}
      onClick={onSeek ? handleSeekClick : undefined}
    >
      {/*
        相对定位包裹层：为播放头覆盖层提供绝对定位基准，同时把「画布可视高」显式
        定为 totalHeight × scale（S4b / D34-5）。旧实现不给本层定高，而是让覆盖层
        自己去猜 `height: ${scale*100}%` —— 相对的是本层 `min-height:100%`（可能
        等于容器而非画布），高容器下覆盖层会越出谱面。现在高度是解析式单一来源，
        覆盖层用 `top:0;bottom:0` 撑满即可。
      */}
      <div
        className={styles.rendererStack}
        style={{ height: `${totalHeight * scale}px` }}
        data-testid="score-renderer-stack"
      >
        <div ref={containerRef} className={styles.rendererCanvas} style={containerStyle} />
        <ScorePlayhead
          anchors={anchors}
          position={playheadPosition}
          scale={scale}
          beatsPerBarAt={beatsPerBarAt}
        />
      </div>
    </div>
  );
};
