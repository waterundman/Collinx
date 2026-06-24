#include "ParallelProcessor.h"

ParallelProcessor::ParallelProcessor() = default;

ParallelProcessor::~ParallelProcessor()
{
    release();
}

// ── Lifecycle ──────────────────────────────────────────────────────────

void ParallelProcessor::prepare(double sampleRate, int samplesPerBlock, int numChannels)
{
    currentSampleRate = sampleRate;
    currentBlockSize = samplesPerBlock;
    currentNumChannels = numChannels;

    for (auto& entry : processors)
    {
        if (entry && entry->processor)
            entry->processor->prepare(sampleRate, samplesPerBlock, numChannels);
    }

    isPrepared = true;
    initializeThreadPool();
}

void ParallelProcessor::release()
{
    if (threadPool)
    {
        threadPool->removeAllJobs(true, 1000);
        threadPool.reset();
    }

    for (auto& entry : processors)
    {
        if (entry && entry->processor)
            entry->processor->release();
    }

    isPrepared = false;
}

// ── Processing ─────────────────────────────────────────────────────────

void ParallelProcessor::process(std::vector<juce::AudioBuffer<float>>& buffers, juce::MidiBuffer& midi)
{
    if (!isPrepared || processors.empty())
        return;

    // Ensure we have the right number of buffers
    if (buffers.size() != processors.size())
        return;

    auto startTime = juce::Time::getHighResolutionTicks();

    switch (processingMode)
    {
        case ProcessingMode::Parallel:
            processParallel(buffers, midi);
            break;
        case ProcessingMode::Sequential:
            processSequential(buffers, midi);
            break;
    }

    auto endTime = juce::Time::getHighResolutionTicks();
    auto durationUs = juce::Time::highResolutionTicksToSeconds(endTime - startTime) * 1000000.0;
    totalProcessingTimeUs.store(static_cast<int64_t>(durationUs));
}

void ParallelProcessor::processSummed(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi)
{
    if (!isPrepared || processors.empty())
        return;

    // Create individual buffers for each processor
    std::vector<juce::AudioBuffer<float>> individualBuffers;
    individualBuffers.reserve(processors.size());

    for (size_t i = 0; i < processors.size(); ++i)
    {
        individualBuffers.emplace_back(buffer.getNumChannels(), buffer.getNumSamples());
        individualBuffers[i].copyFrom(0, 0, buffer, 0, 0, buffer.getNumSamples());
        if (buffer.getNumChannels() > 1)
            individualBuffers[i].copyFrom(1, 0, buffer, 1, 0, buffer.getNumSamples());
    }

    // Process each buffer in parallel/sequential
    process(individualBuffers, midi);

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
    float gain = 1.0f / static_cast<float>(processors.size());
    buffer.applyGain(gain);
}

// ── Processor management ───────────────────────────────────────────────

int ParallelProcessor::addProcessor(std::unique_ptr<Processor> processor)
{
    if (!processor)
        return -1;

    auto entry = std::make_unique<ProcessorEntry>();
    entry->processor = std::move(processor);
    entry->estimatedComplexity = estimateProcessorComplexity(*entry->processor);

    int index = static_cast<int>(processors.size());
    processors.push_back(std::move(entry));

    if (isPrepared)
        processors.back()->processor->prepare(currentSampleRate, currentBlockSize, currentNumChannels);

    return index;
}

void ParallelProcessor::removeProcessor(int index)
{
    if (index < 0 || index >= static_cast<int>(processors.size()))
        return;

    auto& entry = processors[static_cast<size_t>(index)];
    if (entry && entry->processor)
        entry->processor->release();

    processors.erase(processors.begin() + index);
}

int ParallelProcessor::getNumProcessors() const
{
    return static_cast<int>(processors.size());
}

const ParallelProcessor::Processor* ParallelProcessor::getProcessor(int index) const
{
    if (index < 0 || index >= static_cast<int>(processors.size()))
        return nullptr;

    return processors[static_cast<size_t>(index)]->processor.get();
}

ParallelProcessor::Processor* ParallelProcessor::getProcessor(int index)
{
    if (index < 0 || index >= static_cast<int>(processors.size()))
        return nullptr;

    return processors[static_cast<size_t>(index)]->processor.get();
}

// ── Configuration ──────────────────────────────────────────────────────

void ParallelProcessor::setProcessingMode(ProcessingMode mode)
{
    processingMode = mode;
}

ParallelProcessor::ProcessingMode ParallelProcessor::getProcessingMode() const
{
    return processingMode;
}

void ParallelProcessor::setNumThreads(int threads)
{
    numThreads = threads;
    if (isPrepared)
        initializeThreadPool();
}

int ParallelProcessor::getNumThreads() const
{
    if (threadPool)
        return threadPool->getNumThreads();

    return numThreads > 0 ? numThreads : static_cast<int>(std::thread::hardware_concurrency());
}

void ParallelProcessor::setLoadBalancingEnabled(bool enabled)
{
    loadBalancingEnabled = enabled;
}

bool ParallelProcessor::isLoadBalancingEnabled() const
{
    return loadBalancingEnabled;
}

int ParallelProcessor::getTotalLatency() const
{
    int totalLatency = 0;
    for (const auto& entry : processors)
    {
        if (entry && entry->processor)
            totalLatency += entry->processor->getLatency();
    }
    return totalLatency;
}

// ── Internal ───────────────────────────────────────────────────────────

void ParallelProcessor::processParallel(std::vector<juce::AudioBuffer<float>>& buffers, juce::MidiBuffer& midi)
{
    if (!threadPool || processors.size() <= 1)
    {
        // Fallback to sequential if no thread pool or only one processor
        processSequential(buffers, midi);
        return;
    }

    // Submit all processors to the thread pool
    std::vector<std::future<void>> futures;
    futures.reserve(processors.size());

    for (size_t i = 0; i < processors.size(); ++i)
    {
        auto& entry = processors[i];
        if (!entry || !entry->processor)
            continue;

        auto future = std::async(std::launch::async, [&entry, &buffer = buffers[i], &midi]()
        {
            entry->isProcessing.store(true);
            entry->processor->process(buffer, midi);
            entry->isProcessing.store(false);
        });

        futures.push_back(std::move(future));
    }

    // Wait for all processors to complete
    for (auto& future : futures)
    {
        future.wait();
    }
}

void ParallelProcessor::processSequential(std::vector<juce::AudioBuffer<float>>& buffers, juce::MidiBuffer& midi)
{
    for (size_t i = 0; i < processors.size(); ++i)
    {
        auto& entry = processors[i];
        if (!entry || !entry->processor)
            continue;

        entry->processor->process(buffers[i], midi);
    }
}

void ParallelProcessor::initializeThreadPool()
{
    if (threadPool)
    {
        threadPool->removeAllJobs(true, 1000);
    }

    int threads = numThreads > 0 ? numThreads : static_cast<int>(std::thread::hardware_concurrency());
    
    // Limit threads to number of processors
    threads = std::min(threads, static_cast<int>(processors.size()));
    
    // At least 1 thread
    threads = std::max(1, threads);

    threadPool = std::make_unique<juce::ThreadPool>(threads);
}

int ParallelProcessor::estimateProcessorComplexity(const Processor& processor) const
{
    // Simple heuristic based on latency and name
    int latency = processor.getLatency();
    juce::String name = processor.getName().toLowerCase();
    
    int complexity = 1;
    
    // Higher latency typically means more complex processing
    if (latency > 1024)
        complexity += 2;
    else if (latency > 256)
        complexity += 1;
    
    // Known complex processor types
    if (name.contains("reverb") || name.contains("convolution"))
        complexity += 3;
    else if (name.contains("delay") || name.contains("chorus"))
        complexity += 1;
    else if (name.contains("eq") || name.contains("filter"))
        complexity += 1;
    
    return complexity;
}