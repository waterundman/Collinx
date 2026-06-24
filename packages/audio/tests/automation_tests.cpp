#include <juce_audio_basics/juce_audio_basics.h>
#include "../src/automation/AutomationCurve.h"
#include "../src/automation/AutomationManager.h"

/**
 * Simple test runner for automation system.
 * Tests AutomationCurve and AutomationManager functionality.
 */

class AutomationTestRunner
{
public:
    static int runAll(int& passed, int& failed)
    {
        std::cout << std::endl;
        std::cout << "=== Automation Tests ===" << std::endl;

        // ── AutomationCurve tests ─────────────────────────────────────

        runTest("AutomationCurve Creation", [&]() {
            AutomationCurve curve;
            return curve.isEmpty() && curve.getNumKeyframes() == 0;
        }, passed, failed);

        runTest("AutomationCurve Add Keyframe", [&]() {
            AutomationCurve curve;
            int index = curve.addKeyframe(0.0, 0.5f);
            return index == 0 && curve.getNumKeyframes() == 1;
        }, passed, failed);

        runTest("AutomationCurve Multiple Keyframes", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(0.0, 0.0f);
            curve.addKeyframe(1.0, 0.5f);
            curve.addKeyframe(2.0, 1.0f);
            return curve.getNumKeyframes() == 3;
        }, passed, failed);

        runTest("AutomationCurve Keyframe Ordering", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(2.0, 1.0f);
            curve.addKeyframe(0.0, 0.0f);
            curve.addKeyframe(1.0, 0.5f);
            curve.sortKeyframes();
            auto& kf0 = curve.getKeyframe(0);
            auto& kf2 = curve.getKeyframe(2);
            return kf0.timeBeats == 0.0 && kf2.timeBeats == 2.0;
        }, passed, failed);

        runTest("AutomationCurve Linear Interpolation", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(0.0, 0.0f, AutomationCurve::InterpolationType::Linear);
            curve.addKeyframe(1.0, 1.0f, AutomationCurve::InterpolationType::Linear);
            float value = curve.getValueAtTime(0.5);
            return std::abs(value - 0.5f) < 0.001f;
        }, passed, failed);

        runTest("AutomationCurve Step Interpolation", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(0.0, 0.0f, AutomationCurve::InterpolationType::None);
            curve.addKeyframe(1.0, 1.0f, AutomationCurve::InterpolationType::None);
            float value = curve.getValueAtTime(0.5);
            return std::abs(value - 0.0f) < 0.001f;
        }, passed, failed);

        runTest("AutomationCurve Before First Keyframe", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(1.0, 0.5f);
            float value = curve.getValueAtTime(0.0);
            return std::abs(value - 0.5f) < 0.001f;
        }, passed, failed);

        runTest("AutomationCurve After Last Keyframe", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(1.0, 0.5f);
            float value = curve.getValueAtTime(2.0);
            return std::abs(value - 0.5f) < 0.001f;
        }, passed, failed);

        runTest("AutomationCurve Remove Keyframe", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(0.0, 0.0f);
            curve.addKeyframe(1.0, 1.0f);
            curve.removeKeyframe(0);
            return curve.getNumKeyframes() == 1;
        }, passed, failed);

        runTest("AutomationCurve Update Keyframe", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(0.0, 0.0f);
            curve.updateKeyframe(0, 0.5, 0.75f);
            auto& kf = curve.getKeyframe(0);
            return std::abs(kf.timeBeats - 0.5) < 0.001 && std::abs(kf.value - 0.75f) < 0.001f;
        }, passed, failed);

        runTest("AutomationCurve Find Keyframe At", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(0.0, 0.0f);
            curve.addKeyframe(1.0, 0.5f);
            curve.addKeyframe(2.0, 1.0f);
            int index = curve.findKeyframeAt(1.0);
            return index == 1;
        }, passed, failed);

        runTest("AutomationCurve Keyframes In Range", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(0.0, 0.0f);
            curve.addKeyframe(0.5, 0.25f);
            curve.addKeyframe(1.0, 0.5f);
            curve.addKeyframe(1.5, 0.75f);
            curve.addKeyframe(2.0, 1.0f);
            auto indices = curve.getKeyframesInRange(0.5, 1.5);
            return indices.size() == 3;
        }, passed, failed);

        runTest("AutomationCurve Time Range", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(1.0, 0.0f);
            curve.addKeyframe(3.0, 1.0f);
            return std::abs(curve.getStartTime() - 1.0) < 0.001 &&
                   std::abs(curve.getEndTime() - 3.0) < 0.001 &&
                   std::abs(curve.getDuration() - 2.0) < 0.001;
        }, passed, failed);

        runTest("AutomationCurve Export/Import", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(0.0, 0.0f);
            curve.addKeyframe(1.0, 0.5f);
            curve.addKeyframe(2.0, 1.0f);

            auto data = curve.exportToMemory();
            AutomationCurve imported;
            bool success = imported.importFromMemory(data);

            return success && imported.getNumKeyframes() == 3;
        }, passed, failed);

        runTest("AutomationCurve ValueTree Export/Import", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(0.0, 0.0f);
            curve.addKeyframe(1.0, 0.5f);

            auto tree = curve.exportToValueTree("TestCurve");
            AutomationCurve imported;
            bool success = imported.importFromValueTree(tree);

            return success && imported.getNumKeyframes() == 2;
        }, passed, failed);

        runTest("AutomationCurve Thin Keyframes", [&]() {
            AutomationCurve curve;
            curve.addKeyframe(0.0, 0.0f);
            curve.addKeyframe(0.1, 0.001f); // Nearly on the line
            curve.addKeyframe(0.2, 0.002f); // Nearly on the line
            curve.addKeyframe(1.0, 1.0f);
            curve.thinKeyframes(0.01f);
            return curve.getNumKeyframes() == 2; // Should remove middle keyframes
        }, passed, failed);

        // ── AutomationManager tests ───────────────────────────────────

        runTest("AutomationManager Creation", [&]() {
            AutomationManager manager;
            return manager.getState() == AutomationManager::State::Idle;
        }, passed, failed);

        runTest("AutomationManager Prepare", [&]() {
            AutomationManager manager;
            manager.prepare(44100.0, 120.0);
            return manager.getCurrentTimeBeats() == 0.0;
        }, passed, failed);

        runTest("AutomationManager Register Parameter", [&]() {
            AutomationManager manager;
            manager.registerParameter("volume", 0.5f);
            return manager.isParameterRegistered("volume");
        }, passed, failed);

        runTest("AutomationManager Unregister Parameter", [&]() {
            AutomationManager manager;
            manager.registerParameter("volume");
            manager.unregisterParameter("volume");
            return !manager.isParameterRegistered("volume");
        }, passed, failed);

        runTest("AutomationManager Get Registered Parameters", [&]() {
            AutomationManager manager;
            manager.registerParameter("volume");
            manager.registerParameter("pan");
            auto params = manager.getRegisteredParameters();
            return params.size() == 2;
        }, passed, failed);

        runTest("AutomationManager Recording", [&]() {
            AutomationManager manager;
            manager.prepare(44100.0, 120.0);
            manager.registerParameter("volume");
            manager.startRecording();
            return manager.isRecording();
        }, passed, failed);

        runTest("AutomationManager Playback", [&]() {
            AutomationManager manager;
            manager.prepare(44100.0, 120.0);
            manager.startPlayback();
            return manager.isPlaying();
        }, passed, failed);

        runTest("AutomationManager Stop", [&]() {
            AutomationManager manager;
            manager.prepare(44100.0, 120.0);
            manager.startRecording();
            manager.stop();
            return manager.getState() == AutomationManager::State::Idle;
        }, passed, failed);

        runTest("AutomationManager Record Parameter", [&]() {
            AutomationManager manager;
            manager.prepare(44100.0, 120.0);
            manager.registerParameter("volume");
            manager.startRecording();
            manager.setCurrentTimeBeats(0.0);
            manager.recordParameterValue("volume", 0.5f);
            manager.setCurrentTimeBeats(1.0);
            manager.recordParameterValue("volume", 1.0f);
            return manager.getCurve("volume").getNumKeyframes() == 2;
        }, passed, failed);

        runTest("AutomationManager Playback Value", [&]() {
            AutomationManager manager;
            manager.prepare(44100.0, 120.0);
            manager.registerParameter("volume");
            manager.addKeyframe("volume", 0.0, 0.0f);
            manager.addKeyframe("volume", 1.0, 1.0f);
            manager.startPlayback();
            manager.setCurrentTimeBeats(0.5);
            float value = manager.getAutomatedValue("volume");
            return std::abs(value - 0.5f) < 0.001f;
        }, passed, failed);

        runTest("AutomationManager Parameter Enable/Disable", [&]() {
            AutomationManager manager;
            manager.registerParameter("volume");
            manager.setParameterEnabled("volume", false);
            return !manager.isParameterEnabled("volume");
        }, passed, failed);

        runTest("AutomationManager Clear Recording", [&]() {
            AutomationManager manager;
            manager.prepare(44100.0, 120.0);
            manager.registerParameter("volume");
            manager.startRecording();
            manager.recordParameterValueAtTime("volume", 0.5f, 0.0);
            manager.recordParameterValueAtTime("volume", 1.0f, 1.0);
            manager.clearRecording();
            return manager.getCurve("volume").isEmpty();
        }, passed, failed);

        runTest("AutomationManager Quantization", [&]() {
            AutomationManager manager;
            manager.setQuantizeResolution(0.25);
            return std::abs(manager.getQuantizeResolution() - 0.25) < 0.001;
        }, passed, failed);

        runTest("AutomationManager Playback Callback", [&]() {
            AutomationManager manager;
            manager.prepare(44100.0, 120.0);
            manager.registerParameter("volume");
            manager.addKeyframe("volume", 0.0, 0.0f);
            manager.addKeyframe("volume", 1.0, 1.0f);

            bool callbackCalled = false;
            manager.setPlaybackCallback([&](const juce::String& paramId, float value) {
                callbackCalled = true;
            });

            manager.startPlayback();
            manager.setCurrentTimeBeats(0.5);
            return callbackCalled;
        }, passed, failed);

        runTest("AutomationManager Export/Import", [&]() {
            AutomationManager manager;
            manager.prepare(44100.0, 120.0);
            manager.registerParameter("volume");
            manager.addKeyframe("volume", 0.0, 0.0f);
            manager.addKeyframe("volume", 1.0, 1.0f);

            auto tree = manager.exportToValueTree();
            AutomationManager imported;
            bool success = imported.importFromValueTree(tree);

            return success && imported.isParameterRegistered("volume") &&
                   imported.getCurve("volume").getNumKeyframes() == 2;
        }, passed, failed);

        runTest("AutomationManager Overdubbing", [&]() {
            AutomationManager manager;
            manager.prepare(44100.0, 120.0);
            manager.registerParameter("volume");
            manager.addKeyframe("volume", 0.0, 0.0f);
            manager.startOverdubbing();
            return manager.isOverdubbing();
        }, passed, failed);

        runTest("AutomationManager Process Block", [&]() {
            AutomationManager manager;
            manager.prepare(44100.0, 120.0);
            manager.registerParameter("volume");
            manager.addKeyframe("volume", 0.0, 0.0f);
            manager.addKeyframe("volume", 1.0, 1.0f);
            manager.startPlayback();
            manager.processBlock(512);
            return manager.getCurrentTimeBeats() > 0.0;
        }, passed, failed);

        return passed + failed;
    }

private:
    static void runTest(const std::string& testName, std::function<bool()> testFunc, int& passed, int& failed)
    {
        try
        {
            bool result = testFunc();
            if (result)
            {
                std::cout << "  ✓ " << testName << std::endl;
                passed++;
            }
            else
            {
                std::cout << "  ✗ " << testName << std::endl;
                failed++;
            }
        }
        catch (const std::exception& e)
        {
            std::cout << "  ✗ " << testName << " (Exception: " << e.what() << ")" << std::endl;
            failed++;
        }
        catch (...)
        {
            std::cout << "  ✗ " << testName << " (Unknown exception)" << std::endl;
            failed++;
        }
    }
};

int main()
{
    int passed = 0;
    int failed = 0;

    AutomationTestRunner::runAll(passed, failed);

    std::cout << std::endl;
    std::cout << "=== Results ===" << std::endl;
    std::cout << "Passed: " << passed << std::endl;
    std::cout << "Failed: " << failed << std::endl;
    std::cout << "Total:  " << (passed + failed) << std::endl;

    return failed > 0 ? 1 : 0;
}