#pragma once

#include <juce_audio_basics/juce_audio_basics.h>

/**
 * CollinxSynthSound — 最简的 SynthesiserSound 派生。
 *
 * juce::SynthesiserSound 是抽象基类（appliesToNote / appliesToChannel 为纯虚），
 * 不能直接 `new`。对内置合成器来说「任何音符、任何通道都能播」即可。
 *
 * ⚠️ 抽成独立头文件的原因（v2.8.0 踩过）：
 * 最初在 builtin-synth.h 与 wavetable-synth.h 里各写了一份同名类。两个合成器
 * 分开编译时没事，但 Node addon 的 SynthBridge 同时 include 两者 →
 * "redefinition of 'class CollinxSynthSound'"。
 * 凡「多个头文件都要用的类型」，一律放共享头，不要靠 include 顺序碰运气。
 */
class CollinxSynthSound : public juce::SynthesiserSound
{
public:
    bool appliesToNote (int) override { return true; }
    bool appliesToChannel (int) override { return true; }
};
