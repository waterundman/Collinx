#pragma once

#include <napi.h>
#include <memory>
#include <mutex>
#include <atomic>

#include <juce_audio_basics/juce_audio_basics.h>
#include "builtin-synth.h"
#include "wavetable-synth.h"
#include "transport.h"

/**
 * SynthBridge — 把合成器与传输控制暴露给 Node/Electron。
 *
 * ## 为什么**不**包装 AudioEngine
 *
 * `AudioEngine` 继承 `juce::AudioAppComponent`（位于 juce_audio_utils），
 * 它会自己打开音频设备并在消息线程上工作。而 Node addon 里 OS 主线程归 V8 ——
 * 参考 slopsmith-desktop 的公开设计文档：
 *   > JUCE requires the MessageManager on the OS main thread.
 *   > In the Node.js addon, V8 owns the main thread → deadlocks or init failures.
 *
 * 因此本类**只做纯渲染**：不创建 AudioDeviceManager、不碰 MessageManager、
 * 不需要 GUI。音频设备由调用方负责（Electron 侧或后续的独立音频进程）。
 *
 * ## 线程模型
 *
 * - `noteOn` / `noteOff` / transport 控制：从 JS 线程调用
 * - `render`：由调用方的实时音频线程调用
 *
 * 两者通过 `juce::MidiBuffer`（内部 lock-free 消息队列）交换 MIDI，
 * 只有 render 会消费，因而不会在音频线程上抢锁。
 */
class SynthBridge : public Napi::ObjectWrap<SynthBridge>
{
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    explicit SynthBridge(const Napi::CallbackInfo& info);
    ~SynthBridge() override;

private:
    // ── 生命周期 ────────────────────────────────────────────────
    Napi::Value Prepare(const Napi::CallbackInfo& info);   // (sampleRate, blockSize) -> bool
    Napi::Value IsPrepared(const Napi::CallbackInfo& info); // -> bool
    Napi::Value Reset(const Napi::CallbackInfo& info);      // 清空全部声部与待发 MIDI

    // ── 音符 ────────────────────────────────────────────────────
    Napi::Value NoteOn(const Napi::CallbackInfo& info);     // (midi, velocity, channel?) -> void
    Napi::Value NoteOff(const Napi::CallbackInfo& info);    // (midi, channel?) -> void
    Napi::Value AllNotesOff(const Napi::CallbackInfo& info);

    // ── 渲染 ────────────────────────────────────────────────────
    /** (numSamples) -> Float32Array，**交织立体声** [L,R,L,R,...] */
    Napi::Value Render(const Napi::CallbackInfo& info);

    // ── 音色与音量 ──────────────────────────────────────────────
    Napi::Value SetEngine(const Napi::CallbackInfo& info);  // ("builtin" | "wavetable")
    Napi::Value SetVolume(const Napi::CallbackInfo& info);  // (0..1)
    Napi::Value GetVolume(const Napi::CallbackInfo& info);
    Napi::Value SetWaveform(const Napi::CallbackInfo& info); // (0..N) 仅 wavetable

    // ── 传输 ────────────────────────────────────────────────────
    Napi::Value SetTempo(const Napi::CallbackInfo& info);   // (bpm)
    Napi::Value SetTimeSignature(const Napi::CallbackInfo& info); // (numerator, denominator)
    Napi::Value Play(const Napi::CallbackInfo& info);
    Napi::Value Pause(const Napi::CallbackInfo& info);
    Napi::Value Stop(const Napi::CallbackInfo& info);
    Napi::Value SetPosition(const Napi::CallbackInfo& info); // (bar, beat?)
    /** -> { bar, beat, bpm, state } */
    Napi::Value GetTransportState(const Napi::CallbackInfo& info);
    Napi::Value SetLoop(const Napi::CallbackInfo& info);     // (startBar, endBar, enable)

    // ── 内部 ────────────────────────────────────────────────────
    void pushMidi(const juce::MidiMessage& message);
    juce::Synthesiser* activeSynth();

    std::unique_ptr<BuiltinSynth> builtin;
    std::unique_ptr<WavetableSynth> wavetable;
    std::unique_ptr<Transport> transport;

    juce::AudioBuffer<float> renderBuffer;
    /** 待消费的 MIDI：JS 线程写、render 线程取（MidiBuffer 自身线程安全） */
    juce::MidiBuffer pendingMidi;

    double sampleRate = 44100.0;
    int blockSize = 512;
    std::atomic<bool> prepared{false};
    std::atomic<bool> useWavetable{false};
};
