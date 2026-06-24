#include "builtin-synth.h"

SineWaveVoice::SineWaveVoice()
{
    updateRates(44100.0);
}

void SineWaveVoice::updateRates(double sr)
{
    envSampleRate = sr;
    attackRate = 1.0 / (attackTime * sr);
    decayRate = (1.0 - sustainLevel) / (decayTime * sr);
    releaseRate = 1.0 / (releaseTime * sr);
}

bool SineWaveVoice::canPlaySound(juce::SynthesiserSound* sound)
{
    return dynamic_cast<juce::SynthesiserSound*>(sound) != nullptr;
}

void SineWaveVoice::startNote(int midiNoteNumber, float velocity,
                               juce::SynthesiserSound*, int)
{
    double sr = getSampleRate();
    if (sr > 0.0)
        updateRates(sr);

    double freq = juce::MidiMessage::getMidiNoteInHertz(midiNoteNumber);
    angleDelta = (freq / sr) * 2.0 * juce::MathConstants<double>::pi;
    level = velocity;

    envState = EnvState::Attack;
    envValue = 0.0;
    currentAngle = 0.0;
}

void SineWaveVoice::stopNote(float, bool allowTailOff)
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
        angleDelta = 0.0;
    }
}

void SineWaveVoice::renderNextBlock(juce::AudioBuffer<float>& outputBuffer,
                                      int startSample, int numSamples)
{
    if (envState == EnvState::Idle)
        return;

    auto* left = outputBuffer.getWritePointer(0, startSample);
    auto* right = outputBuffer.getNumChannels() > 1
                      ? outputBuffer.getWritePointer(1, startSample)
                      : nullptr;

    for (int i = 0; i < numSamples; ++i)
    {
        // Advance ADSR envelope
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
                angleDelta = 0.0;
                return;
            }
            break;
        case EnvState::Idle:
            return;
        }

        double sampleOut = std::sin(currentAngle) * level * envValue;
        currentAngle = std::fmod(currentAngle + angleDelta,
                                 2.0 * juce::MathConstants<double>::pi);

        float fsample = static_cast<float>(sampleOut);
        left[i] += fsample;
        if (right != nullptr)
            right[i] += fsample;
    }
}

BuiltinSynth::BuiltinSynth()
{
    for (int i = 0; i < 8; ++i)
        addVoice(new SineWaveVoice());
    addSound(new juce::SynthesiserSound());
}

void BuiltinSynth::prepare(const juce::dsp::ProcessSpec& spec)
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

void BuiltinSynth::renderNextBlock(juce::AudioBuffer<float>& buffer,
                                     int startSample, int numSamples)
{
    juce::MidiBuffer emptyMidi;
    renderNextBlock(buffer, emptyMidi, startSample, numSamples);
}

void BuiltinSynth::renderNextBlock(juce::AudioBuffer<float>& buffer,
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

void BuiltinSynth::setMasterVolume(float volume)
{
    masterGain.setGainLinear(juce::jlimit(0.0f, 1.0f, volume));
}

float BuiltinSynth::getMasterVolume() const
{
    return masterGain.getGainLinear();
}

void BuiltinSynth::noteOn(int channel, int midiNote, float velocity)
{
    if (midiNote >= 0 && midiNote <= 127)
        juce::Synthesiser::noteOn(channel, midiNote, velocity);
}

void BuiltinSynth::noteOff(int channel, int midiNote)
{
    if (midiNote >= 0 && midiNote <= 127)
        juce::Synthesiser::noteOff(channel, midiNote, true);
}
