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
 *   AudioPluginFormatManager manager;
 *   manager.addFormat(new ClapPluginFormat());   // 所有权转移给 manager
 *
 * 注意：addFormat() 会接管所有权并在 manager 析构时 delete。
 * 不要传栈对象地址，也不要传仍被智能指针持有的对象。
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

    juce::String getNameOfPluginFromIdentifier(const juce::String& fileOrIdentifier) override;

    bool pluginNeedsRescanning(const juce::PluginDescription& description) override;

    juce::FileSearchPath getDefaultLocationsToSearch() override;

    bool canScanForPlugins() const override;

    bool isTrivialToScan() const override;

    void findAllTypesForFile(juce::OwnedArray<juce::PluginDescription>& results,
                             const juce::String& fileOrIdentifier) override;

    bool doesPluginStillExist(const juce::PluginDescription& description) override;

    juce::StringArray searchPathsForPlugins(const juce::FileSearchPath& searchPaths,
                                            bool recursive,
                                            bool allowAsync) override;

private:
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ClapPluginFormat)
};
