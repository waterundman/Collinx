#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>
#include <memory>
#include <string>
#include <vector>

/**
 * MidiEffectProcessor — Base class for MIDI effect processors.
 *
 * Provides a standard interface for processing MIDI events in a chain.
 * Supports real-time processing, bypass control, and parameter management.
 *
 * Thread-safety: process() is called from the audio thread.
 * All other methods should be called from the message thread unless noted.
 */
class MidiEffectProcessor
{
public:
    MidiEffectProcessor();
    virtual ~MidiEffectProcessor();

    MidiEffectProcessor(MidiEffectProcessor&&) noexcept = default;
    MidiEffectProcessor& operator=(MidiEffectProcessor&&) noexcept = default;

    // ── Lifecycle ──────────────────────────────────────────────────────

    /**
     * Prepare the processor for playback.
     * @param sampleRate The sample rate.
     * @param samplesPerBlock Maximum samples per block.
     */
    virtual void prepare(double sampleRate, int samplesPerBlock);

    /**
     * Release resources.
     */
    virtual void release();

    /**
     * Activate the processor.
     */
    virtual void activate();

    /**
     * Deactivate the processor.
     */
    virtual void deactivate();

    // ── Processing ─────────────────────────────────────────────────────

    /**
     * Process MIDI events.
     * Called from the audio thread.
     * @param midiMessages MIDI buffer to process in-place.
     * @param numSamples Number of samples in this block (for timing).
     */
    virtual void process(juce::MidiBuffer& midiMessages, int numSamples);

    // ── Bypass ─────────────────────────────────────────────────────────

    void setBypassed(bool bypassed);
    bool isBypassed() const;

    // ── State queries ──────────────────────────────────────────────────

    bool isPrepared() const;
    bool isActive() const;

    // ── Processor info ─────────────────────────────────────────────────

    /**
     * Get the processor name.
     */
    virtual juce::String getName() const = 0;

    /**
     * Get the processor ID.
     */
    int getId() const;

    // ── Parameters ─────────────────────────────────────────────────────

    /**
     * Get the number of parameters.
     */
    virtual int getNumParameters() const;

    /**
     * Get parameter value (0..1).
     */
    virtual float getParameter(int index) const;

    /**
     * Set parameter value (0..1).
     */
    virtual void setParameter(int index, float value);

    /**
     * Get parameter name.
     */
    virtual juce::String getParameterName(int index) const;

    /**
     * Get parameter display text.
     */
    virtual juce::String getParameterText(int index) const;

    // ── MIDI filtering ─────────────────────────────────────────────────

    /**
     * Set which MIDI channels to process (1-16). 0 = all channels.
     */
    void setMidiChannel(int channel);
    int getMidiChannel() const;

    /**
     * Set which MIDI message types to process.
     */
    void setMidiMessageFilter(bool noteOn, bool noteOff, bool controlChange,
                               bool programChange, bool pitchBend, bool aftertouch);

    // ── Unique ID ──────────────────────────────────────────────────────

protected:
    int id;

    double currentSampleRate = 0.0;
    int currentBlockSize = 0;

    std::atomic<bool> bypassed{false};
    std::atomic<bool> prepared{false};
    std::atomic<bool> active{false};

    // MIDI filtering
    std::atomic<int> midiChannel{0}; // 0 = all channels
    std::atomic<bool> filterNoteOn{true};
    std::atomic<bool> filterNoteOff{true};
    std::atomic<bool> filterControlChange{true};
    std::atomic<bool> filterProgramChange{true};
    std::atomic<bool> filterPitchBend{true};
    std::atomic<bool> filterAftertouch{true};

    static std::atomic<int> nextId;

    /**
     * Check if a MIDI message should be processed based on filters.
     */
    bool shouldProcessMessage(const juce::MidiMessage& message) const;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MidiEffectProcessor)
};