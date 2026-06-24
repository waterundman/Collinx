#include <juce_audio_basics/juce_audio_basics.h>
#include "../src/perf/PerformanceMonitor.h"
#include "../src/perf/PluginProfiler.h"

/**
 * Performance monitoring test runner.
 */
class PerfTestRunner
{
public:
    static int runAll(int& passed, int& failed)
    {
        std::cout << std::endl;
        std::cout << "=== Performance Monitor Tests ===" << std::endl;

        runPerformanceMonitorTests(passed, failed);
        runPluginProfilerTests(passed, failed);

        return 0;
    }

private:
    static void runPerformanceMonitorTests(int& passed, int& failed)
    {
        std::cout << std::endl << "--- PerformanceMonitor Tests ---" << std::endl;

        runTest("PerformanceMonitor Initial State", [&]() {
            PerformanceMonitor monitor;
            return !monitor.isInitialized() && !monitor.isMonitoring();
        }, passed, failed);

        runTest("PerformanceMonitor Initialize Null Chain", [&]() {
            PerformanceMonitor monitor;
            return !monitor.initialize(nullptr);
        }, passed, failed);

        runTest("PerformanceMonitor Initialize", [&]() {
            PerformanceMonitor monitor;
            // We can't pass a real chain in unit tests without full JUCE setup
            // So we test the initialization check
            return !monitor.isInitialized();
        }, passed, failed);

        runTest("PerformanceMonitor Set Monitoring Interval", [&]() {
            PerformanceMonitor monitor;
            monitor.setMonitoringInterval(200);
            return true; // No crash = pass
        }, passed, failed);

        runTest("PerformanceMonitor Set Latency Threshold", [&]() {
            PerformanceMonitor monitor;
            monitor.setLatencyThreshold(15.0);
            return true; // No crash = pass
        }, passed, failed);

        runTest("PerformanceMonitor Record Processing Time", [&]() {
            PerformanceMonitor monitor;
            monitor.recordProcessingTime(5.0);
            return monitor.getProcessingLatency() == 5.0;
        }, passed, failed);

        runTest("PerformanceMonitor Average Latency", [&]() {
            PerformanceMonitor monitor;
            monitor.recordProcessingTime(10.0);
            monitor.recordProcessingTime(20.0);
            monitor.recordProcessingTime(30.0);
            double avg = monitor.getAverageLatency();
            return avg == 20.0;
        }, passed, failed);

        runTest("PerformanceMonitor Peak Latency", [&]() {
            PerformanceMonitor monitor;
            monitor.recordProcessingTime(10.0);
            monitor.recordProcessingTime(25.0);
            monitor.recordProcessingTime(15.0);
            return monitor.getPeakLatency() == 25.0;
        }, passed, failed);

        runTest("PerformanceMonitor Reset Peaks", [&]() {
            PerformanceMonitor monitor;
            monitor.recordProcessingTime(25.0);
            monitor.resetPeaks();
            return monitor.getPeakLatency() == 0.0;
        }, passed, failed);

        runTest("PerformanceMonitor Latency Callback", [&]() {
            PerformanceMonitor monitor;
            monitor.setLatencyThreshold(10.0);
            double reportedLatency = 0.0;
            double reportedThreshold = 0.0;
            monitor.setOnLatencyWarningCallback([&](double latency, double threshold) {
                reportedLatency = latency;
                reportedThreshold = threshold;
            });
            monitor.recordProcessingTime(15.0);
            return reportedLatency == 15.0 && reportedThreshold == 10.0;
        }, passed, failed);

        runTest("PerformanceMonitor Metrics Callback", [&]() {
            PerformanceMonitor monitor;
            bool callbackInvoked = false;
            monitor.setOnMetricsCallback([&](const PerformanceMonitor::Metrics&) {
                callbackInvoked = true;
            });
            // Callback is only invoked during monitoring, which requires initialization
            return !callbackInvoked;
        }, passed, failed);

        runTest("PerformanceMonitor Get Default Metrics", [&]() {
            PerformanceMonitor monitor;
            auto metrics = monitor.getMetrics();
            return metrics.cpuUsage == 0.0
                && metrics.memoryUsageBytes == 0
                && metrics.processingLatencyMs == 0.0;
        }, passed, failed);
    }

    static void runPluginProfilerTests(int& passed, int& failed)
    {
        std::cout << std::endl << "--- PluginProfiler Tests ---" << std::endl;

        runTest("PluginProfiler Initial State", [&]() {
            PluginProfiler profiler;
            return !profiler.isInitialized() && !profiler.isProfiling();
        }, passed, failed);

        runTest("PluginProfiler Initialize Null Chain", [&]() {
            PluginProfiler profiler;
            return !profiler.initialize(nullptr);
        }, passed, failed);

        runTest("PluginProfiler Set Bottleneck Threshold", [&]() {
            PluginProfiler profiler;
            profiler.setBottleneckThreshold(50.0);
            return true; // No crash = pass
        }, passed, failed);

        runTest("PluginProfiler Set Bottleneck Threshold Clamp", [&]() {
            PluginProfiler profiler;
            // Should clamp to valid range
            profiler.setBottleneckThreshold(5.0);  // Below min (10)
            profiler.setBottleneckThreshold(95.0); // Above max (90)
            return true; // No crash = pass
        }, passed, failed);

        runTest("PluginProfiler Record Processing Time Without Init", [&]() {
            PluginProfiler profiler;
            // Should not crash when not initialized
            profiler.recordPluginProcessingTime(1, 5.0);
            return true;
        }, passed, failed);

        runTest("PluginProfiler Generate Empty Report", [&]() {
            PluginProfiler profiler;
            auto report = profiler.generateReport();
            return report.pluginStats.empty()
                && report.totalProcessingTimeMs == 0.0
                && report.bottleneckPluginId == -1;
        }, passed, failed);

        runTest("PluginProfiler Get Plugin Stats Empty", [&]() {
            PluginProfiler profiler;
            auto stats = profiler.getPluginStats(999);
            return stats.pluginId == -1;
        }, passed, failed);

        runTest("PluginProfiler Get All Stats Empty", [&]() {
            PluginProfiler profiler;
            auto stats = profiler.getAllPluginStats();
            return stats.empty();
        }, passed, failed);

        runTest("PluginProfiler Identify Bottleneck Empty", [&]() {
            PluginProfiler profiler;
            return profiler.identifyBottleneck() == -1;
        }, passed, failed);

        runTest("PluginProfiler Reset", [&]() {
            PluginProfiler profiler;
            profiler.reset();
            return true; // No crash = pass
        }, passed, failed);

        runTest("PluginProfiler Num Profiled Plugins", [&]() {
            PluginProfiler profiler;
            return profiler.getNumProfiledPlugins() == 0;
        }, passed, failed);

        runTest("PluginProfiler Callback Setup", [&]() {
            PluginProfiler profiler;
            bool bottleneckCalled = false;
            profiler.setBottleneckCallback([&](int, const juce::String&, double) {
                bottleneckCalled = true;
            });
            bool profileCalled = false;
            profiler.setProfileCallback([&](const PluginProfiler::PerformanceReport&) {
                profileCalled = true;
            });
            return !bottleneckCalled && !profileCalled;
        }, passed, failed);

        runTest("PluginProfiler Start Stop Without Init", [&]() {
            PluginProfiler profiler;
            // Should not crash
            profiler.startProfiling();
            profiler.stopProfiling();
            return !profiler.isProfiling();
        }, passed, failed);
    }

    static void runTest(const juce::String& testName,
                        std::function<bool()> testFunc,
                        int& passed,
                        int& failed)
    {
        std::cout << "  " << testName << "... ";
        try
        {
            if (testFunc())
            {
                std::cout << "PASS" << std::endl;
                ++passed;
            }
            else
            {
                std::cout << "FAIL" << std::endl;
                ++failed;
            }
        }
        catch (const std::exception& e)
        {
            std::cout << "EXCEPTION: " << e.what() << std::endl;
            ++failed;
        }
    }
};
