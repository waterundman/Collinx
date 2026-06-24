#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginFormatRegistry.h"
#include <vector>
#include <memory>
#include <mutex>
#include <functional>

/**
 * UnifiedPluginManager — Unified plugin management for VST3, CLAP, and more.
 *
 * Provides a single interface for scanning, loading, and managing plugins
 * across all registered formats. Integrates with PluginFormatRegistry for
 * format detection and Vst3HostManager for VST3-specific features.
 *
 * Usage:
 *   UnifiedPluginManager manager;
 *   manager.initialize();
 *   auto plugins = manager.scanAllFormats();
 *   int idx = manager.loadPlugin(plugins[0]);
 *   manager.activatePlugin(idx);
 */
class UnifiedPluginManager
{
public:
    /**
     * Represents a loaded plugin instance with metadata.
     */
    struct LoadedPlugin
    {
        std::unique_ptr<juce::AudioPluginInstance> instance;
        juce::PluginDescription description;
        juce::String formatName;
        bool isActive = false;
        bool isPrepared = false;
        int internalIndex = -1;  // Index within format-specific loader

        LoadedPlugin() = default;
        LoadedPlugin(LoadedPlugin&&) = default;
        LoadedPlugin& operator=(LoadedPlugin&&) = default;
    };

    /**
     * Scan progress callback type.
     * @param formatName Current format being scanned.
     * @param currentFile Current file being processed.
     * @param progress Progress percentage (0-100).
     */
    using ScanProgressCallback = std::function<void(
        const juce::String& formatName,
        const juce::String& currentFile,
        int progress)>;

    /**
     * Plugin state change callback type.
     * @param pluginIndex Index of the plugin that changed.
     * @param newState New state description.
     */
    using PluginStateCallback = std::function<void(
        int pluginIndex,
        const juce::String& newState)>;

    UnifiedPluginManager();
    ~UnifiedPluginManager();

    /**
     * Initialize the unified plugin manager.
     * Sets up format registry and integrates with existing managers.
     * @return true if initialization succeeded.
     */
    bool initialize();

    /**
     * Shut down the manager and unload all plugins.
     */
    void shutdown();

    /**
     * Get the format registry.
     */
    PluginFormatRegistry& getFormatRegistry() { return formatRegistry; }

    // ── Plugin Scanning ─────────────────────────────────────────────────

    /**
     * Scan for plugins in default directories for all registered formats.
     * @return List of discovered plugin descriptions.
     */
    std::vector<juce::PluginDescription> scanAllFormats();

    /**
     * Scan for plugins in specific directories for all formats.
     * @param directories Directories to scan.
     * @return List of discovered plugin descriptions.
     */
    std::vector<juce::PluginDescription> scanDirectories(
        const std::vector<juce::File>& directories);

    /**
     * Scan for plugins of a specific format.
     * @param formatName Name of the format to scan (e.g., "VST3", "CLAP").
     * @return List of discovered plugin descriptions.
     */
    std::vector<juce::PluginDescription> scanFormat(const juce::String& formatName);

    /**
     * Set a callback for scan progress updates.
     */
    void setScanProgressCallback(ScanProgressCallback callback);

    /**
     * Clear the scan cache for all formats.
     */
    void clearScanCache();

    // ── Plugin Loading ──────────────────────────────────────────────────

    /**
     * Load a plugin from a description.
     * @param description Plugin description to load.
     * @param sampleRate Sample rate for initialization.
     * @param blockSize Block size for initialization.
     * @return Index of the loaded plugin, or -1 on failure.
     */
    int loadPlugin(const juce::PluginDescription& description,
                   double sampleRate = 44100.0,
                   int blockSize = 512);

    /**
     * Load a plugin from a file path.
     * Format is auto-detected from the file.
     * @param fileOrIdentifier Path to the plugin file.
     * @param sampleRate Sample rate for initialization.
     * @param blockSize Block size for initialization.
     * @return Index of the loaded plugin, or -1 on failure.
     */
    int loadPluginFromFile(const juce::String& fileOrIdentifier,
                           double sampleRate = 44100.0,
                           int blockSize = 512);

    /**
     * Unload a plugin by index.
     * @param index Index of the plugin to unload.
     */
    void unloadPlugin(int index);

    /**
     * Unload all plugins.
     */
    void unloadAll();

    // ── Plugin Lifecycle ────────────────────────────────────────────────

    /**
     * Activate a plugin.
     * @param index Index of the plugin to activate.
     */
    void activatePlugin(int index);

    /**
     * Deactivate a plugin.
     * @param index Index of the plugin to deactivate.
     */
    void deactivatePlugin(int index);

    /**
     * Prepare a plugin for playback.
     * @param index Index of the plugin.
     * @param sampleRate Sample rate.
     * @param blockSize Block size.
     */
    void preparePlugin(int index, double sampleRate, int blockSize);

    /**
     * Release a plugin's resources.
     * @param index Index of the plugin.
     */
    void releasePlugin(int index);

    // ── Plugin Access ───────────────────────────────────────────────────

    /**
     * Get a loaded plugin by index.
     * @param index Index of the plugin.
     * @return Pointer to the loaded plugin, or nullptr if invalid index.
     */
    LoadedPlugin* getPlugin(int index);

    /**
     * Get the number of loaded plugins.
     */
    int getNumPlugins() const;

    /**
     * Check if a plugin is loaded at the given index.
     */
    bool isPluginLoaded(int index) const;

    /**
     * Get a list of all loaded plugin names.
     */
    juce::StringArray getLoadedPluginNames() const;

    /**
     * Find a loaded plugin by name.
     * @param name Plugin name to search for.
     * @return Index of the plugin, or -1 if not found.
     */
    int findPluginByName(const juce::String& name) const;

    // ── Audio Processing ────────────────────────────────────────────────

    /**
     * Process audio through a plugin.
     * @param index Index of the plugin.
     * @param buffer Audio buffer to process.
     * @param midiBuffer MIDI buffer for the block.
     */
    void processPlugin(int index,
                       juce::AudioBuffer<float>& buffer,
                       const juce::MidiBuffer& midiBuffer);

    // ── Format Queries ──────────────────────────────────────────────────

    /**
     * Get the format name for a file or identifier.
     * @param fileOrIdentifier Path to the plugin file.
     * @return Format name, or empty string if unknown.
     */
    juce::String detectFormatName(const juce::String& fileOrIdentifier) const;

    /**
     * Check if a file matches any known plugin format.
     * @param fileOrIdentifier Path to the plugin file.
     * @return true if the file is a known plugin format.
     */
    bool isKnownPlugin(const juce::String& fileOrIdentifier) const;

    /**
     * Check if the manager is initialized.
     */
    bool isInitialized() const { return initialized; }

    // ── Callbacks ───────────────────────────────────────────────────────

    /**
     * Set a callback for plugin state changes.
     */
    void setPluginStateCallback(PluginStateCallback callback);

private:
    PluginFormatRegistry formatRegistry;
    std::vector<std::unique_ptr<LoadedPlugin>> loadedPlugins;
    mutable std::mutex pluginsMutex;

    ScanProgressCallback scanProgressCallback;
    PluginStateCallback pluginStateCallback;

    bool initialized = false;

    /**
     * Internal: Load a plugin using a specific format.
     */
    int loadPluginWithFormat(juce::AudioPluginFormat* format,
                             const juce::PluginDescription& description,
                             double sampleRate,
                             int blockSize);

    /**
     * Internal: Notify plugin state change.
     */
    void notifyPluginStateChange(int pluginIndex, const juce::String& newState);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(UnifiedPluginManager)
};
