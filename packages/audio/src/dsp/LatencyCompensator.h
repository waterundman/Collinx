#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <vector>
#include <memory>
#include <atomic>
#include <functional>

/**
 * LatencyCompensator — Handles latency compensation for audio processing chains.
 *
 * Automatically detects and compensates for plugin latency by introducing
 * appropriate delays to synchronize parallel processing paths.
 * Supports latency reporting, buffering, and real-time adjustment.
 *
 * Thread-safety: process() is designed for the audio thread.
 * Configuration methods should be called from the message thread.
 */
class LatencyCompensator
{
public:
    /**
     * Latency source information.
     */
    struct LatencyInfo
    {
        int latencySamples = 0;      // Latency in samples
        juce::String sourceName;     // Name of the latency source
        bool isCompensated = false;  // Whether this latency is being compensated
    };

    LatencyCompensator();
    ~LatencyCompensator();

    // ── Lifecycle ──────────────────────────────────────────────────────

    /**
     * Prepare the compensator for playback.
     */
    void prepare(double sampleRate, int samplesPerBlock, int numChannels);

    /**
     * Release the compensator's resources.
     */
    void release();

    // ── Processing ─────────────────────────────────────────────────────

    /**
     * Process audio buffer with latency compensation.
     * @param buffer Audio buffer to process in-place.
     * @param pathIndex Index of the processing path (for parallel compensation).
     */
    void process(juce::AudioBuffer<float>& buffer, int pathIndex = 0);

    /**
     * Process multiple buffers with latency compensation for parallel paths.
     * @param buffers Vector of audio buffers (one per parallel path).
     */
    void processParallel(std::vector<juce::AudioBuffer<float>>& buffers);

    // ── Latency management ─────────────────────────────────────────────

    /**
     * Report latency from a source (e.g., plugin, processing chain).
     * @param sourceId Unique identifier for the latency source.
     * @param latencySamples Latency in samples.
     * @param sourceName Human-readable name for the source.
     */
    void reportLatency(int sourceId, int latencySamples, const juce::String& sourceName = "");

    /**
     * Remove latency report from a source.
     * @param sourceId Unique identifier for the latency source.
     */
    void removeLatencyReport(int sourceId);

    /**
     * Clear all latency reports.
     */
    void clearLatencyReports();

    /**
     * Get the maximum latency across all sources.
     */
    int getMaxLatency() const;

    /**
     * Get the latency for a specific source.
     * @param sourceId Unique identifier for the latency source.
     * @return Latency in samples, or 0 if not found.
     */
    int getLatencyForSource(int sourceId) const;

    /**
     * Get all latency information.
     */
    std::vector<LatencyInfo> getAllLatencyInfo() const;

    /**
     * Get the number of latency sources.
     */
    int getNumLatencySources() const;

    // ── Configuration ──────────────────────────────────────────────────

    /**
     * Enable or disable automatic latency detection.
     * When enabled, the compensator will try to detect latency changes.
     */
    void setAutoDetectEnabled(bool enabled);

    /**
     * Check if automatic latency detection is enabled.
     */
    bool isAutoDetectEnabled() const;

    /**
     * Set the compensation mode.
     * @param delayCompensation If true, uses delay lines for compensation.
     *                         If false, uses time-stretching (not implemented).
     */
    void setDelayCompensationMode(bool delayCompensation);

    /**
     * Check if delay compensation mode is active.
     */
    bool isDelayCompensationMode() const;

    /**
     * Set the maximum latency that can be compensated.
     * @param maxSamples Maximum latency in samples.
     */
    void setMaxCompensatableLatency(int maxSamples);

    /**
     * Get the maximum compensatable latency.
     */
    int getMaxCompensatableLatency() const;

    // ── Queries ────────────────────────────────────────────────────────

    /**
     * Get the current compensation delay being applied.
     * @param pathIndex Index of the processing path.
     * @return Delay in samples.
     */
    int getCurrentCompensationDelay(int pathIndex = 0) const;

    /**
     * Check if the compensator is introducing any delay.
     */
    bool isIntroducingDelay() const;

    /**
     * Get the total latency including compensation.
     */
    int getTotalLatency() const;

    /**
     * Callback invoked when latency changes.
     */
    using LatencyChangeCallback = std::function<void(int newMaxLatency)>;
    void setLatencyChangeCallback(LatencyChangeCallback callback);

private:
    /**
     * Internal delay buffer for a single channel.
     */
    struct DelayBuffer
    {
        juce::AudioBuffer<float> buffer;
        int writePosition = 0;
        int readPosition = 0;
        int delaySamples = 0;
        int size = 0;

        void prepare(int numSamples, int numChannels);
        void release();
        void write(const juce::AudioBuffer<float>& source, int startSample, int numSamples);
        void read(juce::AudioBuffer<float>& dest, int startSample, int numSamples);
        void clear();
    };

    /**
     * Latency source entry.
     */
    struct LatencySource
    {
        int sourceId;
        int latencySamples;
        juce::String sourceName;
        bool isCompensated;
    };

    /**
     * Update compensation delays based on current latency reports.
     */
    void updateCompensationDelays();

    /**
     * Initialize delay buffers for a given latency.
     */
    void initializeDelayBuffers(int maxLatency);

    /**
     * Calculate the delay needed for a specific path to synchronize with others.
     */
    int calculatePathDelay(int pathIndex) const;

    // Latency sources
    std::vector<LatencySource> latencySources;
    mutable std::mutex sourcesMutex;

    // Delay buffers for each parallel path
    std::vector<std::unique_ptr<DelayBuffer>> delayBuffers;
    int numPaths = 1;

    // Configuration
    bool autoDetectEnabled = true;
    bool delayCompensationMode = true;
    int maxCompensatableLatency = 102400; // ~2.3 seconds at 44.1kHz
    bool isPrepared = false;
    double currentSampleRate = 44100.0;
    int currentBlockSize = 512;
    int currentNumChannels = 2;

    // Current state
    int currentMaxLatency = 0;
    std::atomic<bool> isCompensating{false};

    // Callback
    LatencyChangeCallback latencyChangeCallback;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(LatencyCompensator)
};