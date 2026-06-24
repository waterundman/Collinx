#pragma once

#include <functional>
#include <string>
#include <mutex>
#include <atomic>
#include <chrono>
#include <vector>

/**
 * ScanProgressReporter — Reports plugin scan progress to subscribers.
 *
 * Provides thread-safe progress reporting with support for:
 * - Multiple concurrent progress subscribers
 * - Progress percentage, ETA estimation, and per-file status
 * - Throttled updates to avoid flooding UI threads
 *
 * Usage:
 *   ScanProgressReporter reporter;
 *   reporter.setOnProgress([](const ProgressInfo& info) { ... });
 *   reporter.beginScan(100);
 *   for (int i = 0; i < 100; ++i) {
 *       reporter.reportFile("plugin.vst3", i);
 *   }
 *   reporter.endScan();
 */
class ScanProgressReporter
{
public:
    struct ProgressInfo
    {
        int filesScanned = 0;
        int totalFiles = 0;
        float percentComplete = 0.0f;
        std::string currentFile;
        std::chrono::milliseconds estimatedTimeRemaining{0};
        std::chrono::milliseconds elapsedTime{0};
        bool isComplete = false;
    };

    using ProgressCallback = std::function<void(const ProgressInfo&)>;
    using FileCallback = std::function<void(const std::string& filePath)>;

    ScanProgressReporter();
    ~ScanProgressReporter();

    void setOnProgress(ProgressCallback callback);
    void setOnFileStart(FileCallback callback);
    void setOnFileComplete(FileCallback callback);

    /**
     * Begin a new scan session.
     * @param totalFiles Total number of files to scan.
     */
    void beginScan(int totalFiles);

    /**
     * Report progress for a single file.
     * @param filePath Path of the file being scanned.
     * @param filesScanned Number of files scanned so far.
     */
    void reportFile(const std::string& filePath, int filesScanned);

    /**
     * Report that a file scan has completed.
     * @param filePath Path of the completed file.
     * @param success Whether the scan succeeded.
     */
    void reportFileComplete(const std::string& filePath, bool success);

    /**
     * End the current scan session.
     */
    void endScan();

    /**
     * Reset all state.
     */
    void reset();

    /**
     * Get current progress info (thread-safe).
     */
    ProgressInfo getCurrentInfo() const;

    /**
     * Set minimum interval between progress callbacks (throttle).
     * @param interval Minimum time between callbacks.
     */
    void setThrottleInterval(std::chrono::milliseconds interval);

    bool isActive() const { return active; }

private:
    void notifyProgress();
    bool shouldThrottle() const;

    ProgressCallback progressCallback;
    FileCallback fileStartCallback;
    FileCallback fileCompleteCallback;

    mutable std::mutex infoMutex;
    ProgressInfo currentInfo;

    std::atomic<bool> active{false};
    std::chrono::milliseconds throttleInterval{50};
    std::chrono::system_clock::time_point lastNotifyTime;
    std::chrono::system_clock::time_point scanStartTime;

    std::vector<std::chrono::milliseconds> fileDurations;
    mutable std::mutex timingMutex;
};
