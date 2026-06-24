#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <vector>
#include <memory>
#include <mutex>

/**
 * Vst3PluginLoader — Loads and manages VST3 plugin instances.
 *
 * Handles plugin lifecycle including creation, activation, deactivation, and destruction.
 */
class Vst3PluginLoader
{
public:
    /**
     * Represents a loaded plugin instance with its state.
     */
    struct LoadedPlugin
    {
        std::unique_ptr<juce::AudioPluginInstance> instance;
        juce::PluginDescription description;
        bool isActive = false;
        bool isPrepared = false;

        LoadedPlugin() = default;
        LoadedPlugin(LoadedPlugin&&) = default;
        LoadedPlugin& operator=(LoadedPlugin&&) = default;
    };

    Vst3PluginLoader();
    ~Vst3PluginLoader();

    /**
     * Initialize the loader.
     * @param formatManager Pointer to the AudioPluginFormatManager.
     * @return true if initialization succeeded.
     */
    bool initialize(juce::AudioPluginFormatManager* formatManager);

    /**
     * Shut down the loader and unload all plugins.
     */
    void shutdown();

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
     * Process audio through a plugin.
     * @param index Index of the plugin.
     * @param buffer Audio buffer to process.
     * @param midiBuffer MIDI buffer for the block.
     */
    void processPlugin(int index,
                       juce::AudioBuffer<float>& buffer,
                       const juce::MidiBuffer& midiBuffer);

private:
    juce::AudioPluginFormatManager* formatManager = nullptr;
    std::vector<std::unique_ptr<LoadedPlugin>> loadedPlugins;
    mutable std::mutex pluginsMutex;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Vst3PluginLoader)
};
