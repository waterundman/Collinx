#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <functional>
#include <atomic>
#include <mutex>
#include <thread>
#include <chrono>
#include <vector>
#include <array>

class PluginChain;

/**
 * PerformanceMonitor — Real-time CPU, memory, and latency monitoring.
 *
 * Provides continuous performance metrics for the audio engine. Runs periodic
 * sampling on a background thread and delivers results via callbacks.
 *
 * Thread-safety: All getters are lock-free. Callbacks are invoked from the
 * monitoring thread.
 *
 * Usage:
 *   PerformanceMonitor monitor;
 *   monitor.initialize(pluginChain);
 *   monitor.setOnMetricsCallback([](const Metrics& m) { ... });
 *   monitor.startMonitoring();
 */
class PerformanceMonitor
{
public:
    /**
     * Performance metrics snapshot.
     */
    struct Metrics
    {
        double cpuUsage = 0.0;          // 0.0 - 100.0
        size_t memoryUsageBytes = 0;    // Current memory usage in bytes
        size_t peakMemoryBytes = 0;     // Peak memory usage in bytes
        double processingLatencyMs = 0.0; // Last block processing time in ms
        double averageLatencyMs = 0.0;  // Average processing latency
        double peakLatencyMs = 0.0;     // Peak processing latency
        int activePlugins = 0;          // Number of active plugins
        double sampleRate = 44100.0;
        int blockSize = 512;
        int64_t timestamp = 0;          // Steady clock timestamp in ms
    };

    /**
     * Callback for periodic metrics updates.
     */
    using MetricsCallback = std::function<void(const Metrics& metrics)>;

    /**
     * Callback for latency threshold exceeded events.
     */
    using LatencyWarningCallback = std::function<void(double latencyMs, double thresholdMs)>;

    PerformanceMonitor();
    ~PerformanceMonitor();

    /**
     * Initialize the monitor with a reference to the plugin chain.
     * @param chain The plugin chain to monitor.
     * @return true if initialization succeeded.
     */
    bool initialize(PluginChain* chain);

    /**
     * Shut down the monitor and stop background sampling.
     */
    void shutdown();

    /**
     * Start periodic performance monitoring.
     */
    void startMonitoring();

    /**
     * Stop periodic performance monitoring.
     */
    void stopMonitoring();

    /**
     * Get the latest metrics snapshot (lock-free).
     */
    Metrics getMetrics() const;

    /**
     * Get CPU usage percentage (0.0 - 100.0).
     */
    double getCpuUsage() const;

    /**
     * Get current memory usage in bytes.
     */
    size_t getMemoryUsage() const;

    /**
     * Get peak memory usage in bytes.
     */
    size_t getPeakMemoryUsage() const;

    /**
     * Get the last block processing latency in milliseconds.
     */
    double getProcessingLatency() const;

    /**
     * Get average processing latency in milliseconds.
     */
    double getAverageLatency() const;

    /**
     * Get peak processing latency in milliseconds.
     */
    double getPeakLatency() const;

    /**
     * Set the monitoring interval.
     * @param intervalMs Interval in milliseconds (default: 100).
     */
    void setMonitoringInterval(int intervalMs);

    /**
     * Set the latency warning threshold.
     * @param thresholdMs Threshold in milliseconds (default: 10.0).
     */
    void setLatencyThreshold(double thresholdMs);

    /**
     * Set callback for periodic metrics updates.
     */
    void setOnMetricsCallback(MetricsCallback callback);

    /**
     * Set callback for latency threshold warnings.
     */
    void setOnLatencyWarningCallback(LatencyWarningCallback callback);

    /**
     * Reset peak values (peak memory, peak latency).
     */
    void resetPeaks();

    /**
     * Record a manual processing time measurement.
     * Call this from the audio thread after processing a block.
     * @param processingTimeMs Time taken to process the block in ms.
     */
    void recordProcessingTime(double processingTimeMs);

    /**
     * Check if monitoring is active.
     */
    bool isMonitoring() const { return monitoring.load(); }

    /**
     * Check if the monitor is initialized.
     */
    bool isInitialized() const { return initialized.load(); }

private:
    PluginChain* pluginChain = nullptr;

    mutable std::mutex metricsMutex;
    Metrics currentMetrics;

    // Lock-free atomic copies for audio thread
    std::atomic<double> atomicCpuUsage{0.0};
    std::atomic<size_t> atomicMemoryUsage{0};
    std::atomic<size_t> atomicPeakMemory{0};
    std::atomic<double> atomicLatency{0.0};
    std::atomic<double> atomicAvgLatency{0.0};
    std::atomic<double> atomicPeakLatency{0.0};

    // Latency tracking
    static constexpr int kLatencyHistorySize = 64;
    std::array<double, kLatencyHistorySize> latencyHistory{};
    std::atomic<int> latencyHistoryIndex{0};
    std::atomic<int> latencyHistoryCount{0};

    // Configuration
    int monitoringIntervalMs = 100;
    double latencyThresholdMs = 10.0;

    // Callbacks
    MetricsCallback metricsCallback;
    LatencyWarningCallback latencyWarningCallback;

    // Threading
    std::atomic<bool> initialized{false};
    std::atomic<bool> monitoring{false};
    std::thread monitorThread;

    /**
     * Background monitoring loop.
     */
    void monitoringLoop();

    /**
     * Sample current performance metrics.
     */
    void sampleMetrics();

    /**
     * Get current process memory usage.
     */
    static size_t getCurrentMemoryUsage();

    /**
     * Get current timestamp in milliseconds.
     */
    static int64_t currentTimeMs();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PerformanceMonitor)
};
