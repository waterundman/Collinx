#include "Vst3PluginScanner.h"

Vst3PluginScanner::Vst3PluginScanner() = default;

Vst3PluginScanner::~Vst3PluginScanner() = default;

bool Vst3PluginScanner::initialize(juce::AudioPluginFormatManager* manager)
{
    if (manager == nullptr)
    {
        DBG("Vst3PluginScanner: Null format manager");
        return false;
    }

    formatManager = manager;
    return true;
}

void Vst3PluginScanner::shutdown()
{
    formatManager = nullptr;
    cachedResults.clear();
}

std::vector<juce::PluginDescription> Vst3PluginScanner::scanDefaultPaths()
{
    return scanDirectories(getDefaultScanPaths());
}

std::vector<juce::PluginDescription> Vst3PluginScanner::scanDirectory(
    const juce::File& directory)
{
    std::vector<juce::PluginDescription> results;
    scanDirectoryInternal(directory, results);
    return results;
}

std::vector<juce::PluginDescription> Vst3PluginScanner::scanDirectories(
    const std::vector<juce::File>& directories)
{
    std::vector<juce::PluginDescription> results;

    for (const auto& dir : directories)
    {
        if (dir.isDirectory())
        {
            scanDirectoryInternal(dir, results);
        }
    }

    // Cache results
    cachedResults = results;
    DBG("Vst3PluginScanner: Found " << results.size() << " plugins");
    return results;
}

const std::vector<juce::PluginDescription>& Vst3PluginScanner::getCachedResults() const
{
    return cachedResults;
}

void Vst3PluginScanner::clearCache()
{
    cachedResults.clear();
}

bool Vst3PluginScanner::isVst3Plugin(const juce::File& file)
{
    return file.hasFileExtension(".vst3");
}

std::vector<juce::File> Vst3PluginScanner::getDefaultScanPaths()
{
    std::vector<juce::File> paths;

#if JUCE_WINDOWS
    // Windows default paths
    auto programFiles = juce::File::getSpecialLocation(
        juce::File::globalApplicationsDirectory);
    paths.push_back(programFiles.getChildFile("Common Files\\VST3"));

    auto programFilesX86 = juce::File::getSpecialLocation(
        juce::File::globalApplicationsDirectoryX86);
    if (programFilesX86.isDirectory())
        paths.push_back(programFilesX86.getChildFile("Common Files\\VST3"));

#elif JUCE_MAC
    // macOS default paths
    paths.push_back(juce::File("/Library/Audio/Plug-Ins/VST3"));
    paths.push_back(juce::File("~/Library/Audio/Plug-Ins/VST3"));

#elif JUCE_LINUX
    // Linux default paths
    paths.push_back(juce::File("/usr/lib/vst3"));
    paths.push_back(juce::File("/usr/local/lib/vst3"));
    paths.push_back(juce::File("~/.vst3"));
#endif

    return paths;
}

void Vst3PluginScanner::setProgressCallback(ScanProgressCallback callback)
{
    progressCallback = std::move(callback);
}

void Vst3PluginScanner::scanDirectoryInternal(
    const juce::File& directory,
    std::vector<juce::PluginDescription>& results)
{
    if (!directory.isDirectory() || formatManager == nullptr)
        return;

    DBG("Vst3PluginScanner: Scanning " << directory.getFullPathName());

    juce::Array<juce::File> files;
    directory.findChildFiles(files, juce::File::findFiles, true, "*.vst3");

    int totalFiles = files.size();
    int currentFile = 0;

    for (const auto& file : files)
    {
        ++currentFile;

        if (progressCallback)
        {
            progressCallback(file.getFileName(),
                             static_cast<int>((currentFile * 100) / totalFiles));
        }

        // Use the format manager to create plugin descriptions
        juce::OwnedArray<juce::PluginDescription> descriptions;

        for (int i = 0; i < formatManager->getNumFormats(); ++i)
        {
            auto* format = formatManager->getFormat(i);

            if (format->fileMightContainThisPluginType(file.getFullPathName()))
            {
                format->findAllTypesForFile(descriptions, file.getFullPathName());
            }
        }

        for (auto* desc : descriptions)
        {
            if (desc->pluginFormatName == "VST3")
            {
                results.push_back(*desc);
                DBG("Vst3PluginScanner: Found " << desc->name);
            }
        }
    }
}
