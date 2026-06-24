#include "ScanProgressReporter.h"

ScanProgressReporter::ScanProgressReporter() = default;
ScanProgressReporter::~ScanProgressReporter() = default;

void ScanProgressReporter::setOnProgress(ProgressCallback callback)
{
    std::lock_guard<std::mutex> lock(infoMutex);
    progressCallback = std::move(callback);
}

void ScanProgressReporter::setOnFileStart(FileCallback callback)
{
    std::lock_guard<std::mutex> lock(infoMutex);
    fileStartCallback = std::move(callback);
}

void ScanProgressReporter::setOnFileComplete(FileCallback callback)
{
    std::lock_guard<std::mutex> lock(infoMutex);
    fileCompleteCallback = std::move(callback);
}

void ScanProgressReporter::beginScan(int totalFiles)
{
    {
        std::lock_guard<std::mutex> lock(infoMutex);
        currentInfo = ProgressInfo{};
        currentInfo.totalFiles = totalFiles;
        currentInfo.isComplete = false;
    }
    {
        std::lock_guard<std::mutex> lock(timingMutex);
        fileDurations.clear();
        fileDurations.reserve(totalFiles);
    }

    active = true;
    scanStartTime = std::chrono::system_clock::now();
    lastNotifyTime = scanStartTime;
}

void ScanProgressReporter::reportFile(const std::string& filePath, int filesScanned)
{
    if (!active)
        return;

    auto fileStart = std::chrono::system_clock::now();

    {
        std::lock_guard<std::mutex> lock(infoMutex);
        currentInfo.currentFile = filePath;
        currentInfo.filesScanned = filesScanned;
        if (currentInfo.totalFiles > 0)
        {
            currentInfo.percentComplete =
                static_cast<float>(filesScanned) / static_cast<float>(currentInfo.totalFiles) * 100.0f;
        }
        currentInfo.elapsedTime = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now() - scanStartTime);

        // Estimate remaining time
        if (filesScanned > 0 && currentInfo.totalFiles > 0)
        {
            auto avgPerFile = currentInfo.elapsedTime / filesScanned;
            int remaining = currentInfo.totalFiles - filesScanned;
            currentInfo.estimatedTimeRemaining = avgPerFile * remaining;
        }
    }

    if (fileStartCallback)
        fileStartCallback(filePath);

    notifyProgress();
}

void ScanProgressReporter::reportFileComplete(const std::string& filePath, bool /*success*/)
{
    if (!active)
        return;

    if (fileCompleteCallback)
        fileCompleteCallback(filePath);
}

void ScanProgressReporter::endScan()
{
    {
        std::lock_guard<std::mutex> lock(infoMutex);
        currentInfo.isComplete = true;
        currentInfo.percentComplete = 100.0f;
        currentInfo.estimatedTimeRemaining = std::chrono::milliseconds{0};
        currentInfo.elapsedTime = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now() - scanStartTime);
    }

    active = false;
    notifyProgress();
}

void ScanProgressReporter::reset()
{
    std::lock_guard<std::mutex> lock(infoMutex);
    currentInfo = ProgressInfo{};
    active = false;
}

ScanProgressReporter::ProgressInfo ScanProgressReporter::getCurrentInfo() const
{
    std::lock_guard<std::mutex> lock(infoMutex);
    return currentInfo;
}

void ScanProgressReporter::setThrottleInterval(std::chrono::milliseconds interval)
{
    throttleInterval = interval;
}

void ScanProgressReporter::notifyProgress()
{
    if (!progressCallback)
        return;

    if (shouldThrottle())
        return;

    std::lock_guard<std::mutex> lock(infoMutex);
    progressCallback(currentInfo);
    lastNotifyTime = std::chrono::system_clock::now();
}

bool ScanProgressReporter::shouldThrottle() const
{
    auto now = std::chrono::system_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now - lastNotifyTime);
    return elapsed < throttleInterval;
}
