#include <juce_audio_processors/juce_audio_processors.h>
#include "../src/plugins/PluginFormatRegistry.h"
#include "../src/plugins/UnifiedPluginManager.h"
#include "../src/vst3/Vst3HostManager.h"

/**
 * Simple test runner for Unified Plugin Manager integration.
 * Tests format registry and unified manager functionality.
 */

class UnifiedTestRunner
{
public:
    static int runAll(int& passed, int& failed)
    {
        std::cout << std::endl;
        std::cout << "=== Unified Plugin Manager Tests ===" << std::endl;

        // ── PluginFormatRegistry tests ──────────────────────────────────

        runTest("PluginFormatRegistry Initialization", [&]() {
            PluginFormatRegistry registry;
            return registry.initialize();
        }, passed, failed);

        runTest("PluginFormatRegistry IsInitialized", [&]() {
            PluginFormatRegistry registry;
            registry.initialize();
            return registry.isInitialized();
        }, passed, failed);

        runTest("PluginFormatRegistry Has Formats", [&]() {
            PluginFormatRegistry registry;
            registry.initialize();
            return registry.getNumFormats() > 0;
        }, passed, failed);

        runTest("PluginFormatRegistry Has VST3", [&]() {
            PluginFormatRegistry registry;
            registry.initialize();
            return registry.getFormat("VST3") != nullptr;
        }, passed, failed);

        runTest("PluginFormatRegistry Has CLAP", [&]() {
            PluginFormatRegistry registry;
            registry.initialize();
            return registry.getFormat("CLAP") != nullptr;
        }, passed, failed);

        runTest("PluginFormatRegistry Detect CLAP File", [&]() {
            PluginFormatRegistry registry;
            registry.initialize();
            return registry.isKnownPluginFormat("test.clap");
        }, passed, failed);

        runTest("PluginFormatRegistry Detect VST3 File", [&]() {
            PluginFormatRegistry registry;
            registry.initialize();
            return registry.isKnownPluginFormat("test.vst3");
        }, passed, failed);

        runTest("PluginFormatRegistry Unknown Format", [&]() {
            PluginFormatRegistry registry;
            registry.initialize();
            return !registry.isKnownPluginFormat("test.dll");
        }, passed, failed);

        runTest("PluginFormatRegistry Format Names", [&]() {
            PluginFormatRegistry registry;
            registry.initialize();
            auto names = registry.getRegisteredFormatNames();
            return names.contains("VST3") && names.contains("CLAP");
        }, passed, failed);

        runTest("PluginFormatRegistry Detect Format Name", [&]() {
            PluginFormatRegistry registry;
            registry.initialize();
            return registry.getFormatName("test.clap") == "CLAP";
        }, passed, failed);

        runTest("PluginFormatRegistry Shutdown", [&]() {
            PluginFormatRegistry registry;
            registry.initialize();
            registry.shutdown();
            return !registry.isInitialized();
        }, passed, failed);

        // ── UnifiedPluginManager tests ──────────────────────────────────

        runTest("UnifiedPluginManager Initialization", [&]() {
            UnifiedPluginManager manager;
            return manager.initialize();
        }, passed, failed);

        runTest("UnifiedPluginManager IsInitialized", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            return manager.isInitialized();
        }, passed, failed);

        runTest("UnifiedPluginManager Has Format Registry", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            return manager.getFormatRegistry().isInitialized();
        }, passed, failed);

        runTest("UnifiedPluginManager Empty After Construction", [&]() {
            UnifiedPluginManager manager;
            return manager.getNumPlugins() == 0;
        }, passed, failed);

        runTest("UnifiedPluginManager Unload Invalid Index", [&]() {
            UnifiedPluginManager manager;
            manager.unloadPlugin(-1);
            manager.unloadPlugin(999);
            return manager.getNumPlugins() == 0;
        }, passed, failed);

        runTest("UnifiedPluginManager GetPlugin Invalid", [&]() {
            UnifiedPluginManager manager;
            return manager.getPlugin(-1) == nullptr
                && manager.getPlugin(0) == nullptr
                && manager.getPlugin(999) == nullptr;
        }, passed, failed);

        runTest("UnifiedPluginManager Detect Format", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            return manager.detectFormatName("test.clap") == "CLAP";
        }, passed, failed);

        runTest("UnifiedPluginManager IsKnownPlugin", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            return manager.isKnownPlugin("test.clap") && manager.isKnownPlugin("test.vst3");
        }, passed, failed);

        runTest("UnifiedPluginManager Not Known Plugin", [&]() {
            UnifiedPluginManager manager;
            manager.initialize();
            return !manager.isKnownPlugin("test.dll");
        }, passed, failed);

        runTest("UnifiedPluginManager GetLoadedPluginNames Empty", [&]() {
            UnifiedPluginManager manager;
            return manager.getLoadedPluginNames().isEmpty();
        }, passed, failed);

        runTest("UnifiedPluginManager FindPluginByName Not Found", [&]() {
            UnifiedPluginManager manager;
            return manager.findPluginByName("NonExistent") == -1;
        }, passed, failed);

        runTest("UnifiedPluginManager Activate Invalid Index", [&]() {
            UnifiedPluginManager manager;
            manager.activatePlugin(-1);
            return true; // No crash = pass
        }, passed, failed);

        runTest("UnifiedPluginManager Deactivate Invalid Index", [&]() {
            UnifiedPluginManager manager;
            manager.deactivatePlugin(-1);
            return true; // No crash = pass
        }, passed, failed);

        runTest("UnifiedPluginManager Prepare Invalid Index", [&]() {
            UnifiedPluginManager manager;
            manager.preparePlugin(-1, 44100.0, 512);
            return true; // No crash = pass
        }, passed, failed);

        runTest("UnifiedPluginManager Release Invalid Index", [&]() {
            UnifiedPluginManager manager;
            manager.releasePlugin(-1);
            return true; // No crash = pass
        }, passed, failed);

        // ── Vst3HostManager Unified Integration tests ───────────────────

        runTest("Vst3HostManager UnifiedManager Initially Null", [&]() {
            Vst3HostManager host;
            return host.getUnifiedManager() == nullptr;
        }, passed, failed);

        runTest("Vst3HostManager SetUnifiedManager", [&]() {
            Vst3HostManager host;
            UnifiedPluginManager manager;
            host.setUnifiedManager(&manager);
            return host.getUnifiedManager() == &manager;
        }, passed, failed);

        runTest("Vst3HostManager HasUnifiedManager", [&]() {
            Vst3HostManager host;
            UnifiedPluginManager manager;
            host.setUnifiedManager(&manager);
            return host.hasUnifiedManager();
        }, passed, failed);

        runTest("Vst3HostManager ClearUnifiedManager", [&]() {
            Vst3HostManager host;
            UnifiedPluginManager manager;
            host.setUnifiedManager(&manager);
            host.setUnifiedManager(nullptr);
            return !host.hasUnifiedManager();
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
