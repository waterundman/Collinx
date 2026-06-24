#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include "AutomationCurve.h"
#include <unordered_map>
#include <string>
#include <functional>
#include <atomic>

class AutomationManager
{
public:
    enum class State { Idle, Recording, Playing, Overdubbing };

    using ParameterID = juce::String;
    using ValueCallback = std::function<void(const ParameterID& paramId, float value)>;

    AutomationManager();
    ~AutomationManager();

    // Transport
    void prepare(double sampleRate, double bpm);
    void startRecording();
    void startPlayback();
    void startOverdubbing();
    void stop();
    State getState() const { return state.load(); }
    bool isRecording() const { return state == State::Recording; }
    bool isPlaying() const { return state == State::Playing; }
    bool isOverdubbing() const { return state == State::Overdubbing; }

    // Time management
    void setCurrentTimeBeats(double timeBeats);
    double getCurrentTimeBeats() const { return currentTimeBeats; }
    void processBlock(int numSamples);

    // Parameter management
    void registerParameter(const ParameterID& paramId, float defaultValue = 0.0f);
    void unregisterParameter(const ParameterID& paramId);
    bool isParameterRegistered(const ParameterID& paramId) const;
    std::vector<ParameterID> getRegisteredParameters() const;

    // Automation curves
    AutomationCurve& getCurve(const ParameterID& paramId);
    const AutomationCurve& getCurve(const ParameterID& paramId) const;
    bool hasCurve(const ParameterID& paramId) const;
    void clearCurve(const ParameterID& paramId);
    void clearAllCurves();

    // Recording
    void recordParameterValue(const ParameterID& paramId, float value);
    void recordParameterValueAtTime(const ParameterID& paramId, float value, double timeBeats);

    // Playback
    float getAutomatedValue(const ParameterID& paramId) const;
    void setPlaybackCallback(ValueCallback callback);

    // Editing
    void addKeyframe(const ParameterID& paramId, double timeBeats, float value,
                     AutomationCurve::InterpolationType interp = AutomationCurve::InterpolationType::Linear);
    void removeKeyframe(const ParameterID& paramId, int index);
    void updateKeyframe(const ParameterID& paramId, int index, double timeBeats, float value);

    // Automation lanes
    void setParameterEnabled(const ParameterID& paramId, bool enabled);
    bool isParameterEnabled(const ParameterID& paramId) const;
    void setAllParametersEnabled(bool enabled);

    // Clear automation
    void clearRecording();
    void clearAll();

    // Export/Import
    juce::ValueTree exportToValueTree() const;
    bool importFromValueTree(const juce::ValueTree& tree);

    // Quantization
    void setQuantizeResolution(double beats);
    double getQuantizeResolution() const { return quantizeResolution; }

    // Undo support
    using UndoFunction = std::function<void()>;
    void setUndoManager(juce::UndoManager* manager) { undoManager = manager; }

private:
    struct ParameterState
    {
        AutomationCurve curve;
        float currentValue = 0.0f;
        float lastRecordedValue = 0.0f;
        bool enabled = true;
        bool hasChanged = false;
    };

    std::unordered_map<ParameterID, ParameterState> parameters;
    std::atomic<State> state{State::Idle};
    
    double currentTimeBeats = 0.0;
    double sampleRate = 44100.0;
    double bpm = 120.0;
    double samplesPerBeat = 44100.0;
    int64_t sampleCount = 0;
    
    double quantizeResolution = 0.0; // 0 = no quantization
    ValueCallback playbackCallback;
    juce::UndoManager* undoManager = nullptr;

    ParameterState& getOrCreateParameter(const ParameterID& paramId);
    double quantizeTime(double timeBeats) const;
    void updatePlaybackValues();
    void notifyParameterValue(const ParameterID& paramId, float value);
};