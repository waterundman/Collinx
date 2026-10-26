/**
 * 全功能点击审计（v3.1.0）。
 *
 * 目的：真的用手点一遍所有视图与能力，同时收集控制台错误、页面异常、失败请求。
 * 与 e2e 的分工：e2e 守回归断言；本脚本负责"**没人点过的地方**"——
 * 新交互（⌘K / 分栏 / A/B / 插件分区 / MIDI 效果）与全视图遍历。
 *
 * 运行：node scripts/verify/full-click-audit.mjs
 * 前置：vite dev 已在 http://localhost:5180 运行
 */
import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import * as path from "node:path";

// playwright 装在 packages/ui，脚本在仓库根 —— 从该包解析
const requireFromUi = createRequire(path.resolve(process.cwd(), "packages/ui/package.json"));
const { chromium } = requireFromUi("@playwright/test");

const BASE = process.env.AUDIT_BASE ?? "http://localhost:5180";
const OUT = path.resolve(".audit/click-audit", new Date().toISOString().replace(/[:.]/g, "-"));

const results = [];
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const externalRequests = [];

function record(name, status, detail = "", ms = 0) {
  results.push({ name, status, detail, ms });
  const mark = status === "PASS" ? "✓" : status === "SKIP" ? "–" : "✗";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""} (${ms}ms)`);
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.keepDialog] 该步骤本身就要用到弹窗（如设置页本身是 dialog），
 *                                   此时不要执行"清场"逻辑，否则会把自己的容器关掉。
 */
async function step(page, name, fn, opts = {}) {
  const t0 = Date.now();
  try {
    // 防级联：上一步若留下模态框，后续所有点击都会被遮罩吃掉（表现为 30s 超时）
    if (!opts.keepDialog && (await page.locator('[role="dialog"]').count())) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
    }
    const detail = await fn();
    if (detail && typeof detail === "object" && detail.skip) {
      record(name, "SKIP", detail.skip, Date.now() - t0);
      return;
    }
    record(name, "PASS", detail ?? "", Date.now() - t0);
  } catch (err) {
    record(name, "FAIL", err instanceof Error ? err.message.split("\n")[0] : String(err), Date.now() - t0);
    try {
      await page.screenshot({ path: path.join(OUT, `FAIL-${name.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}.png`) });
    } catch {
      /* 截图失败不影响结论 */
    }
  }
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

/** 页签切换统一走 data-testid="tab-<id>"（TabPill 的既有契约） */
const gotoTab = async (page, id) => {
  await page.locator(`[data-testid="tab-${id}"]`).click();
  await page.waitForSelector(`[data-testid="${id}-layout"]`, { timeout: 8000 });
};

/** 设置侧栏项：role=option，按可见文案匹配 */
const gotoSetting = async (page, label) => {
  const option = page.locator('[role="listbox"] [role="option"]', { hasText: label }).first();
  if ((await option.count()) === 0) throw new Error(`设置分区「${label}」不存在`);
  await option.click();
  await page.waitForTimeout(250);
};

async function main() {
  await fs.mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: "msedge" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();

  const EXTERNAL_NOISE = /ERR_PROXY_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|fonts\.googleapis|api\.deepseek|api\.openai/;
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (EXTERNAL_NOISE.test(text)) return; // 外部资源 / 未联网属环境噪声
    consoleErrors.push({ text: text.slice(0, 400) });
  });
  page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 400)));
  page.on("requestfailed", (req) => {
    const url = req.url();
    const entry = { url: url.slice(0, 200), err: req.failure()?.errorText };
    // 外部 LLM 请求在审计环境里必然失败（无 Key / 无网），属预期，不算应用缺陷
    if (
      /api\.deepseek\.com|api\.openai\.com|fonts\.googleapis|gstatic/.test(url) ||
      /ERR_PROXY_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED/.test(entry.err ?? "")
    ) {
      externalRequests.push(entry);
    } else {
      failedRequests.push(entry);
    }
  });

  // ── 0. 启动 ────────────────────────────────────────────────
  await step(page, "启动与 AppShell", async () => {
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="app-shell"]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="compose-layout"]', { timeout: 20000 });
    const tabs = await page.locator('[data-testid="tab-bar"] button').count();
    if (tabs !== 9) throw new Error(`页签数 ${tabs} ≠ 9`);
    return `${tabs} 个页签`;
  });

  // ── 1. 走带：播放 → 位置前进 → 暂停 ───────────────────────
  await step(page, "走带：播放 → 位置前进 → 暂停", async () => {
    const pos = page.locator('[data-testid="transport-position"]');
    const before = (await pos.innerText()).replace(/\s+/g, " ");
    await page.locator('[data-testid="transport-play"]').click();
    // count-in 默认 1 小节（120BPM ≈ 2s），必须等过它才看得到前进
    await page.waitForTimeout(3800);
    const during = (await pos.innerText()).replace(/\s+/g, " ");
    await page.locator('[data-testid="transport-pause"]').click();
    if (before === during) throw new Error(`位置未前进（${before}）`);
    return `${before} → ${during}`;
  });

  // ── 2. 走带：循环开关 ─────────────────────────────────────
  await step(page, "走带：循环开关切换", async () => {
    const loop = page.locator('[data-testid="transport-loop"]');
    const before = await loop.getAttribute("aria-pressed");
    await loop.click();
    const after = await loop.getAttribute("aria-pressed");
    if (before === after) throw new Error(`aria-pressed 未变化（${before}）`);
    await loop.click(); // 复位
    return `${before} → ${after}`;
  });

  // ── 3. 分栏拖拽（v3.0.0 Splitter） ────────────────────────
  await step(page, "分栏拖拽：拖动后写入 CSS 变量", async () => {
    const handle = page.locator('[data-testid="shell-splitter"]');
    const box = await handle.boundingBox();
    if (!box) throw new Error("splitter 无 boundingBox");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 60, { steps: 8 });
    await page.mouse.up();
    const value = await handle.evaluate((el) => el.parentElement?.style.getPropertyValue("--compose-score-h") ?? "");
    if (!value.endsWith("px")) throw new Error("未写入 --compose-score-h");
    // 双击复位
    await handle.dblclick();
    const afterReset = await handle.evaluate((el) => el.parentElement?.style.getPropertyValue("--compose-score-h") ?? "");
    return `拖动 ${value}，双击复位后 "${afterReset}"`;
  });

  // ── 4. 命令面板（v3.0.0 ⌘K） ──────────────────────────────
  await step(page, "命令面板：Ctrl+K → 过滤 → 回车跳转混音", async () => {
    await page.keyboard.press("Control+K");
    await page.waitForSelector('[data-testid="command-palette"]', { timeout: 5000 });
    await page.locator('[data-testid="command-input"]').fill("混音");
    await page.waitForTimeout(200);
    const items = await page.locator('[role="option"]').count();
    if (items === 0) throw new Error("过滤后无结果");
    await page.keyboard.press("Enter");
    await page.waitForSelector('[data-testid="mixer-layout"]', { timeout: 6000 });
    return `${items} 条匹配 → 已跳到混音`;
  });

  // ── 5. 命令面板：Esc 关闭 ────────────────────────────────
  await step(page, "命令面板：Esc 关闭", async () => {
    await page.keyboard.press("Control+K");
    await page.waitForSelector('[data-testid="command-palette"]', { timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    if (await page.locator('[data-testid="command-palette"]').count()) throw new Error("Esc 未关闭");
    return "已关闭";
  });

  // ── 6. 混音台：推子 ───────────────────────────────────────
  await step(page, "混音台：拖动推子改变增益读数", async () => {
    await gotoTab(page, "mixer");
    const fader = page.locator('[data-testid^="mixer-fader-"]').first();
    const gain = page.locator('[data-testid^="mixer-gain-"]').first();
    const before = (await gain.innerText()).trim();
    const box = await fader.boundingBox();
    if (!box) throw new Error("推子无 boundingBox");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = (await gain.innerText()).trim();
    if (before === after) throw new Error(`增益未变化（${before}）`);
    return `${before} → ${after}`;
  });

  // ── 7. 混音台：静音切换 ───────────────────────────────────
  await step(page, "混音台：静音按钮切换", async () => {
    const mute = page.locator('[data-testid^="mixer-mute-"]').first();
    const before = await mute.getAttribute("class");
    await mute.click();
    await page.waitForTimeout(150);
    const after = await mute.getAttribute("class");
    if (before === after) throw new Error("点击后样式无变化");
    await mute.click();
    return "样式类变化 = 生效";
  });

  // ── 8. 混音台：添加轨道（真实走弹窗流程） ────────────────
  await step(page, "混音台：添加轨道（弹窗填写→确认）", async () => {
    const channels = page.locator('[data-testid^="mixer-channel-"]');
    const before = await channels.count();
    await page.locator('[data-testid="mixer-add-track"]').click();

    const dialog = page.locator('[role="dialog"]').first();
    await dialog.waitFor({ timeout: 5000 });
    const inputs = dialog.locator("input");
    await inputs.nth(0).fill("审计轨");
    await inputs.nth(1).fill("audit-src");
    await dialog.locator("button").last().click();
    await page.waitForTimeout(500);

    const after = await channels.count();
    if (after !== before + 1) throw new Error(`通道数 ${before} → ${after}，未新增`);
    if (await page.locator('[role="dialog"]').count()) throw new Error("确认后弹窗未关闭");
    return `${before} → ${after} 条通道`;
  });

  // ── 9. 逐视图点击 ───────────────────────────────────────
  const views = ["compose", "arrange", "orchestrate", "mixer", "score", "taste", "teaching", "agent", "graph"];
  for (const id of views) {
    await step(page, `切到视图：${id}`, async () => {
      await gotoTab(page, id);
      await shot(page, `view-${id}`);
      return `${id}-layout`;
    });
  }

  // ── 10. 钢琴卷：绘制模式 + 点画布 ────────────────────────
  await step(page, "钢琴卷：绘制模式 + 点画布加音符 + 撤销", async () => {
    await gotoTab(page, "compose");
    await page.waitForSelector('[data-testid="piano-roll-canvas"]', { timeout: 6000 });
    await page.locator('[data-testid="piano-roll-draw"]').click();
    const canvas = page.locator('[data-testid="piano-roll-canvas"]');
    const box = await canvas.boundingBox();
    if (!box) throw new Error("画布无 boundingBox");
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await page.waitForTimeout(300);
    await page.keyboard.press("Control+Z");
    await page.waitForTimeout(200);
    return `画布 ${Math.round(box.width)}×${Math.round(box.height)}，已点击并撤销`;
  });

  // ── 11. 编排：空态 → 新建乐段 → 选中 ───────────────────
  await step(page, "编排：空态点「新建乐段」并选中", async () => {
    await gotoTab(page, "arrange");
    if (await page.locator('[data-testid="arrangement-empty"]').count()) {
      // 注意：arrangement-start-grid 是容器，前缀匹配会先命中它 —— 必须排除
      const start = page
        .locator('[data-testid^="arrangement-start-"]:not([data-testid="arrangement-start-grid"])')
        .first();
      if (await start.count()) {
        await start.click();
        await page.waitForTimeout(600);
      }
    }
    const blocks = page.locator('[class*="phraseBlock"]');
    const n = await blocks.count();
    if (n === 0) throw new Error("新建后仍无乐段块");
    await blocks.first().click();
    await page.waitForTimeout(200);
    return `${n} 个乐段块，已选第一个`;
  });

  // ── 12. 编制：切换预设编制 ──────────────────────────────
  await step(page, "编制：切换预设编制", async () => {
    await gotoTab(page, "orchestrate");
    const presets = page.locator('[class*="presetBtn"]');
    const n = await presets.count();
    if (n < 2) throw new Error(`预设按钮只有 ${n} 个`);
    const activeBefore = await page.locator('[class*="presetBtnActive"]').count();
    await presets.nth(1).click();
    await page.waitForTimeout(400);
    const activeAfter = await page.locator('[class*="presetBtnActive"]').count();
    return `${n} 个预设，激活标记 ${activeBefore} → ${activeAfter}`;
  });

  // ── 13. 品味：A/B 面板（v3.1.0） ─────────────────────────
  await step(page, "品味：A/B 面板打开并可用", async () => {
    await gotoTab(page, "taste");
    await page.locator('[data-testid="taste-ab-toggle"]').click();
    await page.waitForSelector('[data-testid="taste-ab-panel"]', { timeout: 6000 });
    if (await page.locator('[data-testid="taste-ab-empty"]').count()) {
      await page.locator('[data-testid="taste-ab-empty"] button').first().click();
      await page.waitForTimeout(500);
    }
    if (!(await page.locator("text=开始测试").count())) throw new Error("记录版本后仍未出现播放器");
    await shot(page, "taste-ab");
    return "面板已就绪";
  });

  // ── 14. A/B 流程 ────────────────────────────────────────
  await step(page, "A/B 流程：两版听完进入投票", async () => {
    await page.locator("text=开始测试").first().click();
    await page.locator("text=切换到").first().click();
    await page.waitForTimeout(300);
    await page.locator("text=开始评价").first().click();
    await page.waitForTimeout(200);
    if (!(await page.locator("text=无偏好").count())) throw new Error("投票按钮未出现");
    return "投票可用";
  });

  // ── 15. 设置：遍历全部分区 ──────────────────────────────
  const cats = ["通用设置", "音频设置", "MIDI设置", "混音设置", "记谱设置", "Agent设置", "Taste设置", "插件"];
  for (const cat of cats) {
    await step(page, `设置：打开分区「${cat}」`, async () => {
      if (!(await page.locator('[role="listbox"] [role="option"]').count())) {
        await page.locator('[data-testid="open-settings"]').click();
        await page.waitForSelector('[role="listbox"]', { timeout: 6000 });
      }
      await gotoSetting(page, cat);
      return cat;
    }, { keepDialog: true });
  }

  // ── 16. 插件分区：浏览器内必须明确不可用 ────────────────
  await step(page, "插件分区：浏览器内显示不可用而非假列表", async () => {
    await gotoSetting(page, "插件");
    const list = await page.locator('[data-testid="plugins-list"]').count();
    const unavailable = await page.locator('[data-testid="plugins-unavailable"]').count();
    if (list > 0) throw new Error("浏览器内竟然列出了插件");
    if (!unavailable) throw new Error("未显示不可用提示");
    await shot(page, "settings-plugins");
    return "unavailable ✓";
  }, { keepDialog: true });

  // ── 17. 插件分区：添加扫描目录（持久化设置） ────────────
  await step(page, "插件分区：添加自定义扫描目录", async () => {
    // 浏览器内整块不可用，添加按钮不该出现 —— 这里断言的是"不可用时不给假操作"
    const addPath = await page.locator('[data-testid="plugins-add-path"]').count();
    if (addPath > 0) throw new Error("不可用状态下仍暴露添加目录按钮");
    return "不可用时无操作入口";
  }, { keepDialog: true });

  // ── 18. MIDI 效果链（v3.1.0） ───────────────────────────
  await step(page, "MIDI 分区：添加移调效果并改值", async () => {
    await gotoSetting(page, "MIDI设置");
    await page.locator('[data-testid="midi-effect-add-transpose"]').click();
    await page.waitForSelector('[data-testid="midi-effects-list"]', { timeout: 5000 });
    const input = page.locator('[data-testid^="midi-effect-value-"]').first();
    await input.fill("7");
    await page.waitForTimeout(200);
    const val = await input.inputValue();
    if (val !== "7") throw new Error(`值未写入（${val}）`);
    await shot(page, "settings-midi-effects");
    return "移调 +7 已生效";
  }, { keepDialog: true });

  // ── 19. MIDI 效果：移除 ─────────────────────────────────
  await step(page, "MIDI 分区：移除效果", async () => {
    await page.locator('[data-testid^="midi-effect-remove-"]').first().click();
    await page.waitForTimeout(200);
    if (await page.locator('[data-testid="midi-effects-list"]').count()) throw new Error("移除后列表仍在");
    if (!(await page.locator('[data-testid="midi-effects-empty"]').count())) throw new Error("未回到空态");
    return "已回到空态";
  }, { keepDialog: true });

  // ── 20. 关闭设置（焦点已掉出容器的情况也要能关） ────────
  await step(page, "设置：移除按钮后焦点掉落，Esc 仍关闭", async () => {
    // 上一步移除了元素，焦点已回到 body —— 正是真实用户最容易卡住的时刻
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    if (await page.locator('[data-testid="settings-page"]').count()) throw new Error("Esc 未能关闭设置");
    return "已关闭";
  }, { keepDialog: true });

  // ── 26. 图谱：点击节点打开详情 ──────────────────────────
  await step(page, "Graph：点击节点打开详情", async () => {
    // 力导向布局会随工程内容变化重排，之前的增删改会让固定锚点失效。
    // 这一步必须在** pristine demo 状态**下做：先重载，再进图谱。
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="compose-layout"]', { timeout: 15000 });
    await gotoTab(page, "graph");
    const canvas = page.locator('[data-testid="graph-canvas"]');
    const box = await canvas.boundingBox();
    if (!box) throw new Error("画布无 boundingBox");
    /**
     * 图谱节点是 canvas 绘制，DOM 里没有锚点，坐标还会随力导向布局变化
     * （既有 e2e 固定点 (200,200) 在本轮实测已不再命中）。
     * 做法：读 canvas 像素，按 20px 网格找出"明亮且有彩"的像素团，
     * 取前几个团心依次点击，命中 node-detail 即成功。
     */
    const collect = () => canvas.evaluate((c) => {
      const ctx = c.getContext("2d");
      const { width: w, height: h } = c;
      const d = ctx.getImageData(0, 0, w, h).data;
      const buckets = new Map();
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4;
          const mx = Math.max(d[i], d[i + 1], d[i + 2]);
          const mn = Math.min(d[i], d[i + 1], d[i + 2]);
          if (mx > 90 && mx - mn > 30) {
            const k = `${Math.round(x / 20)},${Math.round(y / 20)}`;
            const cur = buckets.get(k) ?? { n: 0, x: 0, y: 0 };
            buckets.set(k, { n: cur.n + 1, x: cur.x + x, y: cur.y + y });
          }
        }
      }
      const dpr = w / c.getBoundingClientRect().width;
      return [...buckets.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, 6)
        .map((v) => ({ x: Math.round(v.x / v.n / dpr), y: Math.round(v.y / v.n / dpr) }));
    });

    // 力导向布局是异步绘制的：刚切过来时画布可能还是空的，需轮询等待
    let candidates = [];
    for (let attempt = 0; attempt < 12 && candidates.length === 0; attempt++) {
      candidates = await collect();
      if (candidates.length === 0) await page.waitForTimeout(300);
    }

    if (candidates.length === 0) throw new Error("画布上找不到可点击的高亮区域（等待 3.6s 仍为空）");

    for (const pt of candidates) {
      await canvas.click({ position: { x: pt.x, y: pt.y } });
      await page.waitForTimeout(250);
      if (await page.locator('[data-testid="node-detail"]').count()) {
        return `点击 (${pt.x},${pt.y}) 打开节点详情`;
      }
    }
    throw new Error(`尝试 ${candidates.length} 个高亮团心仍未打开详情`);
  });

  // ── 21. Graph 工具条 ────────────────────────────────────
  await step(page, "Graph：缩放与重新布局按钮", async () => {
    // 上一步打开了节点详情面板，它会盖住画布区域；先关掉再点工具条
    const detail = page.locator('[data-testid="node-detail"]');
    if (await detail.count()) {
      const closeBtn = detail.locator("button").first();
      if (await closeBtn.count()) await closeBtn.click();
      else await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
    await gotoTab(page, "graph");
    const buttons = page.locator('[data-testid="graph-toolbar"] button');
    const n = await buttons.count();
    for (let i = 0; i < n; i++) await buttons.nth(i).click();
    await shot(page, "graph-zoomed");
    return `${n} 个工具按钮已点`;
  });

  // ── 22. 教学：难度 + 讲解 ───────────────────────────────
  await step(page, "教学：切换难度并触发讲解", async () => {
    await gotoTab(page, "teaching");
    const levels = page.locator('[data-testid^="teaching-level-"]');
    const n = await levels.count();
    if (n) await levels.last().click();
    const trigger = page.locator('[data-testid="teaching-harmony-trigger"]');
    if (await trigger.count()) {
      await trigger.click().catch(() => {});
      await page.waitForTimeout(800);
    }
    return `难度按钮 ${n} 个`;
  });

  // ── 23. Agent：输入并发送 ───────────────────────────────
  await step(page, "Agent：输入并发送（允许报错，不可崩）", async () => {
    await gotoTab(page, "agent");
    const input = page.locator('[data-testid="agent-chat-input"]');
    await input.fill("把副歌人声推前一点");
    const send = page.locator('[data-testid="agent-chat-send"]');
    if (await send.isDisabled()) throw new Error("输入后发送按钮仍禁用");
    await send.click();
    await page.waitForTimeout(2500);
    await shot(page, "agent-sent");
    return "已发送";
  });

  // ── 24. 乐谱：导出 MIDI ─────────────────────────────────
  await step(page, "乐谱：点击导出 MIDI", async () => {
    await gotoTab(page, "score");
    const btn = page.locator('[data-testid="export-midi"]');
    if (!(await btn.count())) throw new Error("找不到 export-midi");
    const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
    await btn.click();
    const download = await dl;
    return download ? `已下载 ${download.suggestedFilename()}` : "点击完成（未触发下载事件）";
  });

  // ── 25. 乐谱：导出 PDF ──────────────────────────────────
  await step(page, "乐谱：点击导出 PDF", async () => {
    await gotoTab(page, "score");
    const btn = page.locator('[data-testid="export-pdf"]');
    if (!(await btn.count())) throw new Error("找不到 export-pdf");
    const dl = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
    await btn.click();
    const download = await dl;
    return download ? `已下载 ${download.suggestedFilename()}` : "点击完成（未触发下载事件）";
  });

  // ── 27. 混音台：FX 链建议 ──────────────────────────────
  await step(page, "混音台：点击 AI FX 链建议", async () => {
    await gotoTab(page, "mixer");
    const btn = page.locator('[data-testid^="mixer-suggest-fx-"]').first();
    if (!(await btn.count())) return { skip: "无 FX 建议入口" };
    await btn.click();
    await page.waitForTimeout(800);
    return "已点击建议按钮";
  });

  // ── 28. 设置：搜索过滤导航 ─────────────────────────────
  await step(page, "设置：搜索过滤侧栏", async () => {
    await page.locator('[data-testid="open-settings"]').click();
    await page.waitForSelector('[data-testid="settings-page"]', { timeout: 6000 });
    const search = page.locator('[data-testid="settings-page"] input').first();
    await search.fill("MIDI");
    await page.waitForTimeout(300);
    const visible = await page.locator('[role="listbox"] [role="option"]').count();
    if (visible === 0) throw new Error("搜索后无结果");
    return `过滤后 ${visible} 个分类`;
  }, { keepDialog: true });

  // ── 29. 关闭设置（搜索后焦点仍在输入框，Esc 应生效） ────
  await step(page, "设置：搜索态下 Esc 关闭", async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    if (await page.locator('[data-testid="settings-page"]').count()) throw new Error("Esc 未关闭");
    return "已关闭";
  }, { keepDialog: true });

  // ── 25. 顶栏：保存工程 ──────────────────────────────────
  await step(page, "顶栏：保存工程", async () => {
    const dl = page.waitForEvent("download", { timeout: 8000 }).catch(() => null);
    await page.locator('[data-testid="save-project"]').click();
    const download = await dl;
    if (!download) throw new Error("未触发下载");
    return `已下载 ${download.suggestedFilename()}`;
  });

  await browser.close();

  const pass = results.filter((r) => r.status === "PASS").length;
  const fail = results.filter((r) => r.status === "FAIL").length;
  const skip = results.filter((r) => r.status === "SKIP").length;

  const report = {
    base: BASE,
    finishedAt: new Date().toISOString(),
    summary: { total: results.length, pass, fail, skip },
    consoleErrors,
    pageErrors,
    failedRequests,
    externalRequests,
    results,
  };
  await fs.writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2), "utf8");

  console.log("\n──────── 汇总 ────────");
  console.log(`通过 ${pass} · 失败 ${fail} · 跳过 ${skip}`);
  console.log(
    `控制台错误 ${consoleErrors.length} · 页面异常 ${pageErrors.length} · 失败请求 ${failedRequests.length} · 外部请求失败 ${externalRequests.length}（预期）`,
  );
  console.log(`报告：${path.join(OUT, "report.json")}`);
  for (const e of consoleErrors.slice(0, 8)) console.log(` - console: ${e.text}`);
  for (const e of pageErrors.slice(0, 8)) console.log(` - pageerror: ${e}`);

  process.exitCode = fail > 0 || pageErrors.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("审计脚本崩溃：", err);
  process.exitCode = 2;
});
