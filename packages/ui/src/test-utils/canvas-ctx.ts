/**
 * 共享 canvas 录制基建（v2.0.0 S5 / D5-1 / T24 抽取）。
 *
 * 背景：v1.27.0 起，canvas 的 draw-call 断言（`PianoRollView` 光标 / 量化网格 /
 * 播放头，`MidiInputLoop` 录入闭环）依赖同一个"录制型 2D context"——它把每次
 * 方法调用与属性赋值都记进 `calls`，供测试对**调用序列**做断言（而非像素比对）。
 * 该实现此前在 **3 处逐字节重复**（`components/PianoRoll/__tests__/
 * PianoRollView.test.tsx` 1 处 + `__tests__/MidiInputLoop.test.tsx` 2 处），
 * 已达提取临界，故抽到本模块共享。
 *
 * 行为等价约束（T24 验收）：抽取**不得改变录制出的调用序列**——`PianoRollView.test.tsx`
 * 的 `S1-T09` 以 v1.29 录制的 388 条 golden（`fixtures/pianoRollDrawCalls.cursorOnly.json`）
 * 做逐字节比对，任何录制行为差异都会使其变红。
 *
 * v2.0.0 后置补全（2026-09-14）：断言辅助函数 `frames()` / `lastFrame()` /
 * `verticalLineXsIn()` / `trianglesIn()` / `cursorLabelsIn()` / `positionLabelsIn()`
 * 此前在各 describe 内**重复声明 15 次**（每个名字体逐字节相同），现并入
 * `createRecordedCanvas()` 工厂返回——工厂闭包持有 `calls`，故各 helper 保持**零参**
 * 签名，调用点无需改动。
 *
 * `verticalLineXsIn` 体引用 describe 局部的 `CANVAS_H`；当前 6 个 site 全部为 600，
 * 故工厂以 `canvasH` 形参承载（默认 600）。未来若某 site 用不同画布高，显式传入即可。
 */

/** 单条录制记录：方法调用（op = 方法名）或属性赋值（op = `set:<prop>`）。 */
export type DrawCall = { op: string; args: unknown[] };

/**
 * 构造一个"录制型" CanvasRenderingContext2D 桩。
 *
 * - 白名单方法（见下 `methods`）被调用时追加 `{ op, args }`；
 * - `createLinearGradient` 额外返回带 `addColorStop` 的桩对象（渐变场景不抛错）；
 * - **属性赋值**经 Proxy `set` 拦截，记为 `{ op: "set:<prop>", args: [value] }`；
 * - 未在 `target` 上的读返回 `undefined`（避免抛错）。
 *
 * 返回的 `ctx` 可直接喂给 `HTMLCanvasElement.prototype.getContext` 的 mock。
 */
export function createRecordingCtx(): {
  ctx: CanvasRenderingContext2D;
  calls: DrawCall[];
} {
  const calls: DrawCall[] = [];
  const methods = [
    "scale",
    "clearRect",
    "fillRect",
    "beginPath",
    "moveTo",
    "lineTo",
    "stroke",
    "fill",
    "fillText",
    "closePath",
    "quadraticCurveTo",
  ];
  const target: Record<string, unknown> = {};
  for (const m of methods) {
    target[m] = (...args: unknown[]) => {
      calls.push({ op: m, args });
    };
  }
  target.createLinearGradient = (...args: unknown[]) => {
    calls.push({ op: "createLinearGradient", args });
    return { addColorStop: () => {} };
  };
  const ctx = new Proxy(target, {
    get(t, prop) {
      if (typeof prop === "string" && prop in t) return t[prop];
      return undefined;
    },
    set(t, prop, value) {
      calls.push({ op: `set:${String(prop)}`, args: [value] });
      Reflect.set(t, prop, value);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}


/** 时间轴/网格断言辅助函数所需画布高度（各 site 现均为 600）。 */
export const DEFAULT_RECORDING_CANVAS_H = 600;

/**
 * 录制型 canvas ctx + 一组绑定其 `calls` 的断言辅助函数（工厂）。
 *
 * 与直接调用 `createRecordingCtx()` 相比，本工厂额外返回 6 个 helper；它们闭包持有
 * 本次录制的 `calls`，因此**逐个 describe 只应创建一个实例**（不要把多个实例的
 * helper 混用）。helper 语义见各函数上的注释。
 */
export function createRecordedCanvas(canvasH: number = DEFAULT_RECORDING_CANVAS_H): {
  ctx: CanvasRenderingContext2D;
  calls: DrawCall[];
  frames: () => DrawCall[][];
  lastFrame: () => DrawCall[];
  verticalLineXsIn: (frame: DrawCall[]) => number[];
  trianglesIn: (frame: DrawCall[]) => { apex: number[]; left: number[]; right: number[] }[];
  cursorLabelsIn: (frame: DrawCall[]) => { text: string; x: number; y: number }[];
  positionLabelsIn: (frame: DrawCall[]) => { text: string; x: number; y: number }[];
} {
  const { ctx, calls } = createRecordingCtx();

  /** 按 `scale` 调用切帧（每次 drawCanvas 以 scale 起始）。 */
  function frames(): DrawCall[][] {
    const out: DrawCall[][] = [];
    let cur: DrawCall[] | null = null;
    for (const c of calls) {
      if (c.op === "scale") {
        cur = [];
        out.push(cur);
      }
      if (cur) cur.push(c);
    }
    return out;
  }

  function lastFrame(): DrawCall[] {
    const fs = frames();
    return fs.length > 0 ? fs[fs.length - 1] : [];
  }

  /** 竖线绘制（moveTo(x, 0) + lineTo(x, h)）：网格线与 cursor 竖线共用此模式。 */
  function verticalLineXsIn(frame: DrawCall[]): number[] {
    const xs: number[] = [];
    for (let i = 0; i < frame.length; i++) {
      const c = frame[i];
      if (
        c.op === "moveTo" &&
        c.args[1] === 0 &&
        frame[i + 1]?.op === "lineTo" &&
        frame[i + 1].args[0] === c.args[0] &&
        frame[i + 1].args[1] === canvasH
      ) {
        xs.push(Number(c.args[0]));
      }
    }
    return xs;
  }

  /** 倒三角序列：moveTo(apex, 8) -> lineTo(left, 0) -> lineTo(right, 0) -> closePath -> fill。 */
  function trianglesIn(frame: DrawCall[]) {
    const out: { apex: number[]; left: number[]; right: number[] }[] = [];
    for (let i = 0; i < frame.length; i++) {
      const m = frame[i];
      const l1 = frame[i + 1];
      const l2 = frame[i + 2];
      if (
        m?.op === "moveTo" &&
        m.args[1] === 8 &&
        l1?.op === "lineTo" &&
        l1.args[1] === 0 &&
        l2?.op === "lineTo" &&
        l2.args[1] === 0 &&
        frame[i + 3]?.op === "closePath" &&
        frame[i + 4]?.op === "fill"
      ) {
        out.push({
          apex: m.args as number[],
          left: l1.args as number[],
          right: l2.args as number[],
        });
      }
    }
    return out;
  }

  /** cursor 位置标签（m{bar}.{beat}）及其 x/y。 */
  function cursorLabelsIn(frame: DrawCall[]) {
    return frame
      .filter((c) => c.op === "fillText" && /^m\d+\.\d+$/.test(String(c.args[0])))
      .map((c) => ({
        text: String(c.args[0]),
        x: Number(c.args[1]),
        y: Number(c.args[2]),
      }));
  }

  /** 位置标签（m{bar}.{beat}）及其 x/y。原实现与 cursorLabelsIn 体完全相同。 */
  function positionLabelsIn(frame: DrawCall[]) {
    return frame
      .filter((c) => c.op === "fillText" && /^m\d+\.\d+$/.test(String(c.args[0])))
      .map((c) => ({
        text: String(c.args[0]),
        x: Number(c.args[1]),
        y: Number(c.args[2]),
      }));
  }

  return {
    ctx, calls, frames, lastFrame, verticalLineXsIn, trianglesIn, cursorLabelsIn, positionLabelsIn,
  };
}
