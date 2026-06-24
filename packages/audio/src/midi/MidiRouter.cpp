#include "MidiRouter.h"

MidiRouter::MidiRouter() = default;

MidiRouter::~MidiRouter() = default;

// ── Lifecycle ──────────────────────────────────────────────────────────

void MidiRouter::prepare(double sampleRate, int samplesPerBlock)
{
    currentSampleRate = sampleRate;
    currentBlockSize = samplesPerBlock;
    prepared = true;
}

void MidiRouter::release()
{
    prepared = false;
}

// ── Processing ─────────────────────────────────────────────────────────

void MidiRouter::process(const juce::MidiBuffer& inputMessages, juce::MidiBuffer& outputMessages, int numSamples)
{
    juce::ignoreUnused(numSamples);

    std::lock_guard<std::mutex> lock(configMutex);

    // Clear output buffers
    outputMessages.clear();
    for (auto& [id, dest] : outputs)
    {
        if (dest != nullptr)
            dest->buffer.clear();
    }

    // Process each MIDI message
    for (const auto metadata : inputMessages)
    {
        const auto& message = metadata.getMessage();
        int samplePosition = metadata.samplePosition;

        // Apply filters
        if (message.isNoteOn() && filterNoteOn.load())
            continue;
        if (message.isNoteOff() && filterNoteOff.load())
            continue;
        if (message.isController() && filterControlChange.load())
            continue;
        if (message.isProgramChange() && filterProgramChange.load())
            continue;
        if (message.isPitchWheel() && filterPitchBend.load())
            continue;
        if (message.isAftertouch() && filterAftertouch.load())
            continue;
        if (message.isSysEx() && filterSysEx.load())
            continue;

        // Apply channel mapping
        int outputChannel = 0;
        auto channelIt = channelMappings.find(message.getChannel());
        if (channelIt != channelMappings.end())
            outputChannel = channelIt->second;

        // Create mapped message
        juce::MidiMessage mappedMessage = message;
        if (outputChannel > 0)
            mappedMessage.setChannel(outputChannel);

        // Apply controller mapping
        if (mappedMessage.isController())
        {
            int inputCC = mappedMessage.getControllerNumber();
            auto ccIt = controllerMappings.find(inputCC);
            if (ccIt != controllerMappings.end())
            {
                const auto& mapping = ccIt->second;
                if (mapping.channel == 0 || mapping.channel == mappedMessage.getChannel())
                {
                    mappedMessage = juce::MidiMessage::controllerEvent(
                        mappedMessage.getChannel(),
                        mapping.outputCC,
                        mappedMessage.getControllerValue());
                }
            }
        }

        // Route to outputs
        bool routedToSpecificOutput = false;
        for (auto& [id, dest] : outputs)
        {
            if (dest == nullptr)
                continue;

            // Check if this output should receive this channel
            if (dest->channels.empty() || 
                std::find(dest->channels.begin(), dest->channels.end(), mappedMessage.getChannel()) != dest->channels.end())
            {
                dest->buffer.addEvent(mappedMessage, samplePosition);
                routedToSpecificOutput = true;
            }
        }

        // If no specific output routing, add to main output
        if (!routedToSpecificOutput || outputs.empty())
        {
            outputMessages.addEvent(mappedMessage, samplePosition);
        }
    }
}

// ── Channel mapping ────────────────────────────────────────────────────

void MidiRouter::setChannelMapping(int inputChannel, int outputChannel)
{
    std::lock_guard<std::mutex> lock(configMutex);
    channelMappings[inputChannel] = outputChannel;
}

int MidiRouter::getChannelMapping(int inputChannel) const
{
    std::lock_guard<std::mutex> lock(configMutex);
    auto it = channelMappings.find(inputChannel);
    return it != channelMappings.end() ? it->second : 0;
}

void MidiRouter::clearChannelMappings()
{
    std::lock_guard<std::mutex> lock(configMutex);
    channelMappings.clear();
}

// ── Controller mapping ─────────────────────────────────────────────────

void MidiRouter::mapController(int inputCC, int outputCC, int channel)
{
    std::lock_guard<std::mutex> lock(configMutex);
    controllerMappings[inputCC] = {outputCC, channel};
}

void MidiRouter::unmapController(int inputCC, int channel)
{
    std::lock_guard<std::mutex> lock(configMutex);
    auto it = controllerMappings.find(inputCC);
    if (it != controllerMappings.end())
    {
        if (channel == 0 || it->second.channel == channel)
            controllerMappings.erase(it);
    }
}

int MidiRouter::getMappedController(int inputCC, int channel) const
{
    std::lock_guard<std::mutex> lock(configMutex);
    auto it = controllerMappings.find(inputCC);
    if (it != controllerMappings.end())
    {
        if (it->second.channel == 0 || it->second.channel == channel)
            return it->second.outputCC;
    }
    return -1;
}

void MidiRouter::clearControllerMappings()
{
    std::lock_guard<std::mutex> lock(configMutex);
    controllerMappings.clear();
}

// ── Event filtering ────────────────────────────────────────────────────

void MidiRouter::setFilterNoteOn(bool filter)
{
    filterNoteOn.store(filter);
}

void MidiRouter::setFilterNoteOff(bool filter)
{
    filterNoteOff.store(filter);
}

void MidiRouter::setFilterControlChange(bool filter)
{
    filterControlChange.store(filter);
}

void MidiRouter::setFilterProgramChange(bool filter)
{
    filterProgramChange.store(filter);
}

void MidiRouter::setFilterPitchBend(bool filter)
{
    filterPitchBend.store(filter);
}

void MidiRouter::setFilterAftertouch(bool filter)
{
    filterAftertouch.store(filter);
}

void MidiRouter::setFilterSysEx(bool filter)
{
    filterSysEx.store(filter);
}

// ── Event distribution ─────────────────────────────────────────────────

void MidiRouter::addOutput(int outputId)
{
    std::lock_guard<std::mutex> lock(configMutex);
    if (outputs.find(outputId) == outputs.end())
    {
        outputs[outputId] = std::make_unique<OutputDestination>();
    }
}

void MidiRouter::removeOutput(int outputId)
{
    std::lock_guard<std::mutex> lock(configMutex);
    outputs.erase(outputId);
}

void MidiRouter::routeChannelsToOutput(int outputId, const std::vector<int>& channels)
{
    std::lock_guard<std::mutex> lock(configMutex);
    auto it = outputs.find(outputId);
    if (it != outputs.end() && it->second != nullptr)
    {
        it->second->channels = channels;
    }
}

juce::MidiBuffer* MidiRouter::getOutputBuffer(int outputId)
{
    std::lock_guard<std::mutex> lock(configMutex);
    auto it = outputs.find(outputId);
    if (it != outputs.end() && it->second != nullptr)
    {
        return &it->second->buffer;
    }
    return nullptr;
}

// ── State queries ──────────────────────────────────────────────────────

bool MidiRouter::isPrepared() const
{
    return prepared;
}

int MidiRouter::getNumOutputs() const
{
    std::lock_guard<std::mutex> lock(configMutex);
    return static_cast<int>(outputs.size());
}

void MidiRouter::clearAll()
{
    std::lock_guard<std::mutex> lock(configMutex);
    channelMappings.clear();
    controllerMappings.clear();
    outputs.clear();
}

void MidiRouter::routeMessage(const juce::MidiMessage& message, juce::MidiBuffer& outputBuffer)
{
    // Apply channel mapping
    int outputChannel = 0;
    auto channelIt = channelMappings.find(message.getChannel());
    if (channelIt != channelMappings.end())
        outputChannel = channelIt->second;

    // Create mapped message
    juce::MidiMessage mappedMessage = message;
    if (outputChannel > 0)
        mappedMessage.setChannel(outputChannel);

    // Apply controller mapping
    if (mappedMessage.isController())
    {
        int inputCC = mappedMessage.getControllerNumber();
        auto ccIt = controllerMappings.find(inputCC);
        if (ccIt != controllerMappings.end())
        {
            const auto& mapping = ccIt->second;
            if (mapping.channel == 0 || mapping.channel == mappedMessage.getChannel())
            {
                mappedMessage = juce::MidiMessage::controllerEvent(
                    mappedMessage.getChannel(),
                    mapping.outputCC,
                    mappedMessage.getControllerValue());
            }
        }
    }

    outputBuffer.addEvent(mappedMessage, 0);
}