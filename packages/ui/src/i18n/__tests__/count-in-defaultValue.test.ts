/**
 * v2.0.0 Stage 4（S4）：count-in 文案兜底一致性（T-S4-4，P3）。
 *
 * TransportBar 中 `t("transport.countIn", { defaultValue: "..." })` 的 defaultValue
 * 必须与 zh locale 的 `transport.countIn`（"预备…"）一致 —— 旧实现写成
 * "准备中…" 与 locale 不一致。保留 `{defaultValue}` 形式（禁用 `t(k) || '默认'`
 * 死兜底）。源码文本断言：直接验证 defaultValue 字面量 == locale 字面量。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import zh from "../locales/zh-CN.json";

const here = dirname(fileURLToPath(import.meta.url));

describe("i18n count-in 文案兜底一致性 (v2.0.0 S4 / T-S4-4)", () => {
  it("T-S4-4: TransportBar 的 transport.countIn defaultValue 与 zh locale 一致，且用 {defaultValue} 形式", () => {
    const src = readFileSync(
      resolve(here, "../../components/Transport/TransportBar.tsx"),
      "utf-8"
    );
    const zhValue = (zh as { transport: { countIn: string } }).transport.countIn;
    expect(zhValue).toBeTruthy();

    // 提取 t("transport.countIn", { defaultValue: "..." }) 中的 defaultValue 字面量
    const m = src.match(
      /t\(\s*["']transport\.countIn["']\s*,\s*\{\s*defaultValue:\s*["']([^"']*)["']/
    );
    expect(m).not.toBeNull();
    const defaultValue = m![1]!;

    // 禁用死兜底：不得出现 t("transport.countIn") || '默认' 形式
    expect(src).not.toMatch(/t\(\s*["']transport\.countIn["']\s*\)\s*\|\|/);

    // defaultValue 必须与 zh locale 字面量一致
    expect(defaultValue).toBe(zhValue);
  });
});
