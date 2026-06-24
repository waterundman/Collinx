#include "PluginChain.h"

PluginChain::PluginChain() = default;

PluginChain::~PluginChain()
{
    release();
}

// ── Lifecycle ──────────────────────────────────────────────────────────

void PluginChain::prepare(double sampleRate, int samplesPerBlock, int numChannels)
{
    currentSampleRate = sampleRate;
    currentBlockSize = samplesPerBlock;
    currentNumChannels = numChannels;

    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (auto& plugin : plugins)
    {
        if (plugin != nullptr)
            plugin->prepare(sampleRate, samplesPerBlock, numChannels);
    }

    // Initialize parallel processor if in parallel mode
    if (processingMode == ProcessingMode::Parallel)
    {
        if (!parallelProcessor)
            parallelProcessor = std::make_unique<ParallelProcessor>();
        parallelProcessor->prepare(sampleRate, samplesPerBlock, numChannels);
    }

    // Initialize latency compensator
    latencyCompensator.prepare(sampleRate, samplesPerBlock, numChannels);

    // Report latencies from all plugins
    for (size_t i = 0; i < plugins.size(); ++i)
    {
        if (plugins[i])
        {
            if (auto* instance = plugins[i]->getInstance())
            {
                int latency = instance->getLatencySamples();
                if (latency > 0)
                    latencyCompensator.reportLatency(static_cast<int>(i), latency, plugins[i]->getName());
            }
        }
    }

    isPrepared = true;
    rebuildSnapshot();
}

void PluginChain::release()
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (auto& plugin : plugins)
    {
        if (plugin != nullptr)
        {
            if (plugin->isActive())
                plugin->deactivate();
            plugin->release();
        }
    }

    // Release parallel processor
    if (parallelProcessor)
        parallelProcessor->release();

    // Release latency compensator
    latencyCompensator.release();

    isPrepared = false;
    rebuildSnapshot();
}

void PluginChain::activateAll()
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (auto& plugin : plugins)
    {
        if (plugin != nullptr && plugin->isPrepared())
            plugin->activate();
    }

    rebuildSnapshot();
}

void PluginChain::deactivateAll()
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (auto& plugin : plugins)
    {
        if (plugin != nullptr)
            plugin->deactivate();
    }

    rebuildSnapshot();
}

// ── Processing ─────────────────────────────────────────────────────────

void PluginChain::process(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    // Lock-free fast path: copy the snapshot pointers
    ChainSnapshot localSnapshot;
    {
        std::lock_guard<std::mutex> lock(snapshotMutex);
        localSnapshot = snapshot;
    }

    if (localSnapshot.chainBypassed)
        return;

    switch (processingMode)
    {
        case ProcessingMode::Parallel:
            processParallel(buffer, midi);
            break;
        case ProcessingMode::Sequential:
        default:
            processSequential(buffer, midi);
            break;
    }
}

void PluginChain::setProcessingMode(ProcessingMode mode)
{
    processingMode = mode;
    
    // Update parallel processor if needed
    if (mode == ProcessingMode::Parallel && !parallelProcessor)
    {
        parallelProcessor = std::make_unique<ParallelProcessor>();
        if (isPrepared)
            parallelProcessor->prepare(currentSampleRate, currentBlockSize, currentNumChannels);
    }
}

PluginChain::ProcessingMode PluginChain::getProcessingMode() const
{
    return processingMode;
}

void PluginChain::setNumThreads(int numThreads)
{
    if (parallelProcessor)
        parallelProcessor->setNumThreads(numThreads);
}

int PluginChain::getNumThreads() const
{
    if (parallelProcessor)
        return parallelProcessor->getNumThreads();
    return 1;
}

void PluginChain::setLatencyCompensationEnabled(bool enabled)
{
    latencyCompensationEnabled = enabled;
}

bool PluginChain::isLatencyCompensationEnabled() const
{
    return latencyCompensationEnabled;
}

int PluginChain::getTotalLatency() const
{
    int totalLatency = 0;
    
    // Sum latencies from all plugins
    for (const auto& plugin : plugins)
    {
        if (plugin)
        {
            // VST3 plugins report latency via getLatencySamples()
            if (auto* instance = plugin->getInstance())
                totalLatency += instance->getLatencySamples();
        }
    }
    
    return totalLatency;
}

LatencyCompensator& PluginChain::getLatencyCompensator()
{
    return latencyCompensator;
}

// ── Chain manipulation ─────────────────────────────────────────────────

int PluginChain::addPlugin(std::unique_ptr<PluginProcessor> plugin)
{
    if (plugin == nullptr)
        return -1;

    int index;
    {
        std::lock_guard<std::mutex> lock(snapshotMutex);

        index = static_cast<int>(plugins.size());
        plugins.push_back(std::move(plugin));

        if (isPrepared)
            prepareAndActivatePlugin(*plugins.back());

        rebuildSnapshot();
    }

    if (chainChangeCallback)
        chainChangeCallback();

    return index;
}

void PluginChain::removePlugin(int index)
{
    {
        std::lock_guard<std::mutex> lock(snapshotMutex);

        if (index < 0 || index >= static_cast<int>(plugins.size()))
            return;

        auto& plugin = plugins[static_cast<size_t>(index)];
        if (plugin != nullptr)
        {
            if (plugin->isActive())
                plugin->deactivate();
            plugin->release();
        }

        plugins.erase(plugins.begin() + index);
        rebuildSnapshot();
    }

    if (chainChangeCallback)
        chainChangeCallback();
}

void PluginChain::removePluginById(int pluginId)
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (size_t i = 0; i < plugins.size(); ++i)
    {
        if (plugins[i] != nullptr && plugins[i]->getId() == pluginId)
        {
            auto& plugin = plugins[i];
            if (plugin->isActive())
                plugin->deactivate();
            plugin->release();

            plugins.erase(plugins.begin() + static_cast<int>(i));
            rebuildSnapshot();

            if (chainChangeCallback)
                chainChangeCallback();

            return;
        }
    }
}

void PluginChain::movePlugin(int fromIndex, int toIndex)
{
    {
        std::lock_guard<std::mutex> lock(snapshotMutex);

        int numPlugins = static_cast<int>(plugins.size());
        if (fromIndex < 0 || fromIndex >= numPlugins)
            return;
        if (toIndex < 0 || toIndex >= numPlugins)
            return;
        if (fromIndex == toIndex)
            return;

        auto plugin = std::move(plugins[static_cast<size_t>(fromIndex)]);
        plugins.erase(plugins.begin() + fromIndex);
        plugins.insert(plugins.begin() + toIndex, std::move(plugin));

        rebuildSnapshot();
    }

    if (chainChangeCallback)
        chainChangeCallback();
}

const PluginProcessor* PluginChain::getPlugin(int index) const
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    if (index < 0 || index >= static_cast<int>(plugins.size()))
        return nullptr;

    return plugins[static_cast<size_t>(index)].get();
}

PluginProcessor* PluginChain::getPlugin(int index)
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    if (index < 0 || index >= static_cast<int>(plugins.size()))
        return nullptr;

    return plugins[static_cast<size_t>(index)].get();
}

PluginProcessor* PluginChain::getPluginById(int pluginId)
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (auto& plugin : plugins)
    {
        if (plugin != nullptr && plugin->getId() == pluginId)
            return plugin.get();
    }

    return nullptr;
}

int PluginChain::getNumPlugins() const
{
    std::lock_guard<std::mutex> lock(snapshotMutex);
    return static_cast<int>(plugins.size());
}

bool PluginChain::isEmpty() const
{
    std::lock_guard<std::mutex> lock(snapshotMutex);
    return plugins.empty();
}

// ── Bypass ─────────────────────────────────────────────────────────────

void PluginChain::setChainBypassed(bool shouldBypass)
{
    chainBypassed.store(shouldBypass);

    std::lock_guard<std::mutex> lock(snapshotMutex);
    rebuildSnapshot();
}

bool PluginChain::isChainBypassed() const
{
    return chainBypassed.load();
}

// ── Queries ────────────────────────────────────────────────────────────

bool PluginChain::isAnyPluginActive() const
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (const auto& plugin : plugins)
    {
        if (plugin != nullptr && plugin->isActive() && !plugin->isBypassed())
            return true;
    }

    return false;
}

std::vector<juce::String> PluginChain::getPluginNames() const
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    std::vector<juce::String> names;
    names.reserve(plugins.size());

    for (const auto& plugin : plugins)
    {
        if (plugin != nullptr)
            names.push_back(plugin->getName());
        else
            names.push_back("<null>");
    }

    return names;
}

void PluginChain::setChainChangeCallback(ChainChangeCallback callback)
{
    chainChangeCallback = std::move(callback);
}

// ── Internal ───────────────────────────────────────────────────────────

void PluginChain::rebuildSnapshot()
{
    snapshot.processors.clear();
    snapshot.processors.reserve(plugins.size());
    snapshot.chainBypassed = chainBypassed.load();

    for (const auto& plugin : plugins)
    {
        snapshot.processors.push_back(plugin.get());
    }
}

void PluginChain::prepareAndActivatePlugin(PluginProcessor& plugin)
{
    plugin.prepare(currentSampleRate, currentBlockSize, currentNumChannels);
    plugin.activate();
}

void PluginChain::processSequential(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    // Original sequential processing
    ChainSnapshot localSnapshot;
    {
        std::lock_guard<std::mutex> lock(snapshotMutex);
        localSnapshot = snapshot;
    }

    for (auto* plugin : localSnapshot.processors)
    {
        if (plugin == nullptr)
            continue;

        if (plugin->isBypassed())
            continue;

        plugin->process(buffer, midi);
    }
}

void PluginChain::processParallel(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    // Get snapshot
    ChainSnapshot localSnapshot;
    {
        std::lock_guard<std::mutex> lock(snapshotMutex);
        localSnapshot = snapshot;
    }

    if (localSnapshot.processors.empty())
        return;

    // If we only have one processor, just process it directly
    if (localSnapshot.processors.size() == 1)
    {
        if (localSnapshot.processors[0] && !localSnapshot.processors[0]->isBypassed())
            localSnapshot.processors[0]->process(buffer, midi);
        return;
    }

    // Create individual buffers for each processor
    std::vector<juce::AudioBuffer<float>> individualBuffers;
    individualBuffers.reserve(localSnapshot.processors.size());

    for (size_t i = 0; i < localSnapshot.processors.size(); ++i)
    {
        individualBuffers.emplace_back(buffer.getNumChannels(), buffer.getNumSamples());
        individualBuffers[i].copyFrom(0, 0, buffer, 0, 0, buffer.getNumSamples());
        if (buffer.getNumChannels() > 1)
            individualBuffers[i].copyFrom(1, 0, buffer, 1, 0, buffer.getNumSamples());
    }

    // Process each buffer in parallel
    if (parallelProcessor)
    {
        parallelProcessor->process(individualBuffers, midi);
    }
    else
    {
        // Fallback: process sequentially if parallel processor not available
        for (size_t i = 0; i < localSnapshot.processors.size(); ++i)
        {
            auto* plugin = localSnapshot.processors[i];
            if (plugin && !plugin->isBypassed())
                plugin->process(individualBuffers[i], midi);
        }
    }

    // Apply latency compensation if enabled
    if (latencyCompensationEnabled)
    {
        latencyCompensator.processParallel(individualBuffers);
    }

    // Sum all processed buffers into the output
    buffer.clear();
    for (const auto& processedBuffer : individualBuffers)
    {
        for (int channel = 0; channel < buffer.getNumChannels(); ++channel)
        {
            buffer.addFrom(channel, 0, processedBuffer, channel, 0, buffer.getNumSamples());
        }
    }

    // Normalize by number of processors to prevent clipping
    float gain = 1.0f / static_cast<float>(localSnapshot.processors.size());
    buffer.applyGain(gain);
}
