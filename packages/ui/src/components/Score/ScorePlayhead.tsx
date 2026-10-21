/**
 * 谱面播放头覆盖层（Stage 1：只读跟随）。
 *
 * 设计取舍（对照 OSMD 的 cursorElement）：播放头是一个绝对定位的 DOM 元素，
 * 而非画进 VexFlow 的 SVG。原因：
 *  1. VexFlow 每次重排版会 `container.innerHTML = ""`，画进去的播放头会被抹掉，
 *     必须随每次渲染重建 —— 而播放头随传输位置高频更新，重建 SVG 代价过高。
 *  2. DOM 元素可由 React 单独按 position 更新 left，不必触发谱面重排版。
 *
 * 坐标系：x 由 `playheadX` 在「未缩放的 VexFlow 坐标」上插值后 **乘 scale**，
 * 因此覆盖层位于被 `transform: scale()` 的画布之外（否则会二次缩放）。覆盖层的
 * 绝对定位基准是 ScoreRenderer 内 `position: relative` 的 `.rendererStack`。
 *
 * 高度（v2.3.0 S4b / D34-5）：**由 ScoreRenderer 显式设定**基准层
 * （`.rendererStack` 的高度 = 画布未缩放布局高 × scale = 画布可视高），本组件只用
 * CSS `top:0;bottom:0` 撑满——不再内联任何与 scale 相关的相对高度（旧写法是
 * `scale===1 ? '100%' : `${scale*100}%`` 的死分支 + 相对 `min-height:100%` 的启发式）。
 */
import React from "react";
import type { BarAnchor } from "./bar-anchors";
import styles from "./ScorePlayhead.module.css";

export interface ScorePlayheadProps {
  /** 来自 ScoreRenderer 的 onBarAnchorsChange（未缩放坐标）。 */
  anchors: BarAnchor[];
  /** 播放位置；null/undefined → 不渲染任何覆盖层 DOM。 */
  position?: { bar: number; beat: number } | null;
  /** 与 ScoreRenderer 的 scale 同源（画布 transform: scale(scale)）。 */
  scale?: number;
  /** 拍号派生：某小节的拍数。缺省 () => 4。 */
  beatsPerBarAt?: (bar: number) => number;
}

/**
 * 播放头 x 纯函数（导出以便单测）。
 *
 * 语义：找到 `position.bar` 对应锚点；`fraction = (beat - 1) / beatsPerBarAt(bar)`
 * （beat 从 1 起、允许小数），`x = (x0 + fraction * (x1 - x0)) * scale`；
 * 找不到该 bar 的锚点 → 返回 null。
 */
export function playheadX(
  anchors: BarAnchor[],
  position: { bar: number; beat: number },
  beatsPerBarAt: (bar: number) => number,
  scale: number,
): number | null {
  const anchor = anchors.find((a) => a.bar === position.bar);
  if (!anchor) return null;
  const beats = beatsPerBarAt(position.bar);
  const fraction = (position.beat - 1) / beats;
  return (anchor.x0 + fraction * (anchor.x1 - anchor.x0)) * scale;
}

export const ScorePlayhead: React.FC<ScorePlayheadProps> = ({
  anchors,
  position,
  scale = 1,
  beatsPerBarAt = () => 4,
}) => {
  // 无播放位置或该小节无锚点 → 零新增 DOM。
  if (!position) return null;
  const x = playheadX(anchors, position, beatsPerBarAt, scale);
  if (x === null) return null;

  // 多系统谱面：锚点带纵向区间（y / height）时把竖线限制在所在那一行系统内，
  // 否则竖线会横穿全部系统、指不清是哪一行。单系统锚点不带这两个字段 → 沿用
  // CSS 的 `.line { top:0; bottom:0 }`（铺满画布），行为与改动前完全一致。
  const anchor = anchors.find((a) => a.bar === position.bar);
  const systemStyle: React.CSSProperties | undefined =
    anchor && anchor.y !== undefined && anchor.height !== undefined
      ? { top: `${anchor.y * scale}px`, height: `${anchor.height * scale}px` }
      : undefined;

  // v2.3.0 S4b (D34-5)：覆盖层高度**不再由本组件猜测**。旧实现内联
  // `height: scale === 1 ? '100%' : `${scale*100}%``——两个分支值相等（1*100 === 100）
  // 属死代码，且相对的是 `.rendererStack` 的 `min-height:100%`（可能等于容器而非
  // 画布），容器比谱面高时覆盖层会越出。
  // 现在由 ScoreRenderer 把 `.rendererStack` 的高度显式设为 `totalHeight × scale`
  // （画布可视高；`transform: scale()` 不改变布局盒），本层用 CSS 的
  // `.layer { top: 0; bottom: 0 }` 撑满该基准即可 —— 高度是解析式，非启发式。
  return (
    <div className={styles.layer} data-testid="score-playhead-layer">
      <div
        className={styles.line}
        style={{ left: `${x}px`, ...systemStyle }}
        data-testid="score-playhead"
      />
    </div>
  );
};
