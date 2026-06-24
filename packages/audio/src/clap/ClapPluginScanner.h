#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <vector>
#include <functional>

/**
 * ClapPluginScanner — Scans directories for CLAP plugins.
 *
 * Discovers .clap files in platform-default and user-specified paths.
 * Supports CLAP_PATH environment variable for custom search locations.
 */
class ClapPluginScanner
{
public:
    ClapPluginScanner();
    ~ClapPluginScanner();

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
     * Scan for plugins in the default CLAP directories.
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
     * Scan paths from the CLAP_PATH environment variable.
     * @return List of plugin descriptions found.
     */
    std::vector<juce::PluginDescription> scanClapPathEnv();

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
     * Check if a file is a CLAP plugin.
     * @param file File to check.
     * @return true if the file has the .clap extension.
     */
    static bool isClapPlugin(const juce::File& file);

    /**
     * Get default CLAP scan paths for the current platform.
     *
     * Windows:
     *   - %COMMONPROGRAMFILES%/CLAP
     *   - %LOCALAPPDATA%/Programs/Common/CLAP
     * macOS:
     *   - /Library/Audio/Plug-Ins/CLAP
     *   - ~/Library/Audio/Plug-Ins/CLAP
     * Linux:
     *   - ~/.clap
     *   - /usr/lib/clap
     *
     * @return List of default directories.
     */
    static std::vector<juce::File> getDefaultScanPaths();

    /**
     * Parse directories from the CLAP_PATH environment variable.
     * @return List of directories from CLAP_PATH.
     */
    static std::vector<juce::File> getClapPathDirectories();

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

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ClapPluginScanner)
};
