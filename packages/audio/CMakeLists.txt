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
  juce::juce_dsp
)

juce_generate_juce_header(collinx-audio-engine)

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
    juce::juce_dsp
    juce::juce_audio_plugin_client
  )

  juce_generate_juce_header(collinx-audio-tests)

  add_test(NAME Vst3Tests COMMAND collinx-audio-tests)
  add_test(NAME ClapTests COMMAND collinx-audio-tests)
  add_test(NAME MidiTests COMMAND collinx-audio-tests)
  add_test(NAME PresetTests COMMAND collinx-audio-tests)
  add_test(NAME DspTests COMMAND collinx-audio-tests)
  add_test(NAME ScanTests COMMAND collinx-audio-tests)
  add_test(NAME PerfTests COMMAND collinx-audio-tests)
  add_test(NAME AutomationTests COMMAND collinx-audio-tests)
endif()
