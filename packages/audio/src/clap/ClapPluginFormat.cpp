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

juce::String ClapPluginFormat::getNameOfPluginFromIdentifier(const juce::String& fileOrIdentifier)
{
    // JUCE 文档（juce_AudioPluginFormat.h:106）：返回该标识符所指插件的「可读名称」。
    // 唯一调用方是 PluginDirectoryScanner 的扫描进度显示
    // （nameOfPluginBeingScanned / getNextPluginFileThatWillBeScanned），只用于展示。
    //
    // 与 VST3 的差异有据：VST3 一个 .vst3 是 shell（内含多个插件），故其实现在源码里
    // 直接原样返回标识符（juce_VST3PluginFormat.cpp:4026，附注释 "Impossible to tell"）；
    // CLAP 一个 .clap 文件对应单个插件，但不加载动态库读不到 descriptor 里的显示名，
    // 所以这里取「去掉扩展名的文件名」作为可读名——零成本、不触发加载。
    const juce::File file(fileOrIdentifier);
    const auto name = file.getFileNameWithoutExtension();
    return name.isNotEmpty() ? name : fileOrIdentifier;
}

bool ClapPluginFormat::pluginNeedsRescanning(const juce::PluginDescription& description)
{
    // JUCE 文档（juce_AudioPluginFormat.h:109）：插件版本/日期变了就要重新检查。
    // 判据与 VST3 实现逐字同族（juce_VST3PluginFormat.cpp:4031）：
    // 磁盘上文件的修改时间与上次扫描记下的 lastFileModTime 不一致 → 需要重扫。
    return juce::File(description.fileOrIdentifier).getLastModificationTime()
               != description.lastFileModTime;
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

bool ClapPluginFormat::isTrivialToScan() const
{
    // JUCE 文档（juce_AudioPluginFormat.h:122）：仅当扫描「安全且快」——
    // 可在后台线程几毫秒内完成、且无需加载可执行文件——才返回 true。
    // CLAP 扫描必须 dlopen 动态库才能取到 descriptor，不满足该定义；
    // 与 VST3 实现一致（juce_VST3PluginFormat.h:71 返回 false）。
    return false;
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
