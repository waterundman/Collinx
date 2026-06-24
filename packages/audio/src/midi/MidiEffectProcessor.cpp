#include "MidiEffectProcessor.h"

std::atomic<int> MidiEffectProcessor::nextId{0};

MidiEffectProcessor::MidiEffectProcessor()
    : id(nextId.fetch_add(1))
{
}

MidiEffectProcessor::~MidiEffectProcessor() = default;

// ── Lifecycle ──────────────────────────────────────────────────────────

void MidiEffectProcessor::prepare(double sampleRate, int samplesPerBlock)
{
    currentSampleRate = sampleRate;
    currentBlockSize = samplesPerBlock;
    prepared.store(true);
}

void MidiEffectProcessor::release()
{
    prepared.store(false);
}

void MidiEffectProcessor::activate()
{
    if (prepared.load())
        active.store(true);
}

void MidiEffectProcessor::deactivate()
{
    active.store(false);
}

// ── Processing ─────────────────────────────────────────────────────────

void MidiEffectProcessor::process(juce::MidiBuffer& midiMessages, int numSamples)
{
    // Default implementation: pass through
    // Subclasses should override this to add MIDI effects
    juce::ignoreUnused(midiMessages, numSamples);
}

// ── Bypass ─────────────────────────────────────────────────────────────

void MidiEffectProcessor::setBypassed(bool shouldBypass)
{
    bypassed.store(shouldBypass);
}

bool MidiEffectProcessor::isBypassed() const
{
    return bypassed.load();
}

// ── State queries ──────────────────────────────────────────────────────

bool MidiEffectProcessor::isPrepared() const
{
    return prepared.load();
}

bool MidiEffectProcessor::isActive() const
{
    return active.load();
}

// ── Processor info ─────────────────────────────────────────────────────

int MidiEffectProcessor::getId() const
{
    return id;
}

// ── Parameters ─────────────────────────────────────────────────────────

int MidiEffectProcessor::getNumParameters() const
{
    return 0;
}

float MidiEffectProcessor::getParameter(int index) const
{
    juce::ignoreUnused(index);
    return 0.0f;
}

void MidiEffectProcessor::setParameter(int index, float value)
{
    juce::ignoreUnused(index, value);
}

juce::String MidiEffectProcessor::getParameterName(int index) const
{
    juce::ignoreUnused(index);
    return {};
}

juce::String MidiEffectProcessor::getParameterText(int index) const
{
    juce::ignoreUnused(index);
    return {};
}

// ── MIDI filtering ─────────────────────────────────────────────────────

void MidiEffectProcessor::setMidiChannel(int channel)
{
    midiChannel.store(channel);
}

int MidiEffectProcessor::getMidiChannel() const
{
    return midiChannel.load();
}

void MidiEffectProcessor::setMidiMessageFilter(bool noteOn, bool noteOff, bool controlChange,
                                                 bool programChange, bool pitchBend, bool aftertouch)
{
    filterNoteOn.store(noteOn);
    filterNoteOff.store(noteOff);
    filterControlChange.store(controlChange);
    filterProgramChange.store(programChange);
    filterPitchBend.store(pitchBend);
    filterAftertouch.store(aftertouch);
}

bool MidiEffectProcessor::shouldProcessMessage(const juce::MidiMessage& message) const
{
    // Check channel filter
    int channel = midiChannel.load();
    if (channel > 0 && message.getChannel() != channel)
        return false;

    // Check message type filter
    if (message.isNoteOn() && !filterNoteOn.load())
        return false;
    if (message.isNoteOff() && !filterNoteOff.load())
        return false;
    if (message.isController() && !filterControlChange.load())
        return false;
    if (message.isProgramChange() && !filterProgramChange.load())
        return false;
    if (message.isPitchWheel() && !filterPitchBend.load())
        return false;
    if (message.isAftertouch() && !filterAftertouch.load())
        return false;

    return true;
}