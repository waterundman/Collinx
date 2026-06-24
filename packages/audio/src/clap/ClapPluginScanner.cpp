#include "ClapPluginScanner.h"

ClapPluginScanner::ClapPluginScanner() = default;

ClapPluginScanner::~ClapPluginScanner() = default;

bool ClapPluginScanner::initialize(juce::AudioPluginFormatManager* manager)
{
    if (manager == nullptr)
    {
        DBG("ClapPluginScanner: Null format manager");
        return false;
    }

    formatManager = manager;
    return true;
}

void ClapPluginScanner::shutdown()
{
    formatManager = nullptr;
    cachedResults.clear();
}

std::vector<juce::PluginDescription> ClapPluginScanner::scanDefaultPaths()
{
    auto paths = getDefaultScanPaths();

    auto clapPathDirs = getClapPathDirectories();
    for (auto& dir : clapPathDirs)
        paths.push_back(std::move(dir));

    return scanDirectories(paths);
}

std::vector<juce::PluginDescription> ClapPluginScanner::scanDirectory(
    const juce::File& directory)
{
    std::vector<juce::PluginDescription> results;
    scanDirectoryInternal(directory, results);
    return results;
}

std::vector<juce::PluginDescription> ClapPluginScanner::scanDirectories(
    const std::vector<juce::File>& directories)
{
    std::vector<juce::PluginDescription> results;

    for (const auto& dir : directories)
    {
        if (dir.isDirectory())
            scanDirectoryInternal(dir, results);
    }

    cachedResults = results;
    DBG("ClapPluginScanner: Found " << results.size() << " plugins");
    return results;
}

std::vector<juce::PluginDescription> ClapPluginScanner::scanClapPathEnv()
{
    return scanDirectories(getClapPathDirectories());
}

const std::vector<juce::PluginDescription>& ClapPluginScanner::getCachedResults() const
{
    return cachedResults;
}

void ClapPluginScanner::clearCache()
{
    cachedResults.clear();
}

bool ClapPluginScanner::isClapPlugin(const juce::File& file)
{
    return file.hasFileExtension(".clap");
}

std::vector<juce::File> ClapPluginScanner::getDefaultScanPaths()
{
    std::vector<juce::File> paths;

#if JUCE_WINDOWS
    auto commonProgramFiles = juce::File::getSpecialLocation(
        juce::File::globalApplicationsDirectory);
    auto commonClap = commonProgramFiles.getChildFile("Common Files").getChildFile("CLAP");
    if (commonClap.isDirectory())
        paths.push_back(commonClap);

    auto localAppData = juce::File::getSpecialLocation(
        juce::File::userApplicationDataDirectory);
    auto localClap = localAppData.getChildFile("Programs")
                         .getChildFile("Common")
                         .getChildFile("CLAP");
    if (localClap.isDirectory())
        paths.push_back(localClap);

#elif JUCE_MAC
    paths.push_back(juce::File("/Library/Audio/Plug-Ins/CLAP"));
    paths.push_back(juce::File("~/Library/Audio/Plug-Ins/CLAP"));

#elif JUCE_LINUX
    paths.push_back(juce::File("~/.clap"));
    paths.push_back(juce::File("/usr/lib/clap"));
#endif

    return paths;
}

std::vector<juce::File> ClapPluginScanner::getClapPathDirectories()
{
    std::vector<juce::File> paths;

    auto clapPath = juce::SystemStats::getEnvironmentVariable("CLAP_PATH", {});

    if (clapPath.isNotEmpty())
    {
        juce::StringArray pathEntries;
#if JUCE_WINDOWS
        pathEntries.addTokens(clapPath, ";", {});
#else
        pathEntries.addTokens(clapPath, ":", {});
#endif

        for (const auto& entry : pathEntries)
        {
            if (entry.isNotEmpty())
            {
                juce::File dir(entry);
                if (dir.isDirectory())
                    paths.push_back(dir);
            }
        }
    }

    return paths;
}

void ClapPluginScanner::setProgressCallback(ScanProgressCallback callback)
{
    progressCallback = std::move(callback);
}

void ClapPluginScanner::scanDirectoryInternal(
    const juce::File& directory,
    std::vector<juce::PluginDescription>& results)
{
    if (!directory.isDirectory() || formatManager == nullptr)
        return;

    DBG("ClapPluginScanner: Scanning " << directory.getFullPathName());

    juce::Array<juce::File> files;
    directory.findChildFiles(files, juce::File::findFiles, true, "*.clap");

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

        juce::OwnedArray<juce::PluginDescription> descriptions;

        for (int i = 0; i < formatManager->getNumFormats(); ++i)
        {
            auto* format = formatManager->getFormat(i);

            if (format->fileMightContainThisPluginType(file.getFullPathName()))
                format->findAllTypesForFile(descriptions, file.getFullPathName());
        }

        for (auto* desc : descriptions)
        {
            if (desc->pluginFormatName == "CLAP")
            {
                results.push_back(*desc);
                DBG("ClapPluginScanner: Found " << desc->name);
            }
        }
    }
}
