/**
 * v2.9.6 谱面诊断探针：加载 sad-piano.agentmusic，进入谱面页，
 * 截图 + 统计 VexFlow 实际渲染的音符头数量 + 抓控制台告警，
 * 回答两个问题：①为什么「不符合乐理」②为什么「只渲染一部分」。
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

const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const consoleMsgs = [];
page.on("console", (m) => {
  if (["warning", "error"].includes(m.type())) consoleMsgs.push(`${m.type()}: ${m.text()}`);
});

await page.goto(BASE, { waitUntil: "networkidle" });

// 加载存档
await page
  .locator('[data-testid="project-file-input"]')
  .setInputFiles(path.join(ROOT, ".audit/acceptance/v2.9.5/sad-piano.agentmusic"));
await page.waitForLoadState("networkidle");
await page.waitForTimeout(800);

await page.locator('[data-testid="tab-score"]').click();
await page.locator('[data-testid="score-panel"]').waitFor();
await page.waitForTimeout(1500);

const probe = await page.evaluate(() => {
  const stack = document.querySelector('[data-testid="score-renderer-stack"]');
  const svg = stack?.querySelector("svg");
  // VexFlow 音符头 path/rect 统计：用 .vf-notehead 不可靠（SVG 无类名），
  // 改为统计 stave 数与 glyph 数（vf-text/vf-glyph）
  const staves = stack?.querySelectorAll("path.vf-stave, .vf-stave").length ?? 0;
  const glyphs = stack?.querySelectorAll("text").length ?? 0;
  const paths = svg ? svg.querySelectorAll("path").length : 0;
  return {
    stackHeight: stack ? Math.round(stack.getBoundingClientRect().height) : 0,
    svgHeight: svg ? Math.round(svg.getBoundingClientRect().height) : 0,
    svgWidth: svg ? Math.round(svg.getBoundingClientRect().width) : 0,
    staves,
    glyphs,
    paths,
    containerScrollHeight: stack?.parentElement?.scrollHeight ?? 0,
    containerClientHeight: stack?.parentElement?.clientHeight ?? 0,
  };
});

await page.screenshot({ path: path.join(OUT_DIR, "score-full.png"), fullPage: false });
// 滚到容器底部再截一张（看第二系统是否真的在文档里）
await page.evaluate(() => {
  const stack = document.querySelector('[data-testid="score-renderer-stack"]');
  stack?.parentElement?.scrollTo(0, 99999);
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT_DIR, "score-scrolled.png") });

// 钢琴卷帘对照（编曲页）
await page.locator('[data-testid="tab-compose"]').click();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT_DIR, "compose.png") });

console.log(JSON.stringify({ probe, consoleMsgs: consoleMsgs.slice(0, 12) }, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "score-probe.json"), JSON.stringify({ probe, consoleMsgs }, null, 2));
await browser.close();
