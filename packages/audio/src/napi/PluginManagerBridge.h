#pragma once

#include <napi.h>
#include <memory>
#include <mutex>
#include "../vst3/Vst3HostManager.h"

/**
 * PluginManagerBridge — N-API bridge for VST3 plugin management.
 *
 * Exposes plugin scanning, loading, unloading, and querying to TypeScript.
 * All methods are thread-safe and return JavaScript-friendly data structures.
 *
 * Usage from TypeScript:
 *   const manager = new PluginManagerBridge();
 *   manager.initialize();
 *   const plugins = await manager.scanDefaultPaths();
 *   const pluginId = manager.loadPlugin(plugins[0].id);
 *   manager.unloadPlugin(pluginId);
 */
class PluginManagerBridge : public Napi::ObjectWrap<PluginManagerBridge>
{
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    PluginManagerBridge(const Napi::CallbackInfo& info);
    ~PluginManagerBridge();

private:
    // ── Lifecycle ──────────────────────────────────────────────────────

    /**
     * Initialize the VST3 host manager.
     * @returns boolean indicating success.
     */
    Napi::Value Initialize(const Napi::CallbackInfo& info);

    /**
     * Shutdown the host manager and unload all plugins.
     */
    void Shutdown(const Napi::CallbackInfo& info);

    /**
     * Check if the host manager is initialized.
     * @returns boolean.
     */
    Napi::Value IsInitialized(const Napi::CallbackInfo& info);

    // ── Scanning ───────────────────────────────────────────────────────

    /**
     * Scan for plugins in default VST3 directories (async).
     * @returns Promise<PluginDescription[]>.
     */
    Napi::Value ScanDefaultPaths(const Napi::CallbackInfo& info);

    /**
     * Scan for plugins in a specific directory (async).
     * @param directoryPath string — path to scan.
     * @returns Promise<PluginDescription[]>.
     */
    Napi::Value ScanDirectory(const Napi::CallbackInfo& info);

    /**
     * Get cached scan results.
     * @returns PluginDescription[].
     */
    Napi::Value GetCachedResults(const Napi::CallbackInfo& info);

    /**
     * Clear the scan cache.
     */
    void ClearCache(const Napi::CallbackInfo& info);

    /**
     * Get default VST3 scan paths for the current platform.
     * @returns string[].
     */
    Napi::Value GetDefaultScanPaths(const Napi::CallbackInfo& info);

    // ── Loading ────────────────────────────────────────────────────────

    /**
     * Load a plugin by its description ID from scan results.
     * @param descriptionId string — plugin ID from scan results.
     * @param sampleRate number (optional, default 44100).
     * @param blockSize number (optional, default 512).
     * @returns number — plugin index, or -1 on failure.
     */
    Napi::Value LoadPlugin(const Napi::CallbackInfo& info);

    /**
     * Load a plugin from a file path.
     * @param filePath string — path to the .vst3 file.
     * @param sampleRate number (optional, default 44100).
     * @param blockSize number (optional, default 512).
     * @returns number — plugin index, or -1 on failure.
     */
    Napi::Value LoadPluginFromFile(const Napi::CallbackInfo& info);

    /**
     * Unload a plugin by index.
     * @param index number.
     */
    void UnloadPlugin(const Napi::CallbackInfo& info);

    /**
     * Unload all plugins.
     */
    void UnloadAll(const Napi::CallbackInfo& info);

    // ── Plugin State ───────────────────────────────────────────────────

    /**
     * Activate a plugin.
     * @param index number.
     */
    void ActivatePlugin(const Napi::CallbackInfo& info);

    /**
     * Deactivate a plugin.
     * @param index number.
     */
    void DeactivatePlugin(const Napi::CallbackInfo& info);

    /**
     * Prepare a plugin for playback.
     * @param index number.
     * @param sampleRate number.
     * @param blockSize number.
     */
    void PreparePlugin(const Napi::CallbackInfo& info);

    /**
     * Release a plugin's resources.
     * @param index number.
     */
    void ReleasePlugin(const Napi::CallbackInfo& info);

    // ── Queries ────────────────────────────────────────────────────────

    /**
     * Get the number of loaded plugins.
     * @returns number.
     */
    Napi::Value GetNumPlugins(const Napi::CallbackInfo& info);

    /**
     * Check if a plugin is loaded at the given index.
     * @param index number.
     * @returns boolean.
     */
    Napi::Value IsPluginLoaded(const Napi::CallbackInfo& info);

    /**
     * Get plugin info by index.
     * @param index number.
     * @returns { name, vendor, category, isInstrument, numInputChannels, numOutputChannels, isActive, isPrepared }.
     */
    Napi::Value GetPluginInfo(const Napi::CallbackInfo& info);

    /**
     * Get all loaded plugins info.
     * @returns PluginInfo[].
     */
    Napi::Value GetAllPluginsInfo(const Napi::CallbackInfo& info);

    // ── Helpers ────────────────────────────────────────────────────────

    /**
     * Convert a juce::PluginDescription to a Napi::Object.
     */
    static Napi::Object PluginDescriptionToObject(Napi::Env env,
                                                   const juce::PluginDescription& desc);

    /**
     * Convert scan results to a Napi::Array.
     */
    static Napi::Array PluginDescriptionsToArray(Napi::Env env,
                                                  const std::vector<juce::PluginDescription>& descriptions);

    // ── Members ────────────────────────────────────────────────────────

    std::unique_ptr<Vst3HostManager> hostManager;
    std::mutex bridgeMutex;

    // Cached descriptions keyed by identifier for loadPlugin lookup
    std::unordered_map<std::string, juce::PluginDescription> descriptionCache;

    // ── Async Workers ──────────────────────────────────────────────────

    /**
     * AsyncWorker for scanning plugins.
     */
    class ScanWorker : public Napi::AsyncWorker
    {
    public:
        ScanWorker(Napi::Env env, Vst3PluginScanner* scanner, bool useDefaultPaths, const std::string& dir);
        void Execute() override;
        void OnOK() override;
        void OnError(const Napi::Error& error) override;

    private:
        Vst3PluginScanner* scanner;
        bool useDefaultPaths;
        std::string directory;
        std::vector<juce::PluginDescription> results;
        Napi::Promise::Deferred deferred;
    };
};
