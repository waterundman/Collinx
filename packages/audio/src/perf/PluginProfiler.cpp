#include "PluginProfiler.h"
#include "../vst3/PluginChain.h"
#include "../vst3/PluginProcessor.h"

PluginProfiler::PluginProfiler()
{
}

PluginProfiler::~PluginProfiler()
{
    shutdown();
}

bool PluginProfiler::initialize(PluginChain* chain)
{
    if (initialized.load())
        return true;

    if (chain == nullptr)
    {
        DBG("PluginProfiler: Null plugin chain");
        return false;
    }

    pluginChain = chain;

    // Register existing plugins
    int numPlugins = chain->getNumPlugins();
    for (int i = 0; i < numPlugins; ++i)
    {
        auto* plugin = chain->getPlugin(i);
        if (plugin != nullptr)
            registerPlugin(plugin->getId(), plugin->getName());
    }

    initialized.store(true);
    DBG("PluginProfiler: Initialized with " + juce::String(numPlugins) + " plugins");
    return true;
}

void PluginProfiler::shutdown()
{
    if (!initialized.load())
        return;

    stopProfiling();

    {
        std::lock_guard<std::mutex> lock(statsMutex);
        pluginStatsMap.clear();
        pluginNames.clear();
    }

    pluginChain = nullptr;
    initialized.store(false);
    DBG("PluginProfiler: Shut down");
}

void PluginProfiler::startProfiling()
{
    if (profiling.load())
        return;

    profilingStartTime = currentTimeMs();
    profiling.store(true);

    // Start callback thread if configured
    if (profileCallback)
    {
        profileCallbackThread = std::thread(&PluginProfiler::profileCallbackLoop, this);
    }

    DBG("PluginProfiler: Profiling started");
}

void PluginProfiler::stopProfiling()
{
    if (!profiling.load())
        return;

    profiling.store(false);
    if (profileCallbackThread.joinable())
        profileCallbackThread.join();

    DBG("PluginProfiler: Profiling stopped");
}

void PluginProfiler::recordPluginProcessingTime(int pluginId, double processTimeMs)
{
    if (!profiling.load())
        return;

    std::lock_guard<std::mutex> lock(statsMutex);

    auto it = pluginStatsMap.find(pluginId);
    if (it == pluginStatsMap.end())
        return;

    auto& stats = it->second;

    // Update lock-free atomics
    stats.lastProcessTime.store(processTimeMs, std::memory_order_relaxed);

    double currentPeak = stats.peakProcessTime.load(std::memory_order_relaxed);
    while (processTimeMs > currentPeak)
    {
        if (stats.peakProcessTime.compare_exchange_weak(currentPeak, processTimeMs, std::memory_order_relaxed))
            break;
    }

    double currentMin = stats.minProcessTime.load(std::memory_order_relaxed);
    while (processTimeMs < currentMin)
    {
        if (stats.minProcessTime.compare_exchange_weak(currentMin, processTimeMs, std::memory_order_relaxed))
            break;
    }

    stats.totalBlocks.fetch_add(1, std::memory_order_relaxed);

    // Update accumulator for averaging
    stats.processTimeSum += processTimeMs;
    stats.processTimeSamples++;
}

PluginProfiler::PerformanceReport PluginProfiler::generateReport() const
{
    std::lock_guard<std::mutex> lock(statsMutex);

    PerformanceReport report;
    report.reportTimestamp = currentTimeMs();
    report.profilingDurationMs = report.reportTimestamp - profilingStartTime;

    double totalTime = 0.0;

    // Collect stats for each plugin
    for (const auto& [pluginId, internalStats] : pluginStatsMap)
    {
        PluginStats stats;
        stats.pluginId = pluginId;

        auto nameIt = pluginNames.find(pluginId);
        if (nameIt != pluginNames.end())
            stats.pluginName = nameIt->second;

        stats.lastProcessTimeMs = internalStats.lastProcessTime.load(std::memory_order_relaxed);
        stats.peakProcessTimeMs = internalStats.peakProcessTime.load(std::memory_order_relaxed);
        stats.minProcessTimeMs = internalStats.minProcessTime.load(std::memory_order_relaxed);
        stats.totalBlocksProcessed = internalStats.totalBlocks.load(std::memory_order_relaxed);

        if (internalStats.processTimeSamples > 0)
            stats.averageProcessTimeMs = internalStats.processTimeSum / internalStats.processTimeSamples;

        // Get plugin state from chain
        if (pluginChain != nullptr)
        {
            auto* plugin = pluginChain->getPluginById(pluginId);
            if (plugin != nullptr)
            {
                stats.isActive = plugin->isActive();
                stats.isBypassed = plugin->isBypassed();
                stats.reportedLatency = plugin->getInstance()->getLatencySamples();
            }
        }

        totalTime += stats.averageProcessTimeMs;
        report.pluginStats.push_back(stats);
    }

    report.totalProcessingTimeMs = totalTime;

    // Calculate percentages and identify bottleneck
    double maxPercentage = 0.0;
    int bottleneckId = -1;

    for (auto& stats : report.pluginStats)
    {
        if (totalTime > 0.0)
        {
            stats.chainPercentage = (stats.averageProcessTimeMs / totalTime) * 100.0;
            stats.cpuPercentage = stats.chainPercentage; // Simplified
        }

        // Bottleneck detection
        if (stats.chainPercentage > bottleneckThreshold)
        {
            stats.isBottleneck = true;
            stats.bottleneckScore = stats.chainPercentage;
        }

        if (stats.chainPercentage > maxPercentage)
        {
            maxPercentage = stats.chainPercentage;
            bottleneckId = stats.pluginId;
        }
    }

    if (bottleneckId >= 0)
    {
        report.bottleneckPluginId = bottleneckId;
        auto nameIt = pluginNames.find(bottleneckId);
        if (nameIt != pluginNames.end())
            report.bottleneckPluginName = nameIt->second;
        report.bottleneckPercentage = maxPercentage;
    }

    // Calculate averages
    if (!report.pluginStats.empty())
    {
        double sum = 0.0;
        double peak = 0.0;
        for (const auto& stats : report.pluginStats)
        {
            sum += stats.averageProcessTimeMs;
            peak = std::max(peak, stats.peakProcessTimeMs);
        }
        report.averageProcessingTimeMs = sum / report.pluginStats.size();
        report.peakProcessingTimeMs = peak;
    }

    return report;
}

PluginProfiler::PluginStats PluginProfiler::getPluginStats(int pluginId) const
{
    std::lock_guard<std::mutex> lock(statsMutex);

    auto it = pluginStatsMap.find(pluginId);
    if (it == pluginStatsMap.end())
        return {};

    const auto& internal = it->second;
    PluginStats stats;
    stats.pluginId = pluginId;

    auto nameIt = pluginNames.find(pluginId);
    if (nameIt != pluginNames.end())
        stats.pluginName = nameIt->second;

    stats.lastProcessTimeMs = internal.lastProcessTime.load(std::memory_order_relaxed);
    stats.peakProcessTimeMs = internal.peakProcessTime.load(std::memory_order_relaxed);
    stats.minProcessTimeMs = internal.minProcessTime.load(std::memory_order_relaxed);
    stats.totalBlocksProcessed = internal.totalBlocks.load(std::memory_order_relaxed);

    if (internal.processTimeSamples > 0)
        stats.averageProcessTimeMs = internal.processTimeSum / internal.processTimeSamples;

    return stats;
}

std::vector<PluginProfiler::PluginStats> PluginProfiler::getAllPluginStats() const
{
    return generateReport().pluginStats;
}

int PluginProfiler::identifyBottleneck() const
{
    std::lock_guard<std::mutex> lock(statsMutex);

    double maxTime = 0.0;
    int bottleneckId = -1;

    for (const auto& [pluginId, internalStats] : pluginStatsMap)
    {
        double avgTime = 0.0;
        if (internalStats.processTimeSamples > 0)
            avgTime = internalStats.processTimeSum / internalStats.processTimeSamples;

        if (avgTime > maxTime)
        {
            maxTime = avgTime;
            bottleneckId = pluginId;
        }
    }

    return bottleneckId;
}

void PluginProfiler::setBottleneckThreshold(double threshold)
{
    bottleneckThreshold = std::clamp(threshold, 10.0, 90.0);
}

void PluginProfiler::setBottleneckCallback(BottleneckCallback callback)
{
    bottleneckCallback = std::move(callback);
}

void PluginProfiler::setProfileCallback(ProfileCallback callback, int intervalMs)
{
    profileCallback = std::move(callback);
    profileCallbackIntervalMs = (intervalMs > 0) ? intervalMs : 1000;
}

void PluginProfiler::reset()
{
    std::lock_guard<std::mutex> lock(statsMutex);

    for (auto& [pluginId, stats] : pluginStatsMap)
    {
        stats.lastProcessTime.store(0.0, std::memory_order_relaxed);
        stats.peakProcessTime.store(0.0, std::memory_order_relaxed);
        stats.minProcessTime.store(999999.0, std::memory_order_relaxed);
        stats.totalBlocks.store(0, std::memory_order_relaxed);
        stats.processTimeSum = 0.0;
        stats.processTimeSamples = 0;
    }

    profilingStartTime = currentTimeMs();
    DBG("PluginProfiler: Reset");
}

int PluginProfiler::getNumProfiledPlugins() const
{
    std::lock_guard<std::mutex> lock(statsMutex);
    return static_cast<int>(pluginStatsMap.size());
}

// ── Private ────────────────────────────────────────────────────────────

void PluginProfiler::profileCallbackLoop()
{
    DBG("PluginProfiler: Callback thread started");

    while (profiling.load())
    {
        if (profileCallback)
        {
            auto report = generateReport();
            profileCallback(report);

            // Check for bottleneck and invoke callback
            if (bottleneckCallback && report.bottleneckPluginId >= 0)
            {
                bottleneckCallback(report.bottleneckPluginId,
                                   report.bottleneckPluginName,
                                   report.bottleneckPercentage);
            }
        }

        // Sleep in small increments
        for (int elapsed = 0; elapsed < profileCallbackIntervalMs && profiling.load(); elapsed += 100)
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    DBG("PluginProfiler: Callback thread stopped");
}

void PluginProfiler::registerPlugin(int pluginId, const juce::String& name)
{
    std::lock_guard<std::mutex> lock(statsMutex);

    if (pluginStatsMap.find(pluginId) != pluginStatsMap.end())
        return;

    PluginStatsInternal stats;
    stats.lastProcessTime.store(0.0, std::memory_order_relaxed);
    stats.peakProcessTime.store(0.0, std::memory_order_relaxed);
    stats.minProcessTime.store(999999.0, std::memory_order_relaxed);
    stats.totalBlocks.store(0, std::memory_order_relaxed);

    pluginStatsMap[pluginId] = stats;
    pluginNames[pluginId] = name;

    DBG("PluginProfiler: Registered plugin '" + name + "' (ID: " + juce::String(pluginId) + ")");
}

void PluginProfiler::calculateBottleneckScores(std::vector<PluginStats>& stats) const
{
    double totalTime = 0.0;
    for (const auto& s : stats)
        totalTime += s.averageProcessTimeMs;

    if (totalTime <= 0.0)
        return;

    for (auto& s : stats)
    {
        s.chainPercentage = (s.averageProcessTimeMs / totalTime) * 100.0;
        s.bottleneckScore = s.chainPercentage;

        if (s.chainPercentage > bottleneckThreshold)
            s.isBottleneck = true;
    }
}

int64_t PluginProfiler::currentTimeMs()
{
    return static_cast<int64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count());
}
