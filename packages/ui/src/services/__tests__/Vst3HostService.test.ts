import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Vst3HostService, getVst3HostService, resetVst3HostService } from "../Vst3HostService";

describe("Vst3HostService", () => {
  let service: Vst3HostService;

  beforeEach(() => {
    resetVst3HostService();
    service = new Vst3HostService();
  });

  afterEach(() => {
    service.dispose();
  });

  it("creates an instance", () => {
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(Vst3HostService);
  });

  it("initializes successfully", async () => {
    await service.initialize();
    expect(service.getScanPaths().length).toBeGreaterThan(0);
  });

  it("returns empty plugins list initially", () => {
    const plugins = service.getAllPlugins();
    expect(plugins).toEqual([]);
  });

  it("scans for plugins", async () => {
    await service.initialize();
    const plugins = await service.scanForPlugins();
    expect(plugins.length).toBeGreaterThan(0);
    expect(plugins[0]).toHaveProperty("id");
    expect(plugins[0]).toHaveProperty("name");
    expect(plugins[0]).toHaveProperty("vendor");
  });

  it("loads a plugin", async () => {
    await service.initialize();
    const plugins = await service.scanForPlugins();
    const pluginId = plugins[0].id;

    const result = await service.loadPlugin(pluginId);
    expect(result).toBe(true);
    expect(service.isPluginLoaded(pluginId)).toBe(true);
  });

  it("unloads a plugin", async () => {
    await service.initialize();
    const plugins = await service.scanForPlugins();
    const pluginId = plugins[0].id;

    await service.loadPlugin(pluginId);
    const result = await service.unloadPlugin(pluginId);
    expect(result).toBe(true);
    expect(service.isPluginLoaded(pluginId)).toBe(false);
  });

  it("gets parameters for loaded plugin", async () => {
    await service.initialize();
    const plugins = await service.scanForPlugins();
    const pluginId = plugins[0].id;

    await service.loadPlugin(pluginId);
    const params = await service.getParameters(pluginId);
    expect(params.length).toBeGreaterThan(0);
    expect(params[0]).toHaveProperty("id");
    expect(params[0]).toHaveProperty("name");
    expect(params[0]).toHaveProperty("value");
  });

  it("sets parameter value", async () => {
    await service.initialize();
    const plugins = await service.scanForPlugins();
    const pluginId = plugins[0].id;

    await service.loadPlugin(pluginId);
    await service.setParameter(pluginId, 0, 0.75);

    const params = await service.getParameters(pluginId);
    const param = params.find((p) => p.id === 0);
    expect(param?.value).toBe(0.75);
  });

  it("gets presets for plugin", async () => {
    await service.initialize();
    const plugins = await service.scanForPlugins();
    const pluginId = plugins[0].id;

    await service.loadPlugin(pluginId);
    const presets = await service.getPresets(pluginId);
    expect(presets.length).toBeGreaterThan(0);
    expect(presets[0]).toHaveProperty("id");
    expect(presets[0]).toHaveProperty("name");
  });

  it("adds and removes scan paths", () => {
    const testPath = "/test/path";
    service.addScanPath(testPath);
    expect(service.getScanPaths()).toContain(testPath);

    service.removeScanPath(testPath);
    expect(service.getScanPaths()).not.toContain(testPath);
  });

  it("emits events on plugin load", async () => {
    await service.initialize();
    const plugins = await service.scanForPlugins();
    const pluginId = plugins[0].id;

    let emitted = false;
    service.on("pluginLoaded", () => {
      emitted = true;
    });

    await service.loadPlugin(pluginId);
    expect(emitted).toBe(true);
  });

  it("throws error for non-existent plugin", async () => {
    await expect(service.loadPlugin("non-existent")).rejects.toThrow("Plugin not found");
  });

  it("singleton service works correctly", () => {
    const instance1 = getVst3HostService();
    const instance2 = getVst3HostService();
    expect(instance1).toBe(instance2);
  });
});
