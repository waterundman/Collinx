cmake_minimum_required(VERSION 3.22)
project(collinx-audio-engine VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

include(FetchContent)
FetchContent_Declare(
  juce
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 8.0.1
)
FetchContent_MakeAvailable(juce)

set(SOURCES
  src/main.cpp
  src/audio-engine.cpp
  src/audio-engine.h
  src/builtin-synth.cpp
  src/builtin-synth.h
  src/wavetable-synth.cpp
  src/wavetable-synth.h
  src/transport.cpp
  src/transport.h
  src/dsp/ParallelProcessor.cpp
  src/dsp/ParallelProcessor.h
  src/dsp/LatencyCompensator.cpp
  src/dsp/LatencyCompensator.h
  src/vst3/Vst3HostManager.cpp
  src/vst3/Vst3HostManager.h
  src/vst3/Vst3PluginScanner.cpp
  src/vst3/Vst3PluginScanner.h
  src/vst3/Vst3PluginLoader.cpp
  src/vst3/Vst3PluginLoader.h
  src/vst3/PluginProcessor.cpp
  src/vst3/PluginProcessor.h
  src/vst3/PluginChain.cpp
  src/vst3/PluginChain.h
  src/clap/ClapPluginFormat.cpp
  src/clap/ClapPluginFormat.h
  src/clap/ClapPluginScanner.cpp
  src/clap/ClapPluginScanner.h
  src/clap/ClapPluginLoader.cpp
  src/clap/ClapPluginLoader.h
  src/clap/ClapNoteExpression.cpp
  src/clap/ClapNoteExpression.h
  src/clap/ClapParamModulation.cpp
  src/clap/ClapParamModulation.h
  src/plugins/PluginFormatRegistry.cpp
  src/plugins/PluginFormatRegistry.h
  src/plugins/UnifiedPluginManager.cpp
  src/plugins/UnifiedPluginManager.h
  src/sandbox/PluginCrashDetector.cpp
  src/sandbox/PluginCrashDetector.h
  src/sandbox/PluginHealthMonitor.cpp
  src/sandbox/PluginHealthMonitor.h
  src/sandbox/CrashRecoveryManager.cpp
  src/sandbox/CrashRecoveryManager.h
  src/midi/MidiEffectProcessor.cpp
  src/midi/MidiEffectProcessor.h
  src/midi/MidiEffectChain.cpp
  src/midi/MidiEffectChain.h
  src/midi/MidiRouter.cpp
  src/midi/MidiRouter.h
  src/presets/PresetFormat.cpp
  src/presets/PresetFormat.h
  src/presets/PresetStorage.cpp
  src/presets/PresetStorage.h
  src/presets/PresetManager.cpp
  src/presets/PresetManager.h
  src/scan/AsyncScanner.cpp
  src/scan/AsyncScanner.h
  src/scan/ScanCache.cpp
  src/scan/ScanCache.h
  src/scan/ScanProgressReporter.cpp
  src/scan/ScanProgressReporter.h
  src/perf/PerformanceMonitor.cpp
  src/perf/PerformanceMonitor.h
  src/perf/PluginProfiler.cpp
  src/perf/PluginProfiler.h
  src/automation/AutomationCurve.cpp
  src/automation/AutomationCurve.h
  src/automation/AutomationManager.cpp
  src/automation/AutomationManager.h
)

add_executable(collinx-audio-engine ${SOURCES})

target_include_directories(collinx-audio-engine PRIVATE src)

target_link_libraries(collinx-audio-engine PRIVATE
  juce::juce_audio_basics
  juce::juce_audio_devices
  juce::juce_audio_formats
  juce::juce_audio_processors
  # v2.8.0：AudioEngine 继承 juce::AudioAppComponent（audio-engine.h:11），
  # 该类定义在 juce_audio_utils 模块。缺它会导致
  # "expected class-name before ',' token"，并连带让所有 override 声明失败。
  juce::juce_audio_utils
  juce::juce_dsp
)

# v2.8.0：原此处调用了 juce_generate_juce_header(collinx-audio-engine)，但
#   1) 目标是普通 add_executable，JUCE 要求目标由 juce_add_* 创建才带 sources 目录
#      → CMake 直接报 "Target ... does not have a generated sources directory"；
#   2) 全仓 0 个文件 include <JuceHeader.h>，这个头文件从未被用到。
#   故移除。若将来真的要用 JuceHeader，应改用 juce_add_console_app/juce_add_gui_app。


# Tests
option(BUILD_TESTS "Build tests" ON)

if(BUILD_TESTS)
  enable_testing()

  set(TEST_SOURCES
    tests/vst3_tests.cpp
    tests/clap_tests.cpp
    tests/unified_tests.cpp
    tests/crash_detection_tests.cpp
    tests/midi_tests.cpp
    tests/preset_tests.cpp
    tests/dsp_tests.cpp
    tests/scan_tests.cpp
    tests/perf_tests.cpp
    tests/automation_tests.cpp
  )

  add_executable(collinx-audio-tests
    ${TEST_SOURCES}
    src/dsp/ParallelProcessor.cpp
    src/dsp/LatencyCompensator.cpp
    src/plugins/PluginFormatRegistry.cpp
    src/plugins/UnifiedPluginManager.cpp
    src/clap/ClapPluginFormat.cpp
    src/clap/ClapPluginScanner.cpp
    src/clap/ClapPluginLoader.cpp
    src/clap/ClapNoteExpression.cpp
    src/clap/ClapParamModulation.cpp
    src/sandbox/PluginCrashDetector.cpp
    src/sandbox/PluginHealthMonitor.cpp
    src/sandbox/CrashRecoveryManager.cpp
    src/midi/MidiEffectProcessor.cpp
    src/midi/MidiEffectChain.cpp
    src/midi/MidiRouter.cpp
    src/presets/PresetFormat.cpp
    src/presets/PresetStorage.cpp
    src/presets/PresetManager.cpp
    src/scan/AsyncScanner.cpp
    src/scan/ScanCache.cpp
    src/scan/ScanProgressReporter.cpp
    src/perf/PerformanceMonitor.cpp
    src/perf/PluginProfiler.cpp
    src/automation/AutomationCurve.cpp
    src/automation/AutomationManager.cpp
  )

  target_include_directories(collinx-audio-tests PRIVATE src)

  target_link_libraries(collinx-audio-tests PRIVATE
    juce::juce_audio_basics
    juce::juce_audio_devices
    juce::juce_audio_formats
    juce::juce_audio_processors
    # v2.8.0：与主目标保持一致（测试链接 audio-utils 以覆盖 AudioAppComponent 用法）
    juce::juce_audio_utils
    juce::juce_dsp
    juce::juce_audio_plugin_client
  )

  # v2.8.0：同上，移除对未使用 JuceHeader.h 的生成调用（详见主目标处的说明）。


  add_test(NAME Vst3Tests COMMAND collinx-audio-tests)
  add_test(NAME ClapTests COMMAND collinx-audio-tests)
  add_test(NAME MidiTests COMMAND collinx-audio-tests)
  add_test(NAME PresetTests COMMAND collinx-audio-tests)
  add_test(NAME DspTests COMMAND collinx-audio-tests)
  add_test(NAME ScanTests COMMAND collinx-audio-tests)
  add_test(NAME PerfTests COMMAND collinx-audio-tests)
  add_test(NAME AutomationTests COMMAND collinx-audio-tests)
endif()
