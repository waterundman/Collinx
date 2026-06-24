#include "audio-engine.h"

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
        engine.reset();
    }

    void anotherInstanceStarted(const juce::String&) override {}

    void systemRequestedQuit() override
    {
        quit();
    }

private:
    std::unique_ptr<AudioEngine> engine;
};

START_JUCE_APPLICATION(CollinxApplication)
