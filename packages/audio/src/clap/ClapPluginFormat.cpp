#include "ClapPluginFormat.h"
#include "ClapPluginScanner.h"
#include "ClapPluginLoader.h"

ClapPluginFormat::ClapPluginFormat() = default;

ClapPluginFormat::~ClapPluginFormat() = default;

juce::String ClapPluginFormat::getName() const
{
    return "CLAP";
}

void ClapPluginFormat::createPluginInstance(
    const juce::PluginDescription& description,
    double initialSampleRate,
    int initialBufferSize,
    PluginCreationCallback callback)
{
    if (description.pluginFormatName != getName())
    {
        callback(nullptr, "Invalid plugin format: expected CLAP");
        return;
    }

    ClapPluginLoader loader;
    auto instance = loader.createInstance(description, initialSampleRate, initialBufferSize);

    if (instance != nullptr)
        callback(std::move(instance), {});
    else
        callback(nullptr, "Failed to load CLAP plugin: " + description.name);
}

bool ClapPluginFormat::requiresUnblockedMessageThreadDuringCreation(
    const juce::PluginDescription&) const
{
    return false;
}

bool ClapPluginFormat::fileMightContainThisPluginType(const juce::String& fileOrIdentifier)
{
    return ClapPluginScanner::isClapPlugin(juce::File(fileOrIdentifier));
}

juce::FileSearchPath ClapPluginFormat::getDefaultLocationsToSearch()
{
    juce::FileSearchPath paths;

    for (const auto& dir : ClapPluginScanner::getDefaultScanPaths())
        paths.addIfNotAlreadyThere(dir);

    return paths;
}

bool ClapPluginFormat::canScanForPlugins() const
{
    return true;
}

void ClapPluginFormat::findAllTypesForFile(
    juce::OwnedArray<juce::PluginDescription>& results,
    const juce::String& fileOrIdentifier)
{
    juce::File file(fileOrIdentifier);

    if (!ClapPluginScanner::isClapPlugin(file))
        return;

    ClapPluginLoader loader;
    loader.findDescriptions(fileOrIdentifier, results);
}

bool ClapPluginFormat::doesPluginStillExist(const juce::PluginDescription& description)
{
    juce::File file(description.fileOrIdentifier);
    return file.existsAsFile();
}

juce::StringArray ClapPluginFormat::searchPathsForPlugins(
    const juce::FileSearchPath& searchPaths,
    bool recursive,
    bool /*allowAsync*/)
{
    juce::StringArray results;

    for (int i = 0; i < searchPaths.getNumPaths(); ++i)
    {
        auto dir = searchPaths[i];

        juce::Array<juce::File> files;
        dir.findChildFiles(files,
                           recursive ? juce::File::findFiles : juce::File::findFilesAndDirectories,
                           recursive,
                           "*.clap");

        for (const auto& file : files)
            results.add(file.getFullPathName());
    }

    return results;
}
