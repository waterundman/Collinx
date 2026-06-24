#include "wavetable-synth.h"

// ---- WavetableVoice ----

WavetableVoice::WavetableVoice()
{
    updateRates(44100.0);
}

void WavetableVoice::updateRates(double sr)
{
    if (sr <= 0.0) return;
    attackRate = 1.0 / (attackTime * sr);
    decayRate = (1.0 - sustainLevel) / (decayTime * sr);
    releaseRate = 1.0 / (releaseTime * sr);
}

bool WavetableVoice::canPlaySound(juce::SynthesiserSound* sound)
{
    return dynamic_cast<juce::SynthesiserSound*>(sound) != nullptr;
}

void WavetableVoice::startNote(int midiNoteNumber, float velocity,
                                juce::SynthesiserSound*, int)
{
    double sr = getSampleRate();
    if (sr > 0.0)
        updateRates(sr);

    double freq = juce::MidiMessage::getMidiNoteInHertz(midiNoteNumber);
    double bentFreq = freq * std::pow(2.0, pitchBend * pitchBendRange / 12.0);
    phaseDelta = bentFreq / sr;
    level = velocity;

    envState = EnvState::Attack;
    envValue = 0.0;
    currentPhase = 0.0;
}

void WavetableVoice::stopNote(float, bool allowTailOff)
{
    if (allowTailOff)
    {
        envState = EnvState::Release;
    }
    else
    {
        clearCurrentNote();
        envState = EnvState::Idle;
        envValue = 0.0;
        phaseDelta = 0.0;
    }
}

void WavetableVoice::pitchWheelMoved(int newValue)
{
    pitchBend = (newValue - 8192) / 8192.0;
    if (isKeyDown())
    {
        double sr = getSampleRate();
        int midiNote = getCurrentlyPlayingNote();
        double freq = juce::MidiMessage::getMidiNoteInHertz(midiNote);
        double bentFreq = freq * std::pow(2.0, pitchBend * pitchBendRange / 12.0);
        phaseDelta = bentFreq / sr;
    }
}

double WavetableVoice::sampleWaveform(double phase) const
{
    switch (waveform)
    {
    case Waveform::Sine:
        return std::sin(phase * 2.0 * juce::MathConstants<double>::pi);

    case Waveform::Saw:
        return 2.0 * (phase - std::floor(phase)) - 1.0;

    case Waveform::Square:
        return (phase - std::floor(phase)) < 0.5 ? 1.0 : -1.0;

    case Waveform::Triangle:
    {
        double p = phase - std::floor(phase);
        if (p < 0.25)
            return 4.0 * p;
        else if (p < 0.75)
            return 2.0 - 4.0 * p;
        else
            return 4.0 * p - 4.0;
    }
    }
    return 0.0;
}

void WavetableVoice::renderNextBlock(juce::AudioBuffer<float>& outputBuffer,
                                       int startSample, int numSamples)
{
    if (envState == EnvState::Idle)
        return;

    auto* left = outputBuffer.getWritePointer(0, startSample);
    auto* right = outputBuffer.getNumChannels() > 1
                      ? outputBuffer.getWritePointer(1, startSample)
                      : nullptr;

    double panL = pan <= 0.0f ? 1.0 : 1.0 - pan;
    double panR = pan >= 0.0f ? 1.0 : 1.0 + pan;

    for (int i = 0; i < numSamples; ++i)
    {
        switch (envState)
        {
        case EnvState::Attack:
            envValue += attackRate;
            if (envValue >= 1.0)
            {
                envValue = 1.0;
                envState = EnvState::Decay;
            }
            break;
        case EnvState::Decay:
            envValue -= decayRate;
            if (envValue <= sustainLevel)
            {
                envValue = sustainLevel;
                envState = EnvState::Sustain;
            }
            break;
        case EnvState::Sustain:
            break;
        case EnvState::Release:
            envValue -= releaseRate;
            if (envValue <= 0.0)
            {
                envValue = 0.0;
                clearCurrentNote();
                envState = EnvState::Idle;
                phaseDelta = 0.0;
                return;
            }
            break;
        case EnvState::Idle:
            return;
        }

        double sampleOut = sampleWaveform(currentPhase) * level * envValue;
        currentPhase = std::fmod(currentPhase + phaseDelta, 1.0);

        float fsample = static_cast<float>(sampleOut);
        left[i] += static_cast<float>(fsample * panL);
        if (right != nullptr)
            right[i] += static_cast<float>(fsample * panR);
    }
}

// ---- WavetableSynth ----

WavetableSynth::WavetableSynth()
{
    for (int i = 0; i < 16; ++i)
        addVoice(new WavetableVoice());
    addSound(new juce::SynthesiserSound());
}

void WavetableSynth::prepare(const juce::dsp::ProcessSpec& spec)
{
    processSpec = spec;
    setCurrentPlaybackSampleRate(spec.sampleRate);

    masterGain.reset();
    masterGain.prepare(spec);
    masterGain.setGainLinear(0.7f);

    limiter.reset();
    limiter.prepare(spec);
    limiter.setThreshold(-0.5f);
    limiter.setRelease(50.0f);
}

void WavetableSynth::renderNextBlock(juce::AudioBuffer<float>& buffer,
                                       int startSample, int numSamples)
{
    juce::MidiBuffer emptyMidi;
    renderNextBlock(buffer, emptyMidi, startSample, numSamples);
}

void WavetableSynth::renderNextBlock(juce::AudioBuffer<float>& buffer,
                                       const juce::MidiBuffer& midiMessages,
                                       int startSample, int numSamples)
{
    processMidi(midiMessages, startSample, numSamples);

    buffer.clear(startSample, numSamples);

    renderVoices(buffer, startSample, numSamples);

    juce::dsp::AudioBlock<float> block(buffer);
    juce::dsp::ProcessContextReplacing<float> context(block);
    masterGain.process(context);
    limiter.process(context);
}

void WavetableSynth::setMasterVolume(float volume)
{
    masterGain.setGainLinear(juce::jlimit(0.0f, 1.0f, volume));
}

float WavetableSynth::getMasterVolume() const
{
    return masterGain.getGainLinear();
}

void WavetableSynth::setGlobalWaveform(Waveform wf)
{
    globalWaveform = wf;
    for (int i = 0; i < getNumVoices(); ++i)
    {
        if (auto* v = dynamic_cast<WavetableVoice*>(getVoice(i)))
            v->setWaveform(wf);
    }
}

void WavetableSynth::noteOn(int channel, int midiNote, float velocity)
{
    if (midiNote >= 0 && midiNote <= 127)
    {
        juce::Synthesiser::noteOn(channel, midiNote, velocity);
    }
}

void WavetableSynth::noteOff(int channel, int midiNote)
{
    if (midiNote >= 0 && midiNote <= 127)
        juce::Synthesiser::noteOff(channel, midiNote, true);
}
