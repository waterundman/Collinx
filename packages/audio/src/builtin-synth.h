#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>
#include <cmath>

struct SineWaveVoice : public juce::SynthesiserVoice
{
    SineWaveVoice();

    bool canPlaySound(juce::SynthesiserSound* sound) override;
    void startNote(int midiNoteNumber, float velocity,
                   juce::SynthesiserSound* sound, int currentPitchWheelPosition) override;
    void stopNote(float velocity, bool allowTailOff) override;
    void pitchWheelMoved(int newValue) override {}
    void controllerMoved(int controllerNumber, int newValue) override {}
    void renderNextBlock(juce::AudioBuffer<float>& outputBuffer,
                         int startSample, int numSamples) override;

private:
    enum class EnvState { Idle, Attack, Decay, Sustain, Release };

    double currentAngle = 0.0;
    double angleDelta = 0.0;
    double level = 0.0;

    EnvState envState = EnvState::Idle;
    double envValue = 0.0;
    double envSampleRate = 44100.0;

    double attackRate = 0.0;
    double decayRate = 0.0;
    double sustainLevel = 0.7;
    double releaseRate = 0.0;

    static constexpr double attackTime = 0.01;
    static constexpr double decayTime = 0.1;
    static constexpr double releaseTime = 0.3;

    void updateRates(double sampleRate);
};

class BuiltinSynth : public juce::Synthesiser
{
public:
    BuiltinSynth();

    void prepare(const juce::dsp::ProcessSpec& spec);
    void renderNextBlock(juce::AudioBuffer<float>& buffer,
                         int startSample, int numSamples);
    void renderNextBlock(juce::AudioBuffer<float>& buffer,
                         const juce::MidiBuffer& midiMessages,
                         int startSample, int numSamples);
    void setMasterVolume(float volume);
    float getMasterVolume() const;

    void noteOn(int channel, int midiNote, float velocity);
    void noteOff(int channel, int midiNote);

private:
    juce::dsp::ProcessSpec processSpec;
    juce::dsp::Gain<float> masterGain;
    juce::dsp::Limiter<float> limiter;
};
