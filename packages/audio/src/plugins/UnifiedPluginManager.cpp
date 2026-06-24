#include "UnifiedPluginManager.h"

UnifiedPluginManager::UnifiedPluginManager() = default;

UnifiedPluginManager::~UnifiedPluginManager()
{
    shutdown();
}

bool UnifiedPluginManager::initialize()
{
    if (initialized)
        return true;

    // Initialize the format registry
    if (!formatRegistry.initialize())
    {
        DBG("UnifiedPluginManager: Failed to initialize format registry");
        return false;
    }

    initialized = true;
    DBG("UnifiedPluginManager: Initialized successfully");
    return true;
}

void UnifiedPluginManager::shutdown()
{
    if (!initialized)
        return;

    // Unload all plugins first
    unloadAll();

    formatRegistry.shutdown();

    initialized = false;
    DBG("UnifiedPluginManager: Shut down");
}

// ── Plugin Scanning ─────────────────────────────────────────────────────

std::vector<juce::PluginDescription> UnifiedPluginManager::scanAllFormats()
{
    if (!initialized)
        return {};

    std::vector<juce::PluginDescription> allResults;
    auto formatNames = formatRegistry.getRegisteredFormatNames();

    int totalFormats = formatNames.size();
    int currentFormat = 0;

    for (const auto& formatName : formatNames)
    {
        auto* format = formatRegistry.getFormat(formatName);
        if (format == nullptr || !format->canScanForPlugins())
            continue;

        // Notify progress
        if (scanProgressCallback)
            scanProgressCallback(formatName, "Starting scan...", 0);

        // Get default search paths
        auto searchPaths = format->getDefaultLocationsToSearch();
        auto foundPlugins = format->searchPathsForPlugins(searchPaths, true, false);

        // Find all types for each found file
        for (const auto& pluginFile : foundPlugins)
        {
            juce::OwnedArray<juce::PluginDescription> descriptions;
            format->findAllTypesForFile(descriptions, pluginFile);

            for (auto* desc : descriptions)
            {
                allResults.push_back(*desc);
            }

            // Notify progress
            if (scanProgressCallback)
            {
                int progress = static_cast<int>((currentFormat * 100) / totalFormats);
                scanProgressCallback(formatName, pluginFile, progress);
            }
        }

        ++currentFormat;
    }

    // Final progress
    if (scanProgressCallback)
        scanProgressCallback("", "Scan complete", 100);

    DBG("UnifiedPluginManager: Found " + juce::String(allResults.size()) + " plugins total");
    return allResults;
}

std::vector<juce::PluginDescription> UnifiedPluginManager::scanDirectories(
    const std::vector<juce::File>& directories)
{
    if (!initialized)
        return {};

    std::vector<juce::PluginDescription> allResults;

    for (const auto& dir : directories)
    {
        if (!dir.isDirectory())
            continue;

        // Try each format
        auto formatNames = formatRegistry.getRegisteredFormatNames();
        for (const auto& formatName : formatNames)
        {
            auto* format = formatRegistry.getFormat(formatName);
            if (format == nullptr || !format->canScanForPlugins())
                continue;

            // Check if directory might contain this format
            juce::FileSearchPath searchPath;
            searchPath.add(dir);

            auto foundPlugins = format->searchPathsForPlugins(searchPath, true, false);
            for (const auto& pluginFile : foundPlugins)
            {
                juce::OwnedArray<juce::PluginDescription> descriptions;
                format->findAllTypesForFile(descriptions, pluginFile);

                for (auto* desc : descriptions)
                {
                    allResults.push_back(*desc);
                }
            }
        }
    }

    DBG("UnifiedPluginManager: Found " + juce::String(allResults.size()) + " plugins in directories");
    return allResults;
}

std::vector<juce::PluginDescription> UnifiedPluginManager::scanFormat(const juce::String& formatName)
{
    if (!initialized)
        return {};

    auto* format = formatRegistry.getFormat(formatName);
    if (format == nullptr)
    {
        DBG("UnifiedPluginManager: Format '" + formatName + "' not found");
        return {};
    }

    if (!format->canScanForPlugins())
        return {};

    std::vector<juce::PluginDescription> results;

    if (scanProgressCallback)
        scanProgressCallback(formatName, "Starting scan...", 0);

    auto searchPaths = format->getDefaultLocationsToSearch();
    auto foundPlugins = format->searchPathsForPlugins(searchPaths, true, false);

    int totalFiles = foundPlugins.size();
    int currentFile = 0;

    for (const auto& pluginFile : foundPlugins)
    {
        juce::OwnedArray<juce::PluginDescription> descriptions;
        format->findAllTypesForFile(descriptions, pluginFile);

        for (auto* desc : descriptions)
        {
            results.push_back(*desc);
        }

        ++currentFile;
        if (scanProgressCallback)
        {
            int progress = (currentFile * 100) / totalFiles;
            scanProgressCallback(formatName, pluginFile, progress);
        }
    }

    if (scanProgressCallback)
        scanProgressCallback(formatName, "Scan complete", 100);

    DBG("UnifiedPluginManager: Found " + juce::String(results.size()) + " " + formatName + " plugins");
    return results;
}

void UnifiedPluginManager::setScanProgressCallback(ScanProgressCallback callback)
{
    scanProgressCallback = std::move(callback);
}

void UnifiedPluginManager::clearScanCache()
{
    // Clear caches in format-specific scanners if needed
    // For now, this is a no-op as we don't maintain separate caches
}

// ── Plugin Loading ──────────────────────────────────────────────────────

int UnifiedPluginManager::loadPlugin(const juce::PluginDescription& description,
                                     double sampleRate,
                                     int blockSize)
{
    if (!initialized)
    {
        DBG("UnifiedPluginManager: Not initialized");
        return -1;
    }

    // Detect format from description
    auto* format = formatRegistry.getFormat(description.pluginFormatName);
    if (format == nullptr)
    {
        // Try to detect from file path
        format = formatRegistry.detectFormat(description.fileOrIdentifier);
    }

    if (format == nullptr)
    {
        DBG("UnifiedPluginManager: Unknown format for plugin '" + description.name + "'");
        return -1;
    }

    return loadPluginWithFormat(format, description, sampleRate, blockSize);
}

int UnifiedPluginManager::loadPluginFromFile(const juce::String& fileOrIdentifier,
                                             double sampleRate,
                                             int blockSize)
{
    if (!initialized)
    {
        DBG("UnifiedPluginManager: Not initialized");
        return -1;
    }

    // Detect format
    auto* format = formatRegistry.detectFormat(fileOrIdentifier);
    if (format == nullptr)
    {
        DBG("UnifiedPluginManager: Unknown format for file '" + fileOrIdentifier + "'");
        return -1;
    }

    // Find plugin descriptions in the file
    juce::OwnedArray<juce::PluginDescription> descriptions;
    format->findAllTypesForFile(descriptions, fileOrIdentifier);

    if (descriptions.isEmpty())
    {
        DBG("UnifiedPluginManager: No plugins found in '" + fileOrIdentifier + "'");
        return -1;
    }

    // Load the first description found
    return loadPluginWithFormat(format, *descriptions[0], sampleRate, blockSize);
}

void UnifiedPluginManager::unloadPlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[index];
    if (plugin == nullptr)
        return;

    // Deactivate and release if needed
    if (plugin->isActive)
    {
        plugin->instance->releaseResources();
        plugin->isActive = false;
    }

    if (plugin->isPrepared)
    {
        plugin->isPrepared = false;
    }

    plugin->instance.reset();
    loadedPlugins[index].reset();

    DBG("UnifiedPluginManager: Unloaded plugin at index " + juce::String(index));
    notifyPluginStateChange(index, "unloaded");
}

void UnifiedPluginManager::unloadAll()
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    for (int i = 0; i < static_cast<int>(loadedPlugins.size()); ++i)
    {
        auto& plugin = loadedPlugins[i];
        if (plugin == nullptr)
            continue;

        if (plugin->isActive)
        {
            plugin->instance->releaseResources();
            plugin->isActive = false;
        }

        plugin->instance.reset();
    }

    loadedPlugins.clear();
    DBG("UnifiedPluginManager: Unloaded all plugins");
}

// ── Plugin Lifecycle ────────────────────────────────────────────────────

void UnifiedPluginManager::activatePlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[index];
    if (plugin == nullptr || plugin->instance == nullptr)
        return;

    if (!plugin->isActive)
    {
        plugin->instance->prepareToPlay(44100.0, 512);
        plugin->isActive = true;
        DBG("UnifiedPluginManager: Activated plugin '" + plugin->description.name + "'");
        notifyPluginStateChange(index, "activated");
    }
}

void UnifiedPluginManager::deactivatePlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[index];
    if (plugin == nullptr || plugin->instance == nullptr)
        return;

    if (plugin->isActive)
    {
        plugin->instance->releaseResources();
        plugin->isActive = false;
        DBG("UnifiedPluginManager: Deactivated plugin '" + plugin->description.name + "'");
        notifyPluginStateChange(index, "deactivated");
    }
}

void UnifiedPluginManager::preparePlugin(int index, double sampleRate, int blockSize)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[index];
    if (plugin == nullptr || plugin->instance == nullptr)
        return;

    plugin->instance->prepareToPlay(sampleRate, blockSize);
    plugin->isPrepared = true;
    DBG("UnifiedPluginManager: Prepared plugin '" + plugin->description.name + "'");
}

void UnifiedPluginManager::releasePlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[index];
    if (plugin == nullptr || plugin->instance == nullptr)
        return;

    if (plugin->isPrepared)
    {
        plugin->instance->releaseResources();
        plugin->isPrepared = false;
        plugin->isActive = false;
        DBG("UnifiedPluginManager: Released plugin '" + plugin->description.name + "'");
    }
}

// ── Plugin Access ───────────────────────────────────────────────────────

UnifiedPluginManager::LoadedPlugin* UnifiedPluginManager::getPlugin(int index)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return nullptr;

    return loadedPlugins[index].get();
}

int UnifiedPluginManager::getNumPlugins() const
{
    std::lock_guard<std::mutex> lock(pluginsMutex);
    return static_cast<int>(loadedPlugins.size());
}

bool UnifiedPluginManager::isPluginLoaded(int index) const
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return false;

    return loadedPlugins[index] != nullptr && loadedPlugins[index]->instance != nullptr;
}

juce::StringArray UnifiedPluginManager::getLoadedPluginNames() const
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    juce::StringArray names;
    for (const auto& plugin : loadedPlugins)
    {
        if (plugin != nullptr && plugin->instance != nullptr)
            names.add(plugin->description.name);
        else
            names.add("(empty)");
    }

    return names;
}

int UnifiedPluginManager::findPluginByName(const juce::String& name) const
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    for (int i = 0; i < static_cast<int>(loadedPlugins.size()); ++i)
    {
        if (loadedPlugins[i] != nullptr &&
            loadedPlugins[i]->description.name == name)
        {
            return i;
        }
    }

    return -1;
}

// ── Audio Processing ────────────────────────────────────────────────────

void UnifiedPluginManager::processPlugin(int index,
                                         juce::AudioBuffer<float>& buffer,
                                         const juce::MidiBuffer& midiBuffer)
{
    std::lock_guard<std::mutex> lock(pluginsMutex);

    if (index < 0 || index >= static_cast<int>(loadedPlugins.size()))
        return;

    auto& plugin = loadedPlugins[index];
    if (plugin == nullptr || plugin->instance == nullptr || !plugin->isActive)
        return;

    plugin->instance->processBlock(buffer, midiBuffer);
}

// ── Format Queries ──────────────────────────────────────────────────────

juce::String UnifiedPluginManager::detectFormatName(const juce::String& fileOrIdentifier) const
{
    return formatRegistry.getFormatName(fileOrIdentifier);
}

bool UnifiedPluginManager::isKnownPlugin(const juce::String& fileOrIdentifier) const
{
    return formatRegistry.isKnownPluginFormat(fileOrIdentifier);
}

// ── Callbacks ───────────────────────────────────────────────────────────

void UnifiedPluginManager::setPluginStateCallback(PluginStateCallback callback)
{
    pluginStateCallback = std::move(callback);
}

// ── Private Methods ─────────────────────────────────────────────────────

int UnifiedPluginManager::loadPluginWithFormat(juce::AudioPluginFormat* format,
                                               const juce::PluginDescription& description,
                                               double sampleRate,
                                               int blockSize)
{
    // Use JUCE's AudioPluginFormatManager to create the instance
    auto& formatManager = formatRegistry.getFormatManager();

    // Create plugin instance synchronously
    std::unique_ptr<juce::AudioPluginInstance> instance;
    juce::String errorMessage;

    instance = formatManager.createPluginInstance(
        description,
        sampleRate,
        blockSize,
        errorMessage);

    if (instance == nullptr)
    {
        DBG("UnifiedPluginManager: Failed to load plugin '" + description.name + "': " + errorMessage);
        return -1;
    }

    // Create loaded plugin entry
    auto loadedPlugin = std::make_unique<LoadedPlugin>();
    loadedPlugin->instance = std::move(instance);
    loadedPlugin->description = description;
    loadedPlugin->formatName = format->getName();
    loadedPlugin->isActive = false;
    loadedPlugin->isPrepared = false;

    // Add to loaded plugins
    std::lock_guard<std::mutex> lock(pluginsMutex);
    int newIndex = static_cast<int>(loadedPlugins.size());
    loadedPlugins.push_back(std::move(loadedPlugin));

    DBG("UnifiedPluginManager: Loaded plugin '" + description.name + "' at index " + juce::String(newIndex));
    notifyPluginStateChange(newIndex, "loaded");

    return newIndex;
}

void UnifiedPluginManager::notifyPluginStateChange(int pluginIndex, const juce::String& newState)
{
    if (pluginStateCallback)
        pluginStateCallback(pluginIndex, newState);
}
