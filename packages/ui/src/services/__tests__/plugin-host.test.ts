import { describe, it, expect, afterEach } from "vitest";
import { isPluginHostAvailable, loadPlugin, scanInstalledPlugins } from "../plugin-host";

/**
 * v3.1.0：插件宿主适配层的红线测试。
 *
 * 被它取代的 Vst3HostService 曾返回三个硬编码插件，导致整个插件界面在
 * 浏览器里也能"扫描成功"。这里的断言只有一条核心：**没有宿主就没有数据**。
 */

type GlobalWithBridge = { collinx?: unknown };

function setBridge(value: unknown): void {
  (globalThis as GlobalWithBridge).collinx = value;
}

afterEach(() => {
  delete (globalThis as GlobalWithBridge).collinx;
});

const baseAudioEngine = {
  load: async () => ({ status: "ready" as const }),
  info: async () => ({ status: "ready" as const }),
  start: async () => true,
  stop: async () => undefined,
};

describe("plugin-host", () => {
  it("reports unavailable in a browser and returns NO plugins", async () => {
    expect(isPluginHostAvailable()).toBe(false);

    const outcome = await scanInstalledPlugins();
    expect(outcome.status).toBe("unavailable");
    // 关键：不可用时不能有任何伪造条目
    expect("plugins" in outcome ? outcome.plugins : []).toHaveLength(0);
  });

  it("is unavailable when the desktop bridge exists but has no plugins namespace", async () => {
    setBridge({ isDesktop: true, platform: "win32", audioEngine: baseAudioEngine });

    expect(isPluginHostAvailable()).toBe(false);
    const outcome = await scanInstalledPlugins();
    expect(outcome.status).toBe("unavailable");
  });

  it("passes through the real scan result from the bridge", async () => {
    setBridge({
      isDesktop: true,
      platform: "win32",
      audioEngine: baseAudioEngine,
      plugins: {
        scan: async () => ({
          ok: true,
          plugins: [
            { id: "vst3:abc", name: "RealPlugin", format: "vst3", path: "/x/RealPlugin.vst3", hasBinary: true },
          ],
        }),
        load: async (id: string) => ({ ok: false, pluginId: id, reason: "宿主未接线" }),
      },
    });

    expect(isPluginHostAvailable()).toBe(true);
    const outcome = await scanInstalledPlugins();
    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") throw new Error("unreachable");
    expect(outcome.plugins).toHaveLength(1);
    expect(outcome.plugins[0].name).toBe("RealPlugin");
  });

  it("surfaces the host reason instead of inventing a success", async () => {
    setBridge({
      isDesktop: true,
      platform: "win32",
      audioEngine: baseAudioEngine,
      plugins: {
        scan: async () => ({ ok: false, reason: "目录无权限", plugins: [] }),
        load: async (id: string) => ({ ok: false, pluginId: id, reason: "宿主未接线" }),
      },
    });

    const outcome = await scanInstalledPlugins();
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") throw new Error("unreachable");
    expect(outcome.reason).toBe("目录无权限");
  });

  it("load returns ok:false with the host's reason in the browser", async () => {
    const res = await loadPlugin("vst3:abc");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("插件宿主不可用");
  });
});
