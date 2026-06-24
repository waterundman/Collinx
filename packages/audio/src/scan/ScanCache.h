#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <vector>
#include <unordered_map>
#include <mutex>
#include <chrono>
#include <functional>
#include <memory>

/**
 * ScanCache — Cache for plugin scan results.
 *
 * Provides efficient caching of plugin descriptions with support for:
 * - Cache invalidation based on file modification time
 * - Cache warming (pre-loading cache from persistent storage)
 * - Cache persistence (saving/loading cache to disk)
 * - Thread-safe access
 *
 * Usage:
 *   ScanCache cache;
 *   cache.initialize(juce::File("~/.collinx/plugin_cache.json"));
 *   cache.warmCache();
 *   
 *   // Check cache
 *   auto cached = cache.getCachedDescriptions("/path/to/plugin.vst3");
 *   if (cached) {
 *       // Use cached results
 *   } else {
 *       // Scan and cache
 *       auto results = scanPlugin("/path/to/plugin.vst3");
 *       cache.cacheDescriptions("/path/to/plugin.vst3", results);
 *   }
 */
class ScanCache
{
public:
    /**
     * Cache entry for a single plugin file.
     */
    struct CacheEntry
    {
        juce::String filePath;
        std::vector<juce::PluginDescription> descriptions;
        std::chrono::system_clock::time_point scanTime;
        std::chrono::system_clock::time_point lastAccessTime;
        juce::int64 fileSize = 0;
        juce::int64 fileModificationTime = 0;
        bool isValid = true;
        
        /**
         * Check if this cache entry is still valid for the given file.
         */
        bool isStillValid(const juce::File& file) const;
        
        /**
         * Update access time (for LRU cache management).
         */
        void touch();
    };

    /**
     * Cache statistics.
     */
    struct CacheStats
    {
        int totalEntries = 0;
        int validEntries = 0;
        int invalidEntries = 0;
        int totalPlugins = 0;
        size_t memoryUsageBytes = 0;
        float hitRate = 0.0f;
        int64_t hits = 0;
        int64_t misses = 0;
    };

    /**
     * Cache configuration.
     */
    struct Config
    {
        juce::File persistencePath;         // Path to cache file
        int maxEntries = 10000;             // Maximum number of cache entries
        std::chrono::hours maxAge{168};     // Maximum cache age (1 week)
        bool enablePersistence = true;      // Enable saving/loading cache
        bool enableCompression = false;     // Enable cache compression
        bool autoSave = true;               // Auto-save on changes
        int autoSaveIntervalSeconds = 300;  // Auto-save interval (5 minutes)
    };

    /**
     * Callback types.
     */
    using CacheLoadCallback = std::function<void(int entriesLoaded)>;
    using CacheSaveCallback = std::function<void(int entriesSaved)>;

    ScanCache();
    ~ScanCache();

    /**
     * Initialize the cache with configuration.
     * @param config Cache configuration.
     * @return true if initialization succeeded.
     */
    bool initialize(const Config& config);

    /**
     * Shut down the cache and save if needed.
     */
    void shutdown();

    /**
     * Load cache from persistent storage (warm cache).
     * @return true if cache was loaded successfully.
     */
    bool warmCache();

    /**
     * Save cache to persistent storage.
     * @return true if cache was saved successfully.
     */
    bool saveCache();

    /**
     * Clear all cache entries.
     */
    void clear();

    /**
     * Remove invalid cache entries.
     * @return Number of entries removed.
     */
    int cleanup();

    /**
     * Check if a file has cached descriptions.
     * @param filePath Path to the plugin file.
     * @return true if cache entry exists and is valid.
     */
    bool hasCachedDescriptions(const juce::String& filePath) const;

    /**
     * Get cached descriptions for a file.
     * @param filePath Path to the plugin file.
     * @return Pointer to cached descriptions, or nullptr if not cached/invalid.
     */
    const std::vector<juce::PluginDescription>* getCachedDescriptions(const juce::String& filePath) const;

    /**
     * Get cached descriptions for a file (non-const version).
     * @param filePath Path to the plugin file.
     * @return Pointer to cached descriptions, or nullptr if not cached/invalid.
     */
    std::vector<juce::PluginDescription>* getCachedDescriptions(const juce::String& filePath);

    /**
     * Cache descriptions for a file.
     * @param filePath Path to the plugin file.
     * @param descriptions Plugin descriptions to cache.
     * @param force Force update even if entry exists.
     * @return true if entry was cached/updated.
     */
    bool cacheDescriptions(const juce::String& filePath,
                          const std::vector<juce::PluginDescription>& descriptions,
                          bool force = false);

    /**
     * Remove a specific cache entry.
     * @param filePath Path to the plugin file.
     * @return true if entry was removed.
     */
    bool removeEntry(const juce::String& filePath);

    /**
     * Invalidate cache entry for a file (marks as invalid but keeps entry).
     * @param filePath Path to the plugin file.
     * @return true if entry was invalidated.
     */
    bool invalidateEntry(const juce::String& filePath);

    /**
     * Check if a cache entry is valid for a file.
     * @param filePath Path to the plugin file.
     * @return true if entry is valid.
     */
    bool isEntryValid(const juce::String& filePath) const;

    /**
     * Get all cached plugin descriptions.
     * @return Vector of all cached descriptions.
     */
    std::vector<juce::PluginDescription> getAllCachedDescriptions() const;

    /**
     * Get all cached file paths.
     * @return Vector of file paths with cached entries.
     */
    std::vector<juce::String> getCachedFilePaths() const;

    /**
     * Get cache statistics.
     */
    CacheStats getStats() const;

    /**
     * Get the cache configuration.
     */
    const Config& getConfig() const;

    /**
     * Update cache configuration.
     * @param config New configuration.
     */
    void updateConfig(const Config& config);

    /**
     * Set callback for cache load events.
     */
    void setCacheLoadCallback(CacheLoadCallback callback);

    /**
     * Set callback for cache save events.
     */
    void setCacheSaveCallback(CacheSaveCallback callback);

    /**
     * Enable/disable automatic cache maintenance.
     * @param enable true to enable automatic cleanup.
     * @param interval Maintenance interval in seconds.
     */
    void enableAutoMaintenance(bool enable, int interval = 3600);

    /**
     * Perform cache maintenance (cleanup old/invalid entries).
     */
    void performMaintenance();

    /**
     * Check if the cache is initialized.
     */
    bool isInitialized() const { return initialized; }

    /**
     * Get the number of entries in the cache.
     */
    int getNumEntries() const;

    /**
     * Get memory usage estimate in bytes.
     */
    size_t getMemoryUsage() const;

private:
    /**
     * Internal: Check if a file has changed since caching.
     */
    bool hasFileChanged(const juce::File& file, const CacheEntry& entry) const;

    /**
     * Internal: Enforce cache size limits.
     */
    void enforceSizeLimits();

    /**
     * Internal: Remove LRU entries to make space.
     */
    void removeLRUEntries(int count);

    /**
     * Internal: Save cache in background thread.
     */
    void scheduleAutoSave();

    /**
     * Internal: Load cache from JSON.
     */
    bool loadFromJson(const juce::String& json);

    /**
     * Internal: Save cache to JSON.
     */
    juce::String saveToJson() const;

    /**
     * Internal: Calculate memory usage for an entry.
     */
    size_t calculateEntryMemoryUsage(const CacheEntry& entry) const;

    // Member variables
    Config config;
    mutable std::mutex cacheMutex;
    std::unordered_map<juce::String, CacheEntry> cache;
    
    // Statistics
    mutable std::mutex statsMutex;
    CacheStats stats;
    
    // State
    std::atomic<bool> initialized{false};
    std::atomic<bool> dirty{false}; // Cache has unsaved changes
    
    // Callbacks
    CacheLoadCallback cacheLoadCallback;
    CacheSaveCallback cacheSaveCallback;
    
    // Auto-save
    std::unique_ptr<juce::Timer> autoSaveTimer;
    int autoSaveIntervalSeconds = 300;
    
    // Auto-maintenance
    bool autoMaintenanceEnabled = false;
    int maintenanceInterval = 3600;
    std::chrono::system_clock::time_point lastMaintenance;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ScanCache)
};

// Inline implementations
inline bool ScanCache::CacheEntry::isStillValid(const juce::File& file) const
{
    if (!file.existsAsFile())
        return false;
    
    auto currentModTime = file.getLastModificationTime().toMilliseconds();
    auto currentSize = file.getSize();
    
    return (currentModTime == fileModificationTime) && (currentSize == fileSize);
}

inline void ScanCache::CacheEntry::touch()
{
    lastAccessTime = std::chrono::system_clock::now();
}