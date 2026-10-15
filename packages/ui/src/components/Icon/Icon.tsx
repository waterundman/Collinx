import React from "react";

/**
 * v2.5.0：统一线性图标系统。
 *
 * 取代此前的 emoji（🤖 / 💬 / 🎵 / 🎛 …）—— emoji 在不同平台渲染差异大、
 * 颜色不受主题控制、且与专业音频工作站的视觉语言不符。
 * 全部图标为 `currentColor` 线性笔画，随文字色与主题自动适配。
 */
export type IconName =
  | "spark"
  | "user"
  | "chat"
  | "note"
  | "sliders"
  | "check"
  | "close"
  | "alert"
  | "stop"
  | "send"
  | "refresh"
  | "wave"
  | "layers"
  | "play"
  | "pause"
  | "record"
  | "loop"
  | "star"
  | "chevronDown"
  | "chevronRight";

export interface IconProps {
  name: IconName;
  /** 边长（px），默认 16 */
  size?: number;
  className?: string;
  /** 笔画粗细，默认 1.75（24 视口下） */
  strokeWidth?: number;
  "aria-hidden"?: boolean;
}

const PATHS: Record<IconName, React.ReactNode> = {
  // AI 代理：四角星芒（"生成/智能"的通用隐喻，非 emoji）
  spark: (
    <>
      <path d="M12 3.2 13.9 9 19.8 10.9 13.9 12.8 12 18.6 10.1 12.8 4.2 10.9 10.1 9Z" />
      <path d="M18.4 16.2 19.1 18.3 21.2 19 19.1 19.7 18.4 21.8 17.7 19.7 15.6 19 17.7 18.3Z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.2 20c.6-3.5 3.4-5.6 6.8-5.6s6.2 2.1 6.8 5.6" />
    </>
  ),
  chat: (
    <>
      <path d="M4.5 6.2h15v9.4h-8.1L7.2 19v-3.4H4.5z" />
      <path d="M8.6 10.4h6.8" />
      <path d="M8.6 12.6h4.2" />
    </>
  ),
  note: (
    <>
      <path d="M9.5 17.5V6.8l8-1.6v10.7" />
      <ellipse cx="7.6" cy="17.8" rx="1.9" ry="1.6" />
      <ellipse cx="15.6" cy="16.2" rx="1.9" ry="1.6" />
    </>
  ),
  sliders: (
    <>
      <path d="M5 8.5h14M5 15.5h14" />
      <circle cx="9.5" cy="8.5" r="2.1" />
      <circle cx="14.8" cy="15.5" r="2.1" />
    </>
  ),
  check: <path d="M5.4 12.6 10 17.2 18.8 7.4" />,
  close: <path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4" />,
  alert: (
    <>
      <path d="M12 4.6 20.4 19H3.6z" />
      <path d="M12 10v3.6M12 16.4v.1" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="1.4" />,
  send: <path d="M4.8 12 19.2 5.4 13.4 19.2 11.6 13.4z" />,
  refresh: (
    <>
      <path d="M19 12a7 7 0 1 1-2.3-5.2" />
      <path d="M19.4 4.8v4.2h-4.2" />
    </>
  ),
  wave: (
    <>
      <path d="M3.6 12h2.2l1.6-4.4L10 16.4l2.2-6.6L14 12h6.4" />
    </>
  ),
  layers: (
    <>
      <path d="M12 4.4 20 8.6 12 12.8 4 8.6z" />
      <path d="M4 13.2 12 17.4 20 13.2" />
    </>
  ),
  // 运输控件：实心三角/双竖条（比字符 ▶ / ❚❚ 更可控，且随主题着色）
  play: <path d="M8 5.2 19 12 8 18.8z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="7.6" y="5.6" width="3" height="12.8" rx="0.8" fill="currentColor" stroke="none" />
      <rect x="13.4" y="5.6" width="3" height="12.8" rx="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  chevronDown: <path d="M6.4 9.6 12 15.2 17.6 9.6" />,
  chevronRight: <path d="M9.6 6.4 15.2 12 9.6 17.6" />,
  // 走带录制键：实心圆（比字面 ○ / ● 更可控）
  record: <circle cx="12" cy="12" r="5.2" fill="currentColor" stroke="none" />,
  // 循环：带箭头的闭环
  loop: (
    <>
      <path d="M6.2 9.4h9.1a3.2 3.2 0 0 1 0 6.4H8.2" />
      <path d="M8.6 6.8 6 9.4l2.6 2.6" />
      <path d="M15.4 13.4 18 16l-2.6 2.6" />
    </>
  ),
  // 置信度星级
  star: (
    <path d="M12 4.6 14.1 9.9 19.8 10.3 15.4 13.9 16.8 19.4 12 16.3 7.2 19.4 8.6 13.9 4.2 10.3 9.9 9.9Z" />
  ),
};

export const Icon: React.FC<IconProps> = ({
  name,
  size = 16,
  className,
  strokeWidth = 1.75,
  ...rest
}) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    role="img"
    aria-hidden={rest["aria-hidden"] ?? false}
    focusable="false"
  >
    {PATHS[name]}
  </svg>
);

export default Icon;
