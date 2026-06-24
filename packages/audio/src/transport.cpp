#include "transport.h"

Transport::Transport() = default;

void Transport::prepare(double sr, double initialBpm, int numerator, int denominator)
{
    sampleRate = sr;
    bpm = initialBpm;
    timeSigNumerator = numerator;
    timeSigDenominator = denominator;
    totalSamples.store(0);
}

double Transport::samplesPerBeat() const
{
    return (60.0 / bpm) * sampleRate;
}

double Transport::samplesPerBar() const
{
    return samplesPerBeat() * timeSigNumerator;
}

void Transport::play()
{
    state.store(State::Playing);
}

void Transport::pause()
{
    state.store(State::Paused);
}

void Transport::stop()
{
    state.store(State::Stopped);
    totalSamples.store(0);
}

void Transport::togglePlayPause()
{
    State current = state.load();
    if (current == State::Playing)
        state.store(State::Paused);
    else
        state.store(State::Playing);
}

Transport::State Transport::getState() const
{
    return state.load();
}

void Transport::setLoop(int startBar, int endBar)
{
    loopStartBar = startBar;
    loopEndBar = endBar;
}

void Transport::enableLoop(bool enable)
{
    looping = enable;
}

bool Transport::isLooping() const
{
    return looping;
}

void Transport::getLoopRange(int& startBar, int& endBar) const
{
    startBar = loopStartBar;
    endBar = loopEndBar;
}

void Transport::setPosition(int bar, double beat)
{
    double barOffset = static_cast<double>(bar - 1);
    double beatOffset = beat - 1.0;
    double posSamples = (barOffset * timeSigNumerator + beatOffset) * samplesPerBeat();
    totalSamples.store(static_cast<int64_t>(posSamples));
}

double Transport::getCurrentBar() const
{
    double total = static_cast<double>(totalSamples.load());
    double spb = samplesPerBeat();
    if (spb <= 0.0) return 1.0;
    return total / (spb * timeSigNumerator) + 1.0;
}

double Transport::getCurrentBeat() const
{
    double total = static_cast<double>(totalSamples.load());
    double spb = samplesPerBeat();
    if (spb <= 0.0) return 1.0;
    double totalBeats = total / spb;
    return std::fmod(totalBeats, static_cast<double>(timeSigNumerator)) + 1.0;
}

int Transport::getCurrentBarInt() const
{
    return static_cast<int>(std::floor(getCurrentBar()));
}

void Transport::setBPM(double newBpm)
{
    bpm = newBpm;
}

double Transport::getBPM() const
{
    return bpm;
}

void Transport::setTimeSignature(int numerator, int denominator)
{
    timeSigNumerator = numerator;
    timeSigDenominator = denominator;
}

void Transport::processBlock(int numSamples)
{
    if (state.load() != State::Playing)
        return;

    int64_t current = totalSamples.load();
    current += numSamples;

    if (looping && loopEndBar > loopStartBar)
    {
        double loopEndSamples = (static_cast<double>(loopEndBar) - 1.0)
                                * timeSigNumerator * samplesPerBeat();
        if (static_cast<double>(current) >= loopEndSamples)
        {
            double loopStartSamples = (static_cast<double>(loopStartBar) - 1.0)
                                      * timeSigNumerator * samplesPerBeat();
            double overshoot = static_cast<double>(current) - loopEndSamples;
            current = static_cast<int64_t>(loopStartSamples + overshoot);
        }
    }

    totalSamples.store(current);
}

bool Transport::shouldPlayNote(int noteBar, double noteBeat) const
{
    if (state.load() != State::Playing)
        return false;

    double currentBar = getCurrentBar();
    double notePosition = static_cast<double>(noteBar - 1)
                          + (noteBeat - 1.0) / static_cast<double>(timeSigNumerator);
    double currentPosition = currentBar - 1.0;

    return notePosition <= currentPosition;
}
