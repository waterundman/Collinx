/**
 * 乐谱小节级排版几何纯函数（无 VexFlow 依赖）。
 *
 * 抽离原因：`import("vexflow")` 在 jsdom 测试环境下不保证可用，因此小节槽位
 * 规划与锚点几何必须经由不依赖 VexFlow 的纯函数表达，才能被单测有效覆盖。
 *
 * 几何不变量（调用方与测试均依赖）：
 *  1. slots.length === bars。
 *  2. 相邻槽位连续：slot[k].x + slot[k].width === slot[k+1].x（容差 1e-9）。
 *  3. 所有 slot.width 彼此严格相等（容差 1e-9）。
 *  4. 槽位 x 用乘法 startX + k * barWidth 计算，禁止循环浮点累加——
 *     7/8 等小数宽度下逐次累加会漂移（见测试负控）。
 *  5. barlineXs 严格递增且无重复；首尾各一 + 相邻共享边界只出现一次，
 *     结果长度 === bars + 1。
 */

export interface BarAnchor {
  bar: number;
  x0: number;
  x1: number;
}

export interface BarSlot {
  bar: number;
  x: number;
  width: number;
}

/**
 * 逐小节等宽槽位规划。
 *
 * @param opts.startX         首小节左缘 x（= 谱表 x）。注意 slot.x 是 Stave 片段
 *                            左缘而非音符起始——谱号/拍号占位由 VexFlow 内部处理。
 * @param opts.availableWidth 可分配总宽（已扣除左侧谱号/拍号占位与右侧留白）。
 * @param opts.bars           小节数（>= 1）。
 */
export function planBarSlots(opts: {
  startX: number;
  availableWidth: number;
  bars: number;
}): BarSlot[] {
  const { startX, availableWidth, bars } = opts;
  const barWidth = availableWidth / bars;
  const slots: BarSlot[] = [];
  for (let k = 0; k < bars; k++) {
    // 用乘法而非逐次累加：保证全部落点共享同一浮点前缀，避免累加漂移。
    slots.push({ bar: k + 1, x: startX + k * barWidth, width: barWidth });
  }
  return slots;
}

/**
 * 槽位 → 小节线 x 序列。
 *
 * 结果 = [slots[0].x, slots[0].x + w, slots[1].x + w, ...]（相邻共享边界只出现
 * 一次），严格递增，长度 === slots.length + 1。空槽位返回 []。
 */
export function barlineXs(slots: BarSlot[]): number[] {
  if (slots.length === 0) return [];
  const xs: number[] = [slots[0].x];
  for (const slot of slots) {
    xs.push(slot.x + slot.width);
  }
  return xs;
}

/**
 * 点击反演纯函数：未缩放内容坐标 x → `{ bar, beat }`（Stage 2）。
 *
 * 与 ScorePlayhead.playheadX 互逆（见 T50 往返用例）：playheadX 把 `beat` 经
 * `fraction = (beat - 1) / beatsPerBarAt(bar)` 映射到 x，本函数把 x 经
 * `fraction = (localX - x0) / (x1 - x0)` 反解回 `beat = 1 + fraction * beatsPerBarAt(bar)`。
 *
 * 语义：
 *  - 命中：在 `anchors` 中按 `[x0, x1)` 定位小节；小节内 fraction 钳制到 [0,1]。
 *  - 越界：`localX` 落在首锚点 x0 左侧 → 钳制到首小节 `beat = 1`；
 *    落在末锚点 x1 之外 → 钳制到末小节 `beat = beatsPerBarAt(last)`。
 *    `clamp === false` 时两种越界均返回 `null`。
 *
 * 守卫（硬要求，任一命中即返回 `null`，绝不产出 NaN/Infinity 的 beat）：
 *  - `anchors` 为空；
 *  - `localX` 非有限（NaN/Infinity）；
 *  - 任一锚点 `x1 <= x0`（或坐标非有限）——零宽/塌缩锚点无法定位；
 *  - 命中/钳制目标小节的 `beatsPerBarAt(bar)` 返回 `<= 0` 或非有限。
 */
export function barBeatFromX(opts: {
  anchors: BarAnchor[];
  /** 点击点相对「未缩放内容坐标系」的 x（调用方须先完成 scale/scrollLeft 换算）。 */
  localX: number;
  /** 某小节的四分音符拍数；缺省实现应返回正有限值。 */
  beatsPerBarAt: (bar: number) => number;
  /** 越界是否钳制到首/末小节；默认 true。 */
  clamp?: boolean;
}): { bar: number; beat: number } | null {
  const { anchors, localX, beatsPerBarAt, clamp = true } = opts;

  if (!anchors || anchors.length === 0) return null;
  if (!Number.isFinite(localX)) return null;

  // 全部锚点必须为有效区间（有限坐标且 x1 > x0）；含零宽/塌缩锚点即整体拒绝。
  for (const a of anchors) {
    if (!Number.isFinite(a.x0) || !Number.isFinite(a.x1) || a.x1 <= a.x0) return null;
  }

  const beatsOf = (bar: number): number | null => {
    const beats = beatsPerBarAt(bar);
    if (!Number.isFinite(beats) || beats <= 0) return null;
    return beats;
  };

  const first = anchors[0];
  const last = anchors[anchors.length - 1];

  // 首锚点左侧：钳制到首小节左缘（beat = 1）。
  if (localX < first.x0) {
    if (!clamp) return null;
    if (beatsOf(first.bar) === null) return null;
    return { bar: first.bar, beat: 1 };
  }

  // 末锚点 x1 之外（含恰好落在 x1 上）：钳制到末小节右缘（beat = beatsPerBarAt(last)）。
  if (localX >= last.x1) {
    if (!clamp) return null;
    const beats = beatsOf(last.bar);
    if (beats === null) return null;
    return { bar: last.bar, beat: beats };
  }

  // 命中区间 [x0, x1)。
  const anchor = anchors.find((a) => localX >= a.x0 && localX < a.x1);
  if (!anchor) return null;

  const beats = beatsOf(anchor.bar);
  if (beats === null) return null;

  let fraction = (localX - anchor.x0) / (anchor.x1 - anchor.x0);
  if (fraction < 0) fraction = 0;
  else if (fraction > 1) fraction = 1;

  return { bar: anchor.bar, beat: 1 + fraction * beats };
}
