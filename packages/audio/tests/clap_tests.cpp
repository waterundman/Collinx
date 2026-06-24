#include <juce_audio_processors/juce_audio_processors.h>
#include "../src/clap/ClapPluginFormat.h"
#include "../src/clap/ClapPluginScanner.h"
#include "../src/clap/ClapPluginLoader.h"
#include "../src/clap/ClapNoteExpression.h"
#include "../src/clap/ClapParamModulation.h"

/**
 * Simple test runner for CLAP integration.
 * Mirrors the VST3 test structure for consistency.
 */

class ClapTestRunner
{
public:
    static int runAll(int& passed, int& failed)
    {
        std::cout << std::endl;
        std::cout << "=== CLAP Integration Tests ===" << std::endl;

        // ── ClapPluginFormat tests ────────────────────────────────────

        runTest("ClapPluginFormat Name", [&]() {
            ClapPluginFormat format;
            return format.getName() == "CLAP";
        }, passed, failed);

        runTest("ClapPluginFormat CanScanForPlugins", [&]() {
            ClapPluginFormat format;
            return format.canScanForPlugins();
        }, passed, failed);

        runTest("ClapPluginFormat FileMightContain clap", [&]() {
            ClapPluginFormat format;
            return format.fileMightContainThisPluginType("test.clap");
        }, passed, failed);

        runTest("ClapPluginFormat FileMightContain non-clap", [&]() {
            ClapPluginFormat format;
            return !format.fileMightContainThisPluginType("test.vst3");
        }, passed, failed);

        runTest("ClapPluginFormat DefaultLocations Not Empty", [&]() {
            ClapPluginFormat format;
            auto paths = format.getDefaultLocationsToSearch();
            return !paths.isEmpty();
        }, passed, failed);

        // ── ClapPluginScanner tests ───────────────────────────────────

        runTest("ClapPluginScanner Default Paths Not Empty", [&]() {
            auto paths = ClapPluginScanner::getDefaultScanPaths();
            return !paths.empty();
        }, passed, failed);

        runTest("ClapPluginScanner IsClapPlugin true", [&]() {
            juce::File testFile("test.clap");
            return ClapPluginScanner::isClapPlugin(testFile);
        }, passed, failed);

        runTest("ClapPluginScanner IsClapPlugin false", [&]() {
            juce::File testFile("test.dll");
            return !ClapPluginScanner::isClapPlugin(testFile);
        }, passed, failed);

        runTest("ClapPluginScanner Initialization", [&]() {
            ClapPluginScanner scanner;
            juce::AudioPluginFormatManager manager;
            manager.addDefaultFormats();
            ClapPluginFormat clapFormat;
            manager.addFormat(&clapFormat);
            return scanner.initialize(&manager);
        }, passed, failed);

        runTest("ClapPluginScanner Null Check", [&]() {
            ClapPluginScanner scanner;
            return !scanner.initialize(nullptr);
        }, passed, failed);

        runTest("ClapPluginScanner Cache Clear", [&]() {
            ClapPluginScanner scanner;
            scanner.clearCache();
            return scanner.getCachedResults().empty();
        }, passed, failed);

        runTest("ClapPluginScanner ClapPath Directories", [&]() {
            // CLAP_PATH may or may not be set; just verify no crash
            auto dirs = ClapPluginScanner::getClapPathDirectories();
            return true;
        }, passed, failed);

        // ── ClapPluginLoader tests ────────────────────────────────────

        runTest("ClapPluginLoader Initialization", [&]() {
            ClapPluginLoader loader;
            juce::AudioPluginFormatManager manager;
            manager.addDefaultFormats();
            ClapPluginFormat clapFormat;
            manager.addFormat(&clapFormat);
            return loader.initialize(&manager);
        }, passed, failed);

        runTest("ClapPluginLoader Null Check", [&]() {
            ClapPluginLoader loader;
            return !loader.initialize(nullptr);
        }, passed, failed);

        runTest("ClapPluginLoader Empty After Construction", [&]() {
            ClapPluginLoader loader;
            return loader.getNumPlugins() == 0;
        }, passed, failed);

        runTest("ClapPluginLoader Unload Invalid Index", [&]() {
            ClapPluginLoader loader;
            loader.unloadPlugin(-1);
            loader.unloadPlugin(999);
            return loader.getNumPlugins() == 0;
        }, passed, failed);

        runTest("ClapPluginLoader GetPlugin Invalid", [&]() {
            ClapPluginLoader loader;
            return loader.getPlugin(-1) == nullptr
                && loader.getPlugin(0) == nullptr
                && loader.getPlugin(999) == nullptr;
        }, passed, failed);

        runTest("ClapPluginLoader Activate Invalid Index", [&]() {
            ClapPluginLoader loader;
            loader.activatePlugin(-1);
            return true; // No crash = pass
        }, passed, failed);

        runTest("ClapPluginLoader Deactivate Invalid Index", [&]() {
            ClapPluginLoader loader;
            loader.deactivatePlugin(-1);
            return true; // No crash = pass
        }, passed, failed);

        // ── ClapNoteExpression tests ───────────────────────────────────

        runTest("ClapNoteExpression Prepare/Release", [&]() {
            ClapNoteExpression expr;
            expr.prepare(44100.0);
            bool ok = expr.isPrepared();
            expr.release();
            return ok && !expr.isPrepared();
        }, passed, failed);

        runTest("ClapNoteExpression ProcessNoteExpression", [&]() {
            ClapNoteExpression expr;
            expr.prepare(44100.0);
            expr.processNoteExpression(1, 60,
                ClapNoteExpression::ExpressionId::Pressure, 0.75);
            auto* state = expr.getNoteExpression(1, 60);
            return state != nullptr
                && std::abs(state->get(ClapNoteExpression::ExpressionId::Pressure) - 0.75) < 0.001;
        }, passed, failed);

        runTest("ClapNoteExpression Multiple Expressions", [&]() {
            ClapNoteExpression expr;
            expr.prepare(44100.0);
            expr.processNoteExpression(1, 60, ClapNoteExpression::ExpressionId::Pressure, 0.5);
            expr.processNoteExpression(1, 60, ClapNoteExpression::ExpressionId::Tuning, 2.0);
            expr.processNoteExpression(1, 60, ClapNoteExpression::ExpressionId::Brightness, 0.8);
            auto* state = expr.getNoteExpression(1, 60);
            return state != nullptr
                && std::abs(state->get(ClapNoteExpression::ExpressionId::Tuning) - 2.0) < 0.001
                && std::abs(state->get(ClapNoteExpression::ExpressionId::Brightness) - 0.8) < 0.001;
        }, passed, failed);

        runTest("ClapNoteExpression Invalid Channel Rejected", [&]() {
            ClapNoteExpression expr;
            expr.prepare(44100.0);
            expr.processNoteExpression(0, 60, ClapNoteExpression::ExpressionId::Pressure, 1.0);
            expr.processNoteExpression(17, 60, ClapNoteExpression::ExpressionId::Pressure, 1.0);
            return expr.getNumActiveNotes() == 0;
        }, passed, failed);

        runTest("ClapNoteExpression Reset Clears Notes", [&]() {
            ClapNoteExpression expr;
            expr.prepare(44100.0);
            expr.processNoteExpression(1, 60, ClapNoteExpression::ExpressionId::Pressure, 0.5);
            expr.processNoteExpression(1, 62, ClapNoteExpression::ExpressionId::Pressure, 0.6);
            bool hadNotes = expr.getNumActiveNotes() == 2;
            expr.reset();
            return hadNotes && expr.getNumActiveNotes() == 0;
        }, passed, failed);

        runTest("ClapNoteExpression Callback Fires", [&]() {
            ClapNoteExpression expr;
            expr.prepare(44100.0);
            bool fired = false;
            expr.setCallback([&](int, int, ClapNoteExpression::ExpressionId, double) {
                fired = true;
            });
            expr.processNoteExpression(1, 60, ClapNoteExpression::ExpressionId::Pressure, 0.5);
            return fired;
        }, passed, failed);

        // ── MPE zone tests ─────────────────────────────────────────────

        runTest("ClapNoteExpression MPE Lower Zone", [&]() {
            ClapNoteExpression expr;
            expr.prepare(44100.0);
            expr.setMpeLowerZone(5);
            bool zoneActive = expr.getMpeZone(false).isActive;
            bool ch2Member = expr.isMpeMemberChannel(2);
            bool ch7Member = expr.isMpeMemberChannel(7);
            bool ch1Manager = expr.isMpeManagerChannel(1);
            return zoneActive && ch2Member && !ch7Member && ch1Manager;
        }, passed, failed);

        runTest("ClapNoteExpression MPE Upper Zone", [&]() {
            ClapNoteExpression expr;
            expr.prepare(44100.0);
            expr.setMpeUpperZone(7);
            bool zoneActive = expr.getMpeZone(true).isActive;
            bool ch9Member = expr.isMpeMemberChannel(9);
            bool ch16Manager = expr.isMpeManagerChannel(16);
            return zoneActive && ch9Member && ch16Manager;
        }, passed, failed);

        runTest("ClapNoteExpression MPE Active Detection", [&]() {
            ClapNoteExpression expr;
            expr.prepare(44100.0);
            bool beforeActive = expr.isMpeActive();
            expr.setMpeLowerZone(5);
            bool afterActive = expr.isMpeActive();
            return !beforeActive && afterActive;
        }, passed, failed);

        runTest("ClapNoteExpression Pitch Bend Range", [&]() {
            ClapNoteExpression expr;
            expr.prepare(44100.0);
            bool defaultRange = expr.getPitchBendRange() == 48;
            expr.setPitchBendRange(24);
            bool customRange = expr.getPitchBendRange() == 24;
            expr.setPitchBendRange(200);
            bool clamped = expr.getPitchBendRange() == 96;
            return defaultRange && customRange && clamped;
        }, passed, failed);

        // ── ClapParamModulation tests ──────────────────────────────────

        runTest("ClapParamModulation Prepare/Release", [&]() {
            ClapParamModulation mod;
            mod.prepare(44100.0);
            bool ok = mod.isPrepared();
            mod.release();
            return ok && !mod.isPrepared();
        }, passed, failed);

        runTest("ClapParamModulation Set/Get Depth", [&]() {
            ClapParamModulation mod;
            mod.prepare(44100.0);
            mod.setModulationDepth(1, ClapParamModulation::ModSource::Macro, 0, 0.5);
            double depth = mod.getModulationDepth(1, ClapParamModulation::ModSource::Macro, 0);
            return std::abs(depth - 0.5) < 0.001;
        }, passed, failed);

        runTest("ClapParamModulation Remove Modulation", [&]() {
            ClapParamModulation mod;
            mod.prepare(44100.0);
            mod.setModulationDepth(1, ClapParamModulation::ModSource::Macro, 0, 0.5);
            mod.removeModulation(1, ClapParamModulation::ModSource::Macro, 0);
            double depth = mod.getModulationDepth(1, ClapParamModulation::ModSource::Macro, 0);
            return std::abs(depth) < 0.001;
        }, passed, failed);

        runTest("ClapParamModulation Apply Modulation", [&]() {
            ClapParamModulation mod;
            mod.prepare(44100.0);
            mod.setModulationDepth(1, ClapParamModulation::ModSource::Macro, 0, 0.2);
            mod.setSourceValue(ClapParamModulation::ModSource::Macro, 0, 0.5);
            double result = mod.applyModulation(1, 0.5);
            // Expected: 0.5 + (0.5 * 0.2) = 0.6
            return std::abs(result - 0.6) < 0.001;
        }, passed, failed);

        runTest("ClapParamModulation Clamp Result", [&]() {
            ClapParamModulation mod;
            mod.prepare(44100.0);
            mod.setModulationDepth(1, ClapParamModulation::ModSource::Macro, 0, 1.0);
            mod.setSourceValue(ClapParamModulation::ModSource::Macro, 0, 1.0);
            double result = mod.applyModulation(1, 0.95);
            // 0.95 + 1.0 = 1.95, clamped to 1.0
            return std::abs(result - 1.0) < 0.001;
        }, passed, failed);

        runTest("ClapParamModulation Total Modulation", [&]() {
            ClapParamModulation mod;
            mod.prepare(44100.0);
            mod.setModulationDepth(1, ClapParamModulation::ModSource::Macro, 0, 0.3);
            mod.setModulationDepth(1, ClapParamModulation::ModSource::MpePressure, 0, 0.2);
            mod.setSourceValue(ClapParamModulation::ModSource::Macro, 0, 1.0);
            mod.setSourceValue(ClapParamModulation::ModSource::MpePressure, 0, 0.5);
            double total = mod.getTotalModulation(1);
            // (1.0 * 0.3) + (0.5 * 0.2) = 0.4
            return std::abs(total - 0.4) < 0.001;
        }, passed, failed);

        runTest("ClapParamModulation Matrix AddRoute", [&]() {
            ClapParamModulation mod;
            mod.prepare(44100.0);
            ClapParamModulation::ModRoute route;
            route.source = ClapParamModulation::ModSource::Lfo;
            route.sourceIndex = 0;
            route.paramId = 10;
            route.depth = 0.5;
            mod.addRoute(route);
            return mod.getNumRoutes() == 1 && mod.getNumModulations() == 1;
        }, passed, failed);

        runTest("ClapParamModulation Matrix RemoveRoute", [&]() {
            ClapParamModulation mod;
            mod.prepare(44100.0);
            ClapParamModulation::ModRoute route;
            route.source = ClapParamModulation::ModSource::Lfo;
            route.sourceIndex = 0;
            route.paramId = 10;
            route.depth = 0.5;
            mod.addRoute(route);
            mod.removeRoute(ClapParamModulation::ModSource::Lfo, 0, 10);
            return mod.getNumRoutes() == 0;
        }, passed, failed);

        runTest("ClapParamModulation Matrix GetRoutesForParam", [&]() {
            ClapParamModulation mod;
            mod.prepare(44100.0);
            ClapParamModulation::ModRoute r1, r2;
            r1.source = ClapParamModulation::ModSource::Lfo;
            r1.sourceIndex = 0;
            r1.paramId = 10;
            r1.depth = 0.3;
            r2.source = ClapParamModulation::ModSource::Envelope;
            r2.sourceIndex = 0;
            r2.paramId = 10;
            r2.depth = 0.7;
            mod.addRoute(r1);
            mod.addRoute(r2);
            auto routes = mod.getRoutesForParam(10);
            return routes.size() == 2;
        }, passed, failed);

        runTest("ClapParamModulation ClearAll", [&]() {
            ClapParamModulation mod;
            mod.prepare(44100.0);
            mod.setModulationDepth(1, ClapParamModulation::ModSource::Macro, 0, 0.5);
            mod.setModulationDepth(2, ClapParamModulation::ModSource::Lfo, 0, 0.3);
            mod.clearAllModulations();
            return mod.getNumModulations() == 0 && mod.getNumRoutes() == 0;
        }, passed, failed);

        runTest("ClapParamModulation NumMacros", [&]() {
            ClapParamModulation mod;
            mod.prepare(44100.0);
            mod.setNumMacros(4);
            // Verify macros work by setting source values
            mod.setSourceValue(ClapParamModulation::ModSource::Macro, 0, 0.5);
            mod.setSourceValue(ClapParamModulation::ModSource::Macro, 3, 0.8);
            double v0 = mod.getSourceValue(ClapParamModulation::ModSource::Macro, 0);
            double v3 = mod.getSourceValue(ClapParamModulation::ModSource::Macro, 3);
            return std::abs(v0 - 0.5) < 0.001 && std::abs(v3 - 0.8) < 0.001;
        }, passed, failed);

        runTest("ClapParamModulation Callback Fires", [&]() {
            ClapParamModulation mod;
            mod.prepare(44100.0);
            bool fired = false;
            mod.setCallback([&](uint32_t, double) { fired = true; });
            mod.setModulationDepth(1, ClapParamModulation::ModSource::Macro, 0, 0.5);
            mod.setSourceValue(ClapParamModulation::ModSource::Macro, 0, 1.0);
            mod.applyModulation(1, 0.5);
            return fired;
        }, passed, failed);

        return 0;
    }

private:
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
