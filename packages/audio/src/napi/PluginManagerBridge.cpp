#include "PluginManagerBridge.h"

// ── Static Init ────────────────────────────────────────────────────────

Napi::Object PluginManagerBridge::Init(Napi::Env env, Napi::Object exports)
{
    Napi::Function func = DefineClass(env, "PluginManagerBridge", {
        // Lifecycle
        InstanceMethod("initialize", &PluginManagerBridge::Initialize),
        InstanceMethod("shutdown", &PluginManagerBridge::Shutdown),
        InstanceMethod("isInitialized", &PluginManagerBridge::IsInitialized),

        // Scanning
        InstanceMethod("scanDefaultPaths", &PluginManagerBridge::ScanDefaultPaths),
        InstanceMethod("scanDirectory", &PluginManagerBridge::ScanDirectory),
        InstanceMethod("getCachedResults", &PluginManagerBridge::GetCachedResults),
        InstanceMethod("clearCache", &PluginManagerBridge::ClearCache),
        InstanceMethod("getDefaultScanPaths", &PluginManagerBridge::GetDefaultScanPaths),

        // Loading
        InstanceMethod("loadPlugin", &PluginManagerBridge::LoadPlugin),
        InstanceMethod("loadPluginFromFile", &PluginManagerBridge::LoadPluginFromFile),
        InstanceMethod("unloadPlugin", &PluginManagerBridge::UnloadPlugin),
        InstanceMethod("unloadAll", &PluginManagerBridge::UnloadAll),

        // Plugin State
        InstanceMethod("activatePlugin", &PluginManagerBridge::ActivatePlugin),
        InstanceMethod("deactivatePlugin", &PluginManagerBridge::DeactivatePlugin),
        InstanceMethod("preparePlugin", &PluginManagerBridge::PreparePlugin),
        InstanceMethod("releasePlugin", &PluginManagerBridge::ReleasePlugin),

        // Queries
        InstanceMethod("getNumPlugins", &PluginManagerBridge::GetNumPlugins),
        InstanceMethod("isPluginLoaded", &PluginManagerBridge::IsPluginLoaded),
        InstanceMethod("getPluginInfo", &PluginManagerBridge::GetPluginInfo),
        InstanceMethod("getAllPluginsInfo", &PluginManagerBridge::GetAllPluginsInfo),
    });

    Napi::FunctionReference* constructor = new Napi::FunctionReference();
    *constructor = Napi::Persistent(func);
    env.SetInstanceData(constructor);

    exports.Set("PluginManagerBridge", func);
    return exports;
}

// ── Constructor / Destructor ────────────────────────────────────────────

PluginManagerBridge::PluginManagerBridge(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<PluginManagerBridge>(info)
    , hostManager(std::make_unique<Vst3HostManager>())
{
}

PluginManagerBridge::~PluginManagerBridge()
{
    if (hostManager && hostManager->isInitialized())
        hostManager->shutdown();
}

// ── Lifecycle ──────────────────────────────────────────────────────────

Napi::Value PluginManagerBridge::Initialize(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    std::lock_guard<std::mutex> lock(bridgeMutex);
    bool result = hostManager->initialize();
    return Napi::Boolean::New(env, result);
}

void PluginManagerBridge::Shutdown(const Napi::CallbackInfo& info)
{
    std::lock_guard<std::mutex> lock(bridgeMutex);
    descriptionCache.clear();
    hostManager->shutdown();
}

Napi::Value PluginManagerBridge::IsInitialized(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    return Napi::Boolean::New(env, hostManager->isInitialized());
}

// ── Scanning ───────────────────────────────────────────────────────────

Napi::Value PluginManagerBridge::ScanDefaultPaths(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (!hostManager->isInitialized())
    {
        Napi::Error::New(env, "Host manager not initialized").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto deferred = Napi::Promise::Deferred::New(env);
    auto* worker = new ScanWorker(env, &hostManager->getScanner(), true, "");
    worker->Queue();
    return worker->GetPromise();
}

Napi::Value PluginManagerBridge::ScanDirectory(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (!hostManager->isInitialized())
    {
        Napi::Error::New(env, "Host manager not initialized").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    if (info.Length() < 1 || !info[0].IsString())
    {
        Napi::TypeError::New(env, "Expected string argument (directoryPath)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::string directory = info[0].As<Napi::String>().Utf8Value();
    auto* worker = new ScanWorker(env, &hostManager->getScanner(), false, directory);
    worker->Queue();
    return worker->GetPromise();
}

Napi::Value PluginManagerBridge::GetCachedResults(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    const auto& cached = hostManager->getScanner().getCachedResults();
    return PluginDescriptionsToArray(env, cached);
}

void PluginManagerBridge::ClearCache(const Napi::CallbackInfo& info)
{
    hostManager->getScanner().clearCache();
    std::lock_guard<std::mutex> lock(bridgeMutex);
    descriptionCache.clear();
}

Napi::Value PluginManagerBridge::GetDefaultScanPaths(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    auto paths = Vst3PluginScanner::getDefaultScanPaths();

    Napi::Array result = Napi::Array::New(env, paths.size());
    for (size_t i = 0; i < paths.size(); ++i)
    {
        result.Set(i, Napi::String::New(env, paths[i].getFullPathName().toStdString()));
    }
    return result;
}

// ── Loading ────────────────────────────────────────────────────────────

Napi::Value PluginManagerBridge::LoadPlugin(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (!hostManager->isInitialized())
    {
        Napi::Error::New(env, "Host manager not initialized").ThrowAsJavaScriptException();
        return Napi::Number::New(env, -1);
    }

    if (info.Length() < 1 || !info[0].IsString())
    {
        Napi::TypeError::New(env, "Expected string argument (descriptionId)").ThrowAsJavaScriptException();
        return Napi::Number::New(env, -1);
    }

    std::string descId = info[0].As<Napi::String>().Utf8Value();
    double sampleRate = 44100.0;
    int blockSize = 512;

    if (info.Length() > 1 && info[1].IsNumber())
        sampleRate = info[1].As<Napi::Number>().DoubleValue();
    if (info.Length() > 2 && info[2].IsNumber())
        blockSize = info[2].As<Napi::Number>().Int32Value();

    std::lock_guard<std::mutex> lock(bridgeMutex);

    auto it = descriptionCache.find(descId);
    if (it == descriptionCache.end())
    {
        // Try to find in cached scan results
        const auto& cached = hostManager->getScanner().getCachedResults();
        for (const auto& desc : cached)
        {
            if (desc.identifier.toStdString() == descId || desc.name.toStdString() == descId)
            {
                descriptionCache[descId] = desc;
                it = descriptionCache.find(descId);
                break;
            }
        }

        if (it == descriptionCache.end())
        {
            Napi::Error::New(env, "Plugin description not found: " + descId).ThrowAsJavaScriptException();
            return Napi::Number::New(env, -1);
        }
    }

    int index = hostManager->getLoader().loadPlugin(it->second, sampleRate, blockSize);
    return Napi::Number::New(env, index);
}

Napi::Value PluginManagerBridge::LoadPluginFromFile(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (!hostManager->isInitialized())
    {
        Napi::Error::New(env, "Host manager not initialized").ThrowAsJavaScriptException();
        return Napi::Number::New(env, -1);
    }

    if (info.Length() < 1 || !info[0].IsString())
    {
        Napi::TypeError::New(env, "Expected string argument (filePath)").ThrowAsJavaScriptException();
        return Napi::Number::New(env, -1);
    }

    std::string filePath = info[0].As<Napi::String>().Utf8Value();
    double sampleRate = 44100.0;
    int blockSize = 512;

    if (info.Length() > 1 && info[1].IsNumber())
        sampleRate = info[1].As<Napi::Number>().DoubleValue();
    if (info.Length() > 2 && info[2].IsNumber())
        blockSize = info[2].As<Napi::Number>().Int32Value();

    int index = hostManager->getLoader().loadPluginFromFile(filePath, sampleRate, blockSize);
    return Napi::Number::New(env, index);
}

void PluginManagerBridge::UnloadPlugin(const Napi::CallbackInfo& info)
{
    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(info.Env(), "Expected number argument (index)").ThrowAsJavaScriptException();
        return;
    }

    int index = info[0].As<Napi::Number>().Int32Value();
    hostManager->getLoader().unloadPlugin(index);
}

void PluginManagerBridge::UnloadAll(const Napi::CallbackInfo& info)
{
    hostManager->getLoader().unloadAll();
}

// ── Plugin State ───────────────────────────────────────────────────────

void PluginManagerBridge::ActivatePlugin(const Napi::CallbackInfo& info)
{
    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(info.Env(), "Expected number argument (index)").ThrowAsJavaScriptException();
        return;
    }

    int index = info[0].As<Napi::Number>().Int32Value();
    hostManager->getLoader().activatePlugin(index);
}

void PluginManagerBridge::DeactivatePlugin(const Napi::CallbackInfo& info)
{
    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(info.Env(), "Expected number argument (index)").ThrowAsJavaScriptException();
        return;
    }

    int index = info[0].As<Napi::Number>().Int32Value();
    hostManager->getLoader().deactivatePlugin(index);
}

void PluginManagerBridge::PreparePlugin(const Napi::CallbackInfo& info)
{
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber())
    {
        Napi::TypeError::New(info.Env(), "Expected (index, sampleRate, blockSize)").ThrowAsJavaScriptException();
        return;
    }

    int index = info[0].As<Napi::Number>().Int32Value();
    double sampleRate = info[1].As<Napi::Number>().DoubleValue();
    int blockSize = info[2].As<Napi::Number>().Int32Value();

    hostManager->getLoader().preparePlugin(index, sampleRate, blockSize);
}

void PluginManagerBridge::ReleasePlugin(const Napi::CallbackInfo& info)
{
    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(info.Env(), "Expected number argument (index)").ThrowAsJavaScriptException();
        return;
    }

    int index = info[0].As<Napi::Number>().Int32Value();
    hostManager->getLoader().releasePlugin(index);
}

// ── Queries ────────────────────────────────────────────────────────────

Napi::Value PluginManagerBridge::GetNumPlugins(const Napi::CallbackInfo& info)
{
    return Napi::Number::New(info.Env(), hostManager->getLoader().getNumPlugins());
}

Napi::Value PluginManagerBridge::IsPluginLoaded(const Napi::CallbackInfo& info)
{
    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(info.Env(), "Expected number argument (index)").ThrowAsJavaScriptException();
        return Napi::Boolean::New(info.Env(), false);
    }

    int index = info[0].As<Napi::Number>().Int32Value();
    return Napi::Boolean::New(info.Env(), hostManager->getLoader().isPluginLoaded(index));
}

Napi::Value PluginManagerBridge::GetPluginInfo(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber())
    {
        Napi::TypeError::New(env, "Expected number argument (index)").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    int index = info[0].As<Napi::Number>().Int32Value();
    auto* loaded = hostManager->getLoader().getPlugin(index);

    if (loaded == nullptr)
        return env.Null();

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("index", Napi::Number::New(env, index));
    obj.Set("name", Napi::String::New(env, loaded->description.name.toStdString()));
    obj.Set("vendor", Napi::String::New(env, loaded->description.manufacturerName.toStdString()));
    obj.Set("category", Napi::String::New(env, loaded->description.category.toStdString()));
    obj.Set("isInstrument", Napi::Boolean::New(env, loaded->description.isInstrument));
    obj.Set("numInputChannels", Napi::Number::New(env, loaded->description.numInputChannels));
    obj.Set("numOutputChannels", Napi::Number::New(env, loaded->description.numOutputChannels));
    obj.Set("isActive", Napi::Boolean::New(env, loaded->isActive));
    obj.Set("isPrepared", Napi::Boolean::New(env, loaded->isPrepared));
    obj.Set("identifier", Napi::String::New(env, loaded->description.identifier.toStdString()));

    return obj;
}

Napi::Value PluginManagerBridge::GetAllPluginsInfo(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    int numPlugins = hostManager->getLoader().getNumPlugins();

    Napi::Array result = Napi::Array::New(env, numPlugins);
    for (int i = 0; i < numPlugins; ++i)
    {
        Napi::Value pluginInfo = GetPluginInfo({info.Env(), {Napi::Number::New(env, i)}});
        result.Set(i, pluginInfo);
    }
    return result;
}

// ── Helpers ────────────────────────────────────────────────────────────

Napi::Object PluginManagerBridge::PluginDescriptionToObject(
    Napi::Env env, const juce::PluginDescription& desc)
{
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("name", Napi::String::New(env, desc.name.toStdString()));
    obj.Set("identifier", Napi::String::New(env, desc.identifier.toStdString()));
    obj.Set("manufacturerName", Napi::String::New(env, desc.manufacturerName.toStdString()));
    obj.Set("version", Napi::String::New(env, desc.version.toStdString()));
    obj.Set("category", Napi::String::New(env, desc.category.toStdString()));
    obj.Set("isInstrument", Napi::Boolean::New(env, desc.isInstrument));
    obj.Set("numInputChannels", Napi::Number::New(env, desc.numInputChannels));
    obj.Set("numOutputChannels", Napi::Number::New(env, desc.numOutputChannels));
    obj.Set("pluginFormatName", Napi::String::New(env, desc.pluginFormatName.toStdString()));
    obj.Set("fileOrIdentifier", Napi::String::New(env, desc.fileOrIdentifier.toStdString()));
    obj.Set("uniqueId", Napi::Number::New(env, static_cast<double>(desc.uniqueId)));
    return obj;
}

Napi::Array PluginManagerBridge::PluginDescriptionsToArray(
    Napi::Env env, const std::vector<juce::PluginDescription>& descriptions)
{
    Napi::Array result = Napi::Array::New(env, descriptions.size());
    for (size_t i = 0; i < descriptions.size(); ++i)
    {
        result.Set(i, PluginDescriptionToObject(env, descriptions[i]));
    }
    return result;
}

// ── ScanWorker ─────────────────────────────────────────────────────────

PluginManagerBridge::ScanWorker::ScanWorker(Napi::Env env,
                                             Vst3PluginScanner* scanner,
                                             bool useDefaultPaths,
                                             const std::string& dir)
    : Napi::AsyncWorker(env)
    , scanner(scanner)
    , useDefaultPaths(useDefaultPaths)
    , directory(dir)
    , deferred(Napi::Promise::Deferred::New(env))
{
}

void PluginManagerBridge::ScanWorker::Execute()
{
    if (useDefaultPaths)
    {
        results = scanner->scanDefaultPaths();
    }
    else
    {
        results = scanner->scanDirectory(juce::File(directory));
    }
}

void PluginManagerBridge::ScanWorker::OnOK()
{
    Napi::HandleScope scope(Env());
    Napi::Array arr = PluginDescriptionsToArray(Env(), results);
    deferred.Resolve(arr);
}

void PluginManagerBridge::ScanWorker::OnError(const Napi::Error& error)
{
    Napi::HandleScope scope(Env());
    deferred.Reject(error.Value());
}

Napi::Value PluginManagerBridge::ScanWorker::GetPromise()
{
    return deferred.Promise();
}
