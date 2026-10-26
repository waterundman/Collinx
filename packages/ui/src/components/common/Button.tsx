import React from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "ghost" | "danger";

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  variant?: ButtonVariant;
  /** 测试锚点。保留 `data-testid`，不改既有 e2e 契约。 */
  testId?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * v3.0.0 S3：动作按钮的三档视觉。
 *
 * 起因：全仓 20 个自造按钮类（toolbarBtn / actionBtn / addTrackBtn /
 * clearBtn / pageBtn / modalBtn…），主次全靠各视图自己发挥，于是出现了
 * 「一屏六个等权导出按钮」和「整页没有一个主动作」两种极端。
 *
 * 朴素约束：只用底色区分主次，不加阴影、不加渐变、不做位移；
 * `primary` 每屏**只允许出现一个**（S3 验收口径）。
 */
export const Button: React.FC<ButtonProps> = ({
  variant = "ghost",
  testId,
  className,
  children,
  type = "button",
  ...rest
}) => (
  <button
    type={type}
    className={[styles.base, styles[variant], className].filter(Boolean).join(" ")}
    data-testid={testId}
    {...rest}
  >
    {children}
  </button>
);

export default Button;
