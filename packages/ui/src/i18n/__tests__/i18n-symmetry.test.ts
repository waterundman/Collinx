import { describe, it, expect } from "vitest";
import en from "../locales/en.json";
import zh from "../locales/zh-CN.json";

/** v1.18 lesson: i18n "双语齐备" = key-structure symmetry, not just single-side
 *  grep. A missing key on one side silently falls back to the other language
 *  or to a hard-coded string, so tests pass but the UI shows the wrong text.
 *  This test recursively walks both locale trees and asserts every leaf key
 *  exists on both sides with the same nesting. */
function collectKeys(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      out.push(...collectKeys(v, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function missingKeys(a: unknown, b: unknown): string[] {
  const aKeys = new Set(collectKeys(a));
  const bKeys = new Set(collectKeys(b));
  return [...aKeys].filter((k) => !bKeys.has(k));
}

describe("i18n locale symmetry (v1.23.0 Stage 1: D2-4)", () => {
  it("S1-T04a: en/zh 递归键对称 — missing:[] (critical)", () => {
    const missingInZh = missingKeys(en, zh);
    const missingInEn = missingKeys(zh, en);

    expect(missingInZh).toEqual([]);
    expect(missingInEn).toEqual([]);
  });

  it("S1-T04b: arranger 空态/错误 + settings.device 空态键存在 (critical)", () => {
    // arranger.emptyState / arranger.runFailed (D2-2)
    expect(
      (en as { arranger: Record<string, unknown> }).arranger.emptyState
    ).toBeTruthy();
    expect(
      (zh as { arranger: Record<string, unknown> }).arranger.emptyState
    ).toBeTruthy();
    expect(
      (en as { arranger: Record<string, unknown> }).arranger.runFailed
    ).toBeTruthy();
    expect(
      (zh as { arranger: Record<string, unknown> }).arranger.runFailed
    ).toBeTruthy();

    // settings.device.* (D2-3) — nested under `settings` on both sides.
    const enDevice = (en as { settings: Record<string, unknown> }).settings
      .device as Record<string, unknown> | undefined;
    const zhDevice = (zh as { settings: Record<string, unknown> }).settings
      .device as Record<string, unknown> | undefined;
    expect(enDevice).toBeDefined();
    expect(zhDevice).toBeDefined();
    expect(enDevice!.empty).toBeTruthy();
    expect(zhDevice!.empty).toBeTruthy();
  });
});
