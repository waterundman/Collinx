#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>
#include <cmath>

class Transport
{
public:
    enum class State { Stopped, Playing, Paused };

    Transport();

    void prepare(double sampleRate, double bpm = 120.0, int numerator = 4, int denominator = 4);

    void play();
    void pause();
    void stop();
    void togglePlayPause();
    State getState() const;

    void setLoop(int startBar, int endBar);
    void enableLoop(bool enable);
    bool isLooping() const;
    void getLoopRange(int& startBar, int& endBar) const;

    void setPosition(int bar, double beat = 1.0);
    double getCurrentBar() const;
    double getCurrentBeat() const;
    int getCurrentBarInt() const;

    void setBPM(double bpm);
    double getBPM() const;
    void setTimeSignature(int numerator, int denominator);

    void processBlock(int numSamples);
    bool shouldPlayNote(int noteBar, double noteBeat) const;

    bool isPlaying() const { return state.load() == State::Playing; }

private:
    std::atomic<State> state{State::Stopped};
    double sampleRate = 44100.0;
    double bpm = 120.0;
    int timeSigNumerator = 4;
    int timeSigDenominator = 4;

    std::atomic<int64_t> totalSamples{0};

    bool looping = false;
    int loopStartBar = 1;
    int loopEndBar = 8;

    double samplesPerBeat() const;
    double samplesPerBar() const;
};
