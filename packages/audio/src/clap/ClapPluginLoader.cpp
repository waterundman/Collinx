#include "ClapPluginLoader.h"

ClapPluginLoader::ClapPluginLoader() = default;

ClapPluginLoader::~ClapPluginLoader()
{
    shutdown();
}

bool ClapPluginLoader::initialize(juce::AudioPluginFormatManager* manager)
{
    if (manager == nullptr)
    {
        DBG("ClapPluginLoader: Null format manager");
        return false;
    }

    formatManager = manager;
    return true;
}

void ClapPluginLoader::shutdown()
{
    unloadAll();
    formatManager = nullptr;
}

std::unique_ptr<juce::AudioPluginInstance> ClapPluginLoader::createInstance(
    const juce::PluginDescription& description,
    double sampleRate,
    int blockSize)
{
    if (formatManager == nullptr)
    {
        DBG("ClapPluginLoader: Not initialized");
        return nullptr;
    }

    juce::String errorMessage;

    auto instance = formatManager->createPluginInstance(
        description,
        sampleRate,
        blockSize,
        errorMessage);

    if (instance == nullptr)
        DBG("ClapPluginLoader: Failed to create instance: " << errorMessage);

    return instance;
}

void ClapPluginLoader::findDescriptions(
    const juce::String& fileOrIdentifier,
    juce::OwnedArray<juce::PluginDescription>& results)
{
    if (formatManager == nullptr)
        return;

    for (int i = 0; i < formatManager->getNumFormats(); ++i)
    {
        auto* format = formatManager->getFormat(i);

        if (format->fileMightContainThisPluginType(fileOrIdentifier))
            format->findAllTypesForFile(results, fileOrIdentifier);
    }
}

int ClapPluginLoader::loadPlugin(const juce::PluginDescription& description,
                                  double sampleRate,
                                  int blockSize)
{
    auto instance = createInstance(description, sampleRate, blockSize);

    if (instance == nullptr)
        return -1;

    auto loadedPlugin = std::make_unique<LoadedPlugin>();
    loadedPlugin->instance = std::move(instance);
    loadedPlugin->description = description;

    int index = static_cast<int>(loadedPlugins.size());

    {
        std::lock_guard<std::mutex> lock(pluginsMutex);
        loadedPlugins.push_back(std::move(loadedPlugin));
    }

    DBG("ClapPluginLoader: Loaded " << description.name
        << " at index " << index);
    return index;
}

int ClapPluginLoader::loadPluginFromFile(const juce::String& fileOrIdentifier,
                                          double sampleRate,
                                          int blockSize)
{
    if (formatManager == nullptr)
    {
        DBG("ClapPluginLoader: Not initialized");
        return -1;
    }

    juce::AudioPluginFormat* format = nullptr;

    for (int i = 0; i < formatManager->getNumFormats(); ++i)
    {
        auto* f = formatManager->getFormat(i);
        if (f->fileMightContainThisPluginType(fileOrIdentifier))
        {
            format = f;
            break;
        }
    }

    if (format == nullptr)
    {
        DBG("ClapPluginLoader: No format found for " << fileOrIdentifier);
        return -1;
    }

    juce::OwnedArray<juce::PluginDescription> descriptions;
    format->findAllTypesForFile(descriptions, fileOrIdentifier);

    if (descriptions.isEmpty())
    {
        DBG("ClapPluginLoader: No plugins found in " << fileOrIdentifier);
        return -1;
    }

    return loadPlugin(*descriptions.getFirst(), sampleRate, blockSize);
}

void ClapPluginLoader::unloadPlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[static_cast<size_t>(index)];
    if (plugin == nullptr)
        return;

    if (plugin->isPrepared)
        plugin->instance->releaseResources();

    if (plugin->isActive)
        plugin->instance->setActive(false);

    DBG("ClapPluginLoader: Unloaded " << plugin->description.name);
    plugin.reset();
}

void ClapPluginLoader::unloadAll()
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    for (auto& plugin : loadedPlugins)
    {
        if (plugin != nullptr)
        {
            if (plugin->isPrepared)
                plugin->instance->releaseResources();

            if (plugin->isActive)
                plugin->instance->setActive(false);
        }
    }

    loadedPlugins.clear();
    DBG("ClapPluginLoader: Unloaded all plugins");
}

void ClapPluginLoader::activatePlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[static_cast<size_t>(index)];
    if (plugin == nullptr || plugin->isActive)
        return;

    plugin->instance->setActive(true);
    plugin->isActive = true;
    DBG("ClapPluginLoader: Activated " << plugin->description.name);
}

void ClapPluginLoader::deactivatePlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[static_cast<size_t>(index)];
    if (plugin == nullptr || !plugin->isActive)
        return;

    plugin->instance->setActive(false);
    plugin->isActive = false;
    DBG("ClapPluginLoader: Deactivated " << plugin->description.name);
}

void ClapPluginLoader::preparePlugin(int index, double sampleRate, int blockSize)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[static_cast<size_t>(index)];
    if (plugin == nullptr || plugin->isPrepared)
        return;

    plugin->instance->prepareToPlay(sampleRate, blockSize);
    plugin->isPrepared = true;
    DBG("ClapPluginLoader: Prepared " << plugin->description.name
        << " (" << sampleRate << "Hz, " << blockSize << " samples)");
}

void ClapPluginLoader::releasePlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[static_cast<size_t>(index)];
    if (plugin == nullptr || !plugin->isPrepared)
        return;

    plugin->instance->releaseResources();
    plugin->isPrepared = false;
    DBG("ClapPluginLoader: Released " << plugin->description.name);
}

ClapPluginLoader::LoadedPlugin* ClapPluginLoader::getPlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return nullptr;

    return loadedPlugins[static_cast<size_t>(index)].get();
}

int ClapPluginLoader::getNumPlugins() const
{
    std::lock_guard<std::mutex> lock(pluginsMutex);
    return static_cast<int>(loadedPlugins.size());
}

bool ClapPluginLoader::isPluginLoaded(int index) const
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return false;

    return loadedPlugins[static_cast<size_t>(index)] != nullptr;
}

void ClapPluginLoader::processPlugin(int index,
                                      juce::AudioBuffer<float>& buffer,
                                      const juce::MidiBuffer& midiBuffer)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[static_cast<size_t>(index)];
    if (plugin == nullptr || !plugin->isActive || !plugin->isPrepared)
        return;

    plugin->instance->processBlock(buffer, midiBuffer);
}
