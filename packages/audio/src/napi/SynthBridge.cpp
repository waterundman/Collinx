#include "SynthBridge.h"

namespace
{
    /** 拦截 Napi 抛出的异常（本项目编译时定义了 NAPI_DISABLE_CPP_EXCEPTIONS，
     *  不能用 throw）。统一在这里把「参数不合法」转成 JS 异常并返回 undefined。 */
    inline Napi::Value argError(Napi::Env env, const char* what)
    {
        Napi::TypeError::New(env, what).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    inline int clampMidi(double v)
    {
        const int note = static_cast<int>(v);
        return note < 0 ? 0 : (note > 127 ? 127 : note);
    }

    inline float clamp01(double v)
    {
        return v < 0.0 ? 0.0f : (v > 1.0 ? 1.0f : static_cast<float>(v));
    }
}

Napi::Object SynthBridge::Init(Napi::Env env, Napi::Object exports)
{
    Napi::Function func = DefineClass(env, "SynthBridge", {
        InstanceMethod("prepare", &SynthBridge::Prepare),
        InstanceMethod("isPrepared", &SynthBridge::IsPrepared),
        InstanceMethod("reset", &SynthBridge::Reset),

        InstanceMethod("noteOn", &SynthBridge::NoteOn),
        InstanceMethod("noteOff", &SynthBridge::NoteOff),
        InstanceMethod("allNotesOff", &SynthBridge::AllNotesOff),

        InstanceMethod("render", &SynthBridge::Render),

        InstanceMethod("setEngine", &SynthBridge::SetEngine),
        InstanceMethod("setVolume", &SynthBridge::SetVolume),
        InstanceMethod("getVolume", &SynthBridge::GetVolume),
        InstanceMethod("setWaveform", &SynthBridge::SetWaveform),

        InstanceMethod("setTempo", &SynthBridge::SetTempo),
        InstanceMethod("setTimeSignature", &SynthBridge::SetTimeSignature),
        InstanceMethod("play", &SynthBridge::Play),
        InstanceMethod("pause", &SynthBridge::Pause),
        InstanceMethod("stop", &SynthBridge::Stop),
        InstanceMethod("setPosition", &SynthBridge::SetPosition),
        InstanceMethod("getTransportState", &SynthBridge::GetTransportState),
        InstanceMethod("setLoop", &SynthBridge::SetLoop),
    });

    exports.Set("SynthBridge", func);
    return exports;
}

SynthBridge::SynthBridge(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<SynthBridge>(info)
{
    builtin = std::make_unique<BuiltinSynth>();
    wavetable = std::make_unique<WavetableSynth>();
    transport = std::make_unique<Transport>();
}

SynthBridge::~SynthBridge() = default;

juce::Synthesiser* SynthBridge::activeSynth()
{
    return useWavetable.load() ? static_cast<juce::Synthesiser*>(wavetable.get())
                               : static_cast<juce::Synthesiser*>(builtin.get());
}

void SynthBridge::pushMidi(const juce::MidiMessage& message)
{
    // sampleNumber = 0：事件在下一个渲染块的开头生效。
    // 需要采样级精度时应在 VoiceEvent 里带偏移（后续版本）。
    pendingMidi.addEvent(message, 0);
}

// ── 生命周期 ────────────────────────────────────────────────────

Napi::Value SynthBridge::Prepare(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
        return argError(env, "prepare(sampleRate: number, blockSize: number)");

    const double sr = info[0].As<Napi::Number>().DoubleValue();
    const int bs = info[1].As<Napi::Number>().Int32Value();

    if (sr < 8000.0 || sr > 384000.0)
        return argError(env, "sampleRate out of range (8000..384000)");
    if (bs < 16 || bs > 8192)
        return argError(env, "blockSize out of range (16..8192)");

    sampleRate = sr;
    blockSize = bs;

    juce::dsp::ProcessSpec spec{};
    spec.sampleRate = sampleRate;
    spec.maximumBlockSize = static_cast<juce::uint32>(blockSize);
    spec.numChannels = 2;

    builtin->prepare(spec);
    wavetable->prepare(spec);
    transport->prepare(sampleRate);

    renderBuffer.setSize(2, blockSize, false, true, true);
    renderBuffer.clear();

    prepared.store(true);
    return Napi::Boolean::New(env, true);
}

Napi::Value SynthBridge::IsPrepared(const Napi::CallbackInfo& info)
{
    return Napi::Boolean::New(info.Env(), prepared.load());
}

Napi::Value SynthBridge::Reset(const Napi::CallbackInfo& info)
{
    pendingMidi.clear();
    builtin->allNotesOff(0, true);
    wavetable->allNotesOff(0, true);
    transport->stop();
    return info.Env().Undefined();
}

// ── 音符 ────────────────────────────────────────────────────────

Napi::Value SynthBridge::NoteOn(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber())
        return argError(env, "noteOn(midi: number, velocity?: number, channel?: number)");

    const int note = clampMidi(info[0].As<Napi::Number>().DoubleValue());
    const float velocity = (info.Length() > 1 && info[1].IsNumber())
                               ? clamp01(info[1].As<Napi::Number>().DoubleValue())
                               : 0.8f;
    const int channel = (info.Length() > 2 && info[2].IsNumber())
                            ? info[2].As<Napi::Number>().Int32Value()
                            : 1;

    if (velocity <= 0.0f)
    {
        pushMidi(juce::MidiMessage::noteOff(channel, note));
    }
    else
    {
        pushMidi(juce::MidiMessage::noteOn(channel, note, velocity));
    }
    return env.Undefined();
}

Napi::Value SynthBridge::NoteOff(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber())
        return argError(env, "noteOff(midi: number, channel?: number)");

    const int note = clampMidi(info[0].As<Napi::Number>().DoubleValue());
    const int channel = (info.Length() > 1 && info[1].IsNumber())
                            ? info[1].As<Napi::Number>().Int32Value()
                            : 1;

    pushMidi(juce::MidiMessage::noteOff(channel, note));
    return env.Undefined();
}

Napi::Value SynthBridge::AllNotesOff(const Napi::CallbackInfo& info)
{
    const int channel = (info.Length() > 0 && info[0].IsNumber())
                            ? info[0].As<Napi::Number>().Int32Value()
                            : 0;
    builtin->allNotesOff(channel, true);
    wavetable->allNotesOff(channel, true);
    return info.Env().Undefined();
}

// ── 渲染 ────────────────────────────────────────────────────────

Napi::Value SynthBridge::Render(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (!prepared.load())
        return argError(env, "render() called before prepare()");

    int numSamples = blockSize;
    if (info.Length() > 0 && info[0].IsNumber())
        numSamples = info[0].As<Napi::Number>().Int32Value();

    if (numSamples <= 0 || numSamples > blockSize)
        return argError(env, "render(numSamples) must be 1..blockSize");

    // 取走待消费的 MIDI（swap 后本线程独占，避免与 JS 线程竞争）
    juce::MidiBuffer midi;
    midi.swapWith(pendingMidi);

    renderBuffer.clear();

    // 传输推进：决定本块内各拍的时钟（当前版本不生成节拍器，只有位置推进）
    transport->processBlock(numSamples);

    activeSynth()->renderNextBlock(renderBuffer, midi, 0, numSamples);

    // 输出交织立体声，便于 Web Audio 直接 write 到 AudioWorklet 的声道
    Napi::Float32Array out = Napi::Float32Array::New(env, static_cast<size_t>(numSamples) * 2);
    const float* left = renderBuffer.getReadPointer(0);
    const float* right = renderBuffer.getReadPointer(1);
    float* dst = out.Data();
    for (int i = 0; i < numSamples; ++i)
    {
        dst[i * 2] = left[i];
        dst[i * 2 + 1] = right[i];
    }
    return out;
}

// ── 音色与音量 ──────────────────────────────────────────────────

Napi::Value SynthBridge::SetEngine(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString())
        return argError(env, "setEngine('builtin' | 'wavetable')");

    const std::string name = info[0].As<Napi::String>().Utf8Value();
    if (name == "wavetable")
        useWavetable.store(true);
    else if (name == "builtin")
        useWavetable.store(false);
    else
        return argError(env, "setEngine expects 'builtin' or 'wavetable'");

    return env.Undefined();
}

Napi::Value SynthBridge::SetVolume(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber())
        return argError(env, "setVolume(0..1)");

    const float v = clamp01(info[0].As<Napi::Number>().DoubleValue());
    builtin->setMasterVolume(v);
    wavetable->setMasterVolume(v);
    return env.Undefined();
}

Napi::Value SynthBridge::GetVolume(const Napi::CallbackInfo& info)
{
    return Napi::Number::New(info.Env(), useWavetable.load() ? wavetable->getMasterVolume()
                                                             : builtin->getMasterVolume());
}

Napi::Value SynthBridge::SetWaveform(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber())
        return argError(env, "setWaveform(index: number)");

    const int index = info[0].As<Napi::Number>().Int32Value();
    wavetable->setGlobalWaveform(static_cast<Waveform>(index));
    return env.Undefined();
}

// ── 传输 ────────────────────────────────────────────────────────

Napi::Value SynthBridge::SetTempo(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber())
        return argError(env, "setTempo(bpm)");

    const double bpm = info[0].As<Napi::Number>().DoubleValue();
    if (bpm < 20.0 || bpm > 400.0)
        return argError(env, "bpm out of range (20..400)");

    transport->setBPM(bpm);
    return env.Undefined();
}

Napi::Value SynthBridge::SetTimeSignature(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
        return argError(env, "setTimeSignature(numerator, denominator)");

    transport->setTimeSignature(info[0].As<Napi::Number>().Int32Value(),
                                info[1].As<Napi::Number>().Int32Value());
    return env.Undefined();
}

Napi::Value SynthBridge::Play(const Napi::CallbackInfo& info)
{
    transport->play();
    return info.Env().Undefined();
}

Napi::Value SynthBridge::Pause(const Napi::CallbackInfo& info)
{
    transport->pause();
    return info.Env().Undefined();
}

Napi::Value SynthBridge::Stop(const Napi::CallbackInfo& info)
{
    transport->stop();
    return info.Env().Undefined();
}

Napi::Value SynthBridge::SetPosition(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber())
        return argError(env, "setPosition(bar, beat?)");

    const int bar = info[0].As<Napi::Number>().Int32Value();
    const double beat = (info.Length() > 1 && info[1].IsNumber())
                            ? info[1].As<Napi::Number>().DoubleValue()
                            : 1.0;
    transport->setPosition(bar, beat);
    return env.Undefined();
}

Napi::Value SynthBridge::GetTransportState(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Object obj = Napi::Object::New(env);

    obj.Set("bar", Napi::Number::New(env, transport->getCurrentBar()));
    obj.Set("beat", Napi::Number::New(env, transport->getCurrentBeat()));
    obj.Set("bpm", Napi::Number::New(env, transport->getBPM()));

    const char* state = "stopped";
    switch (transport->getState())
    {
        case Transport::State::Playing: state = "playing"; break;
        case Transport::State::Paused:  state = "paused";  break;
        case Transport::State::Stopped: state = "stopped"; break;
    }
    obj.Set("state", Napi::String::New(env, state));
    return obj;
}

Napi::Value SynthBridge::SetLoop(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 3)
        return argError(env, "setLoop(startBar, endBar, enable)");

    transport->setLoop(info[0].As<Napi::Number>().Int32Value(),
                       info[1].As<Napi::Number>().Int32Value());
    transport->enableLoop(info[2].As<Napi::Boolean>().Value());
    return env.Undefined();
}
