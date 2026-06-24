#include <juce_audio_basics/juce_audio_basics.h>
#include "../src/midi/MidiEffectProcessor.h"
#include "../src/midi/MidiEffectChain.h"
#include "../src/midi/MidiRouter.h"

/**
 * Simple test runner for MIDI effect chain integration.
 * Tests MIDI effect processing, chaining, and routing.
 */

class MidiTestRunner
{
public:
    static int runAll(int& passed, int& failed)
    {
        std::cout << std::endl;
        std::cout << "=== MIDI Effect Chain Tests ===" << std::endl;

        // ── MidiEffectProcessor tests ──────────────────────────────────

        runTest("MidiEffectProcessor Creation", [&]() {
            MidiEffectProcessor processor;
            return processor.getId() >= 0;
        }, passed, failed);

        runTest("MidiEffectProcessor Lifecycle", [&]() {
            MidiEffectProcessor processor;
            processor.prepare(44100.0, 512);
            bool prepared = processor.isPrepared();
            processor.activate();
            bool active = processor.isActive();
            processor.deactivate();
            bool deactivated = !processor.isActive();
            processor.release();
            bool released = !processor.isPrepared();
            return prepared && active && deactivated && released;
        }, passed, failed);

        runTest("MidiEffectProcessor Bypass", [&]() {
            MidiEffectProcessor processor;
            processor.setBypassed(true);
            bool bypassed = processor.isBypassed();
            processor.setBypassed(false);
            bool notBypassed = !processor.isBypassed();
            return bypassed && notBypassed;
        }, passed, failed);

        runTest("MidiEffectProcessor MIDI Channel Filter", [&]() {
            MidiEffectProcessor processor;
            processor.setMidiChannel(5);
            return processor.getMidiChannel() == 5;
        }, passed, failed);

        // ── MidiEffectChain tests ──────────────────────────────────────

        runTest("MidiEffectChain Creation", [&]() {
            MidiEffectChain chain;
            return chain.isEmpty();
        }, passed, failed);

        runTest("MidiEffectChain Add Effect", [&]() {
            MidiEffectChain chain;
            auto effect = std::make_unique<MidiEffectProcessor>();
            int index = chain.addEffect(std::move(effect));
            return index == 0 && chain.getNumEffects() == 1;
        }, passed, failed);

        runTest("MidiEffectChain Remove Effect", [&]() {
            MidiEffectChain chain;
            auto effect = std::make_unique<MidiEffectProcessor>();
            chain.addEffect(std::move(effect));
            chain.removeEffect(0);
            return chain.isEmpty();
        }, passed, failed);

        runTest("MidiEffectChain Move Effect", [&]() {
            MidiEffectChain chain;
            auto effect1 = std::make_unique<MidiEffectProcessor>();
            auto effect2 = std::make_unique<MidiEffectProcessor>();
            chain.addEffect(std::move(effect1));
            chain.addEffect(std::move(effect2));
            chain.moveEffect(0, 1);
            return chain.getNumEffects() == 2;
        }, passed, failed);

        runTest("MidiEffectChain Bypass", [&]() {
            MidiEffectChain chain;
            chain.setChainBypassed(true);
            bool bypassed = chain.isChainBypassed();
            chain.setChainBypassed(false);
            bool notBypassed = !chain.isChainBypassed();
            return bypassed && notBypassed;
        }, passed, failed);

        runTest("MidiEffectChain Processing", [&]() {
            MidiEffectChain chain;
            chain.prepare(44100.0, 512);
            chain.activateAll();

            juce::MidiBuffer midiMessages;
            midiMessages.addEvent(juce::MidiMessage::noteOn(1, 60, (juce::uint8)100), 0);
            midiMessages.addEvent(juce::MidiMessage::noteOff(1, 60, (juce::uint8)0), 100);

            chain.process(midiMessages, 512);

            // Should pass through unchanged (no effects added)
            return midiMessages.getNumEvents() == 2;
        }, passed, failed);

        // ── MidiRouter tests ───────────────────────────────────────────

        runTest("MidiRouter Creation", [&]() {
            MidiRouter router;
            return router.getNumOutputs() == 0;
        }, passed, failed);

        runTest("MidiRouter Channel Mapping", [&]() {
            MidiRouter router;
            router.setChannelMapping(1, 5);
            return router.getChannelMapping(1) == 5;
        }, passed, failed);

        runTest("MidiRouter Controller Mapping", [&]() {
            MidiRouter router;
            router.mapController(1, 7, 0);
            return router.getMappedController(1, 1) == 7;
        }, passed, failed);

        runTest("MidiRouter Add Output", [&]() {
            MidiRouter router;
            router.addOutput(1);
            return router.getNumOutputs() == 1;
        }, passed, failed);

        runTest("MidiRouter Remove Output", [&]() {
            MidiRouter router;
            router.addOutput(1);
            router.removeOutput(1);
            return router.getNumOutputs() == 0;
        }, passed, failed);

        runTest("MidiRouter Processing", [&]() {
            MidiRouter router;
            router.prepare(44100.0, 512);

            juce::MidiBuffer inputMessages;
            inputMessages.addEvent(juce::MidiMessage::noteOn(1, 60, (juce::uint8)100), 0);

            juce::MidiBuffer outputMessages;
            router.process(inputMessages, outputMessages, 512);

            return outputMessages.getNumEvents() == 1;
        }, passed, failed);

        runTest("MidiRouter Channel Mapping Processing", [&]() {
            MidiRouter router;
            router.prepare(44100.0, 512);
            router.setChannelMapping(1, 5);

            juce::MidiBuffer inputMessages;
            inputMessages.addEvent(juce::MidiMessage::noteOn(1, 60, (juce::uint8)100), 0);

            juce::MidiBuffer outputMessages;
            router.process(inputMessages, outputMessages, 512);

            // Check that the output message is on channel 5
            for (const auto metadata : outputMessages)
            {
                const auto& message = metadata.getMessage();
                return message.getChannel() == 5;
            }
            return false;
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

    MidiTestRunner::runAll(passed, failed);

    std::cout << std::endl;
    std::cout << "=== Results ===" << std::endl;
    std::cout << "Passed: " << passed << std::endl;
    std::cout << "Failed: " << failed << std::endl;
    std::cout << "Total:  " << (passed + failed) << std::endl;

    return failed > 0 ? 1 : 0;
}