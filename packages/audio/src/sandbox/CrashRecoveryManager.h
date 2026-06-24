#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <functional>
#include <atomic>
#include <mutex>
#include <string>
#include <vector>
#include <unordered_map>

class UnifiedPluginManager;
class PluginCrashDetector;
class PluginHealthMonitor;

/**
 * CrashRecoveryManager — Manages the full crash recovery lifecycle.
 *
 * Coordinates between the crash detector and health monitor to provide:
 * - Plugin state serialization (save/restore)
 * - User-confirmable recovery flows
 * - Crash history tracking
 *
 * Usage:
 *   CrashRecoveryManager recovery(pluginManager, crashDetector, healthMonitor);
 *   recovery.initialize();
 *   recovery.enableAutoRecovery(true);
 *   recovery.setRecoveryConfirmCallback([](auto& info) { return true; });
 */
class CrashRecoveryManager
{
public:
    /**
     * Serialized plugin state snapshot.
     */
    struct PluginStateSnapshot
    {
        int originalIndex = -1;
        juce::String pluginName;
        juce::String pluginIdentifier;
        juce::String formatName;
        double sampleRate = 44100.0;
        int blockSize = 512;
        bool wasActive = false;
        bool wasPrepared = false;
        juce::MemoryBlock binaryState;
        int64_t timestamp = 0;
    };

    /**
     * Information about a recovery event.
     */
    struct RecoveryInfo
    {
        int pluginIndex = -1;
        juce::String pluginName;
        juce::String crashReason;
        PluginStateSnapshot savedState;
        int64_t crashTimestamp = 0;
        int recoveryAttempts = 0;
        bool recoverySuccessful = false;
    };

    /**
     * Callback to confirm recovery with the user.
     * Return true to proceed with recovery, false to skip.
     * @param info Recovery event details.
     */
    using RecoveryConfirmCallback = std::function<bool(const RecoveryInfo&)>;

    /**
     * Callback when recovery completes.
     * @param info Recovery event details (including success status).
     */
    using RecoveryCompleteCallback = std::function<void(const RecoveryInfo&)>;

    /**
     * Construct with references to the plugin manager, crash detector, and health monitor.
     */
    CrashRecoveryManager(UnifiedPluginManager& pluginManager,
                         PluginCrashDetector& crashDetector,
                         PluginHealthMonitor& healthMonitor);
    ~CrashRecoveryManager();

    /**
     * Initialize the recovery manager.
     * Hooks into crash detector and health monitor callbacks.
     * @return true if initialization succeeded.
     */
    bool initialize();

    /**
     * Shut down and release all resources.
     */
    void shutdown();

    /**
     * Save the current state of a plugin.
     * @param pluginIndex Index of the plugin.
     * @return true if the state was saved successfully.
     */
    bool savePluginState(int pluginIndex);

    /**
     * Save the state of all currently loaded plugins.
     * @return Number of plugins whose state was saved.
     */
    int saveAllPluginStates();

    /**
     * Attempt to restore a plugin from a saved state.
     * @param pluginIndex Index where the plugin was (or the snapshot index).
     * @return true if the plugin was restored successfully.
     */
    bool restorePluginState(int pluginIndex);

    /**
     * Attempt to restore a plugin from a specific snapshot.
     * @param snapshot The snapshot to restore from.
     * @return Index of the restored plugin, or -1 on failure.
     */
    int restoreFromSnapshot(const PluginStateSnapshot& snapshot);

    /**
     * Enable or disable automatic recovery on crash.
     * @param enabled true to auto-recover without user confirmation.
     */
    void enableAutoRecovery(bool enabled);

    /**
     * Check if auto-recovery is enabled.
     */
    bool isAutoRecoveryEnabled() const { return autoRecovery.load(); }

    /**
     * Set the maximum number of recovery attempts per plugin.
     * @param maxAttempts Maximum attempts (default: 3).
     */
    void setMaxRecoveryAttempts(int maxAttempts);

    /**
     * Set callback for user-confirmed recovery.
     */
    void setRecoveryConfirmCallback(RecoveryConfirmCallback callback);

    /**
     * Set callback for recovery completion.
     */
    void setRecoveryCompleteCallback(RecoveryCompleteCallback callback);

    /**
     * Get the crash history.
     * @return List of all recovery events.
     */
    std::vector<RecoveryInfo> getCrashHistory() const;

    /**
     * Clear the crash history.
     */
    void clearCrashHistory();

    /**
     * Get the number of saved plugin states.
     */
    int getNumSavedStates() const;

    /**
     * Check if a saved state exists for a plugin index.
     */
    bool hasSavedState(int pluginIndex) const;

    /**
     * Remove a saved state for a plugin index.
     */
    void removeSavedState(int pluginIndex);

    /**
     * Serialize all saved states to a MemoryBlock for persistence.
     */
    juce::MemoryBlock serializeStates() const;

    /**
     * Deserialize saved states from a MemoryBlock.
     * @return Number of states restored.
     */
    int deserializeStates(const juce::MemoryBlock& data);

    /**
     * Check if the manager is initialized.
     */
    bool isInitialized() const { return initialized.load(); }

private:
    UnifiedPluginManager& pluginManager;
    PluginCrashDetector& crashDetector;
    PluginHealthMonitor& healthMonitor;

    mutable std::mutex stateMutex;
    std::unordered_map<int, PluginStateSnapshot> savedStates;

    mutable std::mutex historyMutex;
    std::vector<RecoveryInfo> crashHistory;

    RecoveryConfirmCallback confirmCallback;
    RecoveryCompleteCallback completeCallback;

    std::atomic<bool> initialized{false};
    std::atomic<bool> autoRecovery{false};
    int maxRecoveryAttempts = 3;

    /**
     * Handle a crash detected by the crash detector.
     */
    void onCrashDetected(const PluginCrashDetector::CrashInfo& crashInfo);

    /**
     * Handle a health state change from the health monitor.
     */
    void onHealthStateChanged(int pluginIndex,
                              PluginHealthMonitor::HealthState oldState,
                              PluginHealthMonitor::HealthState newState);

    /**
     * Execute the recovery flow for a plugin.
     */
    bool executeRecovery(int pluginIndex, const juce::String& reason);

    /**
     * Serialize a single snapshot to JSON.
     */
    juce::String snapshotToJson(const PluginStateSnapshot& snapshot) const;

    /**
     * Deserialize a single snapshot from JSON.
     */
    PluginStateSnapshot snapshotFromJson(const juce::String& json) const;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(CrashRecoveryManager)
};
