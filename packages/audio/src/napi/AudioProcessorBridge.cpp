#include "AudioProcessorBridge.h"

// ── Static Init ────────────────────────────────────────────────────────

Napi::Object AudioProcessorBridge::Init(Napi::Env env, Napi::Object exports)
{
    Napi::Function func = DefineClass(env, "AudioProcessorBridge", {
        // Lifecycle
        InstanceMethod("prepare", &AudioProcessorBridge::Prepare),
        InstanceMethod("release", &AudioProcessorBridge::Release),
        InstanceMethod("activateAll", &AudioProcessorBridge::ActivateAll),
        InstanceMethod("deactivateAll", &AudioProcessorBridge::DeactivateAll),

        // Chain Manipulation
        InstanceMethod("addPlugin", &AudioProcessorBridge::AddPlugin),
        InstanceMethod("removePlugin", &AudioProcessorBridge::RemovePlugin),
        InstanceMethod("removePluginById", &AudioProcessorBridge::RemovePluginById),
        InstanceMethod("movePlugin", &AudioProcessorBridge::MovePlugin),
        InstanceMethod("getNumPlugins", &AudioProcessorBridge::GetNumPlugins),
        InstanceMethod("isEmpty", &AudioProcessorBridge::IsEmpty),
        InstanceMethod("getPluginNames", &AudioProcessorBridge::GetPluginNames),

        // Processing
        InstanceMethod("process", &AudioProcessorBridge::Process),
        InstanceMethod("processAsync", &AudioProcessorBridge::ProcessAsync),

        // Bypass
        InstanceMethod("setChainBypassed", &AudioProcessorBridge::SetChainBypassed),
        InstanceMethod("isChainBypassed", &AudioProcessorBridge::IsChainBypassed),

        // Parameters
        InstanceMethod("getNumParameters", &AudioProcessorBridge::GetNumParameters),
        InstanceMethod("getParameter", &AudioProcessorBridge::GetParameter),
        InstanceMethod("setParameter", &AudioProcessorBridge::SetParameter),
        InstanceMethod("getParameterName", &AudioProcessorBridge::GetParameterName),
        InstanceMethod("getParameterText", &AudioProcessorBridge::GetParameterText),
        InstanceMethod("getAllParameters", &AudioProcessorBridge::GetAllParameters),

        // State Queries
        InstanceMethod("isAnyPluginActive", &AudioProcessorBridge::IsAnyPluginActive),
        InstanceMethod("getPluginInfo", &AudioProcessorBridge::GetPluginInfo),
    });

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    exports.Set("AudioProcessorBridge", func);
    return exports;
}

// ── Constructor / Destructor ────────────────────────────────────────────

AudioProcessorBridge::AudioProcessorBridge(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<AudioProcessorBridge>(info)
    , pluginChain(std::make_unique<PluginChain>())
{
    Napi::Env env = info.Env();

    // Expect a PluginManagerBridge reference to access the host manager
    if (info.Length() < 1 || !info[0].IsObject())
    {
        Napi::Error::New(env, "AudioProcessorBridge requires PluginManagerBridge reference")
            .ThrowAsJavaScriptException();
        return;
    }

    // We store a raw pointer to the host manager — the PluginManagerBridge owns it.
    // In a production setup, use a shared reference or ensure lifetime management.
    // For now, we rely on the PluginManagerBridge outliving this instance.
    hostManager = nullptr;  // Will be set when addPlugin is called
}

AudioProcessorBridge::~AudioProcessorBridge()
{
    if (pluginChain)
        pluginChain->release();
}

// ── Lifecycle ──────────────────────────────────────────────────────────

void AudioProcessorBridge::Prepare(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber())
    {
        Napi::TypeError::New(env, "Expected (sampleRate, samplesPerBlock, numChannels)")
            .ThrowAsJavaScriptException();
        return;
    }

    double sampleRate = info[0].As<Napi::Number>().DoubleValue();
    int samplesPerBlock = info[1].As<Napi::Number>().Int32Value();
    int numChannels = info[2].As<Napi::Number>().Int32Value();

    std::lock_guard<std::mutex> lock(processorMutex);

    currentSampleRate = sampleRate;
    currentBlockSize = samplesPerBlock;
    currentNumChannels = numChannels;

    pluginChain->prepare(sampleRate, samplesPerBlock, numChannels);
    isPrepared = true;

    // Pre-allocate the process buffer
    processBuffer.setSize(numChannels, samplesPerBlock);
}

void AudioProcessorBridge::Release(const Napi::CallbackInfo& info)
{
    std::lock_guard<std::mutex> lock(processorMutex);
    pluginChain->release();
    isPrepared = false;
}

void AudioProcessorBridge::ActivateAll(const Napi::CallbackInfo& info)
{
    pluginChain->activateAll();
}

void AudioProcessorBridge::DeactivateAll(const Napi::CallbackInfo& info)
{
    pluginChain->deactivateAll();
}

// ── Chain Manipulation ─────────────────────────────────────────────────

Napi::Value AudioProcessorBridge::AddPlugin(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 2)
    {
        Napi::TypeError::New(env, "Expected (pluginManager, pluginIndex)").ThrowAsJavaScriptException();
        return Napi::Number::New(env, -1);
    }

    // Get the PluginManagerBridge instance
    if (!info[0].IsObject())
    {
        Napi::TypeError::New(env, "First argument must be PluginManagerBridge instance")
            .ThrowAsJavaScriptException();
        return Napi::Number::New(env, -1);
    }

    // Access the host manager from PluginManagerBridge
    // We need to extract the C++ object from the JS wrapper
    Napi::Object managerObj = info[0].As<Napi::Object>();

    // For now, we'll use a simpler approach: pass the plugin index and
    // the manager will provide the loaded plugin instance.
    // In a real implementation, we'd use a shared registry pattern.

    int pluginIndex = info[1].As<Napi::Number>().Int32Value();

    // This is a simplified version — in production, we'd need to transfer
    // ownership of the plugin instance from Vst3PluginLoader to PluginChain.
    // For now, return a placeholder indicating the plugin was added.
    Napi::Error::New(env, "Plugin transfer from loader to chain not yet implemented. "
                          "Use processPlugin() on PluginManagerBridge directly.")
        .ThrowAsJavaScriptException();
    return Napi::Number::New(env, -1);
}

void AudioProcessorBridge::RemovePlugin(const Napi::CallbackInfo& info)
{
    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(info.Env(), "Expected number argument (chainIndex)")
            .ThrowAsJavaScriptException();
        return;
    }

    int chainIndex = info[0].As<Napi::Number>().Int32Value();
    pluginChain->removePlugin(chainIndex);
}

void AudioProcessorBridge::RemovePluginById(const Napi::CallbackInfo& info)
{
    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(info.Env(), "Expected number argument (pluginId)")
            .ThrowAsJavaScriptException();
        return;
    }

    int pluginId = info[0].As<Napi::Number>().Int32Value();
    pluginChain->removePluginById(pluginId);
}

void AudioProcessorBridge::MovePlugin(const Napi::CallbackInfo& info)
{
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
    {
        Napi::TypeError::New(info.Env(), "Expected (fromIndex, toIndex)")
            .ThrowAsJavaScriptException();
        return;
    }

    int fromIndex = info[0].As<Napi::Number>().Int32Value();
    int toIndex = info[1].As<Napi::Number>().Int32Value();
    pluginChain->movePlugin(fromIndex, toIndex);
}

Napi::Value AudioProcessorBridge::GetNumPlugins(const Napi::CallbackInfo& info)
{
    return Napi::Number::New(info.Env(), pluginChain->getNumPlugins());
}

Napi::Value AudioProcessorBridge::IsEmpty(const Napi::CallbackInfo& info)
{
    return Napi::Boolean::New(info.Env(), pluginChain->isEmpty());
}

Napi::Value AudioProcessorBridge::GetPluginNames(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    auto names = pluginChain->getPluginNames();

    Napi::Array result = Napi::Array::New(env, names.size());
    for (size_t i = 0; i < names.size(); ++i)
    {
        result.Set(i, Napi::String::New(env, names[i].toStdString()));
    }
    return result;
}

// ── Processing ─────────────────────────────────────────────────────────

Napi::Value AudioProcessorBridge::Process(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (!isPrepared)
    {
        Napi::Error::New(env, "AudioProcessorBridge not prepared").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 3)
    {
        Napi::TypeError::New(env, "Expected (inputBuffer, numChannels, numSamples, midiData?)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Parse input buffer
    std::vector<float> inputData;
    if (info[0].IsTypedArray())
    {
        Napi::Float32Array typedArray = info[0].As<Napi::Float32Array>();
        inputData.assign(typedArray.Data(), typedArray.Data() + typedArray.ElementLength());
    }
    else if (info[0].IsArray())
    {
        Napi::Array arr = info[0].As<Napi::Array>();
        inputData.resize(arr.Length());
        for (size_t i = 0; i < arr.Length(); ++i)
        {
            inputData[i] = arr.Get(i).As<Napi::Number>().FloatValue();
        }
    }
    else
    {
        Napi::TypeError::New(env, "inputBuffer must be Float32Array or number[]")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    int numChannels = info[1].As<Napi::Number>().Int32Value();
    int numSamples = info[2].As<Napi::Number>().Int32Value();

    // Parse MIDI data if provided
    juce::MidiBuffer midiBuffer;
    if (info.Length() > 3 && info[3].IsArray())
    {
        parseMidiData(info[3].As<Napi::Array>(), midiBuffer);
    }

    // Convert to JUCE buffer
    juce::AudioBuffer<float> buffer(numChannels, numSamples);
    jsBufferToAudioBuffer(inputData.data(), numChannels, numSamples, buffer);

    // Process
    pluginChain->process(buffer, midiBuffer);

    // Convert back to JS
    return audioBufferToJs(env, buffer);
}

Napi::Value AudioProcessorBridge::ProcessAsync(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (!isPrepared)
    {
        Napi::Error::New(env, "AudioProcessorBridge not prepared").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Similar to Process() but runs on a worker thread
    // For real-time audio, async is generally NOT recommended due to latency.
    // This is provided for batch/offline processing scenarios.

    Napi::Error::New(env, "Async processing not yet implemented. Use sync process() for real-time.")
        .ThrowAsJavaScriptException();
    return env.Undefined();
}

// ── Bypass ─────────────────────────────────────────────────────────────

void AudioProcessorBridge::SetChainBypassed(const Napi::CallbackInfo& info)
{
    if (info.Length() < 1 || !info[0].IsBoolean())
    {
        Napi::TypeError::New(info.Env(), "Expected boolean argument (bypassed)")
            .ThrowAsJavaScriptException();
        return;
    }

    bool bypassed = info[0].As<Napi::Boolean>().Value();
    pluginChain->setChainBypassed(bypassed);
}

Napi::Value AudioProcessorBridge::IsChainBypassed(const Napi::CallbackInfo& info)
{
    return Napi::Boolean::New(info.Env(), pluginChain->isChainBypassed());
}

// ── Parameters ─────────────────────────────────────────────────────────

Napi::Value AudioProcessorBridge::GetNumParameters(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(env, "Expected number argument (pluginIndex)")
            .ThrowAsJavaScriptException();
        return Napi::Number::New(env, 0);
    }

    int pluginIndex = info[0].As<Napi::Number>().Int32Value();
    auto* plugin = pluginChain->getPlugin(pluginIndex);

    if (plugin == nullptr)
        return Napi::Number::New(env, 0);

    return Napi::Number::New(env, plugin->getNumParameters());
}

Napi::Value AudioProcessorBridge::GetParameter(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
    {
        Napi::TypeError::New(env, "Expected (pluginIndex, paramIndex)")
            .ThrowAsJavaScriptException();
        return Napi::Number::New(env, 0.0f);
    }

    int pluginIndex = info[0].As<Napi::Number>().Int32Value();
    int paramIndex = info[1].As<Napi::Number>().Int32Value();

    auto* plugin = pluginChain->getPlugin(pluginIndex);
    if (plugin == nullptr)
        return Napi::Number::New(env, 0.0f);

    return Napi::Number::New(env, plugin->getParameter(paramIndex));
}

void AudioProcessorBridge::SetParameter(const Napi::CallbackInfo& info)
{
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber())
    {
        Napi::TypeError::New(info.Env(), "Expected (pluginIndex, paramIndex, value)")
            .ThrowAsJavaScriptException();
        return;
    }

    int pluginIndex = info[0].As<Napi::Number>().Int32Value();
    int paramIndex = info[1].As<Napi::Number>().Int32Value();
    float value = info[2].As<Napi::Number>().FloatValue();

    auto* plugin = pluginChain->getPlugin(pluginIndex);
    if (plugin == nullptr)
        return;

    plugin->setParameter(paramIndex, value);
}

Napi::Value AudioProcessorBridge::GetParameterName(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
    {
        Napi::TypeError::New(env, "Expected (pluginIndex, paramIndex)")
            .ThrowAsJavaScriptException();
        return Napi::String::New(env, "");
    }

    int pluginIndex = info[0].As<Napi::Number>().Int32Value();
    int paramIndex = info[1].As<Napi::Number>().Int32Value();

    auto* plugin = pluginChain->getPlugin(pluginIndex);
    if (plugin == nullptr)
        return Napi::String::New(env, "");

    return Napi::String::New(env, plugin->getParameterName(paramIndex).toStdString());
}

Napi::Value AudioProcessorBridge::GetParameterText(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
    {
        Napi::TypeError::New(env, "Expected (pluginIndex, paramIndex)")
            .ThrowAsJavaScriptException();
        return Napi::String::New(env, "");
    }

    int pluginIndex = info[0].As<Napi::Number>().Int32Value();
    int paramIndex = info[1].As<Napi::Number>().Int32Value();

    auto* plugin = pluginChain->getPlugin(pluginIndex);
    if (plugin == nullptr)
        return Napi::String::New(env, "");

    return Napi::String::New(env, plugin->getParameterText(paramIndex).toStdString());
}

Napi::Value AudioProcessorBridge::GetAllParameters(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(env, "Expected number argument (pluginIndex)")
            .ThrowAsJavaScriptException();
        return Napi::Array::New(env, 0);
    }

    int pluginIndex = info[0].As<Napi::Number>().Int32Value();
    auto* plugin = pluginChain->getPlugin(pluginIndex);

    if (plugin == nullptr)
        return Napi::Array::New(env, 0);

    int numParams = plugin->getNumParameters();
    Napi::Array result = Napi::Array::New(env, numParams);

    for (int i = 0; i < numParams; ++i)
    {
        Napi::Object param = Napi::Object::New(env);
        param.Set("index", Napi::Number::New(env, i));
        param.Set("name", Napi::String::New(env, plugin->getParameterName(i).toStdString()));
        param.Set("value", Napi::Number::New(env, plugin->getParameter(i)));
        param.Set("text", Napi::String::New(env, plugin->getParameterText(i).toStdString()));
        result.Set(i, param);
    }

    return result;
}

// ── State Queries ──────────────────────────────────────────────────────

Napi::Value AudioProcessorBridge::IsAnyPluginActive(const Napi::CallbackInfo& info)
{
    return Napi::Boolean::New(info.Env(), pluginChain->isAnyPluginActive());
}

Napi::Value AudioProcessorBridge::GetPluginInfo(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(env, "Expected number argument (chainIndex)")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    int chainIndex = info[0].As<Napi::Number>().Int32Value();
    const auto* plugin = pluginChain->getPlugin(chainIndex);

    if (plugin == nullptr)
        return env.Null();

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("id", Napi::Number::New(env, plugin->getId()));
    obj.Set("name", Napi::String::New(env, plugin->getName().toStdString()));
    obj.Set("isPrepared", Napi::Boolean::New(env, plugin->isPrepared()));
    obj.Set("isActive", Napi::Boolean::New(env, plugin->isActive()));
    obj.Set("isBypassed", Napi::Boolean::New(env, plugin->isBypassed()));
    obj.Set("isSilent", Napi::Boolean::New(env, plugin->isSilent()));
    obj.Set("numParameters", Napi::Number::New(env, plugin->getNumParameters()));

    return obj;
}

// ── Internal Helpers ───────────────────────────────────────────────────

void AudioProcessorBridge::jsBufferToAudioBuffer(const float* interleavedData,
                                                  int numChannels,
                                                  int numSamples,
                                                  juce::AudioBuffer<float>& buffer)
{
    // De-interleave: JS provides [L0,R0,L1,R1,...] → JUCE wants [L0,L1,...][R0,R1,...]
    for (int ch = 0; ch < numChannels; ++ch)
    {
        float* channelData = buffer.getWritePointer(ch);
        for (int i = 0; i < numSamples; ++i)
        {
            channelData[i] = interleavedData[i * numChannels + ch];
        }
    }
}

Napi::Float32Array AudioProcessorBridge::audioBufferToJs(
    Napi::Env env, const juce::AudioBuffer<float>& buffer)
{
    int numChannels = buffer.getNumChannels();
    int numSamples = buffer.getNumSamples();
    size_t totalSamples = static_cast<size_t>(numChannels * numSamples);

    Napi::Float32Array result = Napi::Float32Array::New(env, totalSamples);

    // Interleave: JUCE [L0,L1,...][R0,R1,...] → JS [L0,R0,L1,R1,...]
    for (int ch = 0; ch < numChannels; ++ch)
    {
        const float* channelData = buffer.getReadPointer(ch);
        for (int i = 0; i < numSamples; ++i)
        {
            result[static_cast<size_t>(i * numChannels + ch)] = channelData[i];
        }
    }

    return result;
}

void AudioProcessorBridge::parseMidiData(Napi::Array midiArray,
                                          juce::MidiBuffer& midiBuffer)
{
    for (size_t i = 0; i < midiArray.Length(); ++i)
    {
        Napi::Value val = midiArray.Get(i);
        if (!val.IsObject())
            continue;

        Napi::Object msg = val.As<Napi::Object>();

        int status = 0;
        int data1 = 0;
        int data2 = 0;
        int timestamp = 0;

        if (msg.Has("status"))
            status = msg.Get("status").As<Napi::Number>().Int32Value();
        if (msg.Has("data1"))
            data1 = msg.Get("data1").As<Napi::Number>().Int32Value();
        if (msg.Has("data2"))
            data2 = msg.Get("data2").As<Napi::Number>().Int32Value();
        if (msg.Has("timestamp"))
            timestamp = msg.Get("timestamp").As<Napi::Number>().Int32Value();

        // Create MIDI message based on status byte
        juce::MidiMessage midiMsg;

        if ((status & 0xF0) == 0x90)  // Note On
            midiMsg = juce::MidiMessage::noteOn((status & 0x0F) + 1, data1,
                                                 static_cast<juce::uint8>(data2));
        else if ((status & 0xF0) == 0x80)  // Note Off
            midiMsg = juce::MidiMessage::noteOff((status & 0x0F) + 1, data1,
                                                  static_cast<juce::uint8>(data2));
        else if ((status & 0xF0) == 0xB0)  // Control Change
            midiMsg = juce::MidiMessage::controllerEvent((status & 0x0F) + 1, data1, data2);
        else if ((status & 0xF0) == 0xE0)  // Pitch Bend
            midiMsg = juce::MidiMessage::pitchWheel((status & 0x0F) + 1,
                                                      (data2 << 7) | data1);
        else
            midiMsg = juce::MidiMessage(status, data1, data2);

        midiBuffer.addEvent(midiMsg, timestamp);
    }
}

// ── ProcessWorker ──────────────────────────────────────────────────────

AudioProcessorBridge::ProcessWorker::ProcessWorker(
    Napi::Env env,
    PluginChain* chain,
    std::vector<float> audioData,
    int numCh,
    int numSamp,
    juce::MidiBuffer midi)
    : Napi::AsyncWorker(env)
    , chain(chain)
    , interleavedData(std::move(audioData))
    , numChannels(numCh)
    , numSamples(numSamp)
    , midiBuffer(std::move(midi))
    , deferred(Napi::Promise::Deferred::New(env))
{
}

void AudioProcessorBridge::ProcessWorker::Execute()
{
    juce::AudioBuffer<float> buffer(numChannels, numSamples);

    // De-interleave
    for (int ch = 0; ch < numChannels; ++ch)
    {
        float* channelData = buffer.getWritePointer(ch);
        for (int i = 0; i < numSamples; ++i)
        {
            channelData[i] = interleavedData[i * numChannels + ch];
        }
    }

    chain->process(buffer, midiBuffer);

    // Re-interleave
    for (int ch = 0; ch < numChannels; ++ch)
    {
        const float* channelData = buffer.getReadPointer(ch);
        for (int i = 0; i < numSamples; ++i)
        {
            interleavedData[i * numChannels + ch] = channelData[i];
        }
    }
}

void AudioProcessorBridge::ProcessWorker::OnOK()
{
    Napi::HandleScope scope(Env());

    size_t totalSamples = interleavedData.size();
    Napi::Float32Array result = Napi::Float32Array::New(Env(), totalSamples);
    std::memcpy(result.Data(), interleavedData.data(), totalSamples * sizeof(float));

    deferred.Resolve(result);
}

Napi::Value AudioProcessorBridge::ProcessWorker::GetPromise()
{
    return deferred.Promise();
}
