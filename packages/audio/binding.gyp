{
  "targets": [
    {
      "target_name": "vst3-host-addon",
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++20"],
      "sources": [
        "src/napi/Vst3HostAddon.cpp",
        "src/napi/PluginManagerBridge.cpp",
        "src/napi/AudioProcessorBridge.cpp",
        "src/vst3/Vst3HostManager.cpp",
        "src/vst3/Vst3PluginScanner.cpp",
        "src/vst3/Vst3PluginLoader.cpp",
        "src/vst3/PluginProcessor.cpp",
        "src/vst3/PluginChain.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "src"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "JUCE_GLOBAL_MODULE_SETTINGS_INCLUDED=1"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "defines": [
              "_WIN32",
              "WIN32",
              "_WINDOWS",
              "JUCE_WINDOWS=1"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": ["/std:c++20"],
                "ExceptionHandling": 1
              }
            },
            "libraries": [
              "-lwinmm",
              "-lws2_32",
              "-lole32",
              "-loleaut32",
              "-limm32",
              "-lversion",
              "-lshlwapi"
            ]
          }
        ],
        [
          "OS=='mac'",
          {
            "defines": [
              "JUCE_MAC=1"
            ],
            "xcode_settings": {
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "CLANG_CXX_LIBRARY": "libc++",
              "MACOSX_DEPLOYMENT_TARGET": "10.15",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++20"
            },
            "libraries": [
              "-framework CoreAudio",
              "-framework CoreMIDI",
              "-framework AudioToolbox",
              "-framework CoreFoundation",
              "-framework Cocoa",
              "-framework IOKit",
              "-framework Security"
            ]
          }
        ],
        [
          "OS=='linux'",
          {
            "defines": [
              "JUCE_LINUX=1"
            ],
            "libraries": [
              "-lpthread",
              "-ldl",
              "-lrt",
              "-lasound"
            ]
          }
        ]
      ]
    }
  ]
}
