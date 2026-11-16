import React, { useRef, useEffect, useMemo, useState, useCallback } from "react";
import type { NoteEvent, TempoMap } from "@collinx/core";
import { useI18n } from "../../i18n";
import styles from "./ScoreRenderer.module.css";
import { planBarSlots, barBeatFromX } from "./bar-anchors";
import type { BarAnchor, BarSlot } from "./bar-anchors";
import { planSystems } from "./score-layout";
import { ScorePlayhead } from "./ScorePlayhead";
import { groupNotesForStaves, type ScoredNoteGroup } from "./note-grouping";
import {
  beamGroups,
  stemDirection,
  keyAlterations,
  MeasureAccidentalState,
  vexflowKeySpec,
  type KeyDef,
} from "./engraving";
import {
  assignVoices,
  barLengthQn,
  beamRuns,
  fillVoiceRests,
  planNoteSpans,
  spansAreContiguous,
  type NoteSpan,
} from "./notation";

const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const MIDI_TO_VF_KEY: Record<number, string> = {};
for (let midi = 21; midi <= 108; midi++) {
  const pitchClass = midi % 12;
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES_SHARP[pitchClass].toLowerCase();
  MIDI_TO_VF_KEY[midi] = `${name}/${octave}`;
}

/**
 * 休止符的「锚点音高」——VexFlow 用 key 换算 y，而谱号不同则同一个 y 对应的
 * 音高不同。旧实现所有谱表一律用 `b/4`：在高音谱表恰好是中线（正确），
 * 在低音谱表 `b/4` 是**谱表上方加线之外**，整小节休止符会飘在五线谱上面。
 * 每谱表取自己的中线音：高音 B4、低音 D3、中音 C4。
 */
const REST_KEY_BY_CLEF: Record<string, string> = {
  treble: "b/4",
  bass: "d/3",
  alto: "c/4",
  tenor: "c/4",
  percussion: "b/4",
};

function restKeyFor(clef: string): string {
  return REST_KEY_BY_CLEF[clef] ?? "b/4";
}

export interface StaffConfig {
  clef: "treble" | "bass";
  name: string;
  bars: number;
}

export interface ScoreRendererLayout {
  staffConfig: StaffConfig[];
  notationSize?: number;
  /**
   * 每行（系统）最多小节数。缺省 `BARS_PER_SYSTEM`（8）。
   * 超过该值的小节换行到下一系统——此前全部小节被压进同一行 550px，
   * 48 小节工程每小节仅 ~11px，等于不可读。
   */
  barsPerSystem?: number;
}

export interface ScoreRendererProps {
  notes: NoteEvent[];
  layout: ScoreRendererLayout;
  tempoMap?: TempoMap;
  width?: number;
  height?: number;
  scale?: number;
  /**
   * 本画布首小节的**小节号**（默认 1）。分页渲染第 2 页起必须传入，
   * 否则每页锚点都会退回「bar 1..N」，播放头/点击定位会指到第一页。
   */
  startBar?: number;
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
  /** 纸面模式：透明容器 + 纸张底色（由 ScorePanel 设置 --score-paper/--score-ink）。 */
  paper?: boolean;
}

const STAVE_WIDTH = 550;
/**
 * v2.8.0：每小节的**最小可读宽度**。
 *
 * 此前谱表宽度固定 550px，8 个小节挤在里面 → 每小节只有 68px。
 * 一个八分音符的符头 + 符干 + 符尾约需 30px，4~8 个音符同小节时
 * 必然糊成一片（用户原话：「这些音符怎么还是堆在一起」）。
 *
 * 现在谱表宽度随**该行实际小节数**增长，每小节至少 110px ——
 * 这是普通乐谱的排版惯例：宁可加宽加横向滚动，也不压扁音符。
 */
const MIN_BAR_WIDTH = 110;

/**
 * 谱表宽度（按该行实际小节数）。
 *
 * 导出是为了让测试用**同一份算法**复算锚点几何 —— 此前测试硬编码 540，
 * 宽度一改就全线飘红，而那不是产品缺陷，是基准没跟着走。
 */
export function computeStaveWidth(barsInSystem: number): number {
  const n = Number.isFinite(barsInSystem) ? Math.max(1, Math.floor(barsInSystem)) : 1;
  return Math.max(STAVE_WIDTH, n * MIN_BAR_WIDTH);
}
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
  startBar = 1,
  onBarAnchorsChange,
  playheadPosition,
  onSeek,
  paper = false,
}) => {
  const { t } = useI18n();
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
  // 谱面悬停小节：只表达「这里可以点击定位」，不改变任何数据。
  const [hoverBar, setHoverBar] = useState<number | null>(null);
  // VexFlow 动态 import / 渲染的可见状态；失败可重试，不再只把错误塞进 DOM。
  const [renderState, setRenderState] = useState<"loading" | "ready" | "error">("loading");
  const [renderError, setRenderError] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);

  /**
   * 拍号按**小节**取，而不是全曲共用 `meterAt(1)`。
   *
   * 旧实现把首小节拍号喂给所有小节的 Voice / 休止补齐 / 播放头插值，中途变拍号
   * （如 4/4 → 6/8）后，后续小节的拍数、休止与游标位置会系统性偏移。
   * 缺省 tempoMap 时回落 4/4，保持裸组件 API 行为不变。
   */
  const meterAt = useCallback(
    (bar: number) => (tempoMap ? tempoMap.meterAt(bar) : { numerator: 4, denominator: 4 }),
    [tempoMap],
  );
  const beatsPerBarAt = useCallback(
    (bar: number) => {
      const meter = meterAt(bar);
      const denominator = meter.denominator || 4;
      return (meter.numerator * 4) / denominator;
    },
    [meterAt],
  );

  /**
   * v2.9.6：谱表分配改为「按同时性分组后整组归属」。
   *
   * 旧行为按单音音高（≥60 高音谱表）分配 —— 和弦轨生成的三和弦
   * （如 A3/C4/E4）被拆到两个谱表，谱面上和弦就散架了。
   * 新规则：同小节/同拍/同时值聚成一组，组内最低音 < 60 → 低音谱表，
   * 否则高音谱表；单音组与旧行为逐值一致。
   */
  const groupsByStaffAndBar = useMemo(() => {
    const groups = groupNotesForStaves(notes, layout.staffConfig);
    return groups.map((list) => {
      const byBar: Record<number, ScoredNoteGroup[]> = {};
      for (const group of list) {
        (byBar[group.bar] ??= []).push(group);
      }
      return byBar;
    });
  }, [notes, layout.staffConfig]);

  // 渲染小节数沿用既有 maxBars 公式（不从音符推导），保证无音符小节也占槽位。
  // 下限 4 保留既有「短工程也画满 4 小节」的观感，与改动前一致。
  const renderBars = useMemo(() => {
    return Math.max(...layout.staffConfig.map((s) => s.bars), 4);
  }, [layout.staffConfig]);

  /**
   * 谱面排布（v3.3.0）：把「逻辑音组」编译成「可单独绘制的 span」。
   *
   * 旧实现在渲染循环里就地查表，把 `durQn` 硬映射成一个 duration 符号 ——
   * 跨小节、跨拍、附点以及 1.25 / 2.5 / 0.4 这类非常规时值全部失真（详见
   * notation.ts 文件头）。排布是纯函数，提前到 memo 里一次算完，按
   * 「谱表 → 小节」索引；渲染循环只负责构造 VexFlow 对象与绘制。
   *
   * `groups` 保留 chain → 原始分组 的映射：span 只携带时值，音高/拼写仍在分组里。
   */
  const engravingPlan = useMemo(() => {
    const lastBar = startBar + renderBars - 1;
    const groups = new Map<string, ScoredNoteGroup>();
    const byStaff: Record<number, NoteSpan[]>[] = layout.staffConfig.map(() => ({}));

    for (let staffIdx = 0; staffIdx < layout.staffConfig.length; staffIdx++) {
      const source = groupsByStaffAndBar[staffIdx] ?? {};
      const target = byStaff[staffIdx]!;
      for (const barKey of Object.keys(source)) {
        const bar = Number(barKey);
        if (!Number.isInteger(bar) || bar < 1 || bar > lastBar) continue;
        const list = source[bar]!;
        for (let groupIdx = 0; groupIdx < list.length; groupIdx++) {
          const group = list[groupIdx]!;
          const chain = `${staffIdx}:${bar}:${groupIdx}`;
          const spans = planNoteSpans({
            bar,
            offset: group.beat - 1,
            durQn: group.durQn,
            chain,
            meterAt,
            lastBar,
          });
          if (spans.length === 0) continue;
          groups.set(chain, group);
          // ⚠️ 必须按 **span 自己的小节** 归桶，不能一股脑塞进"分组所在小节"：
          // 跨小节音符的后续段属于下一小节，塞错桶会让它在原小节里被重新定位
          // （实测：跨小节音的第二段落到小节首，画成与首音同时发声）。
          for (const span of spans) (target[span.bar] ??= []).push(span);
        }
      }
      for (const barKey of Object.keys(target)) {
        target[Number(barKey)]!.sort(
          (a, b) => a.offset - b.offset || a.index - b.index,
        );
      }
    }

    return { byStaff, groups };
  }, [groupsByStaffAndBar, layout.staffConfig, meterAt, renderBars, startBar]);

  // 系统（行）划分：每行最多 barsPerSystem 小节（缺省 8），超出的换行纵向堆叠。
  // 单行 / 单系统时几何与改动前逐值一致（锚点仍为 {bar,x0,x1}）。
  const systems = useMemo(
    () => planSystems({ bars: renderBars, startBar, barsPerSystem: layout.barsPerSystem }),
    [renderBars, startBar, layout.barsPerSystem],
  );

  // v2.3.0 S4b (D34-5)：画布**未缩放**布局高提到渲染作用域，成为唯一来源——
  // 既喂给 VexFlow 的 `renderer.resize(_, totalHeight)`，又用于给 `.rendererStack`
  // 设定**画布可视高** = totalHeight × scale（`.rendererCanvas` 经 `transform: scale()`
  // 缩放，但 CSS transform **不改变布局盒**，故其布局高恒为 totalHeight）。
  // 覆盖层（`ScorePlayhead` 的 `.layer`）靠 `top:0;bottom:0` 撑满 `.rendererStack`，
  // 于是高度**由解析式决定**，不再依赖 `height: ${scale*100}%` 这类相对启发式
  // （旧实现相对的是 `.rendererStack` 的 `min-height:100%`，容器比谱面高时会越出）。
  //
  // 多系统：每个系统占「谱表数 × 节距」的纵向块，块与块之间不留额外间距（谱表
  // 间距已含在节距内）；单系统时该式退化为改动前的 `谱表数 × 节距 + 20`。
  const totalHeight = useMemo(
    () => Math.max(1, systems.length) * layout.staffConfig.length * (STAVE_HEIGHT + STAVE_GAP) + 20,
    [systems.length, layout.staffConfig.length],
  );

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
      const localY = (e.clientY - rect.top) / scale + (el.scrollTop || 0);
      // 多系统谱面里不同行共享同一批 x 区间：先用纵坐标圈定点击所在的系统，
      // 否则点第 2 行的「第 2 小节」会被解析成第 1 行的第 2 小节。单系统锚点不带
      // y/height → 候选集恒为全量，行为与改动前一致。
      const inSystem = anchors.filter((a) =>
        a.y !== undefined && a.height !== undefined
          ? localY >= a.y && localY < a.y + a.height
          : true,
      );
      const pool = inSystem.length > 0 ? inSystem : anchors;
      const pos = barBeatFromX({ anchors: pool, localX, beatsPerBarAt });
      if (pos) seek(pos);
    },
    [anchors, beatsPerBarAt, scale],
  );

  /**
   * 悬停小节：只更新「哪一小节高亮」，不重排版。用于表达谱面可点击定位。
   * 每像素移动不会 setState —— 只有跨小节边界时才更新，避免 60fps 提交。
   */
  const handleHoverMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!onSeekRef.current) return;
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const localX = (e.clientX - rect.left) / scale + (el.scrollLeft || 0);
      const localY = (e.clientY - rect.top) / scale + (el.scrollTop || 0);
      const inSystem = anchors.filter((a) =>
        a.y !== undefined && a.height !== undefined
          ? localY >= a.y && localY < a.y + a.height
          : true,
      );
      const pool = inSystem.length > 0 ? inSystem : anchors;
      const anchor = pool.find((a) => localX >= a.x0 && localX < a.x1);
      const next = anchor?.bar ?? null;
      setHoverBar((prev) => (prev === next ? prev : next));
    },
    [anchors, scale],
  );

  const hoverAnchor =
    hoverBar === null ? null : anchors.find((a) => a.bar === hoverBar) ?? null;

  useEffect(() => {
    let cancelled = false;
    const currentRenderId = ++renderIdRef.current;
    // 首次渲染显示骨架；已渲染过的谱面在增量重排时保持旧画面，避免闪白。
    if (!containerRef.current?.querySelector("svg")) {
      setRenderState("loading");
      setRenderError("");
    }

    async function render() {
      try {
        const VF = await import("vexflow");
        const container = containerRef.current;
        if (!container || cancelled || currentRenderId !== renderIdRef.current) return;

        container.innerHTML = "";

        const staves = layout.staffConfig;
        // 系统（行）划分与画布高度同源（renderBars / systems 见组件作用域 memo）。
        // ⚠️ 必须早于 staveWidth 计算 —— 宽度依赖本行实际小节数。
        const systemPlans = systems.length > 0 ? systems : planSystems({ bars: renderBars, startBar });
        // 谱表宽度按「本行实际小节数」计算：每小节至少 MIN_BAR_WIDTH。
        // 末行可能不满（按实际小节数算，不按名义值），避免最后一页被拉宽。
        // v3.2.0：调用方若给出 width（紧凑谱 / 分栏自适应），则取「不低于最低
        // 宽度」的可用宽 —— 否则 4 小节的紧凑谱在 1000px 面板里只占左侧 540px。
        const minStaveWidth = computeStaveWidth(systemPlans[0]?.bars ?? renderBars);
        const staveWidth = width
          ? Math.max(minStaveWidth, width - STAVE_PADDING_LEFT * 2)
          : minStaveWidth;
        // totalHeight 由渲染作用域的 useMemo 提供（唯一来源，见其注释）。

        const renderer = new VF.Renderer(container, VF.Renderer.Backends.SVG);
        renderer.resize(staveWidth + STAVE_PADDING_LEFT * 2, totalHeight);
        const context = renderer.getContext();

        // 逐小节等宽槽位：每个系统按自己的小节数生成槽位（含无音符小节）。
        // 可分配宽 = (staveX + staveWidth) - 首小节左缘 - 右侧留白。
        // 注意 slot.x 是 Stave 片段左缘，而非音符起始——谱号/拍号占位由 VexFlow
        // 在 getNoteStartX 内部处理，此处不额外扣减。
        const staveX = STAVE_PADDING_LEFT;
        const firstBarLeft = STAVE_PADDING_LEFT;
        const availableWidth = staveX + staveWidth - firstBarLeft - STAVE_RIGHT_PADDING;
        const systemHeight = staves.length * (STAVE_HEIGHT + STAVE_GAP);
        const lastBar = startBar + renderBars - 1;

        // D32-5：越界 bar 音符计数。旧实现把所有音符无差别塞进 groupedByBar，
        // 其中 bar <= 0 / 非整数 / bar > renderBars 的音符会被「静默丢弃」（既不
        // 画出来也无任何提示）。新实现改为渲染前显式统计并在结束时 warn 一次，
        // 使「丢弃」这一旧行为显式化 —— 不新增对外 prop，仅用于诊断。
        let outOfRangeBarCount = 0;

        // D32-5：越界小节（<1 / 非整数 / > lastBar）的**和弦组**计数。
        // 渲染循环直接跳过这些小节 —— 旧行为的「静默丢弃」在这里显式化。
        for (const byBar of groupsByStaffAndBar) {
          for (const barKey of Object.keys(byBar)) {
            const bar = Number(barKey);
            if (bar < 1 || !Number.isInteger(bar) || bar > lastBar) {
              outOfRangeBarCount += byBar[bar]!.length;
            }
          }
        }

        // 全部系统的小节槽位（按小节号顺序展平）+ 所属系统的纵向起点，
        // 用于上报锚点；单系统时不带纵向信息（锚点形状与改动前一致）。
        const allSlots: (BarSlot & { systemTop: number })[] = [];
        const multiSystem = systemPlans.length > 1;

        /**
         * 连音链：chain → 已绘制的 (span, StaveNote)。
         *
         * 连音线必须在**全部音符绘制完成之后**再画 —— `StaveTie` 要读音符的
         * 最终 x/y（`getTieRightX` / `getYs`）。所以这里先登记，等所有系统画完
         * 统一连线；跨行、跨页的连音也因此能正确落到音符上。
         */
        const chainNotes = new Map<
          string,
          { span: NoteSpan; note: InstanceType<typeof VF.StaveNote> }[]
        >();
        // 同谱表同小节同时发声超过 2 个声部的小节数（谱面会拥挤，仅作诊断）。
        let crowdedBarCount = 0;

        for (const system of systemPlans) {
          const systemTop = system.index * systemHeight;
          // v2.9.7：调号来自图 meta.key_map（tempoMap.keyAt），缺省 C major
          const currentKey: KeyDef = tempoMap
            ? (tempoMap.keyAt(system.startBar) as KeyDef)
            : { tonic: "C", mode: "major" };
          const slots = planBarSlots({
            startX: firstBarLeft,
            availableWidth,
            bars: system.bars,
            startBar: system.startBar,
          });
          allSlots.push(...slots.map((slot) => ({ ...slot, systemTop })));

          // 每小节拍号 + 是否相对前一小节发生变化。跨系统时用 startBar-1 的拍号
          // 作为前值，保证行首变拍号仍会被标注。
          let previousMeter =
            system.startBar > 1 ? meterAt(system.startBar - 1) : null;
          const slotMeters = slots.map((slot) => {
            const barMeter = meterAt(slot.bar);
            const changed =
              previousMeter === null ||
              previousMeter.numerator !== barMeter.numerator ||
              previousMeter.denominator !== barMeter.denominator;
            previousMeter = barMeter;
            return { meter: barMeter, changed };
          });

          // 本系统内每个谱表「第一小节」的 Stave（用于双谱表 BRACE 连接）。
          const vfStaves: InstanceType<typeof VF.Stave>[] = [];

          for (let staffIdx = 0; staffIdx < staves.length; staffIdx++) {
            const staff = staves[staffIdx];
            // 本谱表：小节号 → 已排布的 span（构建时已按起点排序）
            const spansByBar = engravingPlan.byStaff[staffIdx] ?? {};
            const yOffset = systemTop + staffIdx * (STAVE_HEIGHT + STAVE_GAP) + 30;
            // 休止符的符头锚点音高按谱号取（见 REST_KEY_BY_CLEF）。
            const restKey = restKeyFor(staff.clef);

            for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
              const slot = slots[slotIdx];
              const slotMeter = slotMeters[slotIdx]!;
              const barMeter = slotMeter.meter;
              // 每个小节一个独立 Stave 片段（x/y/width 取槽位），首尾相接拼成一行。
              const barStave = new VF.Stave(slot.x, yOffset, slot.width);

              // 小节线由 Stave 自带：首小节左缘无（BRACE/谱号所在），末小节右缘收尾，
              // 中间为单线。BarlineType 从 vexflow 命名空间取，禁止写死魔数。
              barStave.setBegBarType(slotIdx === 0 ? VF.BarlineType.NONE : VF.BarlineType.SINGLE);
              barStave.setEndBarType(
                slotIdx === slots.length - 1 ? VF.BarlineType.END : VF.BarlineType.SINGLE,
              );

              // v2.9.7 记谱规则（见 engraving.ts 来源注）：
              // - 谱号：**每个谱表**每行首小节都要挂（旧实现只挂 staff 0，
              //   低音谱表一直没有谱号 —— 用户指出的「不规范」之一）
              // - 调号：紧随谱号，每行每个谱表都要（key_map 驱动）
              // - 拍号：首小节与变拍号处标注；同一拍号不重复画。
              if (slotIdx === 0) {
                barStave.addClef(staff.clef);
                barStave.addKeySignature(vexflowKeySpec(currentKey));
              }
              if (slotMeter.changed && staffIdx === 0) {
                barStave.addTimeSignature(
                  `${barMeter.numerator}/${barMeter.denominator}`,
                );
              }

              barStave.setContext(context).draw();
              if (slotIdx === 0) vfStaves.push(barStave);

              // 空小节不再跳过 —— v2.9.7 规则③要求画全小节休止符（下方分支）。
              const barSpans = spansByBar[slot.bar] ?? [];
              const barLen = barLengthQn(barMeter);

              // v2.9.7 规则②：小节内临时记号状态机（Gould p.78 —— 小节内同八度
              // 同音名沿用、不重画；与调号一致不画；过小节线由新 context 复位）
              const accidentalState = new MeasureAccidentalState(
                keyAlterations(
                  tempoMap
                    ? (tempoMap.keyAt(slot.bar) as KeyDef)
                    : { tonic: "C", mode: "major" },
                ),
              );

              /**
               * 构造一个 StaveNote。
               *
               * ⚠️ 附点必须**同时**落到 ticks 与视觉修饰符上：`dots` 进 `StaveNote`
               * 构造参数才会改变 `getTicks()`；`Dot.buildAndAttach` 只加修饰符。
               * 旧实现只调后者 —— 谱面上是附点、tick 里没有，本小节后续音符整体前移。
               * `{ all: true }` 让和弦的每个音都带附点（旧实现只点第一个音）。
               */
              const buildNote = (
                span: NoteSpan,
                group: ScoredNoteGroup,
                voiceIdx: number,
                voiceCount: number,
              ) => {
                const keys = group.notes.map(
                  (note) =>
                    MIDI_TO_VF_KEY[note.pitchMidi] ?? `c/${Math.floor(note.pitchMidi / 12) - 1}`,
                );
                const staveNote = new VF.StaveNote({
                  clef: staff.clef,
                  keys,
                  duration: span.duration,
                  dots: span.dots,
                });
                if (span.dots > 0) VF.Dot.buildAndAttach([staveNote], { all: true });

                // 符干方向：多声部按声部（0 上 1 下，通行对位写法）；单声部按
                // 「离中线最远的音」。全音符（含附点全音符）无符干，不设方向。
                if (span.duration.startsWith("w")) {
                  // 无符干
                } else if (voiceCount > 1) {
                  staveNote.setStemDirection(voiceIdx === 0 ? VF.Stem.UP : VF.Stem.DOWN);
                } else {
                  const dir = stemDirection(
                    group.notes.map((n) => n.pitchMidi),
                    staff.clef,
                  );
                  staveNote.setStemDirection(dir === "up" ? VF.Stem.UP : VF.Stem.DOWN);
                }
                return staveNote;
              };

              if (barSpans.length === 0) {
                // v2.9.7 规则③：空小节画整小节休止符
                const rest = new VF.StaveNote({
                  clef: staff.clef,
                  keys: [restKey],
                  duration: "wr",
                });
                // 整小节休止符必须**居中**。Formatter 默认把唯一的 tickable 摆在
                // 可用区起点，谱面上看起来贴在小节线上（用户可见的排版错误）。
                // `setCenterAlignment` 让 Formatter 在 justify 后把它的中心补偿到
                // 可用宽的中点（见 Formatter.shiftToIdealDistances 的
                // getCenterAlignedTickables 分支）。
                rest.setCenterAlignment(true);
                const voice = new VF.Voice({
                  numBeats: barMeter.numerator,
                  beatValue: barMeter.denominator,
                });
                voice.setStrict(false);
                voice.addTickables([rest]);
                new VF.Formatter().joinVoices([voice]).format([voice], slot.width - 20);
                voice.draw(context, barStave);
              } else {
                // v3.3.0：同小节同谱表内按时值区间分声部（旧实现把重叠音符串行
                // 排成一条时间轴 → 第二个音被推到第 5 拍，整小节宽度翻倍）。
                const voiceLists = assignVoices(barSpans);
                if (voiceLists.length > 2) crowdedBarCount += 1;
                const voiceCount = voiceLists.length;
                const voiceObjs: InstanceType<typeof VF.Voice>[] = [];
                /**
                 * 每个声部的音符「可连梁候选」（时间位置 + 时值 + 音符对象）。
                 *
                 * ⚠️ 不能把所有音符直接丢给 `Beam.generateBeams`：它按 `groups`
                 * 分桶后，桶内只要有一个四分及更长的音就**整桶作废** —— 于是
                 * `q 8 8 q` 里那两个八分音符永远分不到梁。先经 `beamRuns` 切成
                 * 「首尾相接且短于四分」的片段，再逐段生成梁。
                 */
                const beamCandidatesByVoice: {
                  offset: number;
                  durQn: number;
                  note: InstanceType<typeof VF.StaveNote>;
                }[][] = [];
                /** 本小节已建好的音符，供「按时间顺序」补临时记号 */
                const drawn: {
                  span: NoteSpan;
                  note: InstanceType<typeof VF.StaveNote>;
                  pitch: number;
                }[] = [];

                for (let voiceIdx = 0; voiceIdx < voiceCount; voiceIdx++) {
                  const spansInVoice = voiceLists[voiceIdx]!;
                  const entries: {
                    offset: number;
                    note: InstanceType<typeof VF.StaveNote>;
                  }[] = [];
                  const beamCandidates: {
                    offset: number;
                    durQn: number;
                    note: InstanceType<typeof VF.StaveNote>;
                  }[] = [];

                  for (const span of spansInVoice) {
                    const group = engravingPlan.groups.get(span.chain);
                    if (!group) continue;
                    const note = buildNote(span, group, voiceIdx, voiceCount);
                    entries.push({ offset: span.offset, note });
                    beamCandidates.push({
                      offset: span.offset,
                      durQn: span.durQn,
                      note,
                    });
                    drawn.push({
                      span,
                      note,
                      pitch: group.notes[0]?.pitchMidi ?? 0,
                    });
                    // 连音链登记：同一逻辑音被跨小节/跨拍切成的各段，绘制后再连线
                    const chain = chainNotes.get(span.chain);
                    if (chain) chain.push({ span, note });
                    else chainNotes.set(span.chain, [{ span, note }]);
                  }

                  // 每个声部都要被休止填满整小节，否则 Formatter 按 tick 总量
                  // 摊开时会把这个声部挤到左侧、与另一声部错位。
                  for (const rest of fillVoiceRests(barLen, spansInVoice)) {
                    const note = new VF.StaveNote({
                      clef: staff.clef,
                      keys: [restKey],
                      duration: rest.duration,
                      // ⚠️ `type: "r"` 不能省：少了它 VexFlow 会把休止画成**实音**
                      // （带符干的半音符），谱面上凭空多出一条符干。
                      type: "r",
                      dots: rest.dots,
                    });
                    if (rest.dots > 0) VF.Dot.buildAndAttach([note], { all: true });
                    entries.push({ offset: rest.offset, note });
                  }

                  entries.sort((a, b) => a.offset - b.offset);
                  const vfNotes = entries.map((e) => e.note);
                  const voice = new VF.Voice({
                    numBeats: barMeter.numerator,
                    beatValue: barMeter.denominator,
                  });
                  voice.setStrict(false);
                  voice.addTickables(vfNotes);
                  voiceObjs.push(voice);
                  beamCandidatesByVoice.push(beamCandidates);
                }

                // 临时记号必须在 format 之前加（影响间距），且顺序必须是「时间顺序」：
                // 状态机按调用顺序记忆本小节已出现的升降，跨声部也要共用一份。
                drawn.sort(
                  (a, b) =>
                    a.span.offset - b.span.offset ||
                    a.pitch - b.pitch ||
                    a.span.index - b.span.index,
                );
                for (const { span, note } of drawn) {
                  const group = engravingPlan.groups.get(span.chain);
                  if (!group) continue;
                  group.notes.forEach((n, keyIndex) => {
                    const symbol = accidentalState.symbolFor(n.pitchMidi, n.pitchSpelling);
                    if (symbol) note.addModifier(new VF.Accidental(symbol), keyIndex);
                  });
                }

                // 多声部必须 joinVoices 后再 format —— 否则两个声部各排各的，
                // 同一拍的两个音不会纵向对齐。
                const formatter = new VF.Formatter();
                formatter.joinVoices(voiceObjs).format(voiceObjs, slot.width - 20);
                voiceObjs.forEach((voice) => voice.draw(context, barStave));

                // 梁按「声部 → 可连梁片段 → 拍组」三层切分：
                // - 声部：两个声部各自成梁，不能把上下声部的符干连起来；
                // - 片段（beamRuns）：四分及更长的音、休止造成的空隙都会断片，
                //   否则 generateBeams 会把「混了四分音符的整桶」判为不可连梁；
                // - 拍组（beamGroups）：4/4 半小节、6/8 附点四分 3/8、5/8 = 3+2 …
                const groups = beamGroups(barMeter.numerator, barMeter.denominator).map(
                  ([num, den]) => new VF.Fraction(num, den),
                );
                for (const candidates of beamCandidatesByVoice) {
                  for (const run of beamRuns(candidates)) {
                    if (run.length < 2) continue;
                    VF.Beam.generateBeams(
                      run.map((c) => c.note),
                      { groups },
                    ).forEach((beam) => beam.setContext(context).draw());
                  }
                }
              }
            }
          }

          if (staves.length >= 2 && vfStaves.length >= 2) {
            const connector = new VF.StaveConnector(vfStaves[0], vfStaves[1]);
            connector.setType(VF.StaveConnector.type.BRACE);
            connector.setContext(context).draw();
          }
        }

        // ── 连音线（tie）──
        //
        // 判据是**几何相邻**：同一逻辑音被跨小节线 / 跨拍点切成多段后，前一段的
        // 结束位置正好是后一段的起点（同小节）或小节末→下一小节首（跨小节）。
        // 绝不以「音高相同」为判据 —— 那样会把「同音高但中间有休止」的两个音
        // 连起来，语义就错了（这正是"连音识别错误"的一类）。
        const barLenOf = (bar: number) => barLengthQn(meterAt(bar));
        for (const list of chainNotes.values()) {
          if (list.length < 2) continue;
          list.sort((a, b) => a.span.bar - b.span.bar || a.span.offset - b.span.offset);
          for (let i = 0; i < list.length - 1; i++) {
            const from = list[i]!;
            const to = list[i + 1]!;
            if (!spansAreContiguous(from.span, to.span, barLenOf)) continue;
            const indexes = from.note.getKeys().map((_, k) => k);
            new VF.StaveTie({
              firstNote: from.note,
              lastNote: to.note,
              firstIndexes: indexes,
              lastIndexes: indexes.slice(),
            })
              .setContext(context)
              .draw();
          }
        }

        // D32-5：越界 bar 音符统计一次性告知（仅在有越界音符时输出，含条数）。
        // 这是对旧「静默丢弃」行为的显式化，不改变渲染结果、不新增对外 prop。
        if (outOfRangeBarCount > 0) {
          console.warn(
            `[ScoreRenderer] 忽略 ${outOfRangeBarCount} 个越界 bar 音符` +
              `（bar < 1 或非整数或 > ${lastBar}）。`,
          );
        }

        // 声部数超过 2 的小节：谱面可读性会下降（符干相撞），但每个音的
        // 时间位置与时值都是真的 —— 这里显式告警，不做静默篡改。
        if (crowdedBarCount > 0) {
          console.warn(
            `[ScoreRenderer] ${crowdedBarCount} 个小节在同谱表内同时发声超过 2 个声部` +
              `（谱面会拥挤，但时值未被篡改）。`,
          );
        }

        // 渲染成功后上报小节锚点（多谱表共用同一 bar→x，只上报一次）。
        // 渲染失败（异常 → catch）或被取消（cancelled）时不得回调。
        //
        // 按值去重：序列化比对，与上一次完全相同时既不再回调、也不 setState，
        // 否则「父组件用 state 接收锚点 → layout 身份变化 → 重排版 → 再回调」
        // 会形成永不收敛的自触发循环（S0 验证者实测 300ms 内 15 次回调）。
        if (!cancelled && currentRenderId === renderIdRef.current) {
          const nextAnchors: BarAnchor[] = allSlots.map((s) => {
            const anchor: BarAnchor = {
              bar: s.bar,
              x0: s.x,
              x1: s.x + s.width,
            };
            // 多系统：补上纵向区间，播放头才能落到正确那一行；单系统不填，
            // 保持 {bar,x0,x1} 的既有锚点形状（既有消费方逐字段读取，安全）。
            if (multiSystem) {
              anchor.y = s.systemTop;
              anchor.height = systemHeight;
            }
            return anchor;
          });
          const key = JSON.stringify(nextAnchors);
          if (key !== lastAnchorsKeyRef.current) {
            lastAnchorsKeyRef.current = key;
            setAnchors(nextAnchors);
            onBarAnchorsChangeRef.current?.(nextAnchors);
          }
        }
        if (!cancelled && currentRenderId === renderIdRef.current) {
          setRenderState("ready");
          setRenderError("");
        }
      } catch (err) {
        if (!cancelled && currentRenderId === renderIdRef.current) {
          const container = containerRef.current;
          if (container) container.innerHTML = "";
          setRenderState("error");
          setRenderError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [notes, engravingPlan, layout, meterAt, renderBars, totalHeight, startBar, systems, retryNonce, width]);

  const containerStyle: React.CSSProperties = {
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    width: width ? `${width}px` : undefined,
    height: height ? `${height}px` : undefined,
  };

  const hoverStyle: React.CSSProperties | undefined = hoverAnchor
    ? {
        left: `${hoverAnchor.x0 * scale}px`,
        width: `${(hoverAnchor.x1 - hoverAnchor.x0) * scale}px`,
        top: `${(hoverAnchor.y ?? 0) * scale}px`,
        height: `${(hoverAnchor.height ?? totalHeight) * scale}px`,
      }
    : undefined;

  const retryRender = () => {
    setRenderError("");
    setRetryNonce((n) => n + 1);
  };

  return (
    // 点击处理仅在有 onSeek 时绑定（undefined 而非空函数）→ 缺省零行为变化。
    <div
      className={`${styles.rendererContainer} ${paper ? styles.paper : ""} ${onSeek ? styles.seekable : ""}`}
      onClick={onSeek ? handleSeekClick : undefined}
      onPointerMove={onSeek ? handleHoverMove : undefined}
      onPointerLeave={onSeek ? () => setHoverBar(null) : undefined}
      aria-busy={renderState === "loading"}
      data-render-state={renderState}
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
        {hoverAnchor && (
          <div
            className={styles.hoverBand}
            style={hoverStyle}
            data-testid="score-hover-band"
            data-bar={hoverAnchor.bar}
          />
        )}
        <ScorePlayhead
          anchors={anchors}
          position={playheadPosition}
          scale={scale}
          beatsPerBarAt={beatsPerBarAt}
        />
      </div>

      {renderState === "loading" && (
        <div className={styles.renderSkeleton} aria-hidden="true">
          <span className={styles.skeletonStaff} />
          <span className={styles.skeletonStaff} />
        </div>
      )}

      {renderState === "error" && (
        <div className={`${styles.renderError} ${styles.errorPlaceholder}`} role="alert">
          <div className={styles.renderErrorTitle}>VexFlow 渲染失败</div>
          <div className={styles.renderErrorDetail}>{renderError}</div>
          <button type="button" className={styles.retryBtn} onClick={retryRender}>
            {t("score.retry")}
          </button>
        </div>
      )}
    </div>
  );
};
