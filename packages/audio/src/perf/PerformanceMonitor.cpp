#include "PerformanceMonitor.h"
#include "../vst3/PluginChain.h"

#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#elif defined(__APPLE__)
#include <mach/mach.h>
#else
#include <fstream>
#endif

PerformanceMonitor::PerformanceMonitor()
{
    latencyHistory.fill(0.0);
}

PerformanceMonitor::~PerformanceMonitor()
{
    shutdown();
}

bool PerformanceMonitor::initialize(PluginChain* chain)
{
    if (initialized.load())
        return true;

    if (chain == nullptr)
    {
        DBG("PerformanceMonitor: Null plugin chain");
        return false;
    }

    pluginChain = chain;
    initialized.store(true);
    DBG("PerformanceMonitor: Initialized");
    return true;
}

void PerformanceMonitor::shutdown()
{
    if (!initialized.load())
        return;

    stopMonitoring();

    {
        std::lock_guard<std::mutex> lock(metricsMutex);
        currentMetrics = {};
    }

    pluginChain = nullptr;
    initialized.store(false);
    DBG("PerformanceMonitor: Shut down");
}

void PerformanceMonitor::startMonitoring()
{
    if (monitoring.load())
        return;

    monitoring.store(true);
    monitorThread = std::thread(&PerformanceMonitor::monitoringLoop, this);
    DBG("PerformanceMonitor: Monitoring started");
}

void PerformanceMonitor::stopMonitoring()
{
    if (!monitoring.load())
        return;

    monitoring.store(false);
    if (monitorThread.joinable())
        monitorThread.join();
    DBG("PerformanceMonitor: Monitoring stopped");
}

PerformanceMonitor::Metrics PerformanceMonitor::getMetrics() const
{
    std::lock_guard<std::mutex> lock(metricsMutex);
    return currentMetrics;
}

double PerformanceMonitor::getCpuUsage() const
{
    return atomicCpuUsage.load(std::memory_order_relaxed);
}

size_t PerformanceMonitor::getMemoryUsage() const
{
    return atomicMemoryUsage.load(std::memory_order_relaxed);
}

size_t PerformanceMonitor::getPeakMemoryUsage() const
{
    return atomicPeakMemory.load(std::memory_order_relaxed);
}

double PerformanceMonitor::getProcessingLatency() const
{
    return atomicLatency.load(std::memory_order_relaxed);
}

double PerformanceMonitor::getAverageLatency() const
{
    return atomicAvgLatency.load(std::memory_order_relaxed);
}

double PerformanceMonitor::getPeakLatency() const
{
    return atomicPeakLatency.load(std::memory_order_relaxed);
}

void PerformanceMonitor::setMonitoringInterval(int intervalMs)
{
    monitoringIntervalMs = (intervalMs > 0) ? intervalMs : 100;
}

void PerformanceMonitor::setLatencyThreshold(double thresholdMs)
{
    latencyThresholdMs = thresholdMs;
}

void PerformanceMonitor::setOnMetricsCallback(MetricsCallback callback)
{
    metricsCallback = std::move(callback);
}

void PerformanceMonitor::setOnLatencyWarningCallback(LatencyWarningCallback callback)
{
    latencyWarningCallback = std::move(callback);
}

void PerformanceMonitor::resetPeaks()
{
    atomicPeakMemory.store(0, std::memory_order_relaxed);
    atomicPeakLatency.store(0.0, std::memory_order_relaxed);

    std::lock_guard<std::mutex> lock(metricsMutex);
    currentMetrics.peakMemoryBytes = 0;
    currentMetrics.peakLatencyMs = 0.0;
}

void PerformanceMonitor::recordProcessingTime(double processingTimeMs)
{
    // Store in lock-free atomics for audio thread
    atomicLatency.store(processingTimeMs, std::memory_order_relaxed);

    // Update latency history for averaging
    int idx = latencyHistoryIndex.load(std::memory_order_relaxed);
    latencyHistory[idx] = processingTimeMs;
    latencyHistoryIndex.store((idx + 1) % kLatencyHistorySize, std::memory_order_relaxed);

    int count = latencyHistoryCount.load(std::memory_order_relaxed);
    if (count < kLatencyHistorySize)
        latencyHistoryCount.store(count + 1, std::memory_order_relaxed);

    // Calculate average
    int numSamples = std::min(count + 1, kLatencyHistorySize);
    double sum = 0.0;
    for (int i = 0; i < numSamples; ++i)
        sum += latencyHistory[i];
    double avg = sum / numSamples;
    atomicAvgLatency.store(avg, std::memory_order_relaxed);

    // Update peak
    double currentPeak = atomicPeakLatency.load(std::memory_order_relaxed);
    while (processingTimeMs > currentPeak)
    {
        if (atomicPeakLatency.compare_exchange_weak(currentPeak, processingTimeMs, std::memory_order_relaxed))
            break;
    }

    // Check threshold
    if (processingTimeMs > latencyThresholdMs && latencyWarningCallback)
    {
        latencyWarningCallback(processingTimeMs, latencyThresholdMs);
    }
}

// ── Private ────────────────────────────────────────────────────────────

void PerformanceMonitor::monitoringLoop()
{
    DBG("PerformanceMonitor: Monitor thread started");

    while (monitoring.load())
    {
        sampleMetrics();

        // Sleep in small increments so we can respond to stopMonitoring quickly
        for (int elapsed = 0; elapsed < monitoringIntervalMs && monitoring.load(); elapsed += 50)
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    DBG("PerformanceMonitor: Monitor thread stopped");
}

void PerformanceMonitor::sampleMetrics()
{
    Metrics metrics;
    metrics.timestamp = currentTimeMs();

    // Sample memory
    metrics.memoryUsageBytes = getCurrentMemoryUsage();
    atomicMemoryUsage.store(metrics.memoryUsageBytes, std::memory_order_relaxed);

    size_t currentPeak = atomicPeakMemory.load(std::memory_order_relaxed);
    while (metrics.memoryUsageBytes > currentPeak)
    {
        if (atomicPeakMemory.compare_exchange_weak(currentPeak, metrics.memoryUsageBytes, std::memory_order_relaxed))
            break;
    }
    metrics.peakMemoryBytes = atomicPeakMemory.load(std::memory_order_relaxed);

    // Sample latency from atomic
    metrics.processingLatencyMs = atomicLatency.load(std::memory_order_relaxed);
    metrics.averageLatencyMs = atomicAvgLatency.load(std::memory_order_relaxed);
    metrics.peakLatencyMs = atomicPeakLatency.load(std::memory_order_relaxed);

    // Estimate CPU usage based on processing latency and block size
    // CPU% = (processing_time / block_duration) * 100
    if (pluginChain != nullptr)
    {
        metrics.sampleRate = 44100.0; // Default, could query from chain
        metrics.blockSize = 512;
        double blockDurationMs = (static_cast<double>(metrics.blockSize) / metrics.sampleRate) * 1000.0;
        if (blockDurationMs > 0.0)
        {
            double cpu = (metrics.processingLatencyMs / blockDurationMs) * 100.0;
            cpu = std::clamp(cpu, 0.0, 100.0);
            atomicCpuUsage.store(cpu, std::memory_order_relaxed);
            metrics.cpuUsage = cpu;
        }

        metrics.activePlugins = pluginChain->getNumPlugins();
    }

    // Store full metrics snapshot
    {
        std::lock_guard<std::mutex> lock(metricsMutex);
        currentMetrics = metrics;
    }

    // Invoke callback
    if (metricsCallback)
        metricsCallback(metrics);
}

size_t PerformanceMonitor::getCurrentMemoryUsage()
{
#ifdef _WIN32
    PROCESS_MEMORY_COUNTERS pmc;
    if (GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof(pmc)))
        return pmc.WorkingSetSize;
    return 0;
#elif defined(__APPLE__)
    struct mach_task_basic_info info;
    mach_msg_type_number_t count = MACH_TASK_BASIC_INFO_COUNT;
    if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &count) == KERN_SUCCESS)
        return info.resident_size;
    return 0;
#else
    // Linux: read /proc/self/status
    std::ifstream statusFile("/proc/self/status");
    std::string line;
    while (std::getline(statusFile, line))
    {
        if (line.substr(0, 6) == "VmRSS:")
        {
            size_t kb = 0;
            try {
                kb = std::stoul(line.substr(6));
            } catch (...) {
                return 0;
            }
            return kb * 1024;
        }
    }
    return 0;
#endif
}

int64_t PerformanceMonitor::currentTimeMs()
{
    return static_cast<int64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count());
}
