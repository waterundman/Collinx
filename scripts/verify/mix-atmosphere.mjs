/**
 * v2.9.6 混音氛围会话：以 v2.9.5 的悲伤钢琴曲为基底，用真实点击做出
 * 「奇幻艺术氛围」混音，并给出数值证据。
 *
 * 路径（全部用户可达交互）：
 *   1. 加载 sad-piano.agentmusic
 *   2. 和弦轨点「AI 混音建议」（MixingAgent → warm EQ + small-room reverb 提案）
 *   3. Agent 面板批准应用（真实审批闭环）
 *   4. 回混音台手调：reverb mix 0.45；加一轨 Delay（+FX → 类型切 DLY）mix 0.3
 *   5. 导出 atmosphere.wav
 *   6. 数值验收：与基线 sad-piano.wav 比 —— 尾音能量显著上升（reverb tail）、
 *      时长一致、整体响度不炸
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const requireFromUi = createRequire(path.resolve(ROOT, "packages/ui/package.json"));
const { chromium } = requireFromUi("@playwright/test");

const OUT_DIR = path.join(ROOT, ".audit", "acceptance", "v2.9.6");
fs.mkdirSync(OUT_DIR, { recursive: true });
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5181";
const BASELINE_WAV = path.join(ROOT, ".audit/acceptance/v2.9.5/sad-piano.wav");

const evidence = { steps: [], errors: [] };
const log = (step, detail) => {
  evidence.steps.push({ step, detail });
  console.log(`[step] ${step}: ${detail}`);
};

async function saveDownload(page, trigger, filePath) {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger()]);
  await download.saveAs(filePath);
  return download.suggestedFilename();
}

/** React 受控 range：原生 setter + input 事件（fill 对 range 会报 Malformed） */
async function setRange(locator, value) {
  await locator.evaluate((el, v) => {
    const input = el;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page
    .locator('[data-testid="project-file-input"]')
    .setInputFiles(path.join(ROOT, ".audit/acceptance/v2.9.5/sad-piano.agentmusic"));
  await page.waitForLoadState("networkidle");

  // ── 2. 和弦轨 AI 混音建议（第 3 条 strip = 和弦） ──
  await page.locator('[data-testid="tab-mixer"]').click();
  await page.locator('[data-testid="mixer-layout"]').waitFor();
  await page.locator('[data-testid^="mixer-suggest-fx-"]').nth(2).click();
  log("suggest-fx", "chords 轨 AI 建议");

  // ── 3. Agent 面板批准 ──
  await page.locator('[data-testid="tab-agent"]').waitFor();
  const pending = page
    .locator('[data-testid="agent-panel-pending"]')
    .locator('[data-testid^="diff-card-"]');
  await pending.first().waitFor({ timeout: 10_000 });
  const proposalText = (await pending.first().innerText()).replace(/\s+/g, " ").slice(0, 160);
  await pending.first().locator('[data-testid^="diff-apply-"]').click();
  log("apply-proposal", proposalText);
  await expectApplied(page);
  async function expectApplied(p) {
    await p
      .locator('[data-testid="agent-panel-history"]')
      .locator('[data-testid^="diff-card-"]')
      .first()
      .waitFor({ timeout: 10_000 });
  }

  // ── 4. 手调氛围：reverb mix ↑；加 Delay ──
  await page.locator('[data-testid="tab-mixer"]').click();
  const chordsStrip = page.locator('[data-testid^="mixer-channel-"]').nth(2);
  await chordsStrip.locator('[data-testid^="mixer-instrument-"]').waitFor();

  // 打开 REV 槽的编辑器（按槽内文字定位，不猜槽序），把 Mix 提到 0.45
  await chordsStrip.locator('[class*="fxSlotType"]', { hasText: "REV" }).locator('..').click();
  const revOverlay = chordsStrip.locator('[class*="fxEditorOverlay"]');
  await revOverlay.waitFor({ timeout: 5000 });
  await setRange(revOverlay.locator('input[type="range"]').first(), "0.45");
  log("reverb-mix", "0.45");
  await page.keyboard.press("Escape");
  await page.locator('[data-testid="mixer-console"]').click({ position: { x: 5, y: 5 } });

  // 加 Delay：+FX（默认加 EQ）→ 打开新槽 → 类型按钮切成 DLY → Mix 0.3
  await chordsStrip.locator('[class*="fxAddBtn"]').click();
  await chordsStrip.locator('[class*="fxSlotType"]', { hasText: "EQ" }).last().locator('..').click();
  const dlyOverlay = chordsStrip.locator('[class*="fxEditorOverlay"]');
  await dlyOverlay.waitFor({ timeout: 5000 });
  await dlyOverlay.locator("button", { hasText: "DLY" }).click();
  await setRange(dlyOverlay.locator('input[type="range"]').first(), "0.3");
  log("delay-added", "mix 0.3");
  await page.locator('[data-testid="mixer-console"]').click({ position: { x: 5, y: 5 } });

  const slotText = (await chordsStrip.locator('[class*="fxSection"]').innerText()).replace(/\s+/g, "");
  evidence.chain = slotText;
  log("chain", slotText);
  await page.screenshot({ path: path.join(OUT_DIR, "mixer-atmosphere.png") });

  // ── 5. 导出 ──
  await page.locator('[data-testid="tab-score"]').click();
  await page.locator('[data-testid="score-panel"]').waitFor();
  const wavName = await saveDownload(
    page,
    () => page.locator('[data-testid="export-wav"]').click(),
    path.join(OUT_DIR, "atmosphere.wav"),
  );
  log("export-wav", wavName);
  await saveDownload(
    page,
    () => page.locator('[data-testid="save-project"]').click(),
    path.join(OUT_DIR, "atmosphere.agentmusic"),
  );
  log("save-project", "atmosphere.agentmusic");
} catch (err) {
  evidence.errors.push(String(err));
  await page.screenshot({ path: path.join(OUT_DIR, "failure.png") }).catch(() => {});
  console.error("[FAIL]", err);
} finally {
  await browser.close();
}

// ── 6. 数值验收：尾音能量（reverb tail）+ 响度 + 时长 ──
function analyzeWav(file) {
  const buf = fs.readFileSync(file);
  const byteRate = buf.readUInt32LE(28);
  const sr = buf.readUInt32LE(24);
  const duration = (buf.length - 44) / byteRate;
  const samples = [];
  for (let i = 44; i + 1 < buf.length; i += 2) {
    samples.push(buf.readInt16LE(i) / 32768);
  }
  const rms = (from, to) => {
    let sum = 0;
    let count = 0;
    for (let i = Math.floor(from * sr); i < Math.min(Math.floor(to * sr), samples.length); i++) {
      const v = samples[i];
    sum += v * v;
      count++;
    }
    return count > 0 ? Math.sqrt(sum / count) : 0;
  };
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  return {
    durationSec: Number(duration.toFixed(2)),
    peak: Number(peak.toFixed(3)),
    rmsAll: Number(rms(0, duration).toFixed(4)),
    // 尾音：最后一个音符在 16 小节末（约 64s 处结束），取 60–64s 与 64s–结尾对比
    tailLast2s: Number(rms(duration - 2, duration).toFixed(4)),
    bodyLast4sBeforeTail: Number(rms(duration - 6, duration - 2).toFixed(4)),
  };
}

const base = analyzeWav(BASELINE_WAV);
const atm = analyzeWav(path.join(OUT_DIR, "atmosphere.wav"));
evidence.baseline = base;
evidence.atmosphere = atm;
evidence.tailRatio = Number((atm.tailLast2s / Math.max(base.tailLast2s, 1e-6)).toFixed(2));

console.log(JSON.stringify({ base, atm, tailRatio: evidence.tailRatio }, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "evidence.json"), JSON.stringify(evidence, null, 2));

// 验收判据
const failures = [];
if (Math.abs(atm.durationSec - base.durationSec) > 0.2) failures.push("时长变了");
if (evidence.tailRatio < 1.2) failures.push(`尾音能量不足（×${evidence.tailRatio}）`);
if (atm.peak > 1) failures.push("削波");
if (atm.rmsAll > base.rmsAll * 2) failures.push("整体响度翻倍（过混）");
console.log(`[done] errors=${evidence.errors.length} verdict=${failures.length === 0 ? "PASS" : failures.join("; ")}`);
process.exit(evidence.errors.length > 0 || failures.length > 0 ? 1 : 0);
