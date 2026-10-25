import { describe, it, expect, vi, afterEach } from "vitest";
import { AudioPreview, latencyHintForBufferSize } from "../audio-preview";

/**
 * v2.9.4：设置 audio.* 从此真的进入 AudioContext 创建参数。
 * ① 采样率/延迟档位 ② 设备不支持采样率时回退（不能静音）③ setSinkId 输出设备。
 */
function makeFakeAudioContext(opts: { throwOnSampleRate?: boolean; supportSink?: boolean } = {}) {
  const created: unknown[] = [];
  const sinkCalls: string[] = [];

  class FakeNode {
    gain = { value: 0, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
    pan = { value: 0, setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() };
    fftSize = 0;
    threshold = { value: 0 };
    knee = { value: 0 };
    ratio = { value: 1 };
    attack = { value: 0 };
    release = { value: 0 };
    connect(target: unknown) {
      return target;
    }
    disconnect() {
      /* noop */
    }
  }

  class FakeAudioContext {
    state: AudioContextState = "running";
    sampleRate = 44100;
    baseLatency = 0.005;
    currentTime = 0;
    destination = new FakeNode();

    constructor(options?: AudioContextOptions) {
      created.push(options ?? null);
      if (opts.throwOnSampleRate && options?.sampleRate !== undefined) {
        throw new Error("NotSupportedError: sampleRate");
      }
    }

    resume = vi.fn(async () => undefined);
    createGain = () => new FakeNode();
    createAnalyser = () => new FakeNode();
    createStereoPanner = () => new FakeNode();
    createDynamicsCompressor = () => new FakeNode();

    setSinkId = opts.supportSink === false
      ? undefined
      : vi.fn(async (id: string) => {
          sinkCalls.push(id);
        });
  }

  return {
    created,
    sinkCalls,
    install() {
      vi.stubGlobal("AudioContext", FakeAudioContext);
    },
    uninstall() {
      vi.unstubAllGlobals();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("latencyHintForBufferSize", () => {
  it("≤256 → interactive；≤1024 → balanced；更大 → playback", () => {
    expect(latencyHintForBufferSize(64)).toBe("interactive");
    expect(latencyHintForBufferSize(256)).toBe("interactive");
    expect(latencyHintForBufferSize(512)).toBe("balanced");
    expect(latencyHintForBufferSize(1024)).toBe("balanced");
    expect(latencyHintForBufferSize(2048)).toBe("playback");
  });

  it("非法值回退 balanced", () => {
    expect(latencyHintForBufferSize(0)).toBe("balanced");
    expect(latencyHintForBufferSize(Number.NaN)).toBe("balanced");
  });
});

describe("AudioPreview 上下文创建参数", () => {
  it("sampleRate 与 latencyHint 传给 AudioContext 构造器", async () => {
    const fake = makeFakeAudioContext();
    fake.install();
    const preview = new AudioPreview({ sampleRate: 96000, latencyHint: "playback" });

    await expect(preview.ensureStarted()).resolves.toBe(true);
    expect(fake.created[0]).toMatchObject({ sampleRate: 96000, latencyHint: "playback" });
  });

  it("设备不支持采样率时回退默认参数（不能整条链静音）", async () => {
    const fake = makeFakeAudioContext({ throwOnSampleRate: true });
    fake.install();
    const preview = new AudioPreview({ sampleRate: 96000 });

    await expect(preview.ensureStarted()).resolves.toBe(true);
    // 第二次构造是回退（无参数）
    expect(fake.created).toHaveLength(2);
    expect(fake.created[1]).toBeNull();
  });

  it("setSinkId 存在时按输出设备切换；不存在时忽略", async () => {
    const fake = makeFakeAudioContext();
    fake.install();
    const preview = new AudioPreview({ outputDeviceId: "device-a" });
    await preview.ensureStarted();

    await expect(preview.setOutputDevice("device-b")).resolves.toBe(true);
    expect(fake.sinkCalls).toEqual(["device-a", "device-b"]);
  });

  it("不支持 setSinkId 的环境：setOutputDevice 返回 false 且不抛错", async () => {
    const fake = makeFakeAudioContext({ supportSink: false });
    fake.install();
    const preview = new AudioPreview({ outputDeviceId: "device-a" });
    await preview.ensureStarted();

    await expect(preview.setOutputDevice("device-b")).resolves.toBe(false);
  });
});
