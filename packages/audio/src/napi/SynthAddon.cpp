/**
 * SynthAddon.cpp — 合成器专用 addon 入口。
 *
 * 为什么单独一个入口，不复用 Vst3HostAddon.cpp：
 * 那个入口会把 PluginManagerBridge / AudioProcessorBridge 一起注册，
 * 而这两个类所在的 .cpp（1628 行）**从未编译通过过**（PluginManagerBridge.cpp
 * 里有 3 类错误：臆造的 ScanWorker::GetPromise、PluginDescription 用了不存在的
 * identifier 字段、Napi 回调签名不匹配）。
 *
 * 合成器（SynthBridge）是 v2.8.0 让 Collinx 出声的关键路径，没必要被
 * VST3 宿主的历史债拖住。两者分开构建：
 *   - 本入口 → collinx-audio-native.node（只有 SynthBridge）
 *   - VST3 宿主 → 待 PluginManagerBridge.cpp 修好后另行加入
 */

#include <napi.h>
#include "SynthBridge.h"

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
    SynthBridge::Init(env, exports);

    exports.Set("version", Napi::String::New(env, "0.1.0"));
    exports.Set("engineType", Napi::String::New(env, "JUCE-Synth"));
    return exports;
}

NODE_API_MODULE(collinx_audio_native, Init)
