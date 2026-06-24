#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>
#include <cmath>
#include <array>

enum class Waveform
{
    Sine,
    Saw,
    Square,
    Triangle
};

struct WavetableVoice : public juce::SynthesiserVoice
{
    WavetableVoice();

    bool canPlaySound(juce::SynthesiserSound* sound) override;
    void startNote(int midiNoteNumber, float velocity,
                   juce::SynthesiserSound* sound, int currentPitchWheelPosition) override;
    void stopNote(float velocity, bool allowTailOff) override;
    void pitchWheelMoved(int newValue) override;
    void controllerMoved(int controllerNumber, int newValue) override {}
    void renderNextBlock(juce::AudioBuffer<float>& outputBuffer,
                         int startSample, int numSamples) override;

    void setWaveform(Waveform wf) { waveform = wf; }
    Waveform getWaveform() const { return waveform; }

    void setPan(float p) { pan = juce::jlimit(-1.0f, 1.0f, p); }
    float getPan() const { return pan; }

private:
    enum class EnvState { Idle, Attack, Decay, Sustain, Release };

    double currentPhase = 0.0;
    double phaseDelta = 0.0;
    double level = 0.0;

    Waveform waveform = Waveform::Saw;
    float pan = 0.0f;

    EnvState envState = EnvState::Idle;
    double envValue = 0.0;

    double attackRate = 0.0;
    double decayRate = 0.0;
    double sustainLevel = 0.7;
    double releaseRate = 0.0;

    static constexpr double attackTime = 0.02;
    static constexpr double decayTime = 0.15;
    static constexpr double releaseTime = 0.3;
    static constexpr double pitchBendRange = 2.0;

    double pitchBend = 0.0;

    void updateRates(double sampleRate);

    double sampleWaveform(double phase) const;
};

class WavetableSynth : public juce::Synthesiser
{
public:
    WavetableSynth();

    void prepare(const juce::dsp::ProcessSpec& spec);
    void renderNextBlock(juce::AudioBuffer<float>& buffer,
                         int startSample, int numSamples);
    void renderNextBlock(juce::AudioBuffer<float>& buffer,
                         const juce::MidiBuffer& midiMessages,
                         int startSample, int numSamples);
    void setMasterVolume(float volume);
    float getMasterVolume() const;
    void setGlobalWaveform(Waveform wf);

    void noteOn(int channel, int midiNote, float velocity);
    void noteOff(int channel, int midiNote);

private:
    juce::dsp::ProcessSpec processSpec;
    juce::dsp::Gain<float> masterGain;
    juce::dsp::Limiter<float> limiter;

    Waveform globalWaveform = Waveform::Saw;
};
