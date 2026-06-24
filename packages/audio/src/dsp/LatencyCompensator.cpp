#include "LatencyCompensator.h"

LatencyCompensator::LatencyCompensator() = default;

LatencyCompensator::~LatencyCompensator()
{
    release();
}

// ── Lifecycle ──────────────────────────────────────────────────────────

void LatencyCompensator::prepare(double sampleRate, int samplesPerBlock, int numChannels)
{
    currentSampleRate = sampleRate;
    currentBlockSize = samplesPerBlock;
    currentNumChannels = numChannels;

    // Initialize with at least one delay buffer
    initializeDelayBuffers(maxCompensatableLatency);

    isPrepared = true;
    updateCompensationDelays();
}

void LatencyCompensator::release()
{
    for (auto& buffer : delayBuffers)
    {
        if (buffer)
            buffer->release();
    }

    delayBuffers.clear();
    isPrepared = false;
}

// ── Processing ─────────────────────────────────────────────────────────

void LatencyCompensator::process(juce::AudioBuffer<float>& buffer, int pathIndex)
{
    if (!isPrepared || !isCompensating.load())
        return;

    if (pathIndex < 0 || pathIndex >= static_cast<int>(delayBuffers.size()))
        return;

    auto& delayBuffer = delayBuffers[static_cast<size_t>(pathIndex)];
    if (!delayBuffer || delayBuffer->delaySamples <= 0)
        return;

    // Write current buffer to delay line
    delayBuffer->write(buffer, 0, buffer.getNumSamples());

    // Read delayed buffer from delay line
    delayBuffer->read(buffer, 0, buffer.getNumSamples());
}

void LatencyCompensator::processParallel(std::vector<juce::AudioBuffer<float>>& buffers)
{
    if (!isPrepared || !isCompensating.load())
        return;

    // Update number of paths if needed
    if (static_cast<int>(buffers.size()) != numPaths)
    {
        numPaths = static_cast<int>(buffers.size());
        initializeDelayBuffers(maxCompensatableLatency);
        updateCompensationDelays();
    }

    // Process each buffer with its corresponding delay
    for (size_t i = 0; i < buffers.size(); ++i)
    {
        process(buffers[i], static_cast<int>(i));
    }
}

// ── Latency management ─────────────────────────────────────────────────

void LatencyCompensator::reportLatency(int sourceId, int latencySamples, const juce::String& sourceName)
{
    std::lock_guard<std::mutex> lock(sourcesMutex);

    // Find existing source or add new one
    auto it = std::find_if(latencySources.begin(), latencySources.end(),
        [sourceId](const LatencySource& s) { return s.sourceId == sourceId; });

    if (it != latencySources.end())
    {
        it->latencySamples = latencySamples;
        it->sourceName = sourceName;
    }
    else
    {
        latencySources.push_back({sourceId, latencySamples, sourceName, false});
    }

    updateCompensationDelays();
}

void LatencyCompensator::removeLatencyReport(int sourceId)
{
    std::lock_guard<std::mutex> lock(sourcesMutex);

    auto it = std::remove_if(latencySources.begin(), latencySources.end(),
        [sourceId](const LatencySource& s) { return s.sourceId == sourceId; });

    if (it != latencySources.end())
    {
        latencySources.erase(it, latencySources.end());
        updateCompensationDelays();
    }
}

void LatencyCompensator::clearLatencyReports()
{
    std::lock_guard<std::mutex> lock(sourcesMutex);
    latencySources.clear();
    updateCompensationDelays();
}

int LatencyCompensator::getMaxLatency() const
{
    std::lock_guard<std::mutex> lock(sourcesMutex);
    return currentMaxLatency;
}

int LatencyCompensator::getLatencyForSource(int sourceId) const
{
    std::lock_guard<std::mutex> lock(sourcesMutex);

    auto it = std::find_if(latencySources.begin(), latencySources.end(),
        [sourceId](const LatencySource& s) { return s.sourceId == sourceId; });

    if (it != latencySources.end())
        return it->latencySamples;

    return 0;
}

std::vector<LatencyCompensator::LatencyInfo> LatencyCompensator::getAllLatencyInfo() const
{
    std::lock_guard<std::mutex> lock(sourcesMutex);

    std::vector<LatencyInfo> info;
    info.reserve(latencySources.size());

    for (const auto& source : latencySources)
    {
        info.push_back({source.latencySamples, source.sourceName, source.isCompensated});
    }

    return info;
}

int LatencyCompensator::getNumLatencySources() const
{
    std::lock_guard<std::mutex> lock(sourcesMutex);
    return static_cast<int>(latencySources.size());
}

// ── Configuration ──────────────────────────────────────────────────────

void LatencyCompensator::setAutoDetectEnabled(bool enabled)
{
    autoDetectEnabled = enabled;
}

bool LatencyCompensator::isAutoDetectEnabled() const
{
    return autoDetectEnabled;
}

void LatencyCompensator::setDelayCompensationMode(bool delayCompensation)
{
    delayCompensationMode = delayCompensation;
}

bool LatencyCompensator::isDelayCompensationMode() const
{
    return delayCompensationMode;
}

void LatencyCompensator::setMaxCompensatableLatency(int maxSamples)
{
    maxCompensatableLatency = maxSamples;
    if (isPrepared)
    {
        initializeDelayBuffers(maxCompensatableLatency);
        updateCompensationDelays();
    }
}

int LatencyCompensator::getMaxCompensatableLatency() const
{
    return maxCompensatableLatency;
}

// ── Queries ────────────────────────────────────────────────────────────

int LatencyCompensator::getCurrentCompensationDelay(int pathIndex) const
{
    if (pathIndex < 0 || pathIndex >= static_cast<int>(delayBuffers.size()))
        return 0;

    return calculatePathDelay(pathIndex);
}

bool LatencyCompensator::isIntroducingDelay() const
{
    return isCompensating.load();
}

int LatencyCompensator::getTotalLatency() const
{
    return currentMaxLatency;
}

void LatencyCompensator::setLatencyChangeCallback(LatencyChangeCallback callback)
{
    latencyChangeCallback = std::move(callback);
}

// ── Internal ───────────────────────────────────────────────────────────

void LatencyCompensator::updateCompensationDelays()
{
    if (latencySources.empty())
    {
        currentMaxLatency = 0;
        isCompensating.store(false);
        return;
    }

    // Find maximum latency
    int maxLatency = 0;
    for (auto& source : latencySources)
    {
        if (source.latencySamples > maxLatency)
            maxLatency = source.latencySamples;
    }

    // Check if we need to compensate
    bool needsCompensation = false;
    for (auto& source : latencySources)
    {
        if (source.latencySamples < maxLatency)
        {
            source.isCompensated = true;
            needsCompensation = true;
        }
        else
        {
            source.isCompensated = false;
        }
    }

    currentMaxLatency = maxLatency;
    isCompensating.store(needsCompensation);

    // Update delay buffers if needed
    if (needsCompensation && isPrepared)
    {
        initializeDelayBuffers(maxLatency);
    }

    // Notify callback
    if (latencyChangeCallback)
        latencyChangeCallback(maxLatency);
}

void LatencyCompensator::initializeDelayBuffers(int maxLatency)
{
    // Ensure we have enough delay buffers for all paths
    while (static_cast<int>(delayBuffers.size()) < numPaths)
    {
        delayBuffers.push_back(std::make_unique<DelayBuffer>());
    }

    // Prepare each delay buffer
    for (auto& buffer : delayBuffers)
    {
        if (buffer)
            buffer->prepare(maxLatency + currentBlockSize, currentNumChannels);
    }
}

int LatencyCompensator::calculatePathDelay(int pathIndex) const
{
    if (pathIndex < 0 || pathIndex >= static_cast<int>(delayBuffers.size()))
        return 0;

    // For now, all paths get the same delay (max latency)
    // In a more sophisticated implementation, each path could have different latency
    return currentMaxLatency;
}

// ── DelayBuffer Implementation ─────────────────────────────────────────

void LatencyCompensator::DelayBuffer::prepare(int numSamples, int numChannels)
{
    size = numSamples;
    buffer.setSize(numChannels, size);
    buffer.clear();
    writePosition = 0;
    readPosition = 0;
    delaySamples = 0;
}

void LatencyCompensator::DelayBuffer::release()
{
    buffer.setSize(0, 0);
    size = 0;
}

void LatencyCompensator::DelayBuffer::write(const juce::AudioBuffer<float>& source, 
                                            int startSample, int numSamples)
{
    if (size == 0)
        return;

    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        for (int i = 0; i < numSamples; ++i)
        {
            int writeIndex = (writePosition + i) % size;
            buffer.setSample(channel, writeIndex, source.getSample(channel, startSample + i));
        }
    }

    writePosition = (writePosition + numSamples) % size;
}

void LatencyCompensator::DelayBuffer::read(juce::AudioBuffer<float>& dest, 
                                           int startSample, int numSamples)
{
    if (size == 0)
        return;

    for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
    {
        for (int i = 0; i < numSamples; ++i)
        {
            int readIndex = (readPosition + i) % size;
            dest.setSample(channel, startSample + i, buffer.getSample(channel, readIndex));
        }
    }

    readPosition = (readPosition + numSamples) % size;
}

void LatencyCompensator::DelayBuffer::clear()
{
    buffer.clear();
    writePosition = 0;
    readPosition = 0;
}