/**
 * DSP Processing Example — Demonstrates ParallelProcessor and LatencyCompensator usage.
 *
 * This example shows how to:
 * 1. Create and configure parallel audio processors
 * 2. Set up latency compensation for parallel processing paths
 * 3. Process audio with both parallel and sequential modes
 */

#include <iostream>
#include <juce_audio_basics/juce_audio_basics.h>
#include "../src/dsp/ParallelProcessor.h"
#include "../src/dsp/LatencyCompensator.h"

/**
 * Example gain processor.
 */
class GainProcessor : public ParallelProcessor::Processor
{
public:
    explicit GainProcessor(juce::String name, float gain = 1.0f, int latency = 0)
        : processorName(std::move(name)), gainValue(gain), latencySamples(latency) {}

    void prepare(double /*sampleRate*/, int /*samplesPerBlock*/, int /*numChannels*/) override {}
    void release() override {}

    void process(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& /*midi*/) override
    {
        buffer.applyGain(gainValue);
    }

    juce::String getName() const override { return processorName; }
    int getLatency() const override { return latencySamples; }

private:
    juce::String processorName;
    float gainValue;
    int latencySamples;
};

/**
 * Example delay processor (introduces latency).
 */
class SimpleDelayProcessor : public ParallelProcessor::Processor
{
public:
    explicit SimpleDelayProcessor(int delaySamples)
        : delaySize(delaySamples) {}

    void prepare(double /*sampleRate*/, int /*samplesPerBlock*/, int numChannels) override
    {
        delayBuffer.setSize(numChannels, delaySize);
        delayBuffer.clear();
        writePos = 0;
    }

    void release() override
    {
        delayBuffer.setSize(0, 0);
    }

    void process(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& /*midi*/) override
    {
        const int numSamples = buffer.getNumSamples();
        const int numChannels = buffer.getNumChannels();

        for (int ch = 0; ch < numChannels; ++ch)
        {
            for (int i = 0; i < numSamples; ++i)
            {
                float input = buffer.getSample(ch, i);
                float delayed = delayBuffer.getSample(ch, writePos);
                delayBuffer.setSample(ch, writePos, input);
                buffer.setSample(ch, i, delayed);
            }
        }

        writePos = (writePos + numSamples) % delaySize;
    }

    juce::String getName() const override { return "SimpleDelay"; }
    int getLatency() const override { return delaySize; }

private:
    int delaySize;
    int writePos = 0;
    juce::AudioBuffer<float> delayBuffer;
};

void runDspExample()
{
    std::cout << "=== DSP Processing Example ===" << std::endl;
    std::cout << std::endl;

    // Configuration
    const double sampleRate = 44100.0;
    const int blockSize = 512;
    const int numChannels = 2;

    // ── Example 1: Parallel Processing ────────────────────────────────

    std::cout << "1. Parallel Processing Example:" << std::endl;

    ParallelProcessor parallelProcessor;

    // Add processors with different characteristics
    parallelProcessor.addProcessor(std::make_unique<GainProcessor>("Clean", 0.8f, 0));
    parallelProcessor.addProcessor(std::make_unique<GainProcessor>("Boost", 1.2f, 0));
    parallelProcessor.addProcessor(std::make_unique<SimpleDelayProcessor>(256));

    parallelProcessor.prepare(sampleRate, blockSize, numChannels);

    // Create input buffer with test signal
    juce::AudioBuffer<float> inputBuffer(numChannels, blockSize);
    for (int ch = 0; ch < numChannels; ++ch)
    {
        for (int i = 0; i < blockSize; ++i)
        {
            // Generate a simple sine wave
            float sample = std::sin(2.0f * 3.14159f * 440.0f * i / sampleRate);
            inputBuffer.setSample(ch, i, sample);
        }
    }

    // Process in parallel mode
    parallelProcessor.setProcessingMode(ParallelProcessor::ProcessingMode::Parallel);
    juce::MidiBuffer midi;
    parallelProcessor.processSummed(inputBuffer, midi);

    std::cout << "   - Processed with " << parallelProcessor.getNumProcessors() << " processors" << std::endl;
    std::cout << "   - Mode: Parallel" << std::endl;
    std::cout << "   - Total latency: " << parallelProcessor.getTotalLatency() << " samples" << std::endl;
    std::cout << std::endl;

    // ── Example 2: Latency Compensation ───────────────────────────────

    std::cout << "2. Latency Compensation Example:" << std::endl;

    LatencyCompensator latencyCompensator;
    latencyCompensator.prepare(sampleRate, blockSize, numChannels);

    // Report latencies from different sources
    latencyCompensator.reportLatency(1, 0, "Clean Path");
    latencyCompensator.reportLatency(2, 0, "Boost Path");
    latencyCompensator.reportLatency(3, 256, "Delay Path");

    std::cout << "   - Max latency: " << latencyCompensator.getMaxLatency() << " samples" << std::endl;
    std::cout << "   - Is compensating: " << (latencyCompensator.isIntroducingDelay() ? "Yes" : "No") << std::endl;
    std::cout << "   - Latency sources: " << latencyCompensator.getNumLatencySources() << std::endl;

    // Process with compensation
    std::vector<juce::AudioBuffer<float>> parallelBuffers;
    for (int i = 0; i < 3; ++i)
    {
        parallelBuffers.emplace_back(numChannels, blockSize);
        for (int ch = 0; ch < numChannels; ++ch)
        {
            for (int j = 0; j < blockSize; ++j)
            {
                float sample = std::sin(2.0f * 3.14159f * 440.0f * j / sampleRate);
                parallelBuffers[i].setSample(ch, j, sample);
            }
        }
    }

    latencyCompensator.processParallel(parallelBuffers);

    std::cout << "   - Compensated " << parallelBuffers.size() << " parallel paths" << std::endl;
    std::cout << std::endl;

    // ── Example 3: Combined Usage ─────────────────────────────────────

    std::cout << "3. Combined Parallel Processing with Latency Compensation:" << std::endl;

    // Create a new processor chain
    ParallelProcessor combinedProcessor;
    combinedProcessor.addProcessor(std::make_unique<GainProcessor>("Path A", 1.0f, 0));
    combinedProcessor.addProcessor(std::make_unique<GainProcessor>("Path B", 1.0f, 128));
    combinedProcessor.addProcessor(std::make_unique<SimpleDelayProcessor>(512));

    combinedProcessor.prepare(sampleRate, blockSize, numChannels);

    // Set up latency compensation
    LatencyCompensator combinedCompensator;
    combinedCompensator.prepare(sampleRate, blockSize, numChannels);

    // Report latencies from each processor
    for (int i = 0; i < combinedProcessor.getNumProcessors(); ++i)
    {
        const auto* proc = combinedProcessor.getProcessor(i);
        if (proc)
        {
            combinedCompensator.reportLatency(i, proc->getLatency(), proc->getName());
        }
    }

    std::cout << "   - Processors: " << combinedProcessor.getNumProcessors() << std::endl;
    std::cout << "   - Max latency: " << combinedCompensator.getMaxLatency() << " samples" << std::endl;
    std::cout << "   - Compensation active: " << (combinedCompensator.isIntroducingDelay() ? "Yes" : "No") << std::endl;

    // Clean up
    combinedProcessor.release();
    combinedCompensator.release();
    parallelProcessor.release();
    latencyCompensator.release();

    std::cout << std::endl;
    std::cout << "=== Example Complete ===" << std::endl;
}

int main()
{
    runDspExample();
    return 0;
}
