#pragma once

#include "PluginProcessor.h"
#include "../dsp/ParallelProcessor.h"
#include "../dsp/LatencyCompensator.h"
#include <vector>
#include <memory>
#include <mutex>
#include <functional>

/**
 * PluginChain — Manages an ordered chain of PluginProcessor instances.
 *
 * Audio flows through the chain sequentially: input → plugin[0] → plugin[1] → ... → output.
 * Supports add/remove/reorder, per-plugin bypass, and silence-flag optimisation
 * (skips downstream plugins when an upstream plugin produces silence).
 *
 * Thread-safety: process() is called from the audio thread (lock-free fast path).
 * All mutators acquire a spin-lock to swap the active chain snapshot.
 */
class PluginChain
{
public:
    /**
     * Processing mode for the plugin chain.
     */
    enum class ProcessingMode
    {
        Sequential,  // Process plugins one after another (default)
        Parallel     // Process plugins in parallel (for independent effects)
    };

    PluginChain();
    ~PluginChain();

    // ── Lifecycle ──────────────────────────────────────────────────────

    /**
     * Prepare all plugins in the chain for playback.
     */
    void prepare(double sampleRate, int samplesPerBlock, int numChannels);

    /**
     * Release all plugins in the chain.
     */
    void release();

    /**
     * Activate all plugins in the chain.
     */
    void activateAll();

    /**
     * Deactivate all plugins in the chain.
     */
    void deactivateAll();

    // ── Processing ─────────────────────────────────────────────────────

    /**
     * Process audio through the entire chain.
     * @param buffer Audio buffer processed in-place.
     * @param midi MIDI buffer for this block.
     *
     * Uses a lock-free snapshot of the chain for the audio thread.
     * If a plugin produces silence, downstream plugins are skipped (silence flag).
     */
    void process(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi);

    /**
     * Set the processing mode (sequential or parallel).
     */
    void setProcessingMode(ProcessingMode mode);

    /**
     * Get the current processing mode.
     */
    ProcessingMode getProcessingMode() const;

    /**
     * Set the number of threads for parallel processing.
     * @param numThreads Number of threads (0 = auto-detect).
     */
    void setNumThreads(int numThreads);

    /**
     * Get the number of threads for parallel processing.
     */
    int getNumThreads() const;

    /**
     * Enable or disable latency compensation.
     */
    void setLatencyCompensationEnabled(bool enabled);

    /**
     * Check if latency compensation is enabled.
     */
    bool isLatencyCompensationEnabled() const;

    /**
     * Get the total latency of the chain (in samples).
     */
    int getTotalLatency() const;

    /**
     * Get the latency compensator instance.
     */
    LatencyCompensator& getLatencyCompensator();

    // ── Chain manipulation ─────────────────────────────────────────────

    /**
     * Add a plugin to the end of the chain.
     * Automatically prepares and activates the plugin if the chain is already prepared.
     * @param plugin The plugin processor to add (ownership transferred).
     * @return Index of the added plugin, or -1 on failure.
     */
    int addPlugin(std::unique_ptr<PluginProcessor> plugin);

    /**
     * Remove a plugin from the chain by index.
     * @param index Index of the plugin to remove.
     */
    void removePlugin(int index);

    /**
     * Remove a plugin from the chain by ID.
     * @param pluginId ID of the plugin to remove.
     */
    void removePluginById(int pluginId);

    /**
     * Move a plugin from one position to another.
     * @param fromIndex Current index.
     * @param toIndex Target index.
     */
    void movePlugin(int fromIndex, int toIndex);

    /**
     * Get a plugin by index (read-only).
     */
    const PluginProcessor* getPlugin(int index) const;

    /**
     * Get a plugin by index (mutable).
     */
    PluginProcessor* getPlugin(int index);

    /**
     * Get a plugin by ID.
     */
    PluginProcessor* getPluginById(int pluginId);

    /**
     * Get the number of plugins in the chain.
     */
    int getNumPlugins() const;

    /**
     * Check if the chain is empty.
     */
    bool isEmpty() const;

    // ── Bypass ─────────────────────────────────────────────────────────

    /**
     * Set bypass for the entire chain (all plugins).
     */
    void setChainBypassed(bool bypassed);

    /**
     * Check if the entire chain is bypassed.
     */
    bool isChainBypassed() const;

    // ── Queries ────────────────────────────────────────────────────────

    /**
     * Check if any plugin in the chain is producing sound.
     */
    bool isAnyPluginActive() const;

    /**
     * Get the names of all plugins in chain order.
     */
    std::vector<juce::String> getPluginNames() const;

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
        std::vector<PluginProcessor*> processors;
        bool chainBypassed = false;
    };

    void rebuildSnapshot();
    void prepareAndActivatePlugin(PluginProcessor& plugin);

    /**
     * Process plugins sequentially (original behavior).
     */
    void processSequential(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi);

    /**
     * Process plugins in parallel.
     */
    void processParallel(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi);

    // Owned plugins (message thread only)
    std::vector<std::unique_ptr<PluginProcessor>> plugins;

    // Snapshot for audio thread
    ChainSnapshot snapshot;
    mutable std::mutex snapshotMutex;

    // Spin-lock for fast audio-thread reads
    std::atomic<bool> snapshotLock{false};

    bool isPrepared = false;
    double currentSampleRate = 44100.0;
    int currentBlockSize = 512;
    int currentNumChannels = 2;

    std::atomic<bool> chainBypassed{false};

    ChainChangeCallback chainChangeCallback;

    // Parallel processing support
    std::unique_ptr<ParallelProcessor> parallelProcessor;
    LatencyCompensator latencyCompensator;
    ProcessingMode processingMode = ProcessingMode::Sequential;
    bool latencyCompensationEnabled = true;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginChain)
};
