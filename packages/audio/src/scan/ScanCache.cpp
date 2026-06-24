#include "ScanCache.h"
#include <juce_core/juce_core.h>

ScanCache::ScanCache() = default;
ScanCache::~ScanCache()
{
    shutdown();
}

bool ScanCache::initialize(const Config& cfg)
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    config = cfg;
    initialized = true;
    lastMaintenance = std::chrono::system_clock::now();
    DBG("ScanCache: Initialized (maxEntries=" << config.maxEntries << ")");
    return true;
}

void ScanCache::shutdown()
{
    if (!initialized)
        return;

    if (dirty && config.enablePersistence)
    {
        saveCache();
    }

    {
        std::lock_guard<std::mutex> lock(cacheMutex);
        cache.clear();
    }
    {
        std::lock_guard<std::mutex> lock(statsMutex);
        stats = CacheStats{};
    }

    initialized = false;
    DBG("ScanCache: Shut down");
}

bool ScanCache::warmCache()
{
    if (!initialized || !config.enablePersistence)
        return false;

    if (!config.persistencePath.existsAsFile())
    {
        DBG("ScanCache: No cache file to warm from");
        return false;
    }

    try
    {
        auto json = config.persistencePath.loadFileAsString();
        bool loaded = loadFromJson(json);

        if (loaded && cacheLoadCallback)
        {
            std::lock_guard<std::mutex> lock(cacheMutex);
            cacheLoadCallback(static_cast<int>(cache.size()));
        }

        return loaded;
    }
    catch (const std::exception& e)
    {
        DBG("ScanCache: Failed to warm cache: " << e.what());
        return false;
    }
}

bool ScanCache::saveCache()
{
    if (!initialized || !config.enablePersistence)
        return false;

    try
    {
        auto json = saveToJson();
        config.persistencePath.getParentDirectory().createDirectory();
        config.persistencePath.replaceWithText(json);
        dirty = false;

        if (cacheSaveCallback)
        {
            std::lock_guard<std::mutex> lock(cacheMutex);
            cacheSaveCallback(static_cast<int>(cache.size()));
        }

        DBG("ScanCache: Saved " << cache.size() << " entries");
        return true;
    }
    catch (const std::exception& e)
    {
        DBG("ScanCache: Failed to save cache: " << e.what());
        return false;
    }
}

void ScanCache::clear()
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    cache.clear();
    dirty = true;

    std::lock_guard<std::mutex> statsLock(statsMutex);
    stats = CacheStats{};

    DBG("ScanCache: Cleared all entries");
}

int ScanCache::cleanup()
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    int removed = 0;

    for (auto it = cache.begin(); it != cache.end(); )
    {
        juce::File file(it->second.filePath);
        if (!it->second.isStillValid(file))
        {
            it = cache.erase(it);
            ++removed;
        }
        else
        {
            ++it;
        }
    }

    if (removed > 0)
        dirty = true;

    DBG("ScanCache: Cleaned up " << removed << " invalid entries");
    return removed;
}

bool ScanCache::hasCachedDescriptions(const juce::String& filePath) const
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    auto it = cache.find(filePath);
    if (it == cache.end())
        return false;

    juce::File file(filePath);
    return it->second.isStillValid(file);
}

const std::vector<juce::PluginDescription>* ScanCache::getCachedDescriptions(
    const juce::String& filePath) const
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    auto it = cache.find(filePath);
    if (it == cache.end())
    {
        std::lock_guard<std::mutex> statsLock(statsMutex);
        const_cast<CacheStats&>(stats).misses++;
        return nullptr;
    }

    juce::File file(filePath);
    if (!it->second.isStillValid(file))
    {
        std::lock_guard<std::mutex> statsLock(statsMutex);
        const_cast<CacheStats&>(stats).misses++;
        return nullptr;
    }

    const_cast<CacheEntry&>(it->second).touch();
    std::lock_guard<std::mutex> statsLock(statsMutex);
    const_cast<CacheStats&>(stats).hits++;
    return &it->second.descriptions;
}

std::vector<juce::PluginDescription>* ScanCache::getCachedDescriptions(
    const juce::String& filePath)
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    auto it = cache.find(filePath);
    if (it == cache.end())
    {
        std::lock_guard<std::mutex> statsLock(statsMutex);
        stats.misses++;
        return nullptr;
    }

    juce::File file(filePath);
    if (!it->second.isStillValid(file))
    {
        std::lock_guard<std::mutex> statsLock(statsMutex);
        stats.misses++;
        return nullptr;
    }

    it->second.touch();
    std::lock_guard<std::mutex> statsLock(statsMutex);
    stats.hits++;
    return &it->second.descriptions;
}

bool ScanCache::cacheDescriptions(const juce::String& filePath,
                                  const std::vector<juce::PluginDescription>& descriptions,
                                  bool force)
{
    std::lock_guard<std::mutex> lock(cacheMutex);

    auto it = cache.find(filePath);
    if (it != cache.end() && !force)
        return false;

    CacheEntry entry;
    entry.filePath = filePath;
    entry.descriptions = descriptions;
    entry.scanTime = std::chrono::system_clock::now();
    entry.lastAccessTime = entry.scanTime;
    entry.isValid = true;

    juce::File file(filePath);
    if (file.existsAsFile())
    {
        entry.fileSize = file.getSize();
        entry.fileModificationTime = file.getLastModificationTime().toMilliseconds();
    }

    cache[filePath] = entry;
    dirty = true;

    enforceSizeLimits();
    scheduleAutoSave();

    return true;
}

bool ScanCache::removeEntry(const juce::String& filePath)
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    auto it = cache.find(filePath);
    if (it == cache.end())
        return false;

    cache.erase(it);
    dirty = true;
    return true;
}

bool ScanCache::invalidateEntry(const juce::String& filePath)
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    auto it = cache.find(filePath);
    if (it == cache.end())
        return false;

    it->second.isValid = false;
    dirty = true;
    return true;
}

bool ScanCache::isEntryValid(const juce::String& filePath) const
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    auto it = cache.find(filePath);
    if (it == cache.end())
        return false;

    juce::File file(filePath);
    return it->second.isStillValid(file);
}

std::vector<juce::PluginDescription> ScanCache::getAllCachedDescriptions() const
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    std::vector<juce::PluginDescription> all;

    for (const auto& [path, entry] : cache)
    {
        juce::File file(path);
        if (entry.isStillValid(file))
        {
            all.insert(all.end(), entry.descriptions.begin(), entry.descriptions.end());
        }
    }

    return all;
}

std::vector<juce::String> ScanCache::getCachedFilePaths() const
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    std::vector<juce::String> paths;
    paths.reserve(cache.size());

    for (const auto& [path, entry] : cache)
    {
        paths.push_back(path);
    }

    return paths;
}

ScanCache::CacheStats ScanCache::getStats() const
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    std::lock_guard<std::mutex> statsLock(statsMutex);

    CacheStats result = stats;
    result.totalEntries = static_cast<int>(cache.size());

    int valid = 0;
    int invalid = 0;
    int totalPlugins = 0;

    for (const auto& [path, entry] : cache)
    {
        juce::File file(path);
        if (entry.isStillValid(file))
        {
            valid++;
            totalPlugins += static_cast<int>(entry.descriptions.size());
        }
        else
        {
            invalid++;
        }
    }

    result.validEntries = valid;
    result.invalidEntries = invalid;
    result.totalPlugins = totalPlugins;
    result.memoryUsageBytes = getMemoryUsage();

    auto totalAccesses = result.hits + result.misses;
    if (totalAccesses > 0)
        result.hitRate = static_cast<float>(result.hits) / static_cast<float>(totalAccesses);

    return result;
}

const ScanCache::Config& ScanCache::getConfig() const
{
    return config;
}

void ScanCache::updateConfig(const Config& cfg)
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    config = cfg;
}

void ScanCache::setCacheLoadCallback(CacheLoadCallback callback)
{
    cacheLoadCallback = std::move(callback);
}

void ScanCache::setCacheSaveCallback(CacheSaveCallback callback)
{
    cacheSaveCallback = std::move(callback);
}

void ScanCache::enableAutoMaintenance(bool enable, int interval)
{
    autoMaintenanceEnabled = enable;
    maintenanceInterval = interval;
}

void ScanCache::performMaintenance()
{
    cleanup();

    {
        std::lock_guard<std::mutex> lock(cacheMutex);
        auto now = std::chrono::system_clock::now();
        for (auto it = cache.begin(); it != cache.end(); )
        {
            auto age = std::chrono::duration_cast<std::chrono::hours>(
                now - it->second.scanTime);
            if (age > config.maxAge)
            {
                it = cache.erase(it);
            }
            else
            {
                ++it;
            }
        }
    }

    lastMaintenance = std::chrono::system_clock::now();
    DBG("ScanCache: Maintenance completed");
}

int ScanCache::getNumEntries() const
{
    std::lock_guard<std::mutex> lock(cacheMutex);
    return static_cast<int>(cache.size());
}

size_t ScanCache::getMemoryUsage() const
{
    size_t total = 0;
    for (const auto& [path, entry] : cache)
    {
        total += calculateEntryMemoryUsage(entry);
    }
    return total;
}

// Private methods

bool ScanCache::hasFileChanged(const juce::File& file, const CacheEntry& entry) const
{
    if (!file.existsAsFile())
        return true;

    return file.getSize() != entry.fileSize ||
           file.getLastModificationTime().toMilliseconds() != entry.fileModificationTime;
}

void ScanCache::enforceSizeLimits()
{
    if (static_cast<int>(cache.size()) > config.maxEntries)
    {
        int excess = static_cast<int>(cache.size()) - config.maxEntries;
        removeLRUEntries(excess);
    }
}

void ScanCache::removeLRUEntries(int count)
{
    // Collect entries with access times
    std::vector<std::pair<juce::String, std::chrono::system_clock::time_point>> entries;
    for (const auto& [path, entry] : cache)
    {
        entries.emplace_back(path, entry.lastAccessTime);
    }

    // Sort by access time (oldest first)
    std::sort(entries.begin(), entries.end(),
        [](const auto& a, const auto& b) { return a.second < b.second; });

    // Remove oldest entries
    int toRemove = std::min(count, static_cast<int>(entries.size()));
    for (int i = 0; i < toRemove; ++i)
    {
        cache.erase(entries[i].first);
    }
}

void ScanCache::scheduleAutoSave()
{
    if (!config.autoSave || !dirty)
        return;
    // In a real implementation, this would use a timer thread.
    // For now, save immediately when dirty.
    if (dirty && config.enablePersistence)
    {
        const_cast<ScanCache*>(this)->saveCache();
    }
}

bool ScanCache::loadFromJson(const juce::String& json)
{
    auto parsed = juce::JSON::parse(json);
    if (!parsed.isObject())
        return false;

    auto* obj = parsed.getDynamicObject();
    if (!obj)
        return false;

    auto entriesVar = obj->getProperty("entries", {});
    if (!entriesVar.isArray())
        return false;

    auto entries = juce::JSON::parse(json);
    auto* root = entries.getDynamicObject();
    if (!root)
        return false;

    auto entriesArray = root->getProperty("entries", juce::Array<juce::var>());

    std::lock_guard<std::mutex> lock(cacheMutex);
    cache.clear();

    for (const auto& entryVar : entriesArray)
    {
        if (!entryVar.isObject())
            continue;

        auto* entryObj = entryVar.getDynamicObject();
        if (!entryObj)
            continue;

        CacheEntry entry;
        entry.filePath = entryObj->getProperty("filePath", "").toString();
        entry.isValid = entryObj->getProperty("isValid", true);

        auto scanTimeInt = static_cast<juce::int64>(
            entryObj->getProperty("scanTime", 0));
        entry.scanTime = std::chrono::system_clock::from_time_t(
            static_cast<std::time_t>(scanTimeInt));

        auto accessTimeInt = static_cast<juce::int64>(
            entryObj->getProperty("lastAccessTime", 0));
        entry.lastAccessTime = std::chrono::system_clock::from_time_t(
            static_cast<std::time_t>(accessTimeInt));

        entry.fileSize = static_cast<juce::int64>(
            entryObj->getProperty("fileSize", 0));
        entry.fileModificationTime = static_cast<juce::int64>(
            entryObj->getProperty("fileModificationTime", 0));

        // Load descriptions
        auto descsVar = entryObj->getProperty("descriptions", {});
        if (descsVar.isArray())
        {
            for (const auto& descVar : *descsVar.getArray())
            {
                if (descVar.isObject())
                {
                    auto* descObj = descVar.getDynamicObject();
                    if (descObj)
                    {
                        juce::PluginDescription desc;
                        desc.name = descObj->getProperty("name", "").toString();
                        desc.pluginFormatName = descObj->getProperty("formatName", "").toString();
                        desc.category = descObj->getProperty("category", "").toString();
                        desc.manufacturerName = descObj->getProperty("manufacturer", "").toString();
                        desc.version = descObj->getProperty("version", "").toString();
                        desc.fileOrIdentifier = descObj->getProperty("fileOrIdentifier", "").toString();
                        desc.isInstrument = static_cast<bool>(
                            descObj->getProperty("isInstrument", false));
                        entry.descriptions.push_back(desc);
                    }
                }
            }
        }

        cache[entry.filePath] = entry;
    }

    DBG("ScanCache: Loaded " << cache.size() << " entries from JSON");
    return true;
}

juce::String ScanCache::saveToJson() const
{
    juce::DynamicObject::Ptr root(new juce::DynamicObject());
    juce::Array<juce::var> entriesArray;

    for (const auto& [path, entry] : cache)
    {
        juce::DynamicObject::Ptr entryObj(new juce::DynamicObject());
        entryObj->setProperty("filePath", entry.filePath);
        entryObj->setProperty("isValid", entry.isValid);
        entryObj->setProperty("scanTime",
            static_cast<juce::int64>(std::chrono::system_clock::to_time_t(entry.scanTime)));
        entryObj->setProperty("lastAccessTime",
            static_cast<juce::int64>(std::chrono::system_clock::to_time_t(entry.lastAccessTime)));
        entryObj->setProperty("fileSize", entry.fileSize);
        entryObj->setProperty("fileModificationTime", entry.fileModificationTime);

        juce::Array<juce::var> descsArray;
        for (const auto& desc : entry.descriptions)
        {
            juce::DynamicObject::Ptr descObj(new juce::DynamicObject());
            descObj->setProperty("name", desc.name);
            descObj->setProperty("formatName", desc.pluginFormatName);
            descObj->setProperty("category", desc.category);
            descObj->setProperty("manufacturer", desc.manufacturerName);
            descObj->setProperty("version", desc.version);
            descObj->setProperty("fileOrIdentifier", desc.fileOrIdentifier);
            descObj->setProperty("isInstrument", desc.isInstrument);
            descsArray.add(descObj.get());
        }
        entryObj->setProperty("descriptions", descsArray);

        entriesArray.add(entryObj.get());
    }

    root->setProperty("entries", entriesArray);
    return juce::JSON::toString(root.get(), true);
}

size_t ScanCache::calculateEntryMemoryUsage(const CacheEntry& entry) const
{
    size_t size = sizeof(CacheEntry);
    size += entry.filePath.getNumBytesAsUTF8();
    size += entry.descriptions.capacity() * sizeof(juce::PluginDescription);
    for (const auto& desc : entry.descriptions)
    {
        size += desc.name.getNumBytesAsUTF8();
        size += desc.pluginFormatName.getNumBytesAsUTF8();
        size += desc.category.getNumBytesAsUTF8();
        size += desc.manufacturerName.getNumBytesAsUTF8();
        size += desc.version.getNumBytesAsUTF8();
        size += desc.fileOrIdentifier.getNumBytesAsUTF8();
    }
    return size;
}
