#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include "Vst3PluginScanner.h"
#include "Vst3PluginLoader.h"

// Forward declaration for UnifiedPluginManager integration
class UnifiedPluginManager;

/**
 * Vst3HostManager — Central manager for VST3 plugin hosting.
 *
 * Coordinates plugin scanning, loading, and lifecycle management.
 * Wraps juce::AudioPluginFormatManager with VST3-specific functionality.
 *
 * Can optionally integrate with UnifiedPluginManager for multi-format support.
 */
class Vst3HostManager
{
public:
    Vst3HostManager();
    ~Vst3HostManager();

    /**
     * Initialize the host manager.
     * Registers VST3 format with AudioPluginFormatManager.
     * @return true if initialization succeeded.
     */
    bool initialize();

    /**
     * Shut down the host manager.
     * Unloads all plugins and releases resources.
     */
    void shutdown();

    /**
     * Get the plugin scanner.
     */
    Vst3PluginScanner& getScanner() { return scanner; }

    /**
     * Get the plugin loader.
     */
    Vst3PluginLoader& getLoader() { return loader; }

    /**
     * Get the underlying AudioPluginFormatManager.
     */
    juce::AudioPluginFormatManager& getFormatManager() { return formatManager; }

    /**
     * Check if the host manager is initialized.
     */
    bool isInitialized() const { return initialized; }

    /**
     * Set the unified plugin manager for multi-format integration.
     * When set, VST3 operations will be coordinated through the unified manager.
     * @param manager Pointer to the UnifiedPluginManager (lifetime managed externally).
     */
    void setUnifiedManager(UnifiedPluginManager* manager);

    /**
     * Get the unified plugin manager (if set).
     * @return Pointer to UnifiedPluginManager, or nullptr if not integrated.
     */
    UnifiedPluginManager* getUnifiedManager() const { return unifiedManager; }

    /**
     * Check if integrated with UnifiedPluginManager.
     */
    bool hasUnifiedManager() const { return unifiedManager != nullptr; }

private:
    juce::AudioPluginFormatManager formatManager;
    Vst3PluginScanner scanner;
    Vst3PluginLoader loader;
    UnifiedPluginManager* unifiedManager = nullptr;

    bool initialized = false;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Vst3HostManager)
};
