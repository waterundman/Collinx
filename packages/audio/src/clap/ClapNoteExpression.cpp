#include "ClapNoteExpression.h"
#include <algorithm>
#include <cmath>

ClapNoteExpression::ClapNoteExpression() = default;
ClapNoteExpression::~ClapNoteExpression() = default;

// ── Lifecycle ───────────────────────────────────────────────────────

void ClapNoteExpression::prepare(double sampleRate, int maxVoices)
{
    currentSampleRate = sampleRate;
    maxVoiceCount = maxVoices;
    prepared = true;
}

void ClapNoteExpression::release()
{
    std::lock_guard<std::mutex> lock(notesMutex);
    activeNotes.clear();
    lowerZone = {};
    upperZone = {};
    prepared = false;
}

void ClapNoteExpression::reset()
{
    std::lock_guard<std::mutex> lock(notesMutex);
    activeNotes.clear();
}

// ── Note expression processing ──────────────────────────────────────

void ClapNoteExpression::processNoteExpression(int channel, int key,
                                                ExpressionId id, double value)
{
    if (!prepared)
        return;

    if (channel < 1 || channel > kMaxChannels || key < 0 || key >= kMaxKeys)
        return;

    if (id == ExpressionId::Count)
        return;

    {
        std::lock_guard<std::mutex> lock(notesMutex);
        NoteKey nk{channel, key};
        activeNotes[nk].set(id, value);
    }

    // Apply expression-specific side effects
    switch (id)
    {
        case ExpressionId::Pressure:
            applyPressure(channel, key, value);
            break;
        case ExpressionId::Tuning:
            applyTuning(channel, key, value);
            break;
        case ExpressionId::Brightness:
            applyBrightness(channel, key, value);
            break;
        default:
            break;
    }

    if (callback)
        callback(channel, key, id, value);
}

const ClapNoteExpression::NoteExpressionState*
ClapNoteExpression::getNoteExpression(int channel, int key) const
{
    std::lock_guard<std::mutex> lock(notesMutex);
    auto it = activeNotes.find({channel, key});
    return it != activeNotes.end() ? &it->second : nullptr;
}

void ClapNoteExpression::setCallback(NoteExpressionCallback cb)
{
    callback = std::move(cb);
}

// ── MPE zone management ─────────────────────────────────────────────

void ClapNoteExpression::setMpeLowerZone(int numChannels)
{
    numChannels = std::clamp(numChannels, 0, 14);
    lowerZone.startChannel = 2;
    lowerZone.endChannel = (numChannels > 0) ? (1 + numChannels) : 1;
    lowerZone.masterChannel = 1;
    lowerZone.isActive = (numChannels > 0);
}

void ClapNoteExpression::setMpeUpperZone(int numChannels)
{
    numChannels = std::clamp(numChannels, 0, 14);
    upperZone.startChannel = (numChannels > 0) ? (16 - numChannels) : 16;
    upperZone.endChannel = 15;
    upperZone.masterChannel = 16;
    upperZone.isActive = (numChannels > 0);
}

ClapNoteExpression::MpeZone ClapNoteExpression::getMpeZone(bool isUpper) const
{
    return isUpper ? upperZone : lowerZone;
}

bool ClapNoteExpression::isMpeMemberChannel(int channel) const
{
    if (channel < 1 || channel > 16)
        return false;

    if (lowerZone.isActive && channel >= lowerZone.startChannel
        && channel <= lowerZone.endChannel && channel != lowerZone.masterChannel)
        return true;

    if (upperZone.isActive && channel >= upperZone.startChannel
        && channel <= upperZone.endChannel && channel != upperZone.masterChannel)
        return true;

    return false;
}

bool ClapNoteExpression::isMpeManagerChannel(int channel) const
{
    if (channel < 1 || channel > 16)
        return false;

    return (lowerZone.isActive && channel == lowerZone.masterChannel)
        || (upperZone.isActive && channel == upperZone.masterChannel);
}

bool ClapNoteExpression::isMpeActive() const
{
    return lowerZone.isActive || upperZone.isActive;
}

// ── Pitch bend range ────────────────────────────────────────────────

void ClapNoteExpression::setPitchBendRange(int semitones)
{
    pitchBendRange.store(std::clamp(semitones, 1, 96));
}

int ClapNoteExpression::getPitchBendRange() const
{
    return pitchBendRange.load();
}

// ── State queries ───────────────────────────────────────────────────

bool ClapNoteExpression::isPrepared() const
{
    return prepared;
}

int ClapNoteExpression::getNumActiveNotes() const
{
    std::lock_guard<std::mutex> lock(notesMutex);
    return static_cast<int>(activeNotes.size());
}

// ── Internal expression handlers ────────────────────────────────────

void ClapNoteExpression::applyPressure(int /*channel*/, int /*key*/, double value)
{
    // Clamp pressure to 0..1; further processing delegated to synth layer
    std::ignore = std::clamp(value, 0.0, 1.0);
}

void ClapNoteExpression::applyTuning(int channel, int key, double semitones)
{
    // Tuning expression: convert semitones to pitch factor
    // The synth layer reads the expression state and applies this to pitch calculation
    // Valid range: -pitchBendRange..+pitchBendRange semitones
    int range = pitchBendRange.load();
    std::ignore = std::clamp(semitones, static_cast<double>(-range), static_cast<double>(range));
}

void ClapNoteExpression::applyBrightness(int /*channel*/, int /*key*/, double value)
{
    // Brightness maps to filter cutoff; value range 0..1
    std::ignore = std::clamp(value, 0.0, 1.0);
}
