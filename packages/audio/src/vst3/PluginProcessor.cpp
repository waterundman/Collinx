#include "PluginProcessor.h"

std::atomic<int> PluginProcessor::nextId{1};

PluginProcessor::PluginProcessor(std::unique_ptr<juce::AudioPluginInstance> inst,
                                 const juce::PluginDescription& desc)
    : instance(std::move(inst))
    , description(desc)
    , id(nextId.fetch_add(1))
{
    jassert(instance != nullptr);
}

PluginProcessor::~PluginProcessor()
{
    if (prepared.load())
        release();

    if (active.load())
        deactivate();
}

// ── Lifecycle ──────────────────────────────────────────────────────────

void PluginProcessor::prepare(double sampleRate, int samplesPerBlock, int numChannels)
{
    if (prepared.load())
        return;

    if (instance == nullptr)
        return;

    currentSampleRate = sampleRate;
    currentBlockSize = samplesPerBlock;
    currentNumChannels = numChannels;

    instance->setPlayConfigDetails(numChannels, numChannels, sampleRate, samplesPerBlock);
    instance->prepareToPlay(sampleRate, samplesPerBlock);

    prepared.store(true);
    lastBlockSilent.store(false);

    DBG("PluginProcessor: Prepared " << getName()
        << " (" << sampleRate << "Hz, " << samplesPerBlock << " samples, "
        << numChannels << " ch)");
}

void PluginProcessor::release()
{
    if (!prepared.load())
        return;

    if (instance != nullptr)
        instance->releaseResources();

    prepared.store(false);
    DBG("PluginProcessor: Released " << getName());
}

void PluginProcessor::activate()
{
    if (active.load() || !prepared.load())
        return;

    if (instance != nullptr)
        instance->setActive(true);

    active.store(true);
    DBG("PluginProcessor: Activated " << getName());
}

void PluginProcessor::deactivate()
{
    if (!active.load())
        return;

    if (instance != nullptr)
        instance->setActive(false);

    active.store(false);
    DBG("PluginProcessor: Deactivated " << getName());
}

// ── Processing ─────────────────────────────────────────────────────────

void PluginProcessor::process(juce::AudioBuffer<float>& buffer,
                               juce::MidiBuffer& midi)
{
    if (!prepared.load() || !active.load() || instance == nullptr)
        return;

    if (bypassed.load())
        return;

    instance->processBlock(buffer, midi);

    lastBlockSilent.store(isBufferSilent(buffer));
}

// ── Bypass ─────────────────────────────────────────────────────────────

void PluginProcessor::setBypassed(bool shouldBypass)
{
    bypassed.store(shouldBypass);
}

bool PluginProcessor::isBypassed() const
{
    return bypassed.load();
}

// ── State queries ──────────────────────────────────────────────────────

bool PluginProcessor::isPrepared() const
{
    return prepared.load();
}

bool PluginProcessor::isActive() const
{
    return active.load();
}

bool PluginProcessor::isSilent() const
{
    return lastBlockSilent.load();
}

bool PluginProcessor::wasLastBlockSilent() const
{
    return lastBlockSilent.load();
}

// ── Plugin info ────────────────────────────────────────────────────────

juce::AudioPluginInstance* PluginProcessor::getInstance()
{
    return instance.get();
}

const juce::AudioPluginInstance* PluginProcessor::getInstance() const
{
    return instance.get();
}

const juce::PluginDescription& PluginProcessor::getDescription() const
{
    return description;
}

juce::String PluginProcessor::getName() const
{
    if (instance != nullptr)
        return instance->getName();

    return description.name;
}

// ── Parameters ─────────────────────────────────────────────────────────

int PluginProcessor::getNumParameters() const
{
    if (instance == nullptr)
        return 0;

    return instance->getParameters().size();
}

float PluginProcessor::getParameter(int index) const
{
    if (instance == nullptr)
        return 0.0f;

    auto params = instance->getParameters();
    if (index < 0 || index >= params.size())
        return 0.0f;

    return params[index]->getValue();
}

void PluginProcessor::setParameter(int index, float value)
{
    if (instance == nullptr)
        return;

    auto params = instance->getParameters();
    if (index < 0 || index >= params.size())
        return;

    params[index]->setValueNotifyingHost(value);
}

juce::String PluginProcessor::getParameterName(int index) const
{
    if (instance == nullptr)
        return {};

    auto params = instance->getParameters();
    if (index < 0 || index >= params.size())
        return {};

    return params[index]->getName(256);
}

juce::String PluginProcessor::getParameterText(int index) const
{
    if (instance == nullptr)
        return {};

    auto params = instance->getParameters();
    if (index < 0 || index >= params.size())
        return {};

    return params[index]->getText(params[index]->getValue(), 256);
}

// ── Silence detection ──────────────────────────────────────────────────

bool PluginProcessor::isBufferSilent(const juce::AudioBuffer<float>& buffer)
{
    constexpr float threshold = 1.0e-8f;

    for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
    {
        auto* data = buffer.getReadPointer(ch);
        for (int i = 0; i < buffer.getNumSamples(); ++i)
        {
            if (std::abs(data[i]) > threshold)
                return false;
        }
    }

    return true;
}
