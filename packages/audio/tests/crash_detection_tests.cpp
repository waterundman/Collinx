#include <juce_audio_processors/juce_audio_processors.h>
#include "../src/plugins/PluginFormatRegistry.h"
#include "../src/plugins/UnifiedPluginManager.h"
#include "../src/sandbox/PluginCrashDetector.h"
#include "../src/sandbox/PluginHealthMonitor.h"
#include "../src/sandbox/CrashRecoveryManager.h"

/**
 * Simple test runner for Stage 2 — Crash Detection Mechanism.
 * Tests PluginCrashDetector, PluginHealthMonitor, and CrashRecoveryManager.
 */

class CrashDetectionTestRunner
{
public:
    static int runAll(int& passed, int& failed)
    {
        std::cout << std::endl;
        std::cout << "=== Crash Detection Mechanism Tests ===" << std::endl;

        // ── PluginCrashDetector tests ────────────────────────────────

        runTest("PluginCrashDetector Construction", [&]() {
            PluginCrashDetector detector;
            return !detector.isInitialized();
        }, passed, failed);

        runTest("PluginCrashDetector Initialize", [&]() {
            PluginCrashDetector detector;
            return detector.initialize();
        }, passed, failed);

        runTest("PluginCrashDetector IsInitialized After Init", [&]() {
            PluginCrashDetector detector;
            detector.initialize();
            return detector.isInitialized();
        }, passed, failed);

        runTest("PluginCrashDetector Double Initialize", [&]() {
            PluginCrashDetector detector;
            detector.initialize();
            return detector.initialize(); // Should return true (idempotent)
        }, passed, failed);

        runTest("PluginCrashDetector Shutdown", [&]() {
            PluginCrashDetector detector;
            detector.initialize();
            detector.shutdown();
            return !detector.isInitialized();
        }, passed, failed);

        runTest("PluginCrashDetector SafeExecute Success", [&]() {
            PluginCrashDetector detector;
            detector.initialize();
            bool ok = detector.safeExecute(0, []() {
                int x = 1 + 1;
                (void)x;
            });
            return ok && !detector.didCrash();
        }, passed, failed);

        runTest("PluginCrashDetector SafeExecute No Init", [&]() {
            PluginCrashDetector detector;
            bool ok = detector.safeExecute(0, []() {
                int x = 1 + 1;
                (void)x;
            });
            return ok; // Should succeed even without initialization
        }, passed, failed);

        runTest("PluginCrashDetector SafeExecute Invalid Index", [&]() {
            PluginCrashDetector detector;
            detector.initialize();
            return detector.safeExecute(-1, []() {});
        }, passed, failed);

        runTest("PluginCrashDetector CrashCallback Set", [&]() {
            PluginCrashDetector detector;
            bool called = false;
            detector.setCrashCallback([&](const PluginCrashDetector::CrashInfo&) {
                called = true;
            });
            // Callback is set but not invoked without a crash
            return !called;
        }, passed, failed);

        runTest("PluginCrashDetector LastCrashInfo Default", [&]() {
            PluginCrashDetector detector;
            auto info = detector.getLastCrashInfo();
            return info.pluginIndex == -1;
        }, passed, failed);

        runTest("PluginCrashDetector SafeExecute Null Func", [&]() {
            PluginCrashDetector detector;
            detector.initialize();
            bool ok = detector.safeExecute(0, nullptr);
            return ok; // Should handle null gracefully
        }, passed, failed);

        // ── PluginHealthMonitor tests ────────────────────────────────

        runTest("PluginHealthMonitor Construction", [&]() {
            UnifiedPluginManager manager;
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            return !monitor.isInitialized();
        }, passed, failed);

        runTest("PluginHealthMonitor Initialize", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            return monitor.initialize();
        }, passed, failed);

        runTest("PluginHealthMonitor Requires CrashDetector Init", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            // detector NOT initialized
            PluginHealthMonitor monitor(manager, detector);
            return !monitor.initialize(); // Should fail
        }, passed, failed);

        runTest("PluginHealthMonitor Double Initialize", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            return monitor.initialize(); // Idempotent
        }, passed, failed);

        runTest("PluginHealthMonitor Register Plugin", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            monitor.registerPlugin(0, "TestPlugin");
            return monitor.getNumRegistered() == 1;
        }, passed, failed);

        runTest("PluginHealthMonitor Unregister Plugin", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            monitor.registerPlugin(0, "TestPlugin");
            monitor.unregisterPlugin(0);
            return monitor.getNumRegistered() == 0;
        }, passed, failed);

        runTest("PluginHealthMonitor Not Monitoring Initially", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            return !monitor.isMonitoring();
        }, passed, failed);

        runTest("PluginHealthMonitor Start/Stop Monitoring", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            monitor.startMonitoring();
            bool started = monitor.isMonitoring();
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
            monitor.stopMonitoring();
            bool stopped = !monitor.isMonitoring();
            return started && stopped;
        }, passed, failed);

        runTest("PluginHealthMonitor SetCheckInterval", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            monitor.setCheckInterval(1000);
            return true; // No crash = pass
        }, passed, failed);

        runTest("PluginHealthMonitor SetUnresponsiveTimeout", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            monitor.setUnresponsiveTimeout(3000);
            return true; // No crash = pass
        }, passed, failed);

        runTest("PluginHealthMonitor SetMaxConsecutiveFailures", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            monitor.setMaxConsecutiveFailures(5);
            return true; // No crash = pass
        }, passed, failed);

        runTest("PluginHealthMonitor HealthStatus Default", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            auto status = monitor.getPluginHealth(999);
            return status.pluginIndex == -1; // Not registered
        }, passed, failed);

        runTest("PluginHealthMonitor AutoRecovery Setting", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            monitor.registerPlugin(0, "Test");
            monitor.setAutoRecovery(0, false);
            auto status = monitor.getPluginHealth(0);
            return !status.autoRecoveryEnabled;
        }, passed, failed);

        // ── CrashRecoveryManager tests ───────────────────────────────

        runTest("CrashRecoveryManager Construction", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            return !recovery.isInitialized();
        }, passed, failed);

        runTest("CrashRecoveryManager Initialize", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            return recovery.initialize();
        }, passed, failed);

        runTest("CrashRecoveryManager Requires Dependencies Init", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            // detector NOT initialized
            PluginHealthMonitor monitor(manager, detector);
            CrashRecoveryManager recovery(manager, detector, monitor);
            return !recovery.initialize(); // Should fail
        }, passed, failed);

        runTest("CrashRecoveryManager AutoRecovery Default Off", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            recovery.initialize();
            return !recovery.isAutoRecoveryEnabled();
        }, passed, failed);

        runTest("CrashRecoveryManager EnableAutoRecovery", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            recovery.initialize();
            recovery.enableAutoRecovery(true);
            return recovery.isAutoRecoveryEnabled();
        }, passed, failed);

        runTest("CrashRecoveryManager SaveState Invalid Index", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            recovery.initialize();
            return !recovery.savePluginState(-1);
        }, passed, failed);

        runTest("CrashRecoveryManager HasSavedState False", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            recovery.initialize();
            return !recovery.hasSavedState(0);
        }, passed, failed);

        runTest("CrashRecoveryManager NumSavedStates Zero", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            recovery.initialize();
            return recovery.getNumSavedStates() == 0;
        }, passed, failed);

        runTest("CrashRecoveryManager CrashHistory Empty", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            recovery.initialize();
            return recovery.getCrashHistory().empty();
        }, passed, failed);

        runTest("CrashRecoveryManager ClearCrashHistory", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            recovery.initialize();
            recovery.clearCrashHistory();
            return recovery.getCrashHistory().empty();
        }, passed, failed);

        runTest("CrashRecoveryManager SetMaxRecoveryAttempts", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            recovery.initialize();
            recovery.setMaxRecoveryAttempts(5);
            return true; // No crash = pass
        }, passed, failed);

        runTest("CrashRecoveryManager Serialize Empty States", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            recovery.initialize();
            auto block = recovery.serializeStates();
            return block.getSize() > 0; // Should produce valid JSON
        }, passed, failed);

        runTest("CrashRecoveryManager Deserialize Empty", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            recovery.initialize();
            juce::MemoryBlock empty;
            int count = recovery.deserializeStates(empty);
            return count == 0;
        }, passed, failed);

        runTest("CrashRecoveryManager RemoveSavedState", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            PluginCrashDetector detector;
            detector.initialize();
            PluginHealthMonitor monitor(manager, detector);
            monitor.initialize();
            CrashRecoveryManager recovery(manager, detector, monitor);
            recovery.initialize();
            recovery.removeSavedState(0); // No-op, should not crash
            return true;
        }, passed, failed);

        return 0;
    }

private:
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
