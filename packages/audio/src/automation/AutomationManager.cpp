#include "AutomationManager.h"

AutomationManager::AutomationManager() = default;
AutomationManager::~AutomationManager() = default;

void AutomationManager::prepare(double sampleRate, double bpm)
{
    this->sampleRate = sampleRate;
    this->bpm = bpm;
    samplesPerBeat = sampleRate * 60.0 / bpm;
    sampleCount = 0;
}

void AutomationManager::startRecording()
{
    state.store(State::Recording);
    for (auto& [id, param] : parameters)
    {
        param.lastRecordedValue = param.currentValue;
        param.hasChanged = false;
    }
}

void AutomationManager::startPlayback()
{
    state.store(State::Playing);
    updatePlaybackValues();
}

void AutomationManager::startOverdubbing()
{
    state.store(State::Overdubbing);
    for (auto& [id, param] : parameters)
    {
        param.lastRecordedValue = param.currentValue;
        param.hasChanged = false;
    }
}

void AutomationManager::stop()
{
    state.store(State::Idle);
}

void AutomationManager::setCurrentTimeBeats(double timeBeats)
{
    currentTimeBeats = timeBeats;
    sampleCount = static_cast<int64_t>(timeBeats * samplesPerBeat);
    
    if (state == State::Playing || state == State::Overdubbing)
        updatePlaybackValues();
}

void AutomationManager::processBlock(int numSamples)
{
    if (state == State::Idle)
        return;

    // Update current time
    double beatsProcessed = static_cast<double>(numSamples) / samplesPerBeat;
    
    if (state == State::Playing || state == State::Overdubbing)
    {
        // Process in small steps for smooth automation
        const double stepSizeBeats = 1.0 / 100.0; // 100 steps per beat
        double remaining = beatsProcessed;
        
        while (remaining > 0.0)
        {
            double step = std::min(remaining, stepSizeBeats);
            currentTimeBeats += step;
            updatePlaybackValues();
            remaining -= step;
        }
    }
    else if (state == State::Recording)
    {
        currentTimeBeats += beatsProcessed;
    }

    sampleCount += numSamples;
}

void AutomationManager::registerParameter(const ParameterID& paramId, float defaultValue)
{
    auto& param = parameters[paramId];
    param.currentValue = defaultValue;
    param.lastRecordedValue = defaultValue;
    param.enabled = true;
}

void AutomationManager::unregisterParameter(const ParameterID& paramId)
{
    parameters.erase(paramId);
}

bool AutomationManager::isParameterRegistered(const ParameterID& paramId) const
{
    return parameters.find(paramId) != parameters.end();
}

std::vector<AutomationManager::ParameterID> AutomationManager::getRegisteredParameters() const
{
    std::vector<ParameterID> result;
    result.reserve(parameters.size());
    for (const auto& [id, _] : parameters)
        result.push_back(id);
    return result;
}

AutomationCurve& AutomationManager::getCurve(const ParameterID& paramId)
{
    return getOrCreateParameter(paramId).curve;
}

const AutomationCurve& AutomationManager::getCurve(const ParameterID& paramId) const
{
    static const AutomationCurve empty;
    auto it = parameters.find(paramId);
    if (it != parameters.end())
        return it->second.curve;
    return empty;
}

bool AutomationManager::hasCurve(const ParameterID& paramId) const
{
    auto it = parameters.find(paramId);
    return it != parameters.end() && !it->second.curve.isEmpty();
}

void AutomationManager::clearCurve(const ParameterID& paramId)
{
    auto it = parameters.find(paramId);
    if (it != parameters.end())
        it->second.curve.clear();
}

void AutomationManager::clearAllCurves()
{
    for (auto& [id, param] : parameters)
        param.curve.clear();
}

void AutomationManager::recordParameterValue(const ParameterID& paramId, float value)
{
    if (state != State::Recording && state != State::Overdubbing)
        return;

    auto& param = getOrCreateParameter(paramId);
    if (!param.enabled)
        return;

    param.currentValue = value;

    // Only record if value has changed significantly
    if (std::abs(value - param.lastRecordedValue) > 0.001f)
    {
        double quantizedTime = quantizeTime(currentTimeBeats);
        param.curve.addKeyframe(quantizedTime, value);
        param.lastRecordedValue = value;
        param.hasChanged = true;
    }
}

void AutomationManager::recordParameterValueAtTime(const ParameterID& paramId, float value, double timeBeats)
{
    if (state != State::Recording && state != State::Overdubbing)
        return;

    auto& param = getOrCreateParameter(paramId);
    if (!param.enabled)
        return;

    double quantizedTime = quantizeTime(timeBeats);
    param.curve.addKeyframe(quantizedTime, value);
    param.currentValue = value;
    param.lastRecordedValue = value;
    param.hasChanged = true;
}

float AutomationManager::getAutomatedValue(const ParameterID& paramId) const
{
    auto it = parameters.find(paramId);
    if (it == parameters.end())
        return 0.0f;

    const auto& param = it->second;
    
    if (state == State::Playing || state == State::Overdubbing)
    {
        if (!param.curve.isEmpty() && param.enabled)
            return param.curve.getValueAtTime(currentTimeBeats);
    }

    return param.currentValue;
}

void AutomationManager::setPlaybackCallback(ValueCallback callback)
{
    playbackCallback = std::move(callback);
}

void AutomationManager::addKeyframe(const ParameterID& paramId, double timeBeats, float value,
                                     AutomationCurve::InterpolationType interp)
{
    auto& param = getOrCreateParameter(paramId);
    param.curve.addKeyframe(timeBeats, value, interp);
}

void AutomationManager::removeKeyframe(const ParameterID& paramId, int index)
{
    auto it = parameters.find(paramId);
    if (it != parameters.end())
        it->second.curve.removeKeyframe(index);
}

void AutomationManager::updateKeyframe(const ParameterID& paramId, int index, double timeBeats, float value)
{
    auto it = parameters.find(paramId);
    if (it != parameters.end())
        it->second.curve.updateKeyframe(index, timeBeats, value);
}

void AutomationManager::setParameterEnabled(const ParameterID& paramId, bool enabled)
{
    auto& param = getOrCreateParameter(paramId);
    param.enabled = enabled;
}

bool AutomationManager::isParameterEnabled(const ParameterID& paramId) const
{
    auto it = parameters.find(paramId);
    if (it != parameters.end())
        return it->second.enabled;
    return false;
}

void AutomationManager::setAllParametersEnabled(bool enabled)
{
    for (auto& [id, param] : parameters)
        param.enabled = enabled;
}

void AutomationManager::clearRecording()
{
    for (auto& [id, param] : parameters)
    {
        param.curve.clear();
        param.hasChanged = false;
    }
}

void AutomationManager::clearAll()
{
    parameters.clear();
    currentTimeBeats = 0.0;
    sampleCount = 0;
}

juce::ValueTree AutomationManager::exportToValueTree() const
{
    juce::ValueTree tree("AutomationManager");
    tree.setProperty("currentTime", currentTimeBeats, nullptr);
    tree.setProperty("quantizeResolution", quantizeResolution, nullptr);

    for (const auto& [id, param] : parameters)
    {
        juce::ValueTree paramTree("Parameter");
        paramTree.setProperty("id", id, nullptr);
        paramTree.setProperty("enabled", param.enabled, nullptr);
        paramTree.setProperty("defaultValue", param.currentValue, nullptr);
        
        auto curveTree = param.curve.exportToValueTree("Curve");
        paramTree.appendChild(curveTree, nullptr);
        
        tree.appendChild(paramTree, nullptr);
    }

    return tree;
}

bool AutomationManager::importFromValueTree(const juce::ValueTree& tree)
{
    if (!tree.isValid() || !tree.hasType("AutomationManager"))
        return false;

    parameters.clear();
    currentTimeBeats = tree.getProperty("currentTime", 0.0);
    quantizeResolution = tree.getProperty("quantizeResolution", 0.0);

    for (int i = 0; i < tree.getNumChildren(); ++i)
    {
        auto paramTree = tree.getChild(i);
        if (paramTree.hasType("Parameter"))
        {
            ParameterID id = paramTree.getProperty("id", "");
            auto& param = parameters[id];
            param.enabled = paramTree.getProperty("enabled", true);
            param.currentValue = static_cast<float>(paramTree.getProperty("defaultValue", 0.0));
            param.lastRecordedValue = param.currentValue;

            auto curveTree = paramTree.getChildWithName("Curve");
            if (curveTree.isValid())
                param.curve.importFromValueTree(curveTree);
        }
    }

    return true;
}

void AutomationManager::setQuantizeResolution(double beats)
{
    quantizeResolution = beats;
}

AutomationManager::ParameterState& AutomationManager::getOrCreateParameter(const ParameterID& paramId)
{
    auto it = parameters.find(paramId);
    if (it == parameters.end())
    {
        registerParameter(paramId);
        return parameters[paramId];
    }
    return it->second;
}

double AutomationManager::quantizeTime(double timeBeats) const
{
    if (quantizeResolution <= 0.0)
        return timeBeats;

    return std::round(timeBeats / quantizeResolution) * quantizeResolution;
}

void AutomationManager::updatePlaybackValues()
{
    for (auto& [id, param] : parameters)
    {
        if (param.enabled && !param.curve.isEmpty())
        {
            float newValue = param.curve.getValueAtTime(currentTimeBeats);
            if (std::abs(newValue - param.currentValue) > 0.0001f)
            {
                param.currentValue = newValue;
                notifyParameterValue(id, newValue);
            }
        }
    }
}

void AutomationManager::notifyParameterValue(const ParameterID& paramId, float value)
{
    if (playbackCallback)
        playbackCallback(paramId, value);
}