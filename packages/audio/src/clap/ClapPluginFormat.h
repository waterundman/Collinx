#pragma once

#include <juce_audio_processors/juce_audio_processors.h>

/**
 * ClapPluginFormat — JUCE AudioPluginFormat for CLAP plugins.
 *
 * Registers CLAP as a known plugin format with AudioPluginFormatManager,
 * enabling unified plugin scanning, loading, and instantiation through
 * the standard JUCE plugin hosting API.
 *
 * Usage:
 *   ClapPluginFormat format;
 *   AudioPluginFormatManager manager;
 *   manager.addFormat(&format);
 */
class ClapPluginFormat : public juce::AudioPluginFormat
{
public:
    ClapPluginFormat();
    ~ClapPluginFormat() override;

    // ── AudioPluginFormat interface ─────────────────────────────────────

    juce::String getName() const override;

    void createPluginInstance(const juce::PluginDescription& description,
                              double initialSampleRate,
                              int initialBufferSize,
                              PluginCreationCallback callback) override;

    bool requiresUnblockedMessageThreadDuringCreation(
        const juce::PluginDescription&) const override;

    bool fileMightContainThisPluginType(const juce::String& fileOrIdentifier) override;

    juce::FileSearchPath getDefaultLocationsToSearch() override;

    bool canScanForPlugins() const override;

    void findAllTypesForFile(juce::OwnedArray<juce::PluginDescription>& results,
                             const juce::String& fileOrIdentifier) override;

    bool doesPluginStillExist(const juce::PluginDescription& description) override;

    juce::StringArray searchPathsForPlugins(const juce::FileSearchPath& searchPaths,
                                            bool recursive,
                                            bool allowAsync) override;

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ClapPluginFormat)
};
