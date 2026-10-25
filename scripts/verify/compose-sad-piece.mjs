/**
 * v2.9.5 实际点击测试：用真实 UI 点击做出一首悲伤钢琴曲。
 *
 * 全程只走用户可达的交互（点击 / 下拉 / 输入），不调 store、不注入状态：
 *   1. 混音台：静音旋律/贝斯轨，和弦轨音色选 keys（最接近钢琴的方波敲击音色）
 *   2. 传输条：BPM 改 60（Adagio 悲伤速度）
 *   3. 编曲页：逐小节点击和弦格，写 16 小节进行
 *      - 1–4 小节：demo 引子（E→G→F#m，已有和弦轨音符）
 *      - 5–16 小节：Am → G → F → Em 循环 ×3（i–VII–VI–v 下行，悲伤语汇）
 *        SET_CHORD 会按 v2.9.1 的规则生成真实三和弦音符（chordGenerated）
 *   4. 点播放 2.5s，断言播放头前进（真出声）
 *   5. 谱面页导出 WAV + 保存 .agentmusic 存档
 *
 * 产物：.audit/acceptance/v2.9.5/{sad-piano.wav, project.agentmusic, *.png, evidence.json}
 * 复跑：先起 dev server（5181），再 `node scripts/verify/compose-sad-piece.mjs`
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const requireFromUi = createRequire(path.resolve(ROOT, "packages/ui/package.json"));
const { chromium } = requireFromUi("@playwright/test");

const OUT_DIR = path.join(ROOT, ".audit", "acceptance", "v2.9.5");
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:5181";
/** 每小节目标和弦（1-4 留给 demo 引子，5-16 是我们的进行） */
const PROGRESSION = new Map([
  [5, "Am"], [6, "G"], [7, "F"], [8, "Em"],
  [9, "Am"], [10, "G"], [11, "F"], [12, "Em"],
  [13, "Am"], [14, "G"], [15, "F"], [16, "Em"],
]);
/** CHORD_CYCLE 的顺位（与 ChordTrack.tsx 保持一致）：空→Em→Am→C→G→F→Dm→空 */
const CYCLE = ["", "Em", "Am", "C", "G", "F", "Dm", ""];

const evidence = { steps: [], clicks: 0, errors: [] };
const log = (step, detail) => {
  evidence.steps.push({ step, detail });
  console.log(`[step] ${step}: ${detail}`);
};

async function saveDownload(page, trigger, filePath) {
  const [download] = await Promise.all([page.waitForEvent("download"), trigger()]);
  await download.saveAs(filePath);
  return download.suggestedFilename();
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

try {
  await page.goto(BASE, { waitUntil: "networkidle" });

  // ── 1. 混音台：静音旋律/贝斯，和弦轨选 keys 音色 ──
  await page.locator('[data-testid="tab-mixer"]').click();
  await page.locator('[data-testid="mixer-layout"]').waitFor();
  // 轨道 id 是随机 UUID，testid 形如 mixer-mute-<uuid>；
  // demo 的轨道顺序固定：旋律 / 贝斯 / 和弦（createDemoMixer）。
  const muteButtons = page.locator('[data-testid^="mixer-mute-"]');
  await muteButtons.nth(0).click();
  evidence.clicks += 1;
  log("mute", "旋律");
  await muteButtons.nth(1).click();
  evidence.clicks += 1;
  log("mute", "贝斯");
  await page.locator('[data-testid^="mixer-instrument-"]').nth(2).selectOption("keys");
  evidence.clicks += 1;
  log("instrument", "chords → keys");
  await page.screenshot({ path: path.join(OUT_DIR, "mixer.png") });

  // ── 2. BPM 60 ──
  await page.locator('[data-testid="tab-compose"]').click();
  await page.locator('[data-testid="chord-track"]').waitFor();
  await page.locator('[data-testid="transport-bpm"]').fill("60");
  evidence.clicks += 1;
  log("bpm", "60");

  // ── 3. 逐小节点击和弦格（点到位为止，最多一圈） ──
  const chordFinal = {};
  for (const [barStr, target] of PROGRESSION) {
    const bar = Number(barStr);
    const cell = page.locator(`[data-testid="chord-cell-${bar}"]`);
    await cell.waitFor({ state: "visible", timeout: 10_000 });
    let label = (await cell.innerText()).trim();
    let guard = 0;
    while (label !== target && guard < CYCLE.length) {
      await cell.click();
      evidence.clicks += 1;
      guard += 1;
      label = (await cell.innerText()).trim();
    }
    if (label !== target) throw new Error(`bar ${bar}: 期望 ${target}，实际 ${label}`);
    chordFinal[bar] = label;
  }
  log("chords", `${Object.keys(chordFinal).length} 小节 → ${JSON.stringify(chordFinal)}`);

  // ── 4. 点播放，验证真的在走 ──
  await page.locator('[data-testid="transport-play"]').click();
  evidence.clicks += 1;
  // 60 BPM 下 count-in 是 1 小节 = 4 秒，等它过去再读播放头
  await page.waitForTimeout(6000);
  const timeMid = await page.locator('[data-testid="transport-time"]').innerText();
  await page.waitForTimeout(1500);
  const timeLater = await page.locator('[data-testid="transport-time"]').innerText();
  await page.locator('[data-testid="transport-stop"]').click();
  evidence.clicks += 1;
  evidence.playhead = { timeMid, timeLater, advanced: timeMid !== timeLater };
  log("play", `${timeMid} → ${timeLater}`);
  if (timeMid === timeLater) throw new Error(`播放头未前进: ${timeMid}`);
  await page.screenshot({ path: path.join(OUT_DIR, "compose.png") });

  // ── 5. 导出 WAV + 工程存档（都在谱面页的真实按钮上） ──
  await page.locator('[data-testid="tab-score"]').click();
  await page.locator('[data-testid="score-panel"]').waitFor();
  const wavName = await saveDownload(
    page,
    () => page.locator('[data-testid="export-wav"]').click(),
    path.join(OUT_DIR, "sad-piano.wav"),
  );
  log("export-wav", wavName);
  const agentmusicName = await saveDownload(
    page,
    () => page.locator('[data-testid="save-project"]').click(),
    path.join(OUT_DIR, "sad-piano.agentmusic"),
  );
  log("save-project", agentmusicName);
} catch (err) {
  evidence.errors.push(String(err));
  await page.screenshot({ path: path.join(OUT_DIR, "failure.png") }).catch(() => {});
  console.error("[FAIL]", err);
} finally {
  await browser.close();
}

// ── 6. WAV 体检验证（时长 / 非静音 / 峰值） ──
const wavPath = path.join(OUT_DIR, "sad-piano.wav");
if (fs.existsSync(wavPath)) {
  const buf = fs.readFileSync(wavPath);
  const byteRate = buf.readUInt32LE(28);
  const duration = (buf.length - 44) / byteRate;
  let peak = 0;
  let sumSq = 0;
  let n = 0;
  for (let i = 44; i + 1 < buf.length; i += 2) {
    const v = buf.readInt16LE(i) / 32768;
    peak = Math.max(peak, Math.abs(v));
    sumSq += v * v;
    n += 1;
  }
  evidence.wav = {
    bytes: buf.length,
    durationSec: Number(duration.toFixed(2)),
    peak: Number(peak.toFixed(3)),
    rms: Number(Math.sqrt(sumSq / n).toFixed(4)),
  };
  log("wav", JSON.stringify(evidence.wav));
}

fs.writeFileSync(path.join(OUT_DIR, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(`[done] clicks=${evidence.clicks} errors=${evidence.errors.length}`);
process.exit(evidence.errors.length > 0 ? 1 : 0);
