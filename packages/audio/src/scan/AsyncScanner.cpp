#include "AsyncScanner.h"
#include <juce_core/juce_core.h>
#include <chrono>
#include <algorithm>

// AsyncScanner::ScanThread implementation
AsyncScanner::ScanThread::ScanThread(AsyncScanner& owner)
    : juce::Thread("PluginScannerThread"), owner(owner)
{
}

void AsyncScanner::ScanThread::run()
{
    owner.performScan();
}

// AsyncScanner implementation
AsyncScanner::AsyncScanner() = default;

AsyncScanner::~AsyncScanner()
{
    shutdown();
}

bool AsyncScanner::initialize(juce::AudioPluginFormatManager* formatManager)
{
    if (initialized)
        return true;

    if (formatManager == nullptr)
    {
        DBG("AsyncScanner: Invalid format manager");
        return false;
    }

    this->formatManager = formatManager;
    initialized = true;
    DBG("AsyncScanner: Initialized");
    return true;
}

void AsyncScanner::shutdown()
{
    if (!initialized)
        return;

    // Cancel any ongoing scan
    if (state == ScanState::Scanning || state == ScanState::Paused)
    {
        cancel();
        waitForCompletion(5000); // Wait up to 5 seconds
    }

    // Clean up thread
    if (scanThread && scanThread->isThreadRunning())
    {
        scanThread->stopThread(2000);
    }
    scanThread.reset();

    initialized = false;
    DBG("AsyncScanner: Shut down");
}

bool AsyncScanner::startScan(bool async)
{
    if (!initialized)
    {
        DBG("AsyncScanner: Not initialized");
        return false;
    }

    if (state == ScanState::Scanning)
    {
        DBG("AsyncScanner: Scan already in progress");
        return false;
    }

    // Set up task
    currentTask.type = ScanTask::Full;
    currentTask.directories.clear();
    
    // Reset state
    {
        std::lock_guard<std::mutex> lock(resultsMutex);
        results.clear();
    }
    filesScanned = 0;
    totalFiles = 0;
    progress = 0.0f;
    shouldCancel = false;
    shouldPause = false;

    // Change state
    notifyStateChange(ScanState::Scanning);

    if (async)
    {
        // Start background thread
        scanThread = std::make_unique<ScanThread>(*this);
        scanThread->startThread();
    }
    else
    {
        // Run synchronously
        performScan();
    }

    return true;
}

bool AsyncScanner::startIncrementalScan(const IncrementalConfig& config, bool async)
{
    if (!initialized)
    {
        DBG("AsyncScanner: Not initialized");
        return false;
    }

    if (state == ScanState::Scanning)
    {
        DBG("AsyncScanner: Scan already in progress");
        return false;
    }

    // Set up task
    currentTask.type = ScanTask::Incremental;
    currentTask.incrementalConfig = config;
    currentTask.directories.clear();
    
    // Reset state
    {
        std::lock_guard<std::mutex> lock(resultsMutex);
        results.clear();
    }
    filesScanned = 0;
    totalFiles = 0;
    progress = 0.0f;
    shouldCancel = false;
    shouldPause = false;

    // Load cache if incremental scanning is enabled
    if (config.enabled)
    {
        incrementalConfig = config;
        loadIncrementalCache();
    }

    // Change state
    notifyStateChange(ScanState::Scanning);

    if (async)
    {
        scanThread = std::make_unique<ScanThread>(*this);
        scanThread->startThread();
    }
    else
    {
        performScan();
    }

    return true;
}

bool AsyncScanner::startDirectoryScan(const std::vector<juce::File>& directories, bool async)
{
    if (!initialized)
    {
        DBG("AsyncScanner: Not initialized");
        return false;
    }

    if (state == ScanState::Scanning)
    {
        DBG("AsyncScanner: Scan already in progress");
        return false;
    }

    // Set up task
    currentTask.type = ScanTask::Directory;
    currentTask.directories = directories;
    
    // Reset state
    {
        std::lock_guard<std::mutex> lock(resultsMutex);
        results.clear();
    }
    filesScanned = 0;
    totalFiles = 0;
    progress = 0.0f;
    shouldCancel = false;
    shouldPause = false;

    // Change state
    notifyStateChange(ScanState::Scanning);

    if (async)
    {
        scanThread = std::make_unique<ScanThread>(*this);
        scanThread->startThread();
    }
    else
    {
        performScan();
    }

    return true;
}

void AsyncScanner::cancel()
{
    if (state == ScanState::Scanning || state == ScanState::Paused)
    {
        shouldCancel = true;
        
        // Resume if paused
        if (state == ScanState::Paused)
        {
            shouldPause = false;
            pauseCondition.notify_all();
        }
        
        notifyStateChange(ScanState::Cancelling);
    }
}

void AsyncScanner::pause()
{
    if (state == ScanState::Scanning)
    {
        shouldPause = true;
        notifyStateChange(ScanState::Paused);
    }
}

void AsyncScanner::resume()
{
    if (state == ScanState::Paused)
    {
        shouldPause = false;
        pauseCondition.notify_all();
        notifyStateChange(ScanState::Scanning);
    }
}

bool AsyncScanner::waitForCompletion(int timeoutMs)
{
    if (state == ScanState::Idle || state == ScanState::Completed || state == ScanState::Failed)
    {
        return true;
    }

    std::unique_lock<std::mutex> lock(stateMutex);
    if (timeoutMs == 0)
    {
        completionCondition.wait(lock, [this] { 
            return state == ScanState::Completed || state == ScanState::Failed; 
        });
        return true;
    }
    else
    {
        return completionCondition.wait_for(lock, std::chrono::milliseconds(timeoutMs), [this] { 
            return state == ScanState::Completed || state == ScanState::Failed; 
        });
    }
}

AsyncScanner::ScanState AsyncScanner::getState() const
{
    return state;
}

bool AsyncScanner::isScanning() const
{
    return state == ScanState::Scanning;
}

bool AsyncScanner::isPaused() const
{
    return state == ScanState::Paused;
}

float AsyncScanner::getProgress() const
{
    return progress;
}

int AsyncScanner::getFilesScanned() const
{
    return filesScanned;
}

int AsyncScanner::getTotalFiles() const
{
    return totalFiles;
}

std::vector<AsyncScanner::ScanResult> AsyncScanner::getResults() const
{
    std::lock_guard<std::mutex> lock(resultsMutex);
    return results;
}

std::vector<juce::PluginDescription> AsyncScanner::getPluginDescriptions() const
{
    std::lock_guard<std::mutex> lock(resultsMutex);
    std::vector<juce::PluginDescription> descriptions;
    
    for (const auto& result : results)
    {
        if (result.success)
        {
            descriptions.insert(descriptions.end(), 
                               result.descriptions.begin(), 
                               result.descriptions.end());
        }
    }
    
    return descriptions;
}

void AsyncScanner::setScanCompleteCallback(ScanCompleteCallback callback)
{
    scanCompleteCallback = std::move(callback);
}

void AsyncScanner::setScanProgressCallback(ScanProgressCallback callback)
{
    scanProgressCallback = std::move(callback);
}

void AsyncScanner::setScanErrorCallback(ScanErrorCallback callback)
{
    scanErrorCallback = std::move(callback);
}

void AsyncScanner::setStateChangeCallback(StateChangeCallback callback)
{
    stateChangeCallback = std::move(callback);
}

void AsyncScanner::setIncrementalConfig(const IncrementalConfig& config)
{
    incrementalConfig = config;
}

const AsyncScanner::IncrementalConfig& AsyncScanner::getIncrementalConfig() const
{
    return incrementalConfig;
}

void AsyncScanner::clearIncrementalCache()
{
    incrementalCache.clear();
    if (incrementalConfig.cacheFilePath.exists())
    {
        incrementalConfig.cacheFilePath.deleteFile();
    }
}

// Private methods

void AsyncScanner::performScan()
{
    DBG("AsyncScanner: Starting scan");
    
    try
    {
        // Collect files to scan
        std::vector<juce::File> filesToScan;
        
        if (currentTask.type == ScanTask::Full)
        {
            // Get default paths from all formats
            auto formatNames = formatManager->getFormats();
            for (auto* format : formatNames)
            {
                if (format && format->canScanForPlugins())
                {
                    auto searchPaths = format->getDefaultLocationsToSearch();
                    auto foundFiles = format->searchPathsForPlugins(searchPaths, true, false);
                    
                    for (const auto& file : foundFiles)
                    {
                        filesToScan.push_back(juce::File(file));
                    }
                }
            }
        }
        else if (currentTask.type == ScanTask::Directory)
        {
            // Scan specified directories
            for (const auto& dir : currentTask.directories)
            {
                if (dir.isDirectory())
                {
                    // Find plugin files in directory
                    juce::Array<juce::File> foundFiles;
                    dir.findChildFiles(foundFiles, juce::File::findFiles, true, 
                                      "*.vst3;*.clap;*.dll;*.so;*.dylib");
                    
                    for (const auto& file : foundFiles)
                    {
                        filesToScan.push_back(file);
                    }
                }
            }
        }
        else if (currentTask.type == ScanTask::Incremental)
        {
            // Get all files first, then filter
            std::vector<juce::File> allFiles;
            auto formatNames = formatManager->getFormats();
            for (auto* format : formatNames)
            {
                if (format && format->canScanForPlugins())
                {
                    auto searchPaths = format->getDefaultLocationsToSearch();
                    auto foundFiles = format->searchPathsForPlugins(searchPaths, true, false);
                    
                    for (const auto& file : foundFiles)
                    {
                        allFiles.push_back(juce::File(file));
                    }
                }
            }
            
            // Filter files that need rescanning
            for (const auto& file : allFiles)
            {
                if (needsRescan(file))
                {
                    filesToScan.push_back(file);
                }
            }
        }
        
        // Remove duplicates
        std::sort(filesToScan.begin(), filesToScan.end());
        filesToScan.erase(std::unique(filesToScan.begin(), filesToScan.end()), 
                         filesToScan.end());
        
        totalFiles = static_cast<int>(filesToScan.size());
        filesScanned = 0;
        progress = 0.0f;
        
        DBG("AsyncScanner: Found " + juce::String(totalFiles) + " files to scan");
        
        // Scan each file
        for (const auto& file : filesToScan)
        {
            // Check for interruption
            if (!checkForInterruption())
            {
                break;
            }
            
            // Scan file
            auto result = scanFile(file);
            
            // Add to results
            {
                std::lock_guard<std::mutex> lock(resultsMutex);
                results.push_back(result);
            }
            
            // Update progress
            filesScanned++;
            progress = static_cast<float>(filesScanned) / static_cast<float>(totalFiles);
            updateProgress(file.getFileName(), filesScanned, totalFiles);
            
            // Notify error if scan failed
            if (!result.success)
            {
                notifyScanError(file.getFullPathName(), result.errorMessage);
            }
            
            // Update incremental cache
            if (incrementalConfig.enabled && result.success)
            {
                incrementalCache[file.getFullPathName()] = std::chrono::system_clock::now();
            }
        }
        
        // Save incremental cache if enabled
        if (incrementalConfig.enabled)
        {
            saveIncrementalCache();
        }
        
        // Check if scan was cancelled
        if (shouldCancel)
        {
            notifyStateChange(ScanState::Idle);
        }
        else
        {
            notifyStateChange(ScanState::Completed);
            notifyScanComplete();
        }
    }
    catch (const std::exception& e)
    {
        DBG("AsyncScanner: Scan failed with exception: " + juce::String(e.what()));
        notifyStateChange(ScanState::Failed);
    }
    
    // Signal completion
    {
        std::lock_guard<std::mutex> lock(stateMutex);
        completionCondition.notify_all();
    }
}

AsyncScanner::ScanResult AsyncScanner::scanFile(const juce::File& file)
{
    ScanResult result;
    result.filePath = file.getFullPathName();
    result.scanTime = std::chrono::system_clock::now();
    
    try
    {
        // Detect format
        auto* format = formatManager->findFormatForFile(file.getFullPathName());
        if (format == nullptr)
        {
            result.success = false;
            result.errorMessage = "Unknown plugin format";
            return result;
        }
        
        // Find all types for this file
        juce::OwnedArray<juce::PluginDescription> descriptions;
        format->findAllTypesForFile(descriptions, file.getFullPathName());
        
        // Copy descriptions
        for (auto* desc : descriptions)
        {
            result.descriptions.push_back(*desc);
        }
        
        result.success = true;
        DBG("AsyncScanner: Scanned " + file.getFileName() + 
            " - found " + juce::String(result.descriptions.size()) + " plugins");
    }
    catch (const std::exception& e)
    {
        result.success = false;
        result.errorMessage = e.what();
        DBG("AsyncScanner: Failed to scan " + file.getFileName() + ": " + e.what());
    }
    
    return result;
}

bool AsyncScanner::needsRescan(const juce::File& file) const
{
    if (!incrementalConfig.enabled)
    {
        return true; // Always rescan if incremental is disabled
    }
    
    auto filePath = file.getFullPathName();
    auto it = incrementalCache.find(filePath);
    
    if (it == incrementalCache.end())
    {
        return true; // Not in cache, needs scan
    }
    
    // Check if file was modified since last scan
    auto lastModified = file.getLastModificationTime().toMilliseconds();
    auto lastScanned = std::chrono::system_clock::to_time_t(it->second);
    auto lastScannedMs = static_cast<juce::int64>(lastScanned) * 1000;
    
    if (lastModified > lastScannedMs)
    {
        return true; // File was modified
    }
    
    // Check cache age
    auto cacheAge = std::chrono::system_clock::now() - it->second;
    if (cacheAge > incrementalConfig.maxCacheAge)
    {
        return true; // Cache is too old
    }
    
    // Verify file still exists if configured
    if (incrementalConfig.verifyExisting && !file.existsAsFile())
    {
        return true; // File no longer exists
    }
    
    return false; // No need to rescan
}

void AsyncScanner::updateProgress(const juce::String& currentFile, int filesScanned, int totalFiles)
{
    if (scanProgressCallback)
    {
        scanProgressCallback(currentFile, filesScanned, totalFiles, progress);
    }
}

bool AsyncScanner::checkForInterruption()
{
    // Check for cancellation
    if (shouldCancel)
    {
        return false;
    }
    
    // Check for pause
    if (shouldPause)
    {
        std::unique_lock<std::mutex> lock(stateMutex);
        pauseCondition.wait(lock, [this] { return !shouldPause || shouldCancel; });
        
        // Check if cancelled while paused
        if (shouldCancel)
        {
            return false;
        }
    }
    
    // Also check thread interruption
    if (scanThread && scanThread->threadShouldExit())
    {
        return false;
    }
    
    return true;
}

bool AsyncScanner::loadIncrementalCache()
{
    if (!incrementalConfig.enabled || !incrementalConfig.cacheFilePath.existsAsFile())
    {
        return false;
    }
    
    try
    {
        auto fileContent = incrementalConfig.cacheFilePath.loadFileAsString();
        // Simple cache format: one file path per line with timestamp
        // In a real implementation, use JSON or binary format
        
        juce::StringArray lines;
        lines.addLines(fileContent);
        
        for (const auto& line : lines)
        {
            if (line.isNotEmpty())
            {
                // Parse line (simplified)
                auto parts = juce::StringArray::fromTokens(line, "|", "");
                if (parts.size() >= 2)
                {
                    auto filePath = parts[0];
                    auto timestamp = parts[1].getLargeIntValue();
                    incrementalCache[filePath] = std::chrono::system_clock::from_time_t(timestamp);
                }
            }
        }
        
        DBG("AsyncScanner: Loaded " + juce::String(incrementalCache.size()) + " entries from cache");
        return true;
    }
    catch (const std::exception& e)
    {
        DBG("AsyncScanner: Failed to load cache: " + juce::String(e.what()));
        return false;
    }
}

bool AsyncScanner::saveIncrementalCache() const
{
    if (!incrementalConfig.enabled)
    {
        return false;
    }
    
    try
    {
        juce::String cacheContent;
        
        for (const auto& entry : incrementalCache)
        {
            auto timestamp = std::chrono::system_clock::to_time_t(entry.second);
            cacheContent += entry.first + "|" + juce::String(timestamp) + "\n";
        }
        
        incrementalConfig.cacheFilePath.replaceWithText(cacheContent);
        DBG("AsyncScanner: Saved " + juce::String(incrementalCache.size()) + " entries to cache");
        return true;
    }
    catch (const std::exception& e)
    {
        DBG("AsyncScanner: Failed to save cache: " + juce::String(e.what()));
        return false;
    }
}

void AsyncScanner::notifyStateChange(ScanState newState)
{
    state = newState;
    
    if (stateChangeCallback)
    {
        stateChangeCallback(newState);
    }
    
    DBG("AsyncScanner: State changed to " + juce::String(static_cast<int>(newState)));
}

void AsyncScanner::notifyScanComplete()
{
    if (scanCompleteCallback)
    {
        std::lock_guard<std::mutex> lock(resultsMutex);
        scanCompleteCallback(results);
    }
}

void AsyncScanner::notifyScanError(const juce::String& filePath, const juce::String& error)
{
    if (scanErrorCallback)
    {
        scanErrorCallback(filePath, error);
    }
}