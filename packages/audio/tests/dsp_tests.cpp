#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>
#include "../src/dsp/ParallelProcessor.h"
#include "../src/dsp/LatencyCompensator.h"

/**
 * Test processor for ParallelProcessor tests.
 */
class TestProcessor : public ParallelProcessor::Processor
{
public:
    explicit TestProcessor(juce::String name, int latency = 0, float gain = 1.0f)
        : processorName(std::move(name)), processorLatency(latency), gainFactor(gain) {}

    void prepare(double /*sampleRate*/, int /*samplesPerBlock*/, int /*numChannels*/) override {}
    void release() override {}

    void process(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& /*midi*/) override
    {
        buffer.applyGain(gainFactor);
        processCount++;
    }

    juce::String getName() const override { return processorName; }
    int getLatency() const override { return processorLatency; }

    int getProcessCount() const { return processCount; }

private:
    juce::String processorName;
    int processorLatency;
    float gainFactor;
    int processCount = 0;
};

/**
 * DSP test runner for ParallelProcessor and LatencyCompensator.
 */
class DspTestRunner
{
public:
    static int runAll(int& passed, int& failed)
    {
        std::cout << std::endl;
        std::cout << "=== DSP Tests (ParallelProcessor & LatencyCompensator) ===" << std::endl;

        runParallelProcessorTests(passed, failed);
        runLatencyCompensatorTests(passed, failed);

        return 0;
    }

private:
    static void runParallelProcessorTests(int& passed, int& failed)
    {
        std::cout << std::endl << "--- ParallelProcessor Tests ---" << std::endl;

        runTest("ParallelProcessor Initial State", [&]() {
            ParallelProcessor pp;
            return pp.getNumProcessors() == 0
                && pp.getProcessingMode() == ParallelProcessor::ProcessingMode::Parallel;
        }, passed, failed);

        runTest("ParallelProcessor Add Processor", [&]() {
            ParallelProcessor pp;
            auto proc = std::make_unique<TestProcessor>("Test1");
            int index = pp.addProcessor(std::move(proc));
            return index == 0 && pp.getNumProcessors() == 1;
        }, passed, failed);

        runTest("ParallelProcessor Add Multiple Processors", [&]() {
            ParallelProcessor pp;
            pp.addProcessor(std::make_unique<TestProcessor>("Test1"));
            pp.addProcessor(std::make_unique<TestProcessor>("Test2"));
            pp.addProcessor(std::make_unique<TestProcessor>("Test3"));
            return pp.getNumProcessors() == 3;
        }, passed, failed);

        runTest("ParallelProcessor Remove Processor", [&]() {
            ParallelProcessor pp;
            pp.addProcessor(std::make_unique<TestProcessor>("Test1"));
            pp.addProcessor(std::make_unique<TestProcessor>("Test2"));
            pp.removeProcessor(0);
            return pp.getNumProcessors() == 1;
        }, passed, failed);

        runTest("ParallelProcessor Remove Invalid Index", [&]() {
            ParallelProcessor pp;
            pp.addProcessor(std::make_unique<TestProcessor>("Test1"));
            pp.removeProcessor(-1);
            pp.removeProcessor(999);
            return pp.getNumProcessors() == 1;
        }, passed, failed);

        runTest("ParallelProcessor Get Processor", [&]() {
            ParallelProcessor pp;
            pp.addProcessor(std::make_unique<TestProcessor>("MyProcessor"));
            auto* proc = pp.getProcessor(0);
            return proc != nullptr && proc->getName() == "MyProcessor";
        }, passed, failed);

        runTest("ParallelProcessor Get Processor Invalid", [&]() {
            ParallelProcessor pp;
            return pp.getProcessor(-1) == nullptr && pp.getProcessor(0) == nullptr;
        }, passed, failed);

        runTest("ParallelProcessor Set Processing Mode", [&]() {
            ParallelProcessor pp;
            pp.setProcessingMode(ParallelProcessor::ProcessingMode::Sequential);
            return pp.getProcessingMode() == ParallelProcessor::ProcessingMode::Sequential;
        }, passed, failed);

        runTest("ParallelProcessor Set Num Threads", [&]() {
            ParallelProcessor pp;
            pp.setNumThreads(4);
            return pp.getNumThreads() == 4;
        }, passed, failed);

        runTest("ParallelProcessor Load Balancing", [&]() {
            ParallelProcessor pp;
            pp.setLoadBalancingEnabled(true);
            return pp.isLoadBalancingEnabled();
            pp.setLoadBalancingEnabled(false);
            return !pp.isLoadBalancingEnabled();
        }, passed, failed);

        runTest("ParallelProcessor Total Latency", [&]() {
            ParallelProcessor pp;
            pp.addProcessor(std::make_unique<TestProcessor>("Test1", 100));
            pp.addProcessor(std::make_unique<TestProcessor>("Test2", 200));
            return pp.getTotalLatency() == 300;
        }, passed, failed);

        runTest("ParallelProcessor Prepare", [&]() {
            ParallelProcessor pp;
            pp.addProcessor(std::make_unique<TestProcessor>("Test1"));
            pp.prepare(44100.0, 512, 2);
            return true; // No crash = pass
        }, passed, failed);

        runTest("ParallelProcessor Process Sequential", [&]() {
            ParallelProcessor pp;
            auto* proc1 = new TestProcessor("Test1", 0, 0.5f);
            auto* proc2 = new TestProcessor("Test2", 0, 0.5f);
            pp.addProcessor(std::unique_ptr<Processor>(proc1));
            pp.addProcessor(std::unique_ptr<Processor>(proc2));
            pp.setProcessingMode(ParallelProcessor::ProcessingMode::Sequential);
            pp.prepare(44100.0, 512, 2);

            std::vector<juce::AudioBuffer<float>> buffers;
            buffers.emplace_back(2, 512);
            buffers.emplace_back(2, 512);
            for (auto& buf : buffers)
            {
                for (int ch = 0; ch < 2; ++ch)
                    buf.clear(ch, 0, 512);
            }

            juce::MidiBuffer midi;
            pp.process(buffers, midi);

            return proc1->getProcessCount() == 1 && proc2->getProcessCount() == 1;
        }, passed, failed);

        runTest("ParallelProcessor Process Parallel", [&]() {
            ParallelProcessor pp;
            auto* proc1 = new TestProcessor("Test1", 0, 0.5f);
            auto* proc2 = new TestProcessor("Test2", 0, 0.5f);
            pp.addProcessor(std::unique_ptr<Processor>(proc1));
            pp.addProcessor(std::unique_ptr<Processor>(proc2));
            pp.setProcessingMode(ParallelProcessor::ProcessingMode::Parallel);
            pp.prepare(44100.0, 512, 2);

            std::vector<juce::AudioBuffer<float>> buffers;
            buffers.emplace_back(2, 512);
            buffers.emplace_back(2, 512);
            for (auto& buf : buffers)
            {
                for (int ch = 0; ch < 2; ++ch)
                    buf.clear(ch, 0, 512);
            }

            juce::MidiBuffer midi;
            pp.process(buffers, midi);

            return proc1->getProcessCount() == 1 && proc2->getProcessCount() == 1;
        }, passed, failed);

        runTest("ParallelProcessor ProcessSummed", [&]() {
            ParallelProcessor pp;
            pp.addProcessor(std::make_unique<TestProcessor>("Test1", 0, 0.5f));
            pp.addProcessor(std::make_unique<TestProcessor>("Test2", 0, 0.5f));
            pp.prepare(44100.0, 512, 2);

            juce::AudioBuffer<float> buffer(2, 512);
            for (int ch = 0; ch < 2; ++ch)
                buffer.clear(ch, 0, 512);

            juce::MidiBuffer midi;
            pp.processSummed(buffer, midi);

            return true; // No crash = pass
        }, passed, failed);

        runTest("ParallelProcessor Release", [&]() {
            ParallelProcessor pp;
            pp.addProcessor(std::make_unique<TestProcessor>("Test1"));
            pp.prepare(44100.0, 512, 2);
            pp.release();
            return true; // No crash = pass
        }, passed, failed);
    }

    static void runLatencyCompensatorTests(int& passed, int& failed)
    {
        std::cout << std::endl << "--- LatencyCompensator Tests ---" << std::endl;

        runTest("LatencyCompensator Initial State", [&]() {
            LatencyCompensator lc;
            return lc.getMaxLatency() == 0
                && lc.getNumLatencySources() == 0
                && !lc.isIntroducingDelay();
        }, passed, failed);

        runTest("LatencyCompensator Report Latency", [&]() {
            LatencyCompensator lc;
            lc.reportLatency(1, 512, "Plugin1");
            return lc.getMaxLatency() == 512
                && lc.getNumLatencySources() == 1;
        }, passed, failed);

        runTest("LatencyCompensator Multiple Reports", [&]() {
            LatencyCompensator lc;
            lc.reportLatency(1, 512, "Plugin1");
            lc.reportLatency(2, 1024, "Plugin2");
            lc.reportLatency(3, 256, "Plugin3");
            return lc.getMaxLatency() == 1024
                && lc.getNumLatencySources() == 3;
        }, passed, failed);

        runTest("LatencyCompensator Update Report", [&]() {
            LatencyCompensator lc;
            lc.reportLatency(1, 512, "Plugin1");
            lc.reportLatency(1, 1024, "Plugin1");
            return lc.getMaxLatency() == 1024
                && lc.getNumLatencySources() == 1;
        }, passed, failed);

        runTest("LatencyCompensator Remove Report", [&]() {
            LatencyCompensator lc;
            lc.reportLatency(1, 512, "Plugin1");
            lc.reportLatency(2, 1024, "Plugin2");
            lc.removeLatencyReport(1);
            return lc.getMaxLatency() == 1024
                && lc.getNumLatencySources() == 1;
        }, passed, failed);

        runTest("LatencyCompensator Remove Non-existent", [&]() {
            LatencyCompensator lc;
            lc.reportLatency(1, 512, "Plugin1");
            lc.removeLatencyReport(999);
            return lc.getNumLatencySources() == 1;
        }, passed, failed);

        runTest("LatencyCompensator Clear Reports", [&]() {
            LatencyCompensator lc;
            lc.reportLatency(1, 512, "Plugin1");
            lc.reportLatency(2, 1024, "Plugin2");
            lc.clearLatencyReports();
            return lc.getMaxLatency() == 0
                && lc.getNumLatencySources() == 0;
        }, passed, failed);

        runTest("LatencyCompensator Get Latency For Source", [&]() {
            LatencyCompensator lc;
            lc.reportLatency(1, 512, "Plugin1");
            lc.reportLatency(2, 1024, "Plugin2");
            return lc.getLatencyForSource(1) == 512
                && lc.getLatencyForSource(2) == 1024
                && lc.getLatencyForSource(999) == 0;
        }, passed, failed);

        runTest("LatencyCompensator Get All Latency Info", [&]() {
            LatencyCompensator lc;
            lc.reportLatency(1, 512, "Plugin1");
            lc.reportLatency(2, 1024, "Plugin2");
            auto info = lc.getAllLatencyInfo();
            return info.size() == 2;
        }, passed, failed);

        runTest("LatencyCompensator Auto Detect", [&]() {
            LatencyCompensator lc;
            lc.setAutoDetectEnabled(true);
            return lc.isAutoDetectEnabled();
            lc.setAutoDetectEnabled(false);
            return !lc.isAutoDetectEnabled();
        }, passed, failed);

        runTest("LatencyCompensator Delay Mode", [&]() {
            LatencyCompensator lc;
            lc.setDelayCompensationMode(true);
            return lc.isDelayCompensationMode();
            lc.setDelayCompensationMode(false);
            return !lc.isDelayCompensationMode();
        }, passed, failed);

        runTest("LatencyCompensator Max Compensatable", [&]() {
            LatencyCompensator lc;
            lc.setMaxCompensatableLatency(204800);
            return lc.getMaxCompensatableLatency() == 204800;
        }, passed, failed);

        runTest("LatencyCompensator Prepare", [&]() {
            LatencyCompensator lc;
            lc.prepare(44100.0, 512, 2);
            return true; // No crash = pass
        }, passed, failed);

        runTest("LatencyCompensator Compensation Active", [&]() {
            LatencyCompensator lc;
            lc.prepare(44100.0, 512, 2);
            lc.reportLatency(1, 512, "Plugin1");
            lc.reportLatency(2, 1024, "Plugin2");
            return lc.isIntroducingDelay();
        }, passed, failed);

        runTest("LatencyCompensator Process", [&]() {
            LatencyCompensator lc;
            lc.prepare(44100.0, 512, 2);
            lc.reportLatency(1, 512, "Plugin1");
            lc.reportLatency(2, 1024, "Plugin2");

            juce::AudioBuffer<float> buffer(2, 512);
            for (int ch = 0; ch < 2; ++ch)
                buffer.clear(ch, 0, 512);

            lc.process(buffer, 0);
            return true; // No crash = pass
        }, passed, failed);

        runTest("LatencyCompensator Process Parallel", [&]() {
            LatencyCompensator lc;
            lc.prepare(44100.0, 512, 2);
            lc.reportLatency(1, 512, "Plugin1");

            std::vector<juce::AudioBuffer<float>> buffers;
            buffers.emplace_back(2, 512);
            buffers.emplace_back(2, 512);
            for (auto& buf : buffers)
            {
                for (int ch = 0; ch < 2; ++ch)
                    buf.clear(ch, 0, 512);
            }

            lc.processParallel(buffers);
            return true; // No crash = pass
        }, passed, failed);

        runTest("LatencyCompensator Get Total Latency", [&]() {
            LatencyCompensator lc;
            lc.reportLatency(1, 512, "Plugin1");
            lc.reportLatency(2, 1024, "Plugin2");
            return lc.getTotalLatency() == 1024;
        }, passed, failed);

        runTest("LatencyCompensator Callback", [&]() {
            LatencyCompensator lc;
            int callbackLatency = 0;
            lc.setLatencyChangeCallback([&](int newMax) {
                callbackLatency = newMax;
            });
            lc.reportLatency(1, 512, "Plugin1");
            return callbackLatency == 512;
        }, passed, failed);

        runTest("LatencyCompensator Release", [&]() {
            LatencyCompensator lc;
            lc.prepare(44100.0, 512, 2);
            lc.reportLatency(1, 512, "Plugin1");
            lc.release();
            return true; // No crash = pass
        }, passed, failed);
    }

    static void runTest(const juce::String& testName,
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
