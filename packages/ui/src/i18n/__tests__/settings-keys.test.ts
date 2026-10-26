import { describe, it, expect } from "vitest";
import i18n from "../index";

/**
 * v3.1.0：设置导航与新增分区的 key 必须真的能解析。
 *
 * 起因（点击审计实测）：`settings.plugins` 在 zh-CN.json 里被定义了两次 ——
 * 先是本轮新增的对象 `{ title, intro, ... }`，后面还留着旧的字符串
 * `"plugins": "插件管理"`。JSON.parse 保留最后一个，于是对象被字符串**静默覆盖**，
 * 设置侧栏直接显示 `settings.plugins.title` 这种原始 key。
 *
 * 语言对称性测试抓不到它（两边都是同样的字符串），所以这里从 **t() 层**断言：
 * 解析结果不能等于 key 本身。
 */

const NAV_KEYS = [
  "settings.general.title",
  "settings.audio.title",
  "settings.midi.title",
  "settings.mixing.title",
  "settings.notation.title",
  "settings.agent.title",
  "settings.taste.title",
  "settings.plugins.title",
];

const PLUGIN_SECTION_KEYS = [
  "settings.plugins.intro",
  "settings.plugins.unavailable",
  "settings.plugins.scanPaths",
  "settings.plugins.scan",
  "settings.plugins.scanning",
  "settings.plugins.results",
  "settings.plugins.empty",
  "settings.plugins.load",
  "settings.plugins.loadUnavailable",
];

const MIDI_EFFECT_KEYS = [
  "settings.midi.effects",
  "settings.midi.effectsHint",
  "settings.midi.effectsEmpty",
  "settings.midi.effectTranspose",
  "settings.midi.effectVelocity",
];

const AB_KEYS = [
  "app.taste.abToggle",
  "app.taste.abCurrent",
  "app.taste.abEmpty",
  "app.taste.abRecord",
];

const ALL = [...NAV_KEYS, ...PLUGIN_SECTION_KEYS, ...MIDI_EFFECT_KEYS, ...AB_KEYS];

describe("i18n: v3.1.0 新增 key 可解析", () => {
  for (const lng of ["zh-CN", "en"]) {
    it(`${lng}: 所有新增 key 都不回落到 key 本身`, () => {
      const missing = ALL.filter((k) => {
        const v = i18n.getFixedT(lng)(k);
        return typeof v !== "string" || v === k || v.trim() === "";
      });
      expect(missing).toEqual([]);
    });
  }

  it("settings.plugins 仍是对象（未被旧字符串键覆盖）", () => {
    // 若有人再往同一个对象里加一个 "plugins": "..." 字符串，JSON.parse 会取后者，
    // 这里就会红 —— 这是本轮实际踩到的坑。
    for (const lng of ["zh-CN", "en"] as const) {
      const bundle = i18n.getResourceBundle(lng, "translation") as Record<string, unknown>;
      const settings = bundle.settings as Record<string, unknown>;
      expect(typeof settings.plugins).toBe("object");
    }
  });
});
