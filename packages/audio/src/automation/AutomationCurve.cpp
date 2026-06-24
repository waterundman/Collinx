#include "AutomationCurve.h"

AutomationCurve::AutomationCurve() = default;
AutomationCurve::~AutomationCurve() = default;

void AutomationCurve::clear()
{
    keyframes.clear();
}

int AutomationCurve::addKeyframe(double timeBeats, float value, InterpolationType interp)
{
    value = clampValue(value);
    
    Keyframe kf;
    kf.timeBeats = timeBeats;
    kf.value = value;
    kf.interpolation = interp;

    auto it = std::lower_bound(keyframes.begin(), keyframes.end(), kf);
    int index = static_cast<int>(it - keyframes.begin());
    keyframes.insert(it, kf);

    return index;
}

void AutomationCurve::removeKeyframe(int index)
{
    if (index >= 0 && index < static_cast<int>(keyframes.size()))
        keyframes.erase(keyframes.begin() + index);
}

void AutomationCurve::removeKeyframesInRange(double startBeats, double endBeats)
{
    keyframes.erase(
        std::remove_if(keyframes.begin(), keyframes.end(),
            [startBeats, endBeats](const Keyframe& kf) {
                return kf.timeBeats >= startBeats && kf.timeBeats <= endBeats;
            }),
        keyframes.end()
    );
}

void AutomationCurve::updateKeyframe(int index, double timeBeats, float value)
{
    if (index < 0 || index >= static_cast<int>(keyframes.size()))
        return;

    value = clampValue(value);
    keyframes[index].timeBeats = timeBeats;
    keyframes[index].value = value;
    sortKeyframes();
}

void AutomationCurve::setKeyframeInterpolation(int index, InterpolationType interp)
{
    if (index >= 0 && index < static_cast<int>(keyframes.size()))
        keyframes[index].interpolation = interp;
}

void AutomationCurve::setKeyframeTension(int index, float tension)
{
    if (index >= 0 && index < static_cast<int>(keyframes.size()))
        keyframes[index].tension = juce::jlimit(-1.0f, 1.0f, tension);
}

const AutomationCurve::Keyframe& AutomationCurve::getKeyframe(int index) const
{
    static const Keyframe empty;
    if (index >= 0 && index < static_cast<int>(keyframes.size()))
        return keyframes[index];
    return empty;
}

int AutomationCurve::findKeyframeAt(double timeBeats, double tolerance) const
{
    for (int i = 0; i < static_cast<int>(keyframes.size()); ++i)
    {
        if (std::abs(keyframes[i].timeBeats - timeBeats) <= tolerance)
            return i;
    }
    return -1;
}

std::vector<int> AutomationCurve::getKeyframesInRange(double startBeats, double endBeats) const
{
    std::vector<int> result;
    for (int i = 0; i < static_cast<int>(keyframes.size()); ++i)
    {
        if (keyframes[i].timeBeats >= startBeats && keyframes[i].timeBeats <= endBeats)
            result.push_back(i);
    }
    return result;
}

float AutomationCurve::getValueAtTime(double timeBeats) const
{
    if (keyframes.empty())
        return 0.0f;

    if (keyframes.size() == 1)
        return keyframes[0].value;

    // Before first keyframe
    if (timeBeats <= keyframes.front().timeBeats)
        return keyframes.front().value;

    // After last keyframe
    if (timeBeats >= keyframes.back().timeBeats)
        return keyframes.back().value;

    // Find surrounding keyframes
    for (size_t i = 0; i < keyframes.size() - 1; ++i)
    {
        const auto& a = keyframes[i];
        const auto& b = keyframes[i + 1];

        if (timeBeats >= a.timeBeats && timeBeats <= b.timeBeats)
        {
            switch (a.interpolation)
            {
                case InterpolationType::None:
                    return interpolateNone(a, timeBeats);
                case InterpolationType::Linear:
                    return interpolateLinear(a, b, timeBeats);
                case InterpolationType::Cubic:
                    return interpolateCubic(a, b, timeBeats);
                default:
                    return interpolateLinear(a, b, timeBeats);
            }
        }
    }

    return keyframes.back().value;
}

bool AutomationCurve::hasKeyframesInRange(double startBeats, double endBeats) const
{
    for (const auto& kf : keyframes)
    {
        if (kf.timeBeats >= startBeats && kf.timeBeats <= endBeats)
            return true;
    }
    return false;
}

double AutomationCurve::getStartTime() const
{
    return keyframes.empty() ? 0.0 : keyframes.front().timeBeats;
}

double AutomationCurve::getEndTime() const
{
    return keyframes.empty() ? 0.0 : keyframes.back().timeBeats;
}

double AutomationCurve::getDuration() const
{
    return getEndTime() - getStartTime();
}

juce::MemoryBlock AutomationCurve::exportToMemory() const
{
    juce::MemoryOutputStream stream;
    stream.writeInt(static_cast<int>(keyframes.size()));
    
    for (const auto& kf : keyframes)
    {
        stream.writeDouble(kf.timeBeats);
        stream.writeFloat(kf.value);
        stream.writeInt(static_cast<int>(kf.interpolation));
        stream.writeFloat(kf.tension);
    }

    return stream.getMemoryBlock();
}

bool AutomationCurve::importFromMemory(const juce::MemoryBlock& data)
{
    juce::MemoryInputStream stream(data, false);
    
    auto numKeyframes = stream.readInt();
    if (numKeyframes < 0 || numKeyframes > 1000000)
        return false;

    keyframes.clear();
    keyframes.reserve(static_cast<size_t>(numKeyframes));

    for (int i = 0; i < numKeyframes; ++i)
    {
        Keyframe kf;
        kf.timeBeats = stream.readDouble();
        kf.value = stream.readFloat();
        kf.interpolation = static_cast<InterpolationType>(stream.readInt());
        kf.tension = stream.readFloat();
        keyframes.push_back(kf);
    }

    sortKeyframes();
    return true;
}

juce::ValueTree AutomationCurve::exportToValueTree(const juce::String& curveName) const
{
    juce::ValueTree tree(curveName);
    
    for (const auto& kf : keyframes)
    {
        juce::ValueTree kfTree("Keyframe");
        kfTree.setProperty("time", kf.timeBeats, nullptr);
        kfTree.setProperty("value", kf.value, nullptr);
        kfTree.setProperty("interpolation", static_cast<int>(kf.interpolation), nullptr);
        kfTree.setProperty("tension", kf.tension, nullptr);
        tree.appendChild(kfTree, nullptr);
    }

    return tree;
}

bool AutomationCurve::importFromValueTree(const juce::ValueTree& tree)
{
    if (!tree.isValid())
        return false;

    keyframes.clear();
    keyframes.reserve(static_cast<size_t>(tree.getNumChildren()));

    for (int i = 0; i < tree.getNumChildren(); ++i)
    {
        auto kfTree = tree.getChild(i);
        if (kfTree.hasType("Keyframe"))
        {
            Keyframe kf;
            kf.timeBeats = kfTree.getProperty("time", 0.0);
            kf.value = static_cast<float>(kfTree.getProperty("value", 0.0));
            kf.interpolation = static_cast<InterpolationType>(
                static_cast<int>(kfTree.getProperty("interpolation", 1)));
            kf.tension = static_cast<float>(kfTree.getProperty("tension", 0.0));
            keyframes.push_back(kf);
        }
    }

    sortKeyframes();
    return true;
}

void AutomationCurve::sortKeyframes()
{
    std::sort(keyframes.begin(), keyframes.end());
}

void AutomationCurve::thinKeyframes(float tolerance)
{
    if (keyframes.size() <= 2)
        return;

    std::vector<Keyframe> thinned;
    thinned.push_back(keyframes.front());

    for (size_t i = 1; i < keyframes.size() - 1; ++i)
    {
        const auto& prev = thinned.back();
        const auto& curr = keyframes[i];
        const auto& next = keyframes[i + 1];

        float interpolated = interpolateLinear(prev, next, curr.timeBeats);
        if (std::abs(curr.value - interpolated) > tolerance)
            thinned.push_back(curr);
    }

    thinned.push_back(keyframes.back());
    keyframes = std::move(thinned);
}

float AutomationCurve::interpolateLinear(const Keyframe& a, const Keyframe& b, double time) const
{
    double range = b.timeBeats - a.timeBeats;
    if (range <= 0.0)
        return a.value;

    double t = (time - a.timeBeats) / range;
    return static_cast<float>(a.value + t * (b.value - a.value));
}

float AutomationCurve::interpolateCubic(const Keyframe& a, const Keyframe& b, double time) const
{
    double range = b.timeBeats - a.timeBeats;
    if (range <= 0.0)
        return a.value;

    double t = (time - a.timeBeats) / range;
    double t2 = t * t;
    double t3 = t2 * t;

    // Hermite basis functions
    double h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    double h10 = t3 - 2.0 * t2 + t;
    double h01 = -2.0 * t3 + 3.0 * t2;
    double h11 = t3 - t2;

    // Tangents with tension
    double m0 = (1.0 - a.tension) * 0.5 * (b.value - a.value);
    double m1 = (1.0 - b.tension) * 0.5 * (b.value - a.value);

    double result = h00 * a.value + h10 * m0 * range + h01 * b.value + h11 * m1 * range;
    return clampValue(static_cast<float>(result));
}

float AutomationCurve::interpolateNone(const Keyframe& a, double /*time*/) const
{
    return a.value;
}

float AutomationCurve::clampValue(float value)
{
    return juce::jlimit(0.0f, 1.0f, value);
}