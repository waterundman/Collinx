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
  # v2.8.0：juce::ValueTree 所在模块（此前代码 include 了但未显式链接）
  juce::juce_data_structures
  # v2.8.0：AudioEngine 继承 juce::AudioAppComponent（audio-engine.h:11），
  # 该类定义在 juce_audio_utils 模块。缺它会导致
  # "expected class-name before ',' token"，并连带让所有 override 声明失败。
  juce::juce_audio_utils
  juce::juce_dsp
)

# v2.8.0：引擎不需要 WebView。juce_gui_extra 会因 JUCE_WEB_BROWSER 默认开启
# 而 #include <gtk/gtk.h>；我们用的是普通 add_executable，JUCE 的 pkg-config
# include 路径不会自动传入（只有 juce_add_* 目标才会）。直接关掉这个用不到的组件。
target_compile_definitions(collinx-audio-engine PRIVATE JUCE_WEB_BROWSER=0)
# v2.8.0：同理关掉 libcurl —— JUCE_USE_CURL 默认开启，juce_core 会引用
# curl_easy_* / curl_multi_* 等符号，而 pkg-config 的 curl 库不会自动传进链接器，
# 导致链接期 46 个 undefined reference。引擎不需要联网功能。
target_compile_definitions(collinx-audio-engine PRIVATE JUCE_USE_CURL=0)
# v2.8.0（第 31 轮）：JUCE 的 VST3 宿主支持是**编译期开关**。不定义
# JUCE_PLUGINHOST_VST3 时，AudioPluginFormatManager::addDefaultFormats()
# 根本不会注册 VST3PluginFormat（Linux 上也同样），于是
# PluginFormatRegistry 拿不到 "VST3"，测试里 4 条相关断言必然失败。
# 引擎的职责就是宿主 VST3，故显式开启。
target_compile_definitions(collinx-audio-engine PRIVATE JUCE_PLUGINHOST_VST3=1)

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
    # v2.8.0（第 28 轮）：漏了整个 src/vst3 实现 → 链接期 29 个 undefined reference
    # （PluginChain / Vst3HostManager / Vst3PluginLoader / Vst3PluginScanner /
    #   PluginProcessor）。这些 .cpp 在主目标里已编译通过，此处补齐同一份清单。
    src/vst3/Vst3HostManager.cpp
    src/vst3/Vst3PluginScanner.cpp
    src/vst3/Vst3PluginLoader.cpp
    src/vst3/PluginProcessor.cpp
    src/vst3/PluginChain.cpp
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
    # v2.8.0：juce::ValueTree 所在模块（此前代码 include 了但未显式链接）
    juce::juce_data_structures
    # v2.8.0：与主目标保持一致（测试链接 audio-utils 以覆盖 AudioAppComponent 用法）
    juce::juce_audio_utils
    juce::juce_dsp
    juce::juce_audio_plugin_client
  )

  target_compile_definitions(collinx-audio-tests PRIVATE JUCE_WEB_BROWSER=0)
  target_compile_definitions(collinx-audio-tests PRIVATE JUCE_USE_CURL=0)
  # v2.8.0（审查发现）：scan_tests.cpp 用 21 个 C 标准 assert()，而 CI 是
  # CMAKE_BUILD_TYPE=Release → 默认 -DNDEBUG → assert 被整体移除。
  # 也就是说 scan_tests 一直是空跑通过。这里对测试目标 undefine NDEBUG，
  # 让断言真正生效（注意：不能用 NDEBUG=0，assert 只看是否定义）。
  target_compile_options(collinx-audio-tests PRIVATE -UNDEBUG)
  # v2.8.0（第 31 轮）：与主目标一致，否则 addDefaultFormats() 不注册 VST3，
  # registry 相关断言（Has VST3 / Detect VST3 File / Format Names）必挂。
  target_compile_definitions(collinx-audio-tests PRIVATE JUCE_PLUGINHOST_VST3=1)

  # v2.8.0：同上，移除对未使用 JuceHeader.h 的生成调用（详见主目标处的说明）。


  # ⚠️ 以下 8 个 add_test 跑的是**同一个二进制**（单入口 vst3_tests.cpp 的
  # JUCEApplication::initialise 里依次调度全部 suite）。所以 ctest 的
  # "8/8 passed" 实际含义是「同一套 201 条用例跑了 8 遍」，各 NAME 不对应
  # 独立子集。保留 8 个只是为了失败时能看出是哪次运行挂了；跑一遍约 1 秒。
  # 若要真正按 suite 分流，需要给二进制加 argv 参数选择入口。
  add_test(NAME Vst3Tests COMMAND collinx-audio-tests)
  add_test(NAME ClapTests COMMAND collinx-audio-tests)
  add_test(NAME MidiTests COMMAND collinx-audio-tests)
  add_test(NAME PresetTests COMMAND collinx-audio-tests)
  add_test(NAME DspTests COMMAND collinx-audio-tests)
  add_test(NAME ScanTests COMMAND collinx-audio-tests)
  add_test(NAME PerfTests COMMAND collinx-audio-tests)
  add_test(NAME AutomationTests COMMAND collinx-audio-tests)
endif()

# ─────────────────────────────────────────────────────────────────────────
# 可选：Node addon（@collinx/audio-native）
#
# 为什么不用 binding.gyp：那份配置定义了 JUCE_* 宏，却**没有任何 JUCE
# include 路径**，也没装 node-addon-api —— 也就是说它从未构建成功过。
# 这里复用 CMake 已经拉好的 JUCE，用 -DBUILD_NAPI=ON 显式开启。
#
# 产物：collinx-audio-native.node（含 SynthBridge + VST3 宿主桥）
# ─────────────────────────────────────────────────────────────────────────
option(BUILD_NAPI "Build Node addon (@collinx/audio-native)" OFF)

if(BUILD_NAPI)
  find_path(NODE_ADDON_API_INCLUDE napi.h
    PATHS
      ${CMAKE_CURRENT_SOURCE_DIR}/node_modules/node-addon-api
      ${CMAKE_CURRENT_SOURCE_DIR}/../../node_modules/node-addon-api
      ${CMAKE_CURRENT_SOURCE_DIR}/../../packages/ui/node_modules/node-addon-api
    NO_DEFAULT_PATH)

  if(NOT NODE_ADDON_API_INCLUDE)
    message(FATAL_ERROR
      "BUILD_NAPI=ON 但找不到 node-addon-api。先执行：\n"
      "  npm i -D node-addon-api（在 packages/audio 或仓库根目录）")
  endif()
  message(STATUS "node-addon-api: ${NODE_ADDON_API_INCLUDE}")

  # node-addon-api 的 napi.h 会 #include <node_api.h>，后者在 Node 自己的
  # include/node 目录里（不属于 node-addon-api 包）。用 node 的可执行路径推导：
  #   <prefix>/bin/node  →  <prefix>/include/node
  find_program(NODE_EXECUTABLE node REQUIRED)
  execute_process(
    COMMAND ${NODE_EXECUTABLE} -p
            "require('path').resolve(process.execPath,'../../include/node')"
    OUTPUT_VARIABLE NODE_INCLUDE_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET)
  if(NOT EXISTS "${NODE_INCLUDE_DIR}/node_api.h")
    message(FATAL_ERROR
      "找不到 node_api.h（推导路径 ${NODE_INCLUDE_DIR}）。若 Node 由包管理器安装，"
      "请额外安装 node 头文件包（如 libnode-dev）。")
  endif()
  message(STATUS "node headers: ${NODE_INCLUDE_DIR}")

  add_library(collinx-audio-native SHARED
    src/napi/Vst3HostAddon.cpp
    src/napi/PluginManagerBridge.cpp
    src/napi/AudioProcessorBridge.cpp
    src/napi/SynthBridge.cpp
    src/vst3/Vst3HostManager.cpp
    src/vst3/Vst3PluginScanner.cpp
    src/vst3/Vst3PluginLoader.cpp
    src/vst3/PluginProcessor.cpp
    src/vst3/PluginChain.cpp
    src/builtin-synth.cpp
    src/wavetable-synth.cpp
    src/transport.cpp
  )

  target_include_directories(collinx-audio-native PRIVATE
    ${NODE_ADDON_API_INCLUDE}
    ${NODE_INCLUDE_DIR}
    src)

  target_compile_definitions(collinx-audio-native PRIVATE
    NAPI_VERSION=8
    NAPI_DISABLE_CPP_EXCEPTIONS
    JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0)

  target_link_libraries(collinx-audio-native PRIVATE
    juce::juce_audio_basics
    juce::juce_audio_devices
    juce::juce_audio_formats
    juce::juce_audio_processors
    juce::juce_data_structures
    juce::juce_dsp)

  # Node 只认 .node 后缀，且不需要 lib 前缀
  set_target_properties(collinx-audio-native PROPERTIES
    PREFIX ""
    SUFFIX ".node")
endif()
