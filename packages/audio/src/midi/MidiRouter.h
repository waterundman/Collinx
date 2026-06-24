#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <vector>
#include <memory>
#include <mutex>
#include <functional>
#include <unordered_map>
#include <atomic>

/**
 * MidiRouter — Routes MIDI events between inputs, effects, and outputs.
 *
 * Supports channel mapping, controller mapping, and event distribution.
 * Can route MIDI from multiple inputs to multiple outputs through configurable mappings.
 *
 * Thread-safety: process() is called from the audio thread.
 * All configuration methods should be called from the message thread.
 */
class MidiRouter
{
public:
    MidiRouter();
    ~MidiRouter();

    // ── Lifecycle ──────────────────────────────────────────────────────

    /**
     * Prepare the router for playback.
     */
    void prepare(double sampleRate, int samplesPerBlock);

    /**
     * Release resources.
     */
    void release();

    // ── Processing ─────────────────────────────────────────────────────

    /**
     * Process MIDI routing.
     * @param inputMessages Input MIDI buffer.
     * @param outputMessages Output MIDI buffer (will be filled with routed messages).
     * @param numSamples Number of samples in this block.
     */
    void process(const juce::MidiBuffer& inputMessages, juce::MidiBuffer& outputMessages, int numSamples);

    // ── Channel mapping ────────────────────────────────────────────────

    /**
     * Set channel mapping: routes messages from inputChannel to outputChannel.
     * @param inputChannel Input channel (1-16).
     * @param outputChannel Output channel (1-16). 0 = pass through unchanged.
     */
    void setChannelMapping(int inputChannel, int outputChannel);

    /**
     * Get channel mapping for an input channel.
     * @param inputChannel Input channel (1-16).
     * @return Output channel (1-16), or 0 if no mapping.
     */
    int getChannelMapping(int inputChannel) const;

    /**
     * Clear all channel mappings (pass through all channels).
     */
    void clearChannelMappings();

    // ── Controller mapping ─────────────────────────────────────────────

    /**
     * Map one CC to another.
     * @param inputCC Input controller number (0-127).
     * @param outputCC Output controller number (0-127).
     * @param channel Channel to apply mapping (0 = all channels).
     */
    void mapController(int inputCC, int outputCC, int channel = 0);

    /**
     * Remove a controller mapping.
     * @param inputCC Input controller number.
     * @param channel Channel (0 = all channels).
     */
    void unmapController(int inputCC, int channel = 0);

    /**
     * Get mapped controller number.
     * @param inputCC Input controller number.
     * @param channel Channel (1-16).
     * @return Mapped controller number, or -1 if no mapping.
     */
    int getMappedController(int inputCC, int channel) const;

    /**
     * Clear all controller mappings.
     */
    void clearControllerMappings();

    // ── Event filtering ────────────────────────────────────────────────

    /**
     * Filter out specific message types.
     */
    void setFilterNoteOn(bool filter);
    void setFilterNoteOff(bool filter);
    void setFilterControlChange(bool filter);
    void setFilterProgramChange(bool filter);
    void setFilterPitchBend(bool filter);
    void setFilterAftertouch(bool filter);
    void setFilterSysEx(bool filter);

    // ── Event distribution ─────────────────────────────────────────────

    /**
     * Add an output destination.
     * @param outputId Unique identifier for the output.
     */
    void addOutput(int outputId);

    /**
     * Remove an output destination.
     * @param outputId Output identifier to remove.
     */
    void removeOutput(int outputId);

    /**
     * Route specific channels to an output.
     * @param outputId Output identifier.
     * @param channels Vector of channels (1-16) to route to this output.
     */
    void routeChannelsToOutput(int outputId, const std::vector<int>& channels);

    /**
     * Get the output buffer for a specific output.
     * @param outputId Output identifier.
     * @return Pointer to the output buffer, or nullptr if not found.
     */
    juce::MidiBuffer* getOutputBuffer(int outputId);

    // ── State queries ──────────────────────────────────────────────────

    bool isPrepared() const;

    /**
     * Get the number of active outputs.
     */
    int getNumOutputs() const;

    /**
     * Clear all routing configuration.
     */
    void clearAll();

private:
    struct ControllerMapping
    {
        int outputCC;
        int channel; // 0 = all channels
    };

    struct OutputDestination
    {
        juce::MidiBuffer buffer;
        std::vector<int> channels; // Empty = all channels
    };

    void routeMessage(const juce::MidiMessage& message, juce::MidiBuffer& outputBuffer);

    bool prepared = false;
    double currentSampleRate = 44100.0;
    int currentBlockSize = 512;

    // Channel mappings (input channel -> output channel)
    std::unordered_map<int, int> channelMappings;

    // Controller mappings (inputCC -> ControllerMapping)
    std::unordered_map<int, ControllerMapping> controllerMappings;

    // Output destinations
    std::unordered_map<int, std::unique_ptr<OutputDestination>> outputs;

    // Filters
    std::atomic<bool> filterNoteOn{false};
    std::atomic<bool> filterNoteOff{false};
    std::atomic<bool> filterControlChange{false};
    std::atomic<bool> filterProgramChange{false};
    std::atomic<bool> filterPitchBend{false};
    std::atomic<bool> filterAftertouch{false};
    std::atomic<bool> filterSysEx{false};

    mutable std::mutex configMutex;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MidiRouter)
};