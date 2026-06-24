#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <vector>
#include <memory>
#include <mutex>
#include <functional>

/**
 * PluginFormatRegistry — Central registry for plugin format handlers.
 *
 * Manages multiple AudioPluginFormat instances (VST3, CLAP, etc.),
 * providing unified access and format auto-detection capabilities.
 *
 * Usage:
 *   PluginFormatRegistry registry;
 *   registry.initialize();  // Registers built-in formats
 *   auto format = registry.detectFormat("/path/to/plugin.clap");
 */
class PluginFormatRegistry
{
public:
    PluginFormatRegistry();
    ~PluginFormatRegistry();

    /**
     * Initialize the registry with built-in format handlers.
     * Registers VST3 and CLAP formats by default.
     * @return true if initialization succeeded.
     */
    bool initialize();

    /**
     * Shut down the registry and release all format handlers.
     */
    void shutdown();

    /**
     * Register a custom plugin format handler.
     * Ownership is shared with the caller — the registry holds a reference.
     * @param format Pointer to the format handler (must remain valid).
     */
    void registerFormat(juce::AudioPluginFormat* format);

    /**
     * Register a plugin format handler with shared ownership.
     * @param format Shared pointer to the format handler.
     */
    void registerFormat(std::shared_ptr<juce::AudioPluginFormat> format);

    /**
     * Unregister a format handler by name.
     * @param formatName Name of the format to remove.
     * @return true if the format was found and removed.
     */
    bool unregisterFormat(const juce::String& formatName);

    /**
     * Get a format handler by name.
     * @param formatName Name of the format (e.g., "VST3", "CLAP").
     * @return Pointer to the format handler, or nullptr if not found.
     */
    juce::AudioPluginFormat* getFormat(const juce::String& formatName) const;

    /**
     * Get all registered format names.
     * @return List of format names.
     */
    juce::StringArray getRegisteredFormatNames() const;

    /**
     * Get the number of registered formats.
     */
    int getNumFormats() const;

    /**
     * Detect the plugin format for a file or identifier.
     * @param fileOrIdentifier Path to the plugin file.
     * @return Pointer to the detected format, or nullptr if unknown.
     */
    juce::AudioPluginFormat* detectFormat(const juce::String& fileOrIdentifier) const;

    /**
     * Get the format name for a file or identifier.
     * @param fileOrIdentifier Path to the plugin file.
     * @return Format name, or empty string if unknown.
     */
    juce::String getFormatName(const juce::String& fileOrIdentifier) const;

    /**
     * Check if a file matches any registered format.
     * @param fileOrIdentifier Path to the plugin file.
     * @return true if the file matches a known format.
     */
    bool isKnownPluginFormat(const juce::String& fileOrIdentifier) const;

    /**
     * Get the underlying AudioPluginFormatManager.
     * This includes all registered formats.
     */
    juce::AudioPluginFormatManager& getFormatManager() { return formatManager; }

    /**
     * Check if the registry is initialized.
     */
    bool isInitialized() const { return initialized; }

private:
    struct FormatEntry
    {
        std::shared_ptr<juce::AudioPluginFormat> ownedFormat;
        juce::AudioPluginFormat* rawFormat = nullptr;
        juce::String name;

        juce::AudioPluginFormat* get() const
        {
            return ownedFormat ? ownedFormat.get() : rawFormat;
        }
    };

    juce::AudioPluginFormatManager formatManager;
    std::vector<FormatEntry> formats;
    mutable std::mutex registryMutex;
    bool initialized = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginFormatRegistry)
};
