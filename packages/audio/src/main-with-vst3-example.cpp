#include "audio-engine.h"
#include "vst3/Vst3HostManager.h"

class CollinxApplication : public juce::JUCEApplication
{
public:
    const juce::String getApplicationName() override
    {
        return "Collinx Audio Engine";
    }

    const juce::String getApplicationVersion() override
    {
        return "0.1.0";
    }

    bool moreThanOneInstanceAllowed() override
    {
        return true;
    }

    void initialise(const juce::String& commandLine) override
    {
        engine = std::make_unique<AudioEngine>();
        engine->requestAudioFocus();

        // Initialize VST3 host manager
        vst3Host = std::make_unique<Vst3HostManager>();
        if (!vst3Host->initialize())
        {
            DBG("Failed to initialize VST3 host");
        }

        if (!juce::RuntimePermissions::isGranted(
                juce::RuntimePermissions::recordAudio))
        {
            juce::RuntimePermissions::request(
                juce::RuntimePermissions::recordAudio,
                [this](bool granted)
                {
                    if (!granted)
                        DBG("MIDI input permission denied");
                });
        }
    }

    void shutdown() override
    {
        vst3Host.reset();
        engine.reset();
    }

    void anotherInstanceStarted(const juce::String&) override {}

    void systemRequestedQuit() override
    {
        quit();
    }

    /**
     * Example: Scan for VST3 plugins and load one.
     */
    void scanAndLoadPlugin()
    {
        if (vst3Host == nullptr)
            return;

        auto& scanner = vst3Host->getScanner();
        auto& loader = vst3Host->getLoader();

        // Scan default paths
        auto plugins = scanner.scanDefaultPaths();

        if (plugins.empty())
        {
            DBG("No VST3 plugins found");
            return;
        }

        // Load the first plugin found
        auto& plugin = plugins[0];
        DBG("Loading: " << plugin.name);

        int index = loader.loadPlugin(plugin,
                                       engine->getSampleRate(),
                                       engine->getBlockSize());

        if (index >= 0)
        {
            loader.preparePlugin(index,
                                 engine->getSampleRate(),
                                 engine->getBlockSize());
            loader.activatePlugin(index);
            DBG("Plugin loaded and activated");
        }
    }

private:
    std::unique_ptr<AudioEngine> engine;
    std::unique_ptr<Vst3HostManager> vst3Host;
};

START_JUCE_APPLICATION(CollinxApplication)
