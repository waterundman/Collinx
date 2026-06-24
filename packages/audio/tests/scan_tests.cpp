#include <cassert>
#include <iostream>
#include <string>
#include <vector>
#include <chrono>
#include <thread>

// Minimal test harness (no external framework dependency)
#define TEST(name) static void name(); \
    struct name##_reg { name##_reg() { tests.push_back({#name, name}); } } name##_inst; \
    static void name()

struct TestEntry { const char* name; void (*fn)(); };
static std::vector<TestEntry> tests;

// ============================================================
// ScanProgressReporter tests (header-only, no JUCE dependency for logic)
// ============================================================
#include "scan/ScanProgressReporter.h"

TEST(test_progress_reporter_begin_end)
{
    ScanProgressReporter reporter;
    assert(!reporter.isActive());

    reporter.beginScan(10);
    assert(reporter.isActive());

    auto info = reporter.getCurrentInfo();
    assert(info.totalFiles == 10);
    assert(info.filesScanned == 0);
    assert(!info.isComplete);

    reporter.endScan();
    assert(!reporter.isActive());

    info = reporter.getCurrentInfo();
    assert(info.isComplete);
    assert(info.percentComplete == 100.0f);
}

TEST(test_progress_reporter_report_file)
{
    ScanProgressReporter reporter;
    reporter.beginScan(4);

    reporter.reportFile("a.vst3", 1);
    auto info = reporter.getCurrentInfo();
    assert(info.filesScanned == 1);
    assert(info.currentFile == "a.vst3");
    assert(info.percentComplete > 0.0f);

    reporter.reportFile("b.clap", 2);
    info = reporter.getCurrentInfo();
    assert(info.filesScanned == 2);
    assert(info.currentFile == "b.clap");

    reporter.endScan();
}

TEST(test_progress_reporter_callback)
{
    ScanProgressReporter reporter;
    int callbackCount = 0;

    reporter.setOnProgress([&callbackCount](const ScanProgressReporter::ProgressInfo&) {
        callbackCount++;
    });

    reporter.beginScan(2);
    // Force immediate callback by disabling throttle
    reporter.setThrottleInterval(std::chrono::milliseconds{0});
    reporter.reportFile("a.vst3", 1);
    reporter.reportFile("b.vst3", 2);
    reporter.endScan();

    // At least begin->report->report->end should fire
    assert(callbackCount >= 2);
}

TEST(test_progress_reporter_file_callbacks)
{
    ScanProgressReporter reporter;
    std::string startedFile;
    std::string completedFile;

    reporter.setOnFileStart([&startedFile](const std::string& f) { startedFile = f; });
    reporter.setOnFileComplete([&completedFile](const std::string& f) { completedFile = f; });

    reporter.beginScan(1);
    reporter.reportFile("test.vst3", 1);
    reporter.reportFileComplete("test.vst3", true);
    reporter.endScan();

    assert(startedFile == "test.vst3");
    assert(completedFile == "test.vst3");
}

TEST(test_progress_reporter_reset)
{
    ScanProgressReporter reporter;
    reporter.beginScan(5);
    reporter.reportFile("a.vst3", 1);
    reporter.reset();

    assert(!reporter.isActive());
    auto info = reporter.getCurrentInfo();
    assert(info.totalFiles == 0);
    assert(info.filesScanned == 0);
}

TEST(test_progress_reporter_eta_estimation)
{
    ScanProgressReporter reporter;
    reporter.setThrottleInterval(std::chrono::milliseconds{0});
    reporter.beginScan(100);

    reporter.reportFile("a.vst3", 50);
    auto info = reporter.getCurrentInfo();
    // ETA should be non-negative after scanning half the files
    assert(info.estimatedTimeRemaining.count() >= 0);

    reporter.endScan();
}

TEST(test_progress_reporter_throttle)
{
    ScanProgressReporter reporter;
    int count = 0;
    reporter.setOnProgress([&count](const ScanProgressReporter::ProgressInfo&) { count++; });
    reporter.setThrottleInterval(std::chrono::milliseconds{500}); // long throttle
    reporter.beginScan(10);

    // Rapid-fire reports should be throttled
    for (int i = 1; i <= 10; ++i)
        reporter.reportFile("file" + std::to_string(i), i);

    // With 500ms throttle, most calls should be suppressed
    // Only the first and possibly one more should fire
    assert(count <= 3);

    reporter.endScan();
}

// ============================================================
// ScanCache tests (logic-level, requires JUCE but we test structure)
// ============================================================
// Note: Full ScanCache tests require JUCE runtime (AudioPluginFormatManager).
// These tests verify the ScanProgressReporter which is self-contained.

// ============================================================
// Main
// ============================================================
int main()
{
    int passed = 0;
    int failed = 0;

    for (auto& t : tests)
    {
        std::cout << "Running: " << t.name << " ... ";
        try
        {
            t.fn();
            std::cout << "PASS" << std::endl;
            ++passed;
        }
        catch (const std::exception& e)
        {
            std::cout << "FAIL: " << e.what() << std::endl;
            ++failed;
        }
        catch (...)
        {
            std::cout << "FAIL (unknown)" << std::endl;
            ++failed;
        }
    }

    std::cout << "\n=== Results: " << passed << " passed, "
              << failed << " failed, "
              << tests.size() << " total ===" << std::endl;

    return failed > 0 ? 1 : 0;
}
