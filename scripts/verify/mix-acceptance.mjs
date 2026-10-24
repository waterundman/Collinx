/**
 * v2.9.0 混音链路数值验收（真浏览器 + OfflineAudioContext）。
 *
 * 断言对象是**声音本身**，不是 store 数字：
 *  - EQ low -12dB @100Hz → 100Hz 分量能量下降
 *  - 声像全左 → 右声道能量 ≈ 0（等功率）
 *  - M/S 生效 → 输出能量 ≈ 0
 *  - 播放链（带 analyser）与导出链（不带）逐样本一致
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const requireFromUi = createRequire("W:/项目仓库/Collinx-new/packages/ui/package.json");
const { chromium } = requireFromUi("@playwright/test");

const BASE = "http://localhost:5181";
const OUT = "W:/项目仓库/Collinx-new/.audit/acceptance/mix";

const results = {};

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: "networkidle" });

// 模块在 dev server 下以 TS 源码提供，动态 import 拿到真实实现
const measure = await page.evaluate(async () => {
  const { createFxChain } = await import("/src/services/fx-chain.ts");
  const { MixerGraph } = await import("/src/services/mixer-graph.ts");

  const SR = 44100;

  async function renderTone({ freq = 100, fx = [], gainDb = 0, pan = 0, muted = false, withAnalysers = false }) {
    const ctx = new OfflineAudioContext(2, SR * 1.2, SR);
    const src = ctx.createOscillator();
    src.type = "sine";
    src.frequency.value = freq;
    const amp = ctx.createGain();
    amp.gain.value = 0.5;
    src.connect(amp);

    const mixer = {
      tracks: [{
        id: "t1", name: "Test", sourceTrackId: "test", busType: "group",
        gainDb: String(gainDb), pan: String(pan), mute: muted, solo: false,
        fxChain: { id: "fx", name: "FX", slots: fx }, sends: [], meterLevel: "0",
      }],
      masterTrack: {
        id: "m", name: "Master", sourceTrackId: "master", busType: "master",
        gainDb: "0", pan: "0", mute: false, solo: false,
        fxChain: { id: "fxm", name: "FX", slots: [] }, sends: [], meterLevel: "0",
      },
      routingMatrix: {},
    };

    const graph = new MixerGraph(ctx, ctx.destination, { withAnalysers });
    graph.apply(mixer);
    amp.connect(graph.bus("test").sum);
    src.start(0);
    const buf = await ctx.startRendering();

    const rms = (data) => {
      const start = Math.floor(SR * 0.2); // 跳过起振
      let sum = 0;
      for (let i = start; i < data.length; i++) sum += data[i] * data[i];
      return Math.sqrt(sum / (data.length - start));
    };
    return {
      left: rms(buf.getChannelData(0)),
      right: rms(buf.getChannelData(1)),
      samples: [buf.getChannelData(0), buf.getChannelData(1)],
    };
  }

  // 送出（Send）：A 轨 100% 送到 aux 总线（aux 再汇入 master）→ 信号叠加
  async function renderWithSend(level) {
    const ctx = new OfflineAudioContext(2, SR * 1.2, SR);
    const src = ctx.createOscillator();
    src.type = "sine";
    src.frequency.value = 1000;
    const amp = ctx.createGain();
    amp.gain.value = 0.5;
    src.connect(amp);

    const track = (id, sends) => ({
      id, name: id, sourceTrackId: id, busType: "group",
      gainDb: "0", pan: "0", mute: false, solo: false,
      fxChain: { id: "fx-" + id, name: "FX", slots: [] },
      sends, meterLevel: "0",
    });
    const mixer = {
      tracks: [
        track("test", [{ targetBusId: "aux", level: String(level), preFader: false }]),
        track("aux", []),
      ],
      masterTrack: {
        id: "m", name: "Master", sourceTrackId: "master", busType: "master",
        gainDb: "0", pan: "0", mute: false, solo: false,
        fxChain: { id: "fxm", name: "FX", slots: [] }, sends: [], meterLevel: "0",
      },
      routingMatrix: {},
    };
    const graph = new MixerGraph(ctx, ctx.destination, { withAnalysers: false });
    graph.apply(mixer);
    amp.connect(graph.bus("test").sum);
    src.start(0);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let sum = 0;
    for (let i = Math.floor(SR * 0.2); i < d.length; i++) sum += d[i] * d[i];
    return Math.sqrt(sum / (d.length - Math.floor(SR * 0.2)));
  }
  const sendDry = await renderWithSend(0);
  const sendFull = await renderWithSend(1);

  const eqSlot = { id: "eq-1", type: "eq", preset: "default", params: { lowGain: "-12", lowFreq: "100" }, enabled: true };

  const dry = await renderTone({ freq: 100 });
  const eq = await renderTone({ freq: 100, fx: [eqSlot] });
  const dry50 = await renderTone({ freq: 50 });
  const eq50 = await renderTone({ freq: 50, fx: [eqSlot] });
  const highDry = await renderTone({ freq: 4000 });
  const highEq = await renderTone({ freq: 4000, fx: [eqSlot] });
  const left = await renderTone({ freq: 1000, pan: -1 });
  const center = await renderTone({ freq: 1000, pan: 0 });
  const muted = await renderTone({ freq: 1000, muted: true });
  const playback = await renderTone({ freq: 1000, withAnalysers: true });
  const exported = await renderTone({ freq: 1000, withAnalysers: false });

  function maxDiff(a, b) {
    let max = 0;
    const l = Math.min(a.length, b.length);
    // 跳过前 50ms：播放链用平滑过渡（防拉链噪声），导出链写静态终值，
    // 只在过渡窗口内有差异；稳态必须逐样本一致。
    for (let i = Math.floor(SR * 0.05); i < l; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > max) max = d;
    }
    return max;
  }

  const { renderNotesToWav } = await import("/src/services/wav-export.ts");
  const baseMixer = {
    tracks: [{
      id: "t1", name: "Test", sourceTrackId: "test", busType: "group",
      gainDb: "0", pan: "0", mute: false, solo: false,
      fxChain: { id: "fx", name: "FX", slots: [] }, sends: [], meterLevel: "0",
    }],
    masterTrack: {
      id: "m", name: "Master", sourceTrackId: "master", busType: "master",
      gainDb: "0", pan: "0", mute: false, solo: false,
      fxChain: { id: "fxm", name: "FX", slots: [] }, sends: [], meterLevel: "0",
    },
    routingMatrix: {},
  };
  const note = { pitchMidi: 60, velocity: 1, startSec: 0, durSec: 0.5, instrumentId: "lead", trackId: "test" };
  function wavRms(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let sum = 0, count = 0;
    for (let off = 44; off + 1 < bytes.byteLength; off += 2) {
      const v = view.getInt16(off, true) / 32768;
      sum += v * v; count++;
    }
    return Math.sqrt(sum / Math.max(1, count));
  }
  const wavDry = wavRms(await renderNotesToWav([note], { mixer: baseMixer, durationSec: 1 }));
  const mutedMixer = { ...baseMixer, tracks: [{ ...baseMixer.tracks[0], mute: true }] };
  const wavMuted = wavRms(await renderNotesToWav([note], { mixer: mutedMixer, durationSec: 1 }));
  const halfMixer = { ...baseMixer, tracks: [{ ...baseMixer.tracks[0], gainDb: "-6" }] };
  const wavHalf = wavRms(await renderNotesToWav([note], { mixer: halfMixer, durationSec: 1 }));

  return {
    send: { dry: sendDry, full: sendFull, gainDb: 20 * Math.log10(sendFull / sendDry) },
    exportMixer: {
      dryRms: wavDry,
      mutedRms: wavMuted,
      halfGainRms: wavHalf,
      halfGainDb: 20 * Math.log10(wavHalf / wavDry),
    },
    eqLow: { freq: 100, dry: dry.left, processed: eq.left, dropDb: 20 * Math.log10(eq.left / dry.left) },
    eqLow50: { freq: 50, dry: dry50.left, processed: eq50.left, dropDb: 20 * Math.log10(eq50.left / dry50.left) },
    eqHigh: { dry: highDry.left, processed: highEq.left, dropDb: 20 * Math.log10(highEq.left / highDry.left) },
    pan: { left: left.left, right: left.right, centerL: center.left, centerR: center.right },
    mute: { left: muted.left, right: muted.right },
    parity: {
      maxDiffLeft: maxDiff(playback.samples[0], exported.samples[0]),
      maxDiffRight: maxDiff(playback.samples[1], exported.samples[1]),
    },
  };
});

Object.assign(results, measure);

// 截图：混音台可见状态（作为"控件存在"的视觉证据）
await page.getByTestId("tab-mixer").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/mixer.png`, fullPage: true });

await browser.close();

writeFileSync(`${OUT}/evidence.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
