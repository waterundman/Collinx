#pragma once

#include <functional>
#include <atomic>
#include <mutex>
#include <string>
#include <cstdint>

/**
 * PluginCrashDetector — Platform-specific crash detection for plugins.
 *
 * Wraps SEH (Windows) and signal handlers (Unix) to catch crashes
 * originating from plugin code without terminating the host application.
 *
 * Usage:
 *   PluginCrashDetector detector;
 *   detector.initialize();
 *   detector.setCrashCallback([](const auto& info) { ... });
 *   bool ok = detector.safeExecute(pluginIndex, [&]() { plugin->processBlock(...); });
 */
class PluginCrashDetector
{
public:
    /**
     * Information about a detected crash.
     */
    struct CrashInfo
    {
        int pluginIndex = -1;
        std::string signalName;
        std::string description;
        std::string address;
        uint64_t timestamp = 0;
    };

    /**
     * Crash callback type. Called when a crash is detected.
     * The callback runs in a signal-handler or SEH context — keep it minimal.
     */
    using CrashCallback = std::function<void(const CrashInfo&)>;

    PluginCrashDetector();
    ~PluginCrashDetector();

    /**
     * Install platform-specific crash handlers.
     * @return true if handlers were installed successfully.
     */
    bool initialize();

    /**
     * Restore original crash handlers.
     */
    void shutdown();

    /**
     * Set the callback invoked when a crash is detected.
     * @param callback Function to call on crash.
     */
    void setCrashCallback(CrashCallback callback);

    /**
     * Execute a function within a protected context.
     * If the function triggers a crash, the crash is caught and reported.
     * @param pluginIndex Index of the plugin being executed (for reporting).
     * @param func The function to execute safely.
     * @return true if the function completed without crashing.
     */
    bool safeExecute(int pluginIndex, std::function<void()> func);

    /**
     * Check if a crash was detected during the last safeExecute call.
     */
    bool didCrash() const { return lastCrashDetected.load(); }

    /**
     * Get crash info from the last detected crash.
     */
    CrashInfo getLastCrashInfo() const;

    /**
     * Check if the detector is initialized.
     */
    bool isInitialized() const { return initialized.load(); }

private:
    CrashCallback crashCallback;
    mutable std::mutex callbackMutex;

    std::atomic<bool> initialized{false};
    std::atomic<bool> lastCrashDetected{false};
    std::atomic<int> currentPluginIndex{-1};

    CrashInfo lastCrashInfo;
    mutable std::mutex crashInfoMutex;

    // Platform-specific: store previous handler for restoration
#if defined(_WIN32)
    void* previousSehHandler = nullptr;
#else
    // Store previous signal handlers (SIGSEGV, SIGABRT, SIGFPE, SIGBUS)
    struct PreviousHandlers;
    PreviousHandlers* prevHandlers = nullptr;
#endif

    /**
     * Internal crash report — called from platform handler.
     */
    void reportCrash(int pluginIndex, const std::string& signalName,
                     const std::string& description, const std::string& address);

    /**
     * Platform-specific initialization.
     */
    bool initializePlatform();

    /**
     * Platform-specific shutdown.
     */
    void shutdownPlatform();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginCrashDetector)
};
