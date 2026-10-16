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

        // v2.8.0：原为 engine->requestAudioFocus() —— AudioEngine 没有这个方法，
        // JUCE 也不存在该 API（它是移动端的"音频焦点"概念），说明这段代码从未
        // 被编译过。AudioAppComponent 的正确开启方式是 setAudioChannels(输出, 输入)。
        engine->setAudioChannels(2, 2);

        // v2.8.0：录音权限是移动端概念；桌面端不存在该 API 的实际意义，
        // 且在部分 JUCE 版本的桌面配置下不可用，故加平台保护。
#if JUCE_IOS || JUCE_ANDROID
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
#endif
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
