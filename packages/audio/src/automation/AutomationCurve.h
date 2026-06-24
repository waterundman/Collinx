#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <vector>
#include <algorithm>
#include <cmath>

class AutomationCurve
{
public:
    enum class InterpolationType
    {
        None,       // Step (hold value)
        Linear,     // Linear interpolation
        Cubic       // Cubic Hermite spline
    };

    struct Keyframe
    {
        double timeBeats = 0.0;    // Time in beats
        float value = 0.0f;        // Parameter value [0.0, 1.0]
        InterpolationType interpolation = InterpolationType::Linear;
        float tension = 0.0f;      // For cubic interpolation [-1.0, 1.0]

        bool operator<(const Keyframe& other) const
        {
            return timeBeats < other.timeBeats;
        }
    };

    AutomationCurve();
    ~AutomationCurve();

    void clear();

    // Keyframe management
    int addKeyframe(double timeBeats, float value, 
                    InterpolationType interp = InterpolationType::Linear);
    void removeKeyframe(int index);
    void removeKeyframesInRange(double startBeats, double endBeats);
    void updateKeyframe(int index, double timeBeats, float value);
    void setKeyframeInterpolation(int index, InterpolationType interp);
    void setKeyframeTension(int index, float tension);

    // Query
    int getNumKeyframes() const { return static_cast<int>(keyframes.size()); }
    const Keyframe& getKeyframe(int index) const;
    int findKeyframeAt(double timeBeats, double tolerance = 0.01) const;
    std::vector<int> getKeyframesInRange(double startBeats, double endBeats) const;

    // Interpolation
    float getValueAtTime(double timeBeats) const;
    bool isEmpty() const { return keyframes.empty(); }
    bool hasKeyframesInRange(double startBeats, double endBeats) const;

    // Time range
    double getStartTime() const;
    double getEndTime() const;
    double getDuration() const;

    // Export/Import
    juce::MemoryBlock exportToMemory() const;
    bool importFromMemory(const juce::MemoryBlock& data);
    juce::ValueTree exportToValueTree(const juce::String& curveName = "AutomationCurve") const;
    bool importFromValueTree(const juce::ValueTree& tree);

    // Utility
    void sortKeyframes();
    void thinKeyframes(float tolerance);

private:
    std::vector<Keyframe> keyframes;

    float interpolateLinear(const Keyframe& a, const Keyframe& b, double time) const;
    float interpolateCubic(const Keyframe& a, const Keyframe& b, double time) const;
    float interpolateNone(const Keyframe& a, double time) const;

    static float clampValue(float value);
};