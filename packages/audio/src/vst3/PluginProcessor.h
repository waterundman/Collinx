#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>
#include <memory>
#include <string>

/**
 * PluginProcessor — Wraps a VST3 AudioPluginInstance for real-time processing.
 *
 * Encapsulates plugin lifecycle (prepare/process/release), MIDI forwarding,
 * parameter access, bypass control, and silence detection.
 *
 * Thread-safety: process() may be called from the audio thread.
 * All other methods should be called from the message thread unless noted.
 */
class PluginProcessor
{
public:
    /**
     * Construct from an existing AudioPluginInstance (takes ownership).
     */
    explicit PluginProcessor(std::unique_ptr<juce::AudioPluginInstance> instance,
                             const juce::PluginDescription& description);

    ~PluginProcessor();

    PluginProcessor(PluginProcessor&&) noexcept = default;
    PluginProcessor& operator=(PluginProcessor&&) noexcept = default;

    // ── Lifecycle ──────────────────────────────────────────────────────

    /**
     * Prepare the plugin for playback.
     * Safe to call multiple times; subsequent calls are no-ops if already prepared
     * with matching parameters. Changing sampleRate/blockSize requires release + prepare.
     */
    void prepare(double sampleRate, int samplesPerBlock, int numChannels);

    /**
     * Release the plugin's audio resources.
     */
    void release();

    /**
     * Activate the plugin (setActive true). Must be prepared first.
     */
    void activate();

    /**
     * Deactivate the plugin (setActive false).
     */
    void deactivate();

    // ── Processing ─────────────────────────────────────────────────────

    /**
     * Process audio through the plugin.
     * Called from the audio thread. If bypassed, audio passes through unchanged.
     * @param buffer Audio buffer to process in-place.
     * @param midi MIDI buffer for this block.
     */
    void process(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi);

    // ── Bypass ─────────────────────────────────────────────────────────

    void setBypassed(bool bypassed);
    bool isBypassed() const;

    // ── State queries ──────────────────────────────────────────────────

    bool isPrepared() const;
    bool isActive() const;
    bool isSilent() const;

    /**
     * Returns true if the plugin output was silent for the last process() call.
     * Useful for the chain to skip downstream processing.
     */
    bool wasLastBlockSilent() const;

    // ── Plugin info ────────────────────────────────────────────────────

    juce::AudioPluginInstance* getInstance();
    const juce::AudioPluginInstance* getInstance() const;
    const juce::PluginDescription& getDescription() const;
    juce::String getName() const;

    // ── Parameters ─────────────────────────────────────────────────────

    /**
     * Get the number of automatable parameters.
     */
    int getNumParameters() const;

    /**
     * Get parameter value (0..1).
     */
    float getParameter(int index) const;

    /**
     * Set parameter value (0..1).
     */
    void setParameter(int index, float value);

    /**
     * Get parameter name.
     */
    juce::String getParameterName(int index) const;

    /**
     * Get parameter display text for the current value.
     */
    juce::String getParameterText(int index) const;

    // ── Unique ID ──────────────────────────────────────────────────────

    int getId() const { return id; }

private:
    std::unique_ptr<juce::AudioPluginInstance> instance;
    juce::PluginDescription description;

    int id;

    double currentSampleRate = 0.0;
    int currentBlockSize = 0;
    int currentNumChannels = 0;

    std::atomic<bool> bypassed{false};
    std::atomic<bool> prepared{false};
    std::atomic<bool> active{false};
    std::atomic<bool> lastBlockSilent{false};

    static std::atomic<int> nextId;

    /**
     * Check if a buffer is silent (all samples below threshold).
     */
    static bool isBufferSilent(const juce::AudioBuffer<float>& buffer);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginProcessor)
};
