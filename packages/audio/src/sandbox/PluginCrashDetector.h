#pragma once

#include <functional>
#include <atomic>
#include <mutex>
#include <string>
#include <cstdint>

/**
 * PluginCrashDetector — Platform-specific crash detection for plugins.
 *
 * Wraps SEH (Windows) and signal handlers (Unix) to catch crashes
 * originating from plugin code without terminating the host application.
 *
 * Usage:
 *   PluginCrashDetector detector;
 *   detector.initialize();
 *   detector.setCrashCallback([](const auto& info) { ... });
 *   bool ok = detector.safeExecute(pluginIndex, [&]() { plugin->processBlock(...); });
 */
class PluginCrashDetector
{
public:
    /**
     * Information about a detected crash.
     */
    struct CrashInfo
    {
        int pluginIndex = -1;
        std::string signalName;
        std::string description;
        std::string address;
        uint64_t timestamp = 0;
    };

    /**
     * Crash callback type. Called when a crash is detected.
     * The callback runs in a signal-handler or SEH context — keep it minimal.
     */
    using CrashCallback = std::function<void(const CrashInfo&)>;

    PluginCrashDetector();
    ~PluginCrashDetector();

    /**
     * Install platform-specific crash handlers.
     * @return true if handlers were installed successfully.
     */
    bool initialize();

    /**
     * Restore original crash handlers.
     */
    void shutdown();

    /**
     * Set the callback invoked when a crash is detected.
     * @param callback Function to call on crash.
     */
    void setCrashCallback(CrashCallback callback);

    /**
     * Execute a function within a protected context.
     * If the function triggers a crash, the crash is caught and reported.
     * @param pluginIndex Index of the plugin being executed (for reporting).
     * @param func The function to execute safely.
     * @return true if the function completed without crashing.
     */
    bool safeExecute(int pluginIndex, std::function<void()> func);

    /**
     * Check if a crash was detected during the last safeExecute call.
     */
    bool didCrash() const { return lastCrashDetected.load(); }

    /**
     * Get crash info from the last detected crash.
     */
    CrashInfo getLastCrashInfo() const;

    /**
     * Check if the detector is initialized.
     */
    bool isInitialized() const { return initialized.load(); }

    /**
     * Internal crash report — called from the platform handler.
     *
     * 必须是 public：Unix 侧的处理器是 .cpp 中的 static 自由函数
     * crashSignalHandler()（PluginCrashDetector.cpp:220），它不属于本类，无权
     * 访问私有成员。也不能改用 friend：
     *   1) friend 声明会把这个名字引入命名空间作用域并赋予外部链接，与 .cpp 里
     *      的 `static` 定义冲突（static declaration follows non-static declaration）；
     *   2) friend 声明需要写出完整签名，其中 siginfo_t 依赖 <signal.h>，会破坏本
     *      头文件「std-only、不引入 JUCE/平台头」的约定。
     * 另一个调用点 safeExecute() 的 Windows SEH 分支（.cpp:131）是成员函数，
     * 不受本改动影响；本方法仍属内部实现，外部调用方请使用 safeExecute()。
     */
    void reportCrash(int pluginIndex, const std::string& signalName,
                     const std::string& description, const std::string& address);

private:
    CrashCallback crashCallback;
    mutable std::mutex callbackMutex;

    std::atomic<bool> initialized{false};
    std::atomic<bool> lastCrashDetected{false};
    std::atomic<int> currentPluginIndex{-1};

    CrashInfo lastCrashInfo;
    mutable std::mutex crashInfoMutex;

    // Platform-specific: store previous handler for restoration
#if defined(_WIN32)
    void* previousSehHandler = nullptr;
#else
    // Store previous signal handlers (SIGSEGV, SIGABRT, SIGFPE, SIGBUS)
    struct PreviousHandlers;
    PreviousHandlers* prevHandlers = nullptr;
#endif

    /**
     * Platform-specific initialization.
     */
    bool initializePlatform();

    /**
     * Platform-specific shutdown.
     */
    void shutdownPlatform();

    // 本头文件刻意不依赖 JUCE（sandbox 崩溃处理层保持 std-only，只有 .cpp 才
    // include juce_core），所以这里的 JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR
    // 从未被展开，被编译器当成无类型的成员声明：
    //   error: ISO C++ forbids declaration of
    //          'JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR' with no type
    // 改为它展开后的 std 等价物。宏原文（juce_core/system/juce_PlatformDefs.h:240/254）：
    //   JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(x)
    //     = JUCE_DECLARE_NON_COPYABLE(x) + JUCE_LEAK_DETECTOR(x)
    //     = "x(const x&) = delete; x& operator=(const x&) = delete;" + 泄漏检测器
    // 其中 LEAK_DETECTOR 依赖 juce::LeakedObjectDetector，本头文件不可用也不适用。
    PluginCrashDetector(const PluginCrashDetector&) = delete;
    PluginCrashDetector& operator=(const PluginCrashDetector&) = delete;
};
