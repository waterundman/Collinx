#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <functional>
#include <atomic>
#include <mutex>
#include <vector>
#include <unordered_map>
#include <chrono>
#include <string>

class PluginChain;
class PluginProcessor;

/**
 * PluginProfiler — Per-plugin performance profiling and bottleneck detection.
 *
 * Profiles individual plugins in a PluginChain, tracking processing time,
 * memory usage, and identifying performance bottlenecks.
 *
 * Usage:
 *   PluginProfiler profiler;
 *   profiler.initialize(pluginChain);
 *   profiler.startProfiling();
 *   // ... let audio process ...
 *   auto report = profiler.generateReport();
 */
class PluginProfiler
{
public:
    /**
     * Performance statistics for a single plugin.
     */
    struct PluginStats
    {
        int pluginId = -1;
        juce::String pluginName;

        // Timing
        double lastProcessTimeMs = 0.0;
        double averageProcessTimeMs = 0.0;
        double peakProcessTimeMs = 0.0;
        double minProcessTimeMs = 0.0;
        int64_t totalSamplesProcessed = 0;
        int64_t totalBlocksProcessed = 0;

        // Relative contribution
        double cpuPercentage = 0.0;      // % of total processing time
        double chainPercentage = 0.0;    // % of chain processing time

        // Bottleneck detection
        bool isBottleneck = false;
        double bottleneckScore = 0.0;    // Higher = more likely bottleneck

        // State
        bool isActive = false;
        bool isBypassed = false;
        int reportedLatency = 0;
    };

    /**
     * Performance report for the entire chain.
     */
    struct PerformanceReport
    {
        std::vector<PluginStats> pluginStats;
        double totalProcessingTimeMs = 0.0;
        double averageProcessingTimeMs = 0.0;
        double peakProcessingTimeMs = 0.0;
        int bottleneckPluginId = -1;
        juce::String bottleneckPluginName;
        double bottleneckPercentage = 0.0;
        int64_t reportTimestamp = 0;
        int64_t profilingDurationMs = 0;
    };

    /**
     * Callback when a bottleneck is detected.
     * @param pluginId ID of the bottleneck plugin.
     * @param pluginName Name of the bottleneck plugin.
     * @param percentage Percentage of total processing time.
     */
    using BottleneckCallback = std::function<void(int pluginId,
                                                  const juce::String& pluginName,
                                                  double percentage)>;

    /**
     * Callback for periodic profiling updates.
     */
    using ProfileCallback = std::function<void(const PerformanceReport& report)>;

    PluginProfiler();
    ~PluginProfiler();

    /**
     * Initialize the profiler with a reference to the plugin chain.
     * @param chain The plugin chain to profile.
     * @return true if initialization succeeded.
     */
    bool initialize(PluginChain* chain);

    /**
     * Shut down the profiler.
     */
    void shutdown();

    /**
     * Start profiling. Begins tracking plugin performance.
     */
    void startProfiling();

    /**
     * Stop profiling.
     */
    void stopProfiling();

    /**
     * Record processing time for a specific plugin.
     * Call from the audio thread after each plugin processes.
     * @param pluginId ID of the plugin.
     * @param processTimeMs Time taken in milliseconds.
     */
    void recordPluginProcessingTime(int pluginId, double processTimeMs);

    /**
     * Generate a performance report for all profiled plugins.
     */
    PerformanceReport generateReport() const;

    /**
     * Get stats for a specific plugin.
     * @param pluginId ID of the plugin.
     * @return Plugin stats, or nullptr if not profiled.
     */
    PluginStats getPluginStats(int pluginId) const;

    /**
     * Get stats for all profiled plugins.
     */
    std::vector<PluginStats> getAllPluginStats() const;

    /**
     * Identify the current bottleneck plugin.
     * @return Plugin ID of the bottleneck, or -1 if none.
     */
    int identifyBottleneck() const;

    /**
     * Set the bottleneck detection threshold.
     * @param threshold Percentage of total time (default: 40.0).
     */
    void setBottleneckThreshold(double threshold);

    /**
     * Set callback for bottleneck detection.
     */
    void setBottleneckCallback(BottleneckCallback callback);

    /**
     * Set callback for periodic profile updates.
     * @param callback Callback function.
     * @param intervalMs Update interval in milliseconds (default: 1000).
     */
    void setProfileCallback(ProfileCallback callback, int intervalMs = 1000);

    /**
     * Reset all profiling data.
     */
    void reset();

    /**
     * Check if profiling is active.
     */
    bool isProfiling() const { return profiling.load(); }

    /**
     * Check if the profiler is initialized.
     */
    bool isInitialized() const { return initialized.load(); }

    /**
     * Get the number of profiled plugins.
     */
    int getNumProfiledPlugins() const;

private:
    /**
     * Internal stats tracking with lock-free audio thread support.
     */
    struct PluginStatsInternal
    {
        std::atomic<double> lastProcessTime{0.0};
        std::atomic<double> peakProcessTime{0.0};
        std::atomic<double> minProcessTime{999999.0};
        std::atomic<int64_t> totalBlocks{0};

        // Accumulator for averaging (protected by mutex)
        double processTimeSum = 0.0;
        int64_t processTimeSamples = 0;
    };

    PluginChain* pluginChain = nullptr;

    mutable std::mutex statsMutex;
    std::unordered_map<int, PluginStatsInternal> pluginStatsMap;
    std::unordered_map<int, juce::String> pluginNames;

    // Configuration
    double bottleneckThreshold = 40.0;
    int profileCallbackIntervalMs = 1000;

    // Callbacks
    BottleneckCallback bottleneckCallback;
    ProfileCallback profileCallback;

    // Threading
    std::atomic<bool> initialized{false};
    std::atomic<bool> profiling{false};
    std::thread profileCallbackThread;

    // Timing
    int64_t profilingStartTime = 0;

    /**
     * Background thread for invoking profile callbacks.
     */
    void profileCallbackLoop();

    /**
     * Register a plugin for profiling.
     */
    void registerPlugin(int pluginId, const juce::String& name);

    /**
     * Calculate bottleneck scores for all plugins.
     */
    void calculateBottleneckScores(std::vector<PluginStats>& stats) const;

    /**
     * Get current timestamp in milliseconds.
     */
    static int64_t currentTimeMs();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginProfiler)
};
