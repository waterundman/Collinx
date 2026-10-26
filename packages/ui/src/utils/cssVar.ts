/**
 * v3.0.0 A7：CSS 令牌读取的唯一出口。
 *
 * 此前 7 个组件各自复制了一份 `getCSSVar`（GraphView / NodeDetail /
 * TasteDiffPanel / TasteTimelineView / ArrangementView / ArrangerPanel /
 * PianoRollView），复制体一旦有人改成 `document.body` 或去掉 trim，
 * canvas 取色就会与 CSS 令牌悄悄分叉。
 *
 * 注意：这是**纯函数**而非 hook —— 全部调用点都在 canvas 绘制 effect 里，
 * 用 hook 语义不符且会引入额外依赖。
 */
export function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** 带兜底值的版本：令牌缺失时返回 fallback，避免 canvas 画出透明色。 */
export function getCSSVarOr(name: string, fallback: string): string {
  return getCSSVar(name) || fallback;
}
