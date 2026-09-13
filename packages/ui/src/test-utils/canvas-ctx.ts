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
 * ⚠️ 已知遗留（不在 T24 范围，登记供后续清理）：`frames()` / `verticalLineXsIn()` /
 * `trianglesIn()` / `cursorLabelsIn()` / `positionLabelsIn()` 这几个**断言辅助函数**
 * 同样是复制的（两文件中共声明 8 次），本次未一并抽取——它们的调用面更广、各 describe
 * 的取用子集不同，合并需逐个比对，故留待单独一次重构。
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
