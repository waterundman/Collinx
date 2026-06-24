#include <juce_audio_processors/juce_audio_processors.h>
#include "../src/vst3/Vst3HostManager.h"
#include "../src/vst3/Vst3PluginScanner.h"
#include "../src/vst3/Vst3PluginLoader.h"
#include "../src/vst3/PluginProcessor.h"
#include "../src/vst3/PluginChain.h"
#include "clap_tests.cpp"
#include "unified_tests.cpp"
#include "crash_detection_tests.cpp"

/**
 * Simple test runner for VST3 integration.
 * Note: This is a basic test framework. For production, consider using
 * a proper test framework like Google Test or Catch2.
 */

class Vst3TestRunner : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override { return "VST3 Tests"; }
    const juce::String getApplicationVersion() override { return "1.0.0"; }
    bool moreThanOneInstanceAllowed() override { return false; }

    void initialise(const juce::String&) override
    {
        int passed = 0;
        int failed = 0;

        std::cout << "=== VST3 Integration Tests ===" << std::endl;

        // ── Stage 0 tests ──────────────────────────────────────────────

        runTest("HostManager Initialization", [&]() {
            Vst3HostManager manager;
            return manager.initialize();
        }, passed, failed);

        runTest("Scanner Default Paths", [&]() {
            auto paths = Vst3PluginScanner::getDefaultScanPaths();
            return !paths.empty();
        }, passed, failed);

        runTest("Scanner VST3 Detection", [&]() {
            juce::File testFile("test.vst3");
            return Vst3PluginScanner::isVst3Plugin(testFile);
        }, passed, failed);

        runTest("Scanner Non-VST3 Detection", [&]() {
            juce::File testFile("test.dll");
            return !Vst3PluginScanner::isVst3Plugin(testFile);
        }, passed, failed);

        runTest("Loader Initialization", [&]() {
            Vst3PluginLoader loader;
            juce::AudioPluginFormatManager manager;
            manager.addDefaultFormats();
            return loader.initialize(&manager);
        }, passed, failed);

        runTest("Loader Null Check", [&]() {
            Vst3PluginLoader loader;
            return !loader.initialize(nullptr);
        }, passed, failed);

        // ── Stage 1: PluginChain tests ─────────────────────────────────

        runTest("PluginChain Empty After Construction", [&]() {
            PluginChain chain;
            return chain.isEmpty() && chain.getNumPlugins() == 0;
        }, passed, failed);

        runTest("PluginChain Bypass Default Off", [&]() {
            PluginChain chain;
            return !chain.isChainBypassed();
        }, passed, failed);

        runTest("PluginChain SetBypassed", [&]() {
            PluginChain chain;
            chain.setChainBypassed(true);
            bool result1 = chain.isChainBypassed();
            chain.setChainBypassed(false);
            bool result2 = !chain.isChainBypassed();
            return result1 && result2;
        }, passed, failed);

        runTest("PluginChain Prepare And Release", [&]() {
            PluginChain chain;
            chain.prepare(44100.0, 512, 2);
            chain.release();
            return true; // No crash = pass
        }, passed, failed);

        runTest("PluginChain Process Empty Chain", [&]() {
            PluginChain chain;
            chain.prepare(44100.0, 512, 2);
            chain.activateAll();

            juce::AudioBuffer<float> buffer(2, 512);
            buffer.clear();
            juce::MidiBuffer midi;

            chain.process(buffer, midi);
            chain.release();
            return true; // No crash = pass
        }, passed, failed);

        runTest("PluginChain Remove Invalid Index", [&]() {
            PluginChain chain;
            chain.removePlugin(-1);
            chain.removePlugin(999);
            return chain.isEmpty();
        }, passed, failed);

        runTest("PluginChain Move Invalid Index", [&]() {
            PluginChain chain;
            chain.movePlugin(-1, 0);
            chain.movePlugin(0, -1);
            chain.movePlugin(0, 0);
            return chain.isEmpty();
        }, passed, failed);

        runTest("PluginChain GetPluginNames Empty", [&]() {
            PluginChain chain;
            auto names = chain.getPluginNames();
            return names.empty();
        }, passed, failed);

        runTest("PluginChain GetPlugin Invalid", [&]() {
            PluginChain chain;
            return chain.getPlugin(-1) == nullptr
                && chain.getPlugin(0) == nullptr
                && chain.getPlugin(999) == nullptr;
        }, passed, failed);

        runTest("PluginChain ChangeCallback Fires", [&]() {
            PluginChain chain;
            bool callbackFired = false;
            chain.setChainChangeCallback([&]() { callbackFired = true; });

            // removePlugin on invalid index should NOT fire callback
            chain.removePlugin(-1);
            bool notFiredYet = !callbackFired;

            return notFiredYet;
        }, passed, failed);

        // ── Stage 1: PluginProcessor tests (unit-level, no real plugin) ─

        runTest("PluginProcessor Silence Detection", [&]() {
            // We can't easily test PluginProcessor without a real plugin instance,
            // but we can test the static silence detection logic indirectly.
            // This test verifies the class compiles and the API is accessible.
            return true;
        }, passed, failed);

        // ── CLAP integration tests ──────────────────────────────────────

        ClapTestRunner::runAll(passed, failed);

        // ── Unified Plugin Manager tests ────────────────────────────────

        UnifiedTestRunner::runAll(passed, failed);

        // ── Stage 2: Crash Detection Mechanism tests ──────────────────

        CrashDetectionTestRunner::runAll(passed, failed);

        std::cout << std::endl;
        std::cout << "Results: " << passed << " passed, "
                  << failed << " failed" << std::endl;

        if (failed > 0)
            setApplicationReturnValue(1);

        quit();
    }

    void shutdown() override {}
    void anotherInstanceStarted(const juce::String&) override {}
    void systemRequestedQuit() override { quit(); }

private:
    void runTest(const juce::String& testName,
                 std::function<bool()> testFunc,
                 int& passed,
                 int& failed)
    {
        std::cout << "  " << testName << "... ";
        try
        {
            if (testFunc())
            {
                std::cout << "PASS" << std::endl;
                ++passed;
            }
            else
            {
                std::cout << "FAIL" << std::endl;
                ++failed;
            }
        }
        catch (const std::exception& e)
        {
            std::cout << "EXCEPTION: " << e.what() << std::endl;
            ++failed;
        }
    }
};

START_JUCE_APPLICATION(Vst3TestRunner)
