#pragma once

#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>
#include "builtin-synth.h"
#include "transport.h"
#include "vst3/PluginChain.h"
#include "vst3/Vst3HostManager.h"

class AudioEngine : public juce::AudioAppComponent,
                    private juce::MidiInputCallback
{
public:
    AudioEngine();
    ~AudioEngine() override;

    void prepareToPlay(int samplesPerBlock, double sampleRate) override;
    void releaseResources() override;
    void getNextAudioBlock(const juce::AudioSourceChannelInfo& bufferToFill) override;

    juce::AudioDeviceManager& getDeviceManager() { return deviceManager; }
    BuiltinSynth& getSynth() { return *synth; }
    Transport& getTransport() { return *transport; }
    PluginChain& getPluginChain() { return *pluginChain; }
    Vst3HostManager& getVst3Host() { return *vst3Host; }

    double getSampleRate() const { return currentSampleRate; }
    int getBlockSize() const { return currentBlockSize; }

    void handleMidiMessage(const juce::MidiMessage& message);

    void setMidiInputEnabled(bool enabled);

    /**
     * Load a VST3 plugin by file path and add it to the processing chain.
     * @param fileOrIdentifier Path to the VST3 plugin file.
     * @return Plugin ID (positive) on success, -1 on failure.
     */
    int loadPluginToChain(const juce::String& fileOrIdentifier);

    /**
     * Load a VST3 plugin from a PluginDescription and add it to the chain.
     * @param description Plugin description.
     * @return Plugin ID (positive) on success, -1 on failure.
     */
    int loadPluginToChain(const juce::PluginDescription& description);

    /**
     * Remove a plugin from the processing chain by ID.
     */
    void removePluginFromChain(int pluginId);

private:
    void handleIncomingMidiMessage(juce::MidiInput* source,
                                   const juce::MidiMessage& message) override;
    void findAndEnableMidiDevices();

    juce::AudioDeviceManager deviceManager;
    std::unique_ptr<BuiltinSynth> synth;
    std::unique_ptr<Transport> transport;
    std::unique_ptr<PluginChain> pluginChain;
    std::unique_ptr<Vst3HostManager> vst3Host;

    double currentSampleRate = 44100.0;
    int currentBlockSize = 512;

    juce::MidiBuffer incomingMidi;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(AudioEngine)
};
