/* eslint-disable @typescript-eslint/no-explicit-any */
type EventHandler = (...args: any[]) => void;

class BrowserEventEmitter {
  private listeners: Map<string, Set<EventHandler>> = new Map();
  private maxListeners = 10;

  on(event: string, handler: EventHandler): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const handlers = this.listeners.get(event)!;
    if (handlers.size >= this.maxListeners) {
      console.warn(`MaxListenersExceededWarning: Possible memory leak. ${handlers.size + 1} listeners added for event "${event}".`);
    }
    handlers.add(handler);
    return this;
  }

  off(event: string, handler: EventHandler): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const handlers = this.listeners.get(event);
    if (!handlers || handlers.size === 0) return false;
    for (const handler of handlers) {
      handler(...args);
    }
    return true;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  setMaxListeners(n: number): this {
    this.maxListeners = n;
    return this;
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

export interface Vst3PluginInfo {
  id: string;
  name: string;
  vendor: string;
  version: string;
  category: string;
  path: string;
  isLoaded: boolean;
  hasEditor: boolean;
  inputChannels: number;
  outputChannels: number;
}

export interface Vst3Parameter {
  id: number;
  name: string;
  label: string;
  value: number;
  defaultValue: number;
  minValue: number;
  maxValue: number;
  step: number;
  isAutomatable: boolean;
}

export interface Vst3Preset {
  id: string;
  name: string;
  category: string;
}

export type Vst3EventType =
  | "pluginLoaded"
  | "pluginUnloaded"
  | "parameterChanged"
  | "editorOpened"
  | "editorClosed"
  | "presetLoaded"
  | "scanProgress"
  | "error";

export interface Vst3Event {
  type: Vst3EventType;
  pluginId?: string;
  data?: unknown;
}

export interface ScanProgress {
  scanned: number;
  total: number;
  currentPath: string;
}

export class Vst3HostService extends BrowserEventEmitter {
  private plugins: Map<string, Vst3PluginInfo> = new Map();
  private parameters: Map<string, Vst3Parameter[]> = new Map();
  private presets: Map<string, Vst3Preset[]> = new Map();
  private scanPaths: string[] = [];
  private isScanning = false;
  private initialized = false;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.scanPaths = this.getDefaultScanPaths();
      this.initialized = true;
      this.emitEvent({ type: "scanProgress", data: { status: "initialized" } });
    } catch (error) {
      this.emitEvent({ type: "error", data: { message: "Failed to initialize VST3 host", error } });
      throw error;
    }
  }

  async dispose(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.isLoaded) {
        await this.unloadPlugin(plugin.id);
      }
    }
    this.plugins.clear();
    this.parameters.clear();
    this.presets.clear();
    this.removeAllListeners();
    this.initialized = false;
  }

  async scanForPlugins(paths?: string[]): Promise<Vst3PluginInfo[]> {
    if (this.isScanning) {
      throw new Error("Scan already in progress");
    }

    this.isScanning = true;
    const scanPaths = paths || this.scanPaths;
    const discoveredPlugins: Vst3PluginInfo[] = [];

    try {
      const totalPaths = scanPaths.length;
      for (let i = 0; i < totalPaths; i++) {
        const scanPath = scanPaths[i];
        this.emitEvent({
          type: "scanProgress",
          data: { scanned: i, total: totalPaths, currentPath: scanPath } as ScanProgress,
        });

        const plugins = await this.scanDirectory(scanPath);
        discoveredPlugins.push(...plugins);
      }

      for (const plugin of discoveredPlugins) {
        this.plugins.set(plugin.id, plugin);
      }

      return discoveredPlugins;
    } finally {
      this.isScanning = false;
    }
  }

  async loadPlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (plugin.isLoaded) return true;

    try {
      plugin.isLoaded = true;
      this.plugins.set(pluginId, plugin);
      this.emitEvent({ type: "pluginLoaded", pluginId });
      return true;
    } catch (error) {
      this.emitEvent({ type: "error", pluginId, data: { message: "Failed to load plugin", error } });
      return false;
    }
  }

  async unloadPlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (!plugin.isLoaded) return true;

    try {
      plugin.isLoaded = false;
      this.plugins.set(pluginId, plugin);
      this.emitEvent({ type: "pluginUnloaded", pluginId });
      return true;
    } catch (error) {
      this.emitEvent({ type: "error", pluginId, data: { message: "Failed to unload plugin", error } });
      return false;
    }
  }

  getPlugin(pluginId: string): Vst3PluginInfo | undefined {
    return this.plugins.get(pluginId);
  }

  getAllPlugins(): Vst3PluginInfo[] {
    return Array.from(this.plugins.values());
  }

  getLoadedPlugins(): Vst3PluginInfo[] {
    return this.getAllPlugins().filter((p) => p.isLoaded);
  }

  async getParameters(pluginId: string): Promise<Vst3Parameter[]> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (!plugin.isLoaded) {
      throw new Error(`Plugin not loaded: ${pluginId}`);
    }

    return this.parameters.get(pluginId) || [];
  }

  async setParameter(pluginId: string, paramId: number, value: number): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    if (!plugin.isLoaded) {
      throw new Error(`Plugin not loaded: ${pluginId}`);
    }

    const params = this.parameters.get(pluginId) || [];
    const param = params.find((p) => p.id === paramId);
    if (!param) {
      throw new Error(`Parameter not found: ${paramId}`);
    }

    const clampedValue = Math.max(param.minValue, Math.min(param.maxValue, value));
    param.value = clampedValue;

    this.emitEvent({
      type: "parameterChanged",
      pluginId,
      data: { paramId, value: clampedValue },
    });
  }

  async getPresets(pluginId: string): Promise<Vst3Preset[]> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    return this.presets.get(pluginId) || [];
  }

  async loadPreset(pluginId: string, presetId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const presets = this.presets.get(pluginId) || [];
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    this.emitEvent({
      type: "presetLoaded",
      pluginId,
      data: { presetId },
    });
  }

  addScanPath(path: string): void {
    if (!this.scanPaths.includes(path)) {
      this.scanPaths.push(path);
    }
  }

  removeScanPath(path: string): void {
    this.scanPaths = this.scanPaths.filter((p) => p !== path);
  }

  getScanPaths(): string[] {
    return [...this.scanPaths];
  }

  isPluginLoaded(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.isLoaded ?? false;
  }

  isScanInProgress(): boolean {
    return this.isScanning;
  }

  private async scanDirectory(path: string): Promise<Vst3PluginInfo[]> {
    const plugins: Vst3PluginInfo[] = [];

    const mockPlugins: Vst3PluginInfo[] = [
      {
        id: `vst3-${Date.now()}-1`,
        name: "Reverb Pro",
        vendor: "AudioDSP",
        version: "2.1.0",
        category: "Effect",
        path: `${path}/ReverbPro.vst3`,
        isLoaded: false,
        hasEditor: true,
        inputChannels: 2,
        outputChannels: 2,
      },
      {
        id: `vst3-${Date.now()}-2`,
        name: "Synth Master",
        vendor: "VirtualSound",
        version: "3.5.2",
        category: "Instrument",
        path: `${path}/SynthMaster.vst3`,
        isLoaded: false,
        hasEditor: true,
        inputChannels: 0,
        outputChannels: 2,
      },
      {
        id: `vst3-${Date.now()}-3`,
        name: "Compressor X",
        vendor: "DynamicsLab",
        version: "1.0.0",
        category: "Effect",
        path: `${path}/CompressorX.vst3`,
        isLoaded: false,
        hasEditor: false,
        inputChannels: 2,
        outputChannels: 2,
      },
    ];

    plugins.push(...mockPlugins);

    for (const plugin of plugins) {
      this.parameters.set(plugin.id, this.generateMockParameters());
      this.presets.set(plugin.id, this.generateMockPresets(plugin.id));
    }

    return plugins;
  }

  private getDefaultScanPaths(): string[] {
    const paths: string[] = [];

    paths.push("C:/Program Files/Common Files/VST3");
    paths.push("C:/Program Files (x86)/Common Files/VST3");
    paths.push("D:/VST3 Plugins");

    return paths;
  }

  private generateMockParameters(): Vst3Parameter[] {
    return [
      { id: 0, name: "gain", label: "Gain", value: 0.5, defaultValue: 0.5, minValue: 0, maxValue: 1, step: 0.01, isAutomatable: true },
      { id: 1, name: "mix", label: "Mix", value: 1.0, defaultValue: 1.0, minValue: 0, maxValue: 1, step: 0.01, isAutomatable: true },
      { id: 2, name: "bypass", label: "Bypass", value: 0, defaultValue: 0, minValue: 0, maxValue: 1, step: 1, isAutomatable: false },
      { id: 3, name: "volume", label: "Volume", value: 0.75, defaultValue: 0.75, minValue: 0, maxValue: 1, step: 0.01, isAutomatable: true },
    ];
  }

  private generateMockPresets(pluginId: string): Vst3Preset[] {
    return [
      { id: `${pluginId}-preset-1`, name: "Default", category: "Init" },
      { id: `${pluginId}-preset-2`, name: "Warm Hall", category: "Reverb" },
      { id: `${pluginId}-preset-3`, name: "Bright Room", category: "Reverb" },
    ];
  }

  private emitEvent(event: Vst3Event): void {
    this.emit(event.type, event);
    this.emit("event", event);
  }
}

let instance: Vst3HostService | null = null;

export function getVst3HostService(): Vst3HostService {
  if (!instance) {
    instance = new Vst3HostService();
  }
  return instance;
}

export function resetVst3HostService(): void {
  if (instance) {
    instance.dispose();
    instance = null;
  }
}
