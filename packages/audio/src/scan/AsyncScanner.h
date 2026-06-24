#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <vector>
#include <functional>
#include <atomic>
#include <mutex>
#include <thread>
#include <condition_variable>
#include <queue>
#include <future>

/**
 * AsyncScanner — Asynchronous plugin scanner with incremental scanning support.
 *
 * Provides background scanning capabilities for plugin discovery.
 * Supports cancellation, pause/resume, and incremental scanning
 * (only scanning new or modified files).
 *
 * Usage:
 *   AsyncScanner scanner;
 *   scanner.initialize(&formatRegistry);
 *   scanner.setScanCompleteCallback([](auto results) { ... });
 *   scanner.startScan();
 *   // Later...
 *   scanner.pause();
 *   scanner.resume();
 *   scanner.cancel();
 */
class AsyncScanner
{
public:
    /**
     * Scan state enumeration.
     */
    enum class ScanState
    {
        Idle,           // Not scanning
        Scanning,       // Actively scanning
        Paused,         // Scan paused
        Cancelling,     // Cancellation requested
        Completed,      // Scan completed successfully
        Failed          // Scan failed
    };

    /**
     * Scan result for a single file.
     */
    struct ScanResult
    {
        juce::String filePath;
        std::vector<juce::PluginDescription> descriptions;
        bool success = false;
        juce::String errorMessage;
        std::chrono::system_clock::time_point scanTime;
    };

    /**
     * Incremental scan configuration.
     */
    struct IncrementalConfig
    {
        bool enabled = false;               // Enable incremental scanning
        juce::File cacheFilePath;           // Path to cache file
        std::chrono::hours maxCacheAge{24}; // Maximum cache age before forced rescan
        bool verifyExisting = true;         // Verify cached entries still exist
    };

    /**
     * Callback types.
     */
    using ScanCompleteCallback = std::function<void(std::vector<ScanResult> results)>;
    using ScanProgressCallback = std::function<void(const juce::String& currentFile, 
                                                   int filesScanned, 
                                                   int totalFiles,
                                                   float progress)>;
    using ScanErrorCallback = std::function<void(const juce::String& filePath, 
                                                const juce::String& error)>;
    using StateChangeCallback = std::function<void(ScanState newState)>;

    AsyncScanner();
    ~AsyncScanner();

    /**
     * Initialize the scanner.
     * @param formatRegistry Pointer to the plugin format registry.
     * @return true if initialization succeeded.
     */
    bool initialize(juce::AudioPluginFormatManager* formatManager);

    /**
     * Shut down the scanner and release resources.
     */
    void shutdown();

    /**
     * Start a full scan of all plugin directories.
     * @param async If true, scan runs in background thread (default: true).
     * @return true if scan started successfully.
     */
    bool startScan(bool async = true);

    /**
     * Start an incremental scan (only new/modified files).
     * @param config Incremental scan configuration.
     * @param async If true, scan runs in background thread (default: true).
     * @return true if scan started successfully.
     */
    bool startIncrementalScan(const IncrementalConfig& config, bool async = true);

    /**
     * Start scanning specific directories.
     * @param directories Directories to scan.
     * @param async If true, scan runs in background thread (default: true).
     * @return true if scan started successfully.
     */
    bool startDirectoryScan(const std::vector<juce::File>& directories, bool async = true);

    /**
     * Cancel the current scan.
     * Blocks until scan thread acknowledges cancellation.
     */
    void cancel();

    /**
     * Pause the current scan.
     * Can be resumed with resume().
     */
    void pause();

    /**
     * Resume a paused scan.
     */
    void resume();

    /**
     * Wait for the current scan to complete.
     * @param timeoutMs Timeout in milliseconds (0 = wait forever).
     * @return true if scan completed, false if timed out.
     */
    bool waitForCompletion(int timeoutMs = 0);

    /**
     * Get the current scan state.
     */
    ScanState getState() const;

    /**
     * Check if a scan is in progress.
     */
    bool isScanning() const;

    /**
     * Check if the scan is paused.
     */
    bool isPaused() const;

    /**
     * Get scan progress (0.0 to 1.0).
     */
    float getProgress() const;

    /**
     * Get the number of files scanned so far.
     */
    int getFilesScanned() const;

    /**
     * Get the total number of files to scan.
     */
    int getTotalFiles() const;

    /**
     * Get all scan results from the last scan.
     */
    std::vector<ScanResult> getResults() const;

    /**
     * Get plugin descriptions from all successful scan results.
     */
    std::vector<juce::PluginDescription> getPluginDescriptions() const;

    /**
     * Set callback for scan completion.
     */
    void setScanCompleteCallback(ScanCompleteCallback callback);

    /**
     * Set callback for scan progress updates.
     */
    void setScanProgressCallback(ScanProgressCallback callback);

    /**
     * Set callback for scan errors.
     */
    void setScanErrorCallback(ScanErrorCallback callback);

    /**
     * Set callback for state changes.
     */
    void setStateChangeCallback(StateChangeCallback callback);

    /**
     * Configure incremental scanning.
     */
    void setIncrementalConfig(const IncrementalConfig& config);

    /**
     * Get the incremental scan configuration.
     */
    const IncrementalConfig& getIncrementalConfig() const;

    /**
     * Clear the incremental scan cache.
     */
    void clearIncrementalCache();

    /**
     * Check if the scanner is initialized.
     */
    bool isInitialized() const { return initialized; }

private:
    /**
     * Internal scan worker thread.
     */
    class ScanThread : public juce::Thread
    {
    public:
        ScanThread(AsyncScanner& owner);
        void run() override;
        
    private:
        AsyncScanner& owner;
    };

    /**
     * Scan task for thread pool.
     */
    struct ScanTask
    {
        enum Type { Full, Incremental, Directory };
        
        Type type;
        std::vector<juce::File> directories;
        IncrementalConfig incrementalConfig;
    };

    /**
     * Perform the actual scanning work.
     */
    void performScan();

    /**
     * Scan a single file and return results.
     */
    ScanResult scanFile(const juce::File& file);

    /**
     * Check if a file needs rescanning (for incremental mode).
     */
    bool needsRescan(const juce::File& file) const;

    /**
     * Update scan progress.
     */
    void updateProgress(const juce::String& currentFile, int filesScanned, int totalFiles);

    /**
     * Check for pause/cancel signals.
     * @return true if scan should continue, false if cancelled.
     */
    bool checkForInterruption();

    /**
     * Load incremental cache from file.
     */
    bool loadIncrementalCache();

    /**
     * Save incremental cache to file.
     */
    bool saveIncrementalCache() const;

    /**
     * Notify state change.
     */
    void notifyStateChange(ScanState newState);

    /**
     * Notify scan completion.
     */
    void notifyScanComplete();

    /**
     * Notify scan error.
     */
    void notifyScanError(const juce::String& filePath, const juce::String& error);

    // Member variables
    juce::AudioPluginFormatManager* formatManager = nullptr;
    std::unique_ptr<ScanThread> scanThread;
    
    // State
    std::atomic<ScanState> state{ScanState::Idle};
    std::atomic<bool> shouldCancel{false};
    std::atomic<bool> shouldPause{false};
    std::atomic<bool> isInitialized{false};
    
    // Synchronization
    mutable std::mutex resultsMutex;
    mutable std::mutex stateMutex;
    std::condition_variable pauseCondition;
    std::condition_variable completionCondition;
    
    // Scan data
    ScanTask currentTask;
    std::vector<ScanResult> results;
    std::atomic<int> filesScanned{0};
    std::atomic<int> totalFiles{0};
    std::atomic<float> progress{0.0f};
    
    // Incremental scanning
    IncrementalConfig incrementalConfig;
    std::unordered_map<juce::String, std::chrono::system_clock::time_point> incrementalCache;
    
    // Callbacks
    ScanCompleteCallback scanCompleteCallback;
    ScanProgressCallback scanProgressCallback;
    ScanErrorCallback scanErrorCallback;
    StateChangeCallback stateChangeCallback;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(AsyncScanner)
};