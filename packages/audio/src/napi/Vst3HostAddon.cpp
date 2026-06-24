/**
 * Vst3HostAddon.cpp — N-API addon entry point for Collinx VST3 Host.
 *
 * Registers the PluginManagerBridge and AudioProcessorBridge classes
 * as exports from the native module.
 *
 * Usage from TypeScript:
 *   const { PluginManagerBridge, AudioProcessorBridge } = require('./build/Release/vst3-host-addon');
 *
 *   const manager = new PluginManagerBridge();
 *   manager.initialize();
 *
 *   const plugins = await manager.scanDefaultPaths();
 *   console.log(`Found ${plugins.length} plugins`);
 *
 *   const processor = new AudioProcessorBridge(manager);
 *   processor.prepare(44100, 512, 2);
 */

#include <napi.h>
#include "PluginManagerBridge.h"
#include "AudioProcessorBridge.h"

/**
 * Module initialization function.
 * Called by Node.js when the addon is loaded.
 */
Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    // Register bridge classes
    PluginManagerBridge::Init(env, exports);
    AudioProcessorBridge::Init(env, exports);

    // Export version info
    exports.Set("version", Napi::String::New(env, "1.2.0"));
    exports.Set("engineType", Napi::String::New(env, "VST3"));

    // Export utility functions
    exports.Set("getDefaultScanPaths", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        auto paths = Vst3PluginScanner::getDefaultScanPaths();
        Napi::Array result = Napi::Array::New(info.Env(), paths.size());
        for (size_t i = 0; i < paths.size(); ++i)
        {
            result.Set(i, Napi::String::New(info.Env(), paths[i].getFullPathName().toStdString()));
        }
        return result;
    }));

    exports.Set("isVst3File", Napi::Function::New(env, [](const Napi::CallbackInfo& info) {
        if (info.Length() < 1 || !info[0].IsString())
        {
            Napi::TypeError::New(info.Env(), "Expected string argument (filePath)")
                .ThrowAsJavaScriptException();
            return Napi::Boolean::New(info.Env(), false);
        }

        std::string path = info[0].As<Napi::String>().Utf8Value();
        bool isVst3 = Vst3PluginScanner::isVst3Plugin(juce::File(path));
        return Napi::Boolean::New(info.Env(), isVst3);
    }));

    return exports;
}

// Register the addon with Node.js
NODE_API_MODULE(vst3_host_addon, Init)
