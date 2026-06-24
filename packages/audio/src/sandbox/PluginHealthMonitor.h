#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <functional>
#include <atomic>
#include <mutex>
#include <thread>
#include <chrono>
#include <vector>
#include <unordered_map>

class UnifiedPluginManager;
class PluginCrashDetector;

/**
 * PluginHealthMonitor — Monitors plugin health and detects unresponsive plugins.
 *
 * Runs periodic health checks on all registered plugins. If a plugin fails to
 * respond within a configurable timeout, it is marked as unresponsive and
 * recovery is triggered.
 *
 * Usage:
 *   PluginHealthMonitor monitor(pluginManager, crashDetector);
 *   monitor.initialize();
 *   monitor.registerPlugin(0, "My Plugin");
 *   monitor.startMonitoring();
 */
class PluginHealthMonitor
{
public:
    /**
     * Health state of a monitored plugin.
     */
    enum class HealthState
    {
        Healthy,
        Unresponsive,
        Crashed,
        Recovering,
        Disabled
    };

    /**
     * Health status for a single plugin.
     */
    struct PluginHealthStatus
    {
        int pluginIndex = -1;
        juce::String pluginName;
        HealthState state = HealthState::Healthy;
        int consecutiveFailures = 0;
        int64_t lastSuccessfulCheck = 0;
        int64_t lastCheckTime = 0;
        bool autoRecoveryEnabled = true;
    };

    /**
     * Callback when a plugin's health state changes.
     * @param pluginIndex Index of the plugin.
     * @param oldState Previous health state.
     * @param newState New health state.
     */
    using HealthStateCallback = std::function<void(
        int pluginIndex,
        HealthState oldState,
        HealthState newState)>;

    /**
     * Callback when a plugin becomes unresponsive.
     * @param pluginIndex Index of the unresponsive plugin.
     * @param pluginName Name of the plugin.
     */
    using UnresponsiveCallback = std::function<void(
        int pluginIndex,
        const juce::String& pluginName)>;

    /**
     * Construct with references to the plugin manager and crash detector.
     */
    PluginHealthMonitor(UnifiedPluginManager& pluginManager,
                        PluginCrashDetector& crashDetector);
    ~PluginHealthMonitor();

    /**
     * Initialize the health monitor.
     * @return true if initialization succeeded.
     */
    bool initialize();

    /**
     * Shut down the monitor and stop background checking.
     */
    void shutdown();

    /**
     * Register a plugin for health monitoring.
     * @param pluginIndex Index of the plugin in UnifiedPluginManager.
     * @param pluginName Display name for logging.
     */
    void registerPlugin(int pluginIndex, const juce::String& pluginName);

    /**
     * Unregister a plugin from health monitoring.
     * @param pluginIndex Index of the plugin.
     */
    void unregisterPlugin(int pluginIndex);

    /**
     * Start periodic health monitoring.
     */
    void startMonitoring();

    /**
     * Stop periodic health monitoring.
     */
    void stopMonitoring();

    /**
     * Perform an immediate health check on a specific plugin.
     * @param pluginIndex Index of the plugin.
     * @return true if the plugin is healthy.
     */
    bool checkPluginHealth(int pluginIndex);

    /**
     * Perform an immediate health check on all registered plugins.
     * @return Number of healthy plugins.
     */
    int checkAllPlugins();

    /**
     * Get the health status of a plugin.
     * @param pluginIndex Index of the plugin.
     * @return Health status, or nullptr if not registered.
     */
    PluginHealthStatus getPluginHealth(int pluginIndex) const;

    /**
     * Get health status of all monitored plugins.
     */
    std::vector<PluginHealthStatus> getAllPluginHealth() const;

    /**
     * Set the health check interval.
     * @param intervalMs Interval in milliseconds (default: 2000).
     */
    void setCheckInterval(int intervalMs);

    /**
     * Set the timeout for considering a plugin unresponsive.
     * @param timeoutMs Timeout in milliseconds (default: 5000).
     */
    void setUnresponsiveTimeout(int timeoutMs);

    /**
     * Set maximum consecutive failures before marking as crashed.
     * @param maxFailures Number of failures (default: 3).
     */
    void setMaxConsecutiveFailures(int maxFailures);

    /**
     * Enable or disable auto-recovery for a specific plugin.
     * @param pluginIndex Index of the plugin.
     * @param enabled true to enable auto-recovery.
     */
    void setAutoRecovery(int pluginIndex, bool enabled);

    /**
     * Set callback for health state changes.
     */
    void setHealthStateCallback(HealthStateCallback callback);

    /**
     * Set callback for unresponsive plugins.
     */
    void setUnresponsiveCallback(UnresponsiveCallback callback);

    /**
     * Check if monitoring is active.
     */
    bool isMonitoring() const { return monitoring.load(); }

    /**
     * Check if the monitor is initialized.
     */
    bool isInitialized() const { return initialized.load(); }

    /**
     * Get the number of registered plugins.
     */
    int getNumRegistered() const;

private:
    UnifiedPluginManager& pluginManager;
    PluginCrashDetector& crashDetector;

    mutable std::mutex statusMutex;
    std::unordered_map<int, PluginHealthStatus> pluginStatuses;

    HealthStateCallback healthStateCallback;
    UnresponsiveCallback unresponsiveCallback;

    std::atomic<bool> initialized{false};
    std::atomic<bool> monitoring{false};
    std::thread monitorThread;

    int checkIntervalMs = 2000;
    int unresponsiveTimeoutMs = 5000;
    int maxConsecutiveFailures = 3;

    /**
     * Background monitoring loop.
     */
    void monitoringLoop();

    /**
     * Update health state for a plugin.
     */
    void updatePluginState(int pluginIndex, HealthState newState);

    /**
     * Attempt automatic recovery of a crashed/unresponsive plugin.
     */
    bool attemptRecovery(int pluginIndex);

    /**
     * Get current timestamp in milliseconds.
     */
    static int64_t currentTimeMs();

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginHealthMonitor)
};
