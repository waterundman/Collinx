#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <vector>
#include <functional>

/**
 * Vst3PluginScanner — Scans directories for VST3 plugins.
 *
 * Provides plugin discovery with caching and async scanning support.
 */
class Vst3PluginScanner
{
public:
    Vst3PluginScanner();
    ~Vst3PluginScanner();

    /**
     * Initialize the scanner.
     * @param formatManager Pointer to the AudioPluginFormatManager.
     * @return true if initialization succeeded.
     */
    bool initialize(juce::AudioPluginFormatManager* formatManager);

    /**
     * Shut down the scanner and release resources.
     */
    void shutdown();

    /**
     * Scan for plugins in the default VST3 directories.
     * @return List of plugin descriptions found.
     */
    std::vector<juce::PluginDescription> scanDefaultPaths();

    /**
     * Scan for plugins in a specific directory.
     * @param directory Path to scan.
     * @return List of plugin descriptions found.
     */
    std::vector<juce::PluginDescription> scanDirectory(const juce::File& directory);

    /**
     * Scan for plugins in multiple directories.
     * @param directories List of paths to scan.
     * @return List of plugin descriptions found.
     */
    std::vector<juce::PluginDescription> scanDirectories(
        const std::vector<juce::File>& directories);

    /**
     * Get cached scan results.
     * @return Cached plugin descriptions.
     */
    const std::vector<juce::PluginDescription>& getCachedResults() const;

    /**
     * Clear the scan cache.
     */
    void clearCache();

    /**
     * Check if a file is a VST3 plugin.
     * @param file File to check.
     * @return true if the file appears to be a VST3 plugin.
     */
    static bool isVst3Plugin(const juce::File& file);

    /**
     * Get default VST3 scan paths for the current platform.
     * @return List of default directories.
     */
    static std::vector<juce::File> getDefaultScanPaths();

    using ScanProgressCallback = std::function<void(const juce::String& currentFile, int progress)>;

    /**
     * Set a callback for scan progress updates.
     */
    void setProgressCallback(ScanProgressCallback callback);

private:
    void scanDirectoryInternal(const juce::File& directory,
                               std::vector<juce::PluginDescription>& results);

    juce::AudioPluginFormatManager* formatManager = nullptr;
    std::vector<juce::PluginDescription> cachedResults;
    ScanProgressCallback progressCallback;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(Vst3PluginScanner)
};
