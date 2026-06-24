#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>
#include <vector>
#include <memory>
#include <functional>
#include <atomic>
#include <thread>
#include <future>

/**
 * ParallelProcessor — Manages parallel audio processing of multiple audio processors.
 *
 * Supports processing multiple audio chains in parallel using a thread pool.
 * Provides load balancing by distributing work across available threads.
 * Supports switching between parallel and sequential processing modes.
 *
 * Thread-safety: process() is designed to be called from the audio thread.
 * All configuration methods should be called from the message thread.
 */
class ParallelProcessor
{
public:
    /**
     * Audio processor interface for parallel processing.
     * Classes implementing this interface can be processed in parallel.
     */
    class Processor
    {
    public:
        virtual ~Processor() = default;
        
        /**
         * Prepare the processor for playback.
         */
        virtual void prepare(double sampleRate, int samplesPerBlock, int numChannels) = 0;
        
        /**
         * Release the processor's audio resources.
         */
        virtual void release() = 0;
        
        /**
         * Process audio. Called from the audio thread.
         * @param buffer Audio buffer to process in-place.
         * @param midi MIDI buffer for this block.
         */
        virtual void process(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) = 0;
        
        /**
         * Get the name of this processor.
         */
        virtual juce::String getName() const = 0;
        
        /**
         * Get the latency introduced by this processor (in samples).
         */
        virtual int getLatency() const { return 0; }
    };

    /**
     * Processing mode for the parallel processor.
     */
    enum class ProcessingMode
    {
        Parallel,   // Process all processors in parallel
        Sequential  // Process all processors sequentially
    };

    ParallelProcessor();
    ~ParallelProcessor();

    // ── Lifecycle ──────────────────────────────────────────────────────

    /**
     * Prepare all processors for playback.
     */
    void prepare(double sampleRate, int samplesPerBlock, int numChannels);

    /**
     * Release all processors.
     */
    void release();

    // ── Processing ─────────────────────────────────────────────────────

    /**
     * Process audio through all processors in the configured mode.
     * @param buffers Vector of audio buffers to process (one per processor).
     * @param midi MIDI buffer for this block.
     *
     * In parallel mode, all processors run concurrently.
     * In sequential mode, processors run one after another.
     */
    void process(std::vector<juce::AudioBuffer<float>>& buffers, juce::MidiBuffer& midi);

    /**
     * Process audio through all processors with a single input buffer.
     * Each processor receives a copy of the input and results are summed.
     * @param buffer Input/output audio buffer.
     * @param midi MIDI buffer for this block.
     */
    void processSummed(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi);

    // ── Processor management ───────────────────────────────────────────

    /**
     * Add a processor to the parallel chain.
     * @param processor The processor to add (ownership transferred).
     * @return Index of the added processor.
     */
    int addProcessor(std::unique_ptr<Processor> processor);

    /**
     * Remove a processor by index.
     */
    void removeProcessor(int index);

    /**
     * Get the number of processors.
     */
    int getNumProcessors() const;

    /**
     * Get a processor by index (read-only).
     */
    const Processor* getProcessor(int index) const;

    /**
     * Get a processor by index (mutable).
     */
    Processor* getProcessor(int index);

    // ── Configuration ──────────────────────────────────────────────────

    /**
     * Set the processing mode (parallel or sequential).
     */
    void setProcessingMode(ProcessingMode mode);

    /**
     * Get the current processing mode.
     */
    ProcessingMode getProcessingMode() const;

    /**
     * Set the number of threads in the thread pool.
     * @param numThreads Number of threads (0 = auto-detect based on hardware).
     */
    void setNumThreads(int numThreads);

    /**
     * Get the number of threads in the thread pool.
     */
    int getNumThreads() const;

    /**
     * Enable or disable load balancing.
     * When enabled, work is distributed based on processor complexity.
     */
    void setLoadBalancingEnabled(bool enabled);

    /**
     * Check if load balancing is enabled.
     */
    bool isLoadBalancingEnabled() const;

    /**
     * Get the total latency of all processors (in samples).
     */
    int getTotalLatency() const;

private:
    /**
     * Internal processor wrapper with metadata.
     */
    struct ProcessorEntry
    {
        std::unique_ptr<Processor> processor;
        std::atomic<bool> isProcessing{false};
        int estimatedComplexity = 1; // For load balancing
    };

    /**
     * Process all processors in parallel mode.
     */
    void processParallel(std::vector<juce::AudioBuffer<float>>& buffers, juce::MidiBuffer& midi);

    /**
     * Process all processors in sequential mode.
     */
    void processSequential(std::vector<juce::AudioBuffer<float>>& buffers, juce::MidiBuffer& midi);

    /**
     * Initialize the thread pool.
     */
    void initializeThreadPool();

    /**
     * Estimate processor complexity for load balancing.
     */
    int estimateProcessorComplexity(const Processor& processor) const;

    // Owned processors
    std::vector<std::unique_ptr<ProcessorEntry>> processors;

    // Thread pool for parallel processing
    std::unique_ptr<juce::ThreadPool> threadPool;
    int numThreads = 0;
    bool loadBalancingEnabled = true;

    // Processing configuration
    ProcessingMode processingMode = ProcessingMode::Parallel;
    bool isPrepared = false;
    double currentSampleRate = 44100.0;
    int currentBlockSize = 512;
    int currentNumChannels = 2;

    // Performance metrics
    std::atomic<int64_t> totalProcessingTimeUs{0};
    std::atomic<int64_t> parallelSpeedupPercent{0};

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ParallelProcessor)
};