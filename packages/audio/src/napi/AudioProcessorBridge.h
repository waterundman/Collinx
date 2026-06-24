#pragma once

#include <napi.h>
#include <memory>
#include <mutex>
#include <vector>
#include <atomic>
#include "../vst3/PluginChain.h"
#include "../vst3/Vst3HostManager.h"

/**
 * AudioProcessorBridge — N-API bridge for real-time audio processing.
 *
 * Exposes plugin chain management, audio processing, and parameter control
 * to TypeScript. Supports real-time audio data transfer via Float32Arrays.
 *
 * Usage from TypeScript:
 *   const processor = new AudioProcessorBridge(hostManager);
 *   processor.prepare(44100, 512, 2);
 *   processor.addPlugin(pluginIndex);
 *   const outputBuffer = processor.process(inputBuffer, midiData);
 *   processor.setParameter(pluginIndex, paramIndex, 0.5);
 */
class AudioProcessorBridge : public Napi::ObjectWrap<AudioProcessorBridge>
{
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    AudioProcessorBridge(const Napi::CallbackInfo& info);
    ~AudioProcessorBridge();

private:
    // ── Lifecycle ──────────────────────────────────────────────────────

    /**
     * Prepare the audio processor for playback.
     * @param sampleRate number (e.g. 44100).
     * @param samplesPerBlock number (e.g. 512).
     * @param numChannels number (e.g. 2 for stereo).
     */
    void Prepare(const Napi::CallbackInfo& info);

    /**
     * Release audio resources.
     */
    void Release(const Napi::CallbackInfo& info);

    /**
     * Activate all plugins in the chain.
     */
    void ActivateAll(const Napi::CallbackInfo& info);

    /**
     * Deactivate all plugins in the chain.
     */
    void DeactivateAll(const Napi::CallbackInfo& info);

    // ── Chain Manipulation ─────────────────────────────────────────────

    /**
     * Add a loaded plugin to the processing chain.
     * @param pluginIndex number — index from PluginManagerBridge.loadPlugin().
     * @returns number — chain index, or -1 on failure.
     */
    Napi::Value AddPlugin(const Napi::CallbackInfo& info);

    /**
     * Remove a plugin from the chain by index.
     * @param chainIndex number.
     */
    void RemovePlugin(const Napi::CallbackInfo& info);

    /**
     * Remove a plugin from the chain by its unique ID.
     * @param pluginId number.
     */
    void RemovePluginById(const Napi::CallbackInfo& info);

    /**
     * Move a plugin within the chain.
     * @param fromIndex number.
     * @param toIndex number.
     */
    void MovePlugin(const Napi::CallbackInfo& info);

    /**
     * Get the number of plugins in the chain.
     * @returns number.
     */
    Napi::Value GetNumPlugins(const Napi::CallbackInfo& info);

    /**
     * Check if the chain is empty.
     * @returns boolean.
     */
    Napi::Value IsEmpty(const Napi::CallbackInfo& info);

    /**
     * Get the names of all plugins in chain order.
     * @returns string[].
     */
    Napi::Value GetPluginNames(const Napi::CallbackInfo& info);

    // ── Processing ─────────────────────────────────────────────────────

    /**
     * Process audio through the plugin chain.
     *
     * @param inputBuffer Float32Array | number[] — interleaved audio data.
     * @param numChannels number — number of channels.
     * @param numSamples number — number of samples per channel.
     * @param midiData object (optional) — { status, data1, data2, timestamp }[].
     * @returns Float32Array — processed interleaved audio data.
     */
    Napi::Value Process(const Napi::CallbackInfo& info);

    /**
     * Process audio through the plugin chain (async version).
     * Same params as Process(), returns Promise<Float32Array>.
     */
    Napi::Value ProcessAsync(const Napi::CallbackInfo& info);

    // ── Bypass ─────────────────────────────────────────────────────────

    /**
     * Set bypass for the entire chain.
     * @param bypassed boolean.
     */
    void SetChainBypassed(const Napi::CallbackInfo& info);

    /**
     * Check if the chain is bypassed.
     * @returns boolean.
     */
    Napi::Value IsChainBypassed(const Napi::CallbackInfo& info);

    // ── Parameters ─────────────────────────────────────────────────────

    /**
     * Get the number of parameters for a plugin.
     * @param pluginIndex number — chain index.
     * @returns number.
     */
    Napi::Value GetNumParameters(const Napi::CallbackInfo& info);

    /**
     * Get a parameter value (0..1).
     * @param pluginIndex number.
     * @param paramIndex number.
     * @returns number.
     */
    Napi::Value GetParameter(const Napi::CallbackInfo& info);

    /**
     * Set a parameter value (0..1).
     * @param pluginIndex number.
     * @param paramIndex number.
     * @param value number.
     */
    void SetParameter(const Napi::CallbackInfo& info);

    /**
     * Get parameter name.
     * @param pluginIndex number.
     * @param paramIndex number.
     * @returns string.
     */
    Napi::Value GetParameterName(const Napi::CallbackInfo& info);

    /**
     * Get parameter display text.
     * @param pluginIndex number.
     * @param paramIndex number.
     * @returns string.
     */
    Napi::Value GetParameterText(const Napi::CallbackInfo& info);

    /**
     * Get all parameters for a plugin.
     * @param pluginIndex number.
     * @returns { index, name, value, text }[].
     */
    Napi::Value GetAllParameters(const Napi::CallbackInfo& info);

    // ── State Queries ──────────────────────────────────────────────────

    /**
     * Check if any plugin in the chain is active.
     * @returns boolean.
     */
    Napi::Value IsAnyPluginActive(const Napi::CallbackInfo& info);

    /**
     * Get plugin info by chain index.
     * @param chainIndex number.
     * @returns object with plugin details.
     */
    Napi::Value GetPluginInfo(const Napi::CallbackInfo& info);

    // ── Internal Helpers ───────────────────────────────────────────────

    /**
     * Convert interleaved JS buffer to JUCE AudioBuffer.
     */
    void jsBufferToAudioBuffer(const float* interleavedData,
                                int numChannels,
                                int numSamples,
                                juce::AudioBuffer<float>& buffer);

    /**
     * Convert JUCE AudioBuffer to interleaved JS buffer.
     */
    Napi::Float32Array audioBufferToJs(Napi::Env env,
                                        const juce::AudioBuffer<float>& buffer);

    /**
     * Parse MIDI data from JS object array to MidiBuffer.
     */
    void parseMidiData(Napi::Array midiArray, juce::MidiBuffer& midiBuffer);

    // ── Members ────────────────────────────────────────────────────────

    Vst3HostManager* hostManager;  // Non-owning reference
    std::unique_ptr<PluginChain> pluginChain;
    std::mutex processorMutex;

    bool isPrepared = false;
    double currentSampleRate = 44100.0;
    int currentBlockSize = 512;
    int currentNumChannels = 2;

    // Reusable buffers to avoid allocation in process()
    juce::AudioBuffer<float> processBuffer;
    juce::MidiBuffer processMidi;

    // ── Async Worker ───────────────────────────────────────────────────

    class ProcessWorker : public Napi::AsyncWorker
    {
    public:
        ProcessWorker(Napi::Env env,
                      PluginChain* chain,
                      std::vector<float> audioData,
                      int numChannels,
                      int numSamples,
                      juce::MidiBuffer midi);
        void Execute() override;
        void OnOK() override;

        Napi::Value GetPromise();

    private:
        PluginChain* chain;
        std::vector<float> interleavedData;
        int numChannels;
        int numSamples;
        juce::MidiBuffer midiBuffer;
        Napi::Promise::Deferred deferred;
    };
};
