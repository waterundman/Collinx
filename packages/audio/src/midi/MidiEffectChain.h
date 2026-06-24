#pragma once

#include "MidiEffectProcessor.h"
#include <vector>
#include <memory>
#include <mutex>
#include <functional>

/**
 * MidiEffectChain — Manages an ordered chain of MidiEffectProcessor instances.
 *
 * MIDI events flow through the chain sequentially: input → effect[0] → effect[1] → ... → output.
 * Supports add/remove/reorder, per-effect bypass, and real-time processing.
 *
 * Thread-safety: process() is called from the audio thread (lock-free fast path).
 * All mutators acquire a mutex to swap the active chain snapshot.
 */
class MidiEffectChain
{
public:
    MidiEffectChain();
    ~MidiEffectChain();

    // ── Lifecycle ──────────────────────────────────────────────────────

    /**
     * Prepare all effects in the chain for playback.
     */
    void prepare(double sampleRate, int samplesPerBlock);

    /**
     * Release all effects in the chain.
     */
    void release();

    /**
     * Activate all effects in the chain.
     */
    void activateAll();

    /**
     * Deactivate all effects in the chain.
     */
    void deactivateAll();

    // ── Processing ─────────────────────────────────────────────────────

    /**
     * Process MIDI events through the entire chain.
     * @param midiMessages MIDI buffer to process in-place.
     * @param numSamples Number of samples in this block (for timing).
     *
     * Uses a lock-free snapshot of the chain for the audio thread.
     */
    void process(juce::MidiBuffer& midiMessages, int numSamples);

    // ── Chain manipulation ─────────────────────────────────────────────

    /**
     * Add an effect to the end of the chain.
     * Automatically prepares and activates the effect if the chain is already prepared.
     * @param effect The MIDI effect processor to add (ownership transferred).
     * @return Index of the added effect, or -1 on failure.
     */
    int addEffect(std::unique_ptr<MidiEffectProcessor> effect);

    /**
     * Remove an effect from the chain by index.
     * @param index Index of the effect to remove.
     */
    void removeEffect(int index);

    /**
     * Remove an effect from the chain by ID.
     * @param effectId ID of the effect to remove.
     */
    void removeEffectById(int effectId);

    /**
     * Move an effect from one position to another.
     * @param fromIndex Current index.
     * @param toIndex Target index.
     */
    void moveEffect(int fromIndex, int toIndex);

    /**
     * Get an effect by index (read-only).
     */
    const MidiEffectProcessor* getEffect(int index) const;

    /**
     * Get an effect by index (mutable).
     */
    MidiEffectProcessor* getEffect(int index);

    /**
     * Get an effect by ID.
     */
    MidiEffectProcessor* getEffectById(int effectId);

    /**
     * Get the number of effects in the chain.
     */
    int getNumEffects() const;

    /**
     * Check if the chain is empty.
     */
    bool isEmpty() const;

    // ── Bypass ─────────────────────────────────────────────────────────

    /**
     * Set bypass for the entire chain (all effects).
     */
    void setChainBypassed(bool bypassed);

    /**
     * Check if the entire chain is bypassed.
     */
    bool isChainBypassed() const;

    // ── Queries ────────────────────────────────────────────────────────

    /**
     * Get the names of all effects in chain order.
     */
    std::vector<juce::String> getEffectNames() const;

    /**
     * Callback invoked when the chain changes (add/remove/reorder).
     */
    using ChainChangeCallback = std::function<void()>;
    void setChainChangeCallback(ChainChangeCallback callback);

private:
    /**
     * Snapshot used by the audio thread — a plain vector of raw pointers.
     * Avoids heap allocation on the audio thread.
     */
    struct ChainSnapshot
    {
        std::vector<MidiEffectProcessor*> processors;
        bool chainBypassed = false;
    };

    void rebuildSnapshot();
    void prepareAndActivateEffect(MidiEffectProcessor& effect);

    // Owned effects (message thread only)
    std::vector<std::unique_ptr<MidiEffectProcessor>> effects;

    // Snapshot for audio thread
    ChainSnapshot snapshot;
    mutable std::mutex snapshotMutex;

    bool isPrepared = false;
    double currentSampleRate = 44100.0;
    int currentBlockSize = 512;

    std::atomic<bool> chainBypassed{false};

    ChainChangeCallback chainChangeCallback;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MidiEffectChain)
};