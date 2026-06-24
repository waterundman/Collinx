#include "Vst3PluginLoader.h"

Vst3PluginLoader::Vst3PluginLoader() = default;

Vst3PluginLoader::~Vst3PluginLoader()
{
    shutdown();
}

bool Vst3PluginLoader::initialize(juce::AudioPluginFormatManager* manager)
{
    if (manager == nullptr)
    {
        DBG("Vst3PluginLoader: Null format manager");
        return false;
    }

    formatManager = manager;
    return true;
}

void Vst3PluginLoader::shutdown()
{
    unloadAll();
    formatManager = nullptr;
}

int Vst3PluginLoader::loadPlugin(const juce::PluginDescription& description,
                                  double sampleRate,
                                  int blockSize)
{
    if (formatManager == nullptr)
    {
        DBG("Vst3PluginLoader: Not initialized");
        return -1;
    }

    juce::String errorMessage;

    auto instance = formatManager->createPluginInstance(
        description,
        sampleRate,
        blockSize,
        errorMessage);

    if (instance == nullptr)
    {
        DBG("Vst3PluginLoader: Failed to load plugin: " << errorMessage);
        return -1;
    }

    auto loadedPlugin = std::make_unique<LoadedPlugin>();
    loadedPlugin->instance = std::move(instance);
    loadedPlugin->description = description;

    int index = static_cast<int>(loadedPlugins.size());

    {
        std::lock_guard<std::mutex> lock(pluginsMutex);
        loadedPlugins.push_back(std::move(loadedPlugin));
    }

    DBG("Vst3PluginLoader: Loaded " << description.name
        << " at index " << index);
    return index;
}

int Vst3PluginLoader::loadPluginFromFile(const juce::String& fileOrIdentifier,
                                          double sampleRate,
                                          int blockSize)
{
    if (formatManager == nullptr)
    {
        DBG("Vst3PluginLoader: Not initialized");
        return -1;
    }

    // Find the format that can handle this file
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
        DBG("Vst3PluginLoader: No format found for " << fileOrIdentifier);
        return -1;
    }

    // Get plugin description from file
    juce::OwnedArray<juce::PluginDescription> descriptions;
    format->findAllTypesForFile(descriptions, fileOrIdentifier);

    if (descriptions.isEmpty())
    {
        DBG("Vst3PluginLoader: No plugins found in " << fileOrIdentifier);
        return -1;
    }

    return loadPlugin(*descriptions.getFirst(), sampleRate, blockSize);
}

void Vst3PluginLoader::unloadPlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[static_cast<size_t>(index)];
    if (plugin == nullptr)
        return;

    if (plugin->isPrepared)
    {
        plugin->instance->releaseResources();
    }

    if (plugin->isActive)
    {
        plugin->instance->setActive(false);
    }

    DBG("Vst3PluginLoader: Unloaded " << plugin->description.name);
    plugin.reset();
}

void Vst3PluginLoader::unloadAll()
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
    DBG("Vst3PluginLoader: Unloaded all plugins");
}

void Vst3PluginLoader::activatePlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[static_cast<size_t>(index)];
    if (plugin == nullptr || plugin->isActive)
        return;

    plugin->instance->setActive(true);
    plugin->isActive = true;
    DBG("Vst3PluginLoader: Activated " << plugin->description.name);
}

void Vst3PluginLoader::deactivatePlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[static_cast<size_t>(index)];
    if (plugin == nullptr || !plugin->isActive)
        return;

    plugin->instance->setActive(false);
    plugin->isActive = false;
    DBG("Vst3PluginLoader: Deactivated " << plugin->description.name);
}

void Vst3PluginLoader::preparePlugin(int index, double sampleRate, int blockSize)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[static_cast<size_t>(index)];
    if (plugin == nullptr || plugin->isPrepared)
        return;

    plugin->instance->prepareToPlay(sampleRate, blockSize);
    plugin->isPrepared = true;
    DBG("Vst3PluginLoader: Prepared " << plugin->description.name
        << " (" << sampleRate << "Hz, " << blockSize << " samples)");
}

void Vst3PluginLoader::releasePlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[static_cast<size_t>(index)];
    if (plugin == nullptr || !plugin->isPrepared)
        return;

    plugin->instance->releaseResources();
    plugin->isPrepared = false;
    DBG("Vst3PluginLoader: Released " << plugin->description.name);
}

Vst3PluginLoader::LoadedPlugin* Vst3PluginLoader::getPlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return nullptr;

    return loadedPlugins[static_cast<size_t>(index)].get();
}

int Vst3PluginLoader::getNumPlugins() const
{
    std::lock_guard<std::mutex> lock(pluginsMutex);
    return static_cast<int>(loadedPlugins.size());
}

bool Vst3PluginLoader::isPluginLoaded(int index) const
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return false;

    return loadedPlugins[static_cast<size_t>(index)] != nullptr;
}

void Vst3PluginLoader::processPlugin(int index,
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
