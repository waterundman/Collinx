#include "audio-engine.h"
#include "vst3/PluginProcessor.h"

AudioEngine::AudioEngine()
    : synth(std::make_unique<BuiltinSynth>())
    , transport(std::make_unique<Transport>())
    , pluginChain(std::make_unique<PluginChain>())
    , vst3Host(std::make_unique<Vst3HostManager>())
{
    juce::AudioDeviceManager::AudioDeviceSetup setup;
    deviceManager.getAudioDeviceSetup(setup);

    setup.sampleRate = 44100.0;
    setup.bufferSize = 512;
    setup.useDefaultInputChannels = false;
    setup.inputChannels = 0;
    setup.useDefaultOutputChannels = true;
    setup.outputChannels = 2;

    juce::String error = deviceManager.initialise(
        0, 2, nullptr, true, juce::String(), &setup);

    if (error.isNotEmpty())
        DBG("AudioEngine: device init error: " << error);

    setAudioChannels(0, 2);

    // Initialize VST3 host
    if (!vst3Host->initialize())
        DBG("AudioEngine: Failed to initialize VST3 host");

    deviceManager.addMidiInputDeviceCallback({}, this);
    findAndEnableMidiDevices();
}

AudioEngine::~AudioEngine()
{
    deviceManager.removeMidiInputDeviceCallback({}, this);

    // Shutdown plugin chain before audio device
    pluginChain->release();
    vst3Host->shutdown();

    shutdownAudio();
}

void AudioEngine::findAndEnableMidiDevices()
{
    auto midiInputs = juce::MidiInput::getAvailableDevices();
    for (const auto& dev : midiInputs)
    {
        deviceManager.setMidiInputDeviceEnabled(dev.identifier, true);
    }
}

void AudioEngine::handleIncomingMidiMessage(juce::MidiInput*,
                                              const juce::MidiMessage& message)
{
    incomingMidi.addEvent(message, 0);
}

void AudioEngine::handleMidiMessage(const juce::MidiMessage& message)
{
    incomingMidi.addEvent(message, 0);
}

void AudioEngine::setMidiInputEnabled(bool enabled)
{
    auto midiInputs = juce::MidiInput::getAvailableDevices();
    for (const auto& dev : midiInputs)
    {
        deviceManager.setMidiInputDeviceEnabled(dev.identifier, enabled);
    }
}

void AudioEngine::prepareToPlay(int samplesPerBlock, double sampleRate)
{
    currentSampleRate = sampleRate;
    currentBlockSize = samplesPerBlock;

    juce::dsp::ProcessSpec spec;
    spec.sampleRate = sampleRate;
    spec.maximumBlockSize = static_cast<juce::uint32>(samplesPerBlock);
    spec.numChannels = 2;

    synth->prepare(spec);
    transport->prepare(sampleRate);

    // Prepare plugin chain with matching audio parameters
    pluginChain->prepare(sampleRate, samplesPerBlock, 2);
    pluginChain->activateAll();
}

void AudioEngine::releaseResources()
{
    synth->allNotesOff(0);
    pluginChain->deactivateAll();
    pluginChain->release();
}

void AudioEngine::getNextAudioBlock(const juce::AudioSourceChannelInfo& bufferToFill)
{
    bufferToFill.clearActiveBufferRegion();

    transport->processBlock(bufferToFill.numSamples);

    // Render built-in synth into the buffer
    synth->renderNextBlock(
        *bufferToFill.buffer,
        incomingMidi,
        bufferToFill.startSample,
        bufferToFill.numSamples);

    // Process through plugin chain
    // Create a sub-buffer view for the current block to avoid offset issues
    juce::AudioBuffer<float> pluginBuffer(
        bufferToFill.buffer->getArrayOfWritePointers(),
        bufferToFill.buffer->getNumChannels(),
        bufferToFill.startSample,
        bufferToFill.numSamples);

    pluginChain->process(pluginBuffer, incomingMidi);

    incomingMidi.clear();
}

int AudioEngine::loadPluginToChain(const juce::String& fileOrIdentifier)
{
    if (!vst3Host->isInitialized())
    {
        DBG("AudioEngine: VST3 host not initialized");
        return -1;
    }

    auto& loader = vst3Host->getLoader();
    int loaderIndex = loader.loadPluginFromFile(
        fileOrIdentifier, currentSampleRate, currentBlockSize);

    if (loaderIndex < 0)
    {
        DBG("AudioEngine: Failed to load plugin from " << fileOrIdentifier);
        return -1;
    }

    auto* loadedPlugin = loader.getPlugin(loaderIndex);
    if (loadedPlugin == nullptr)
    {
        DBG("AudioEngine: Loaded plugin is null");
        return -1;
    }

    // Transfer ownership from loader to a PluginProcessor wrapper
    auto processor = std::make_unique<PluginProcessor>(
        std::move(loadedPlugin->instance),
        loadedPlugin->description);

    // Clear the loader entry since we took ownership
    // (unloadPlugin would try to release/destroy the instance we already moved)
    loadedPlugin->instance.reset();

    int pluginId = pluginChain->addPlugin(std::move(processor));
    if (pluginId >= 0)
        DBG("AudioEngine: Plugin added to chain with ID " << pluginId);

    return pluginId;
}

int AudioEngine::loadPluginToChain(const juce::PluginDescription& description)
{
    if (!vst3Host->isInitialized())
    {
        DBG("AudioEngine: VST3 host not initialized");
        return -1;
    }

    auto& loader = vst3Host->getLoader();
    int loaderIndex = loader.loadPlugin(
        description, currentSampleRate, currentBlockSize);

    if (loaderIndex < 0)
    {
        DBG("AudioEngine: Failed to load plugin: " << description.name);
        return -1;
    }

    auto* loadedPlugin = loader.getPlugin(loaderIndex);
    if (loadedPlugin == nullptr)
        return -1;

    auto processor = std::make_unique<PluginProcessor>(
        std::move(loadedPlugin->instance),
        loadedPlugin->description);

    loadedPlugin->instance.reset();

    int pluginId = pluginChain->addPlugin(std::move(processor));
    if (pluginId >= 0)
        DBG("AudioEngine: Plugin added to chain with ID " << pluginId);

    return pluginId;
}

void AudioEngine::removePluginFromChain(int pluginId)
{
    pluginChain->removePluginById(pluginId);
}
