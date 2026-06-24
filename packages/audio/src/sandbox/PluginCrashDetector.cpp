#include "PluginCrashDetector.h"
#include <juce_core/juce_core.h>
#include <chrono>

#if defined(_WIN32)
    #ifndef WIN32_LEAN_AND_MEAN
        #define WIN32_LEAN_AND_MEAN
    #endif
    #include <windows.h>
    #include <excpt.h>
#else
    #include <signal.h>
    #include <setjmp.h>
    #include <cstring>
#endif

// ── Platform-specific state ────────────────────────────────────────────

#if !defined(_WIN32)
struct PluginCrashDetector::PreviousHandlers
{
    struct sigaction segv;
    struct sigaction abrt;
    struct sigaction fpe;
    struct sigaction bus;
};

// Thread-local jump buffer for longjmp-based recovery on Unix
static thread_local sigjmp_buf g_jumpBuffer;
static thread_local volatile sig_atomic_t g_jumpValid = 0;
static thread_local PluginCrashDetector* g_activeDetector = nullptr;
static thread_local int g_activePluginIndex = -1;
#endif

// ── Constructor / Destructor ───────────────────────────────────────────

PluginCrashDetector::PluginCrashDetector() = default;

PluginCrashDetector::~PluginCrashDetector()
{
    shutdown();
}

// ── Public API ─────────────────────────────────────────────────────────

bool PluginCrashDetector::initialize()
{
    if (initialized.load())
        return true;

    if (!initializePlatform())
    {
        DBG("PluginCrashDetector: Failed to initialize platform handlers");
        return false;
    }

    initialized.store(true);
    DBG("PluginCrashDetector: Initialized");
    return true;
}

void PluginCrashDetector::shutdown()
{
    if (!initialized.load())
        return;

    shutdownPlatform();
    initialized.store(false);
    DBG("PluginCrashDetector: Shut down");
}

void PluginCrashDetector::setCrashCallback(CrashCallback callback)
{
    std::lock_guard<std::mutex> lock(callbackMutex);
    crashCallback = std::move(callback);
}

bool PluginCrashDetector::safeExecute(int pluginIndex, std::function<void()> func)
{
    if (!initialized.load() || !func)
    {
        if (func) func();
        return true;
    }

    lastCrashDetected.store(false);
    currentPluginIndex.store(pluginIndex);

#if defined(_WIN32)
    // ── Windows SEH ─────────────────────────────────────────────────
    __try
    {
        func();
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
        DWORD code = GetExceptionCode();
        std::string signalName;
        std::string desc;

        switch (code)
        {
            case EXCEPTION_ACCESS_VIOLATION:
                signalName = "ACCESS_VIOLATION";
                desc = "Memory access violation";
                break;
            case EXCEPTION_STACK_OVERFLOW:
                signalName = "STACK_OVERFLOW";
                desc = "Stack overflow";
                break;
            case EXCEPTION_INT_DIVIDE_BY_ZERO:
                signalName = "DIVIDE_BY_ZERO";
                desc = "Integer division by zero";
                break;
            case EXCEPTION_ILLEGAL_INSTRUCTION:
                signalName = "ILLEGAL_INSTRUCTION";
                desc = "Illegal instruction";
                break;
            case EXCEPTION_FLT_DIVIDE_BY_ZERO:
                signalName = "FLT_DIVIDE_BY_ZERO";
                desc = "Float division by zero";
                break;
            default:
                signalName = "UNKNOWN (" + std::to_string(code) + ")";
                desc = "Unknown exception";
                break;
        }

        lastCrashDetected.store(true);
        reportCrash(pluginIndex, signalName, desc, "");
        return false;
    }
#else
    // ── Unix signal handler with longjmp ────────────────────────────
    g_activeDetector = this;
    g_activePluginIndex = pluginIndex;

    if (sigsetjmp(g_jumpBuffer, 1) == 0)
    {
        g_jumpValid = 1;
        func();
        g_jumpValid = 0;
        g_activeDetector = nullptr;
        return true;
    }
    else
    {
        g_jumpValid = 0;
        g_activeDetector = nullptr;
        lastCrashDetected.store(true);
        // Crash info was already reported in the signal handler
        return false;
    }
#endif
}

PluginCrashDetector::CrashInfo PluginCrashDetector::getLastCrashInfo() const
{
    std::lock_guard<std::mutex> lock(crashInfoMutex);
    return lastCrashInfo;
}

// ── Private ────────────────────────────────────────────────────────────

void PluginCrashDetector::reportCrash(int pluginIndex, const std::string& signalName,
                                      const std::string& description, const std::string& address)
{
    CrashInfo info;
    info.pluginIndex = pluginIndex;
    info.signalName = signalName;
    info.description = description;
    info.address = address;
    info.timestamp = static_cast<uint64_t>(
        std::chrono::system_clock::now().time_since_epoch().count());

    {
        std::lock_guard<std::mutex> lock(crashInfoMutex);
        lastCrashInfo = info;
    }

    DBG("PluginCrashDetector: Crash detected for plugin " + juce::String(pluginIndex)
        + " — " + juce::String(signalName));

    CrashCallback cb;
    {
        std::lock_guard<std::mutex> lock(callbackMutex);
        cb = crashCallback;
    }

    if (cb)
        cb(info);
}

// ── Platform-specific implementation ───────────────────────────────────

#if defined(_WIN32)

// Windows: SEH — no global handler needed; __try/__except is per-call.
bool PluginCrashDetector::initializePlatform()
{
    // Nothing to install globally — we use structured exception handling
    // inline in safeExecute(). This avoids interfering with other handlers.
    return true;
}

void PluginCrashDetector::shutdownPlatform()
{
    // Nothing to tear down.
}

#else

// Unix: signal handlers for crash recovery via longjmp.
static struct sigaction g_oldSegv;
static struct sigaction g_oldAbrt;
static struct sigaction g_oldFpe;
static struct sigaction g_oldBus;

static void crashSignalHandler(int sig, siginfo_t* info, void* ucontext)
{
    (void)ucontext;

    if (g_jumpValid && g_activeDetector != nullptr)
    {
        std::string signalName;
        std::string desc;

        switch (sig)
        {
            case SIGSEGV:
                signalName = "SIGSEGV";
                desc = "Segmentation fault";
                break;
            case SIGABRT:
                signalName = "SIGABRT";
                desc = "Abort signal";
                break;
            case SIGFPE:
                signalName = "SIGFPE";
                desc = "Floating-point exception";
                break;
            case SIGBUS:
                signalName = "SIGBUS";
                desc = "Bus error";
                break;
            default:
                signalName = "SIGNAL_" + std::to_string(sig);
                desc = "Unknown signal";
                break;
        }

        char addrBuf[32];
        snprintf(addrBuf, sizeof(addrBuf), "%p", info->si_addr);

        g_activeDetector->reportCrash(g_activePluginIndex, signalName, desc, addrBuf);

        // Jump back to safeExecute
        g_jumpValid = 0;
        siglongjmp(g_jumpBuffer, 1);
    }
    else
    {
        // No jump target — restore default handler and re-raise
        struct sigaction sa;
        sa.sa_handler = SIG_DFL;
        sigemptyset(&sa.sa_mask);
        sa.sa_flags = 0;
        sigaction(sig, &sa, nullptr);
        raise(sig);
    }
}

bool PluginCrashDetector::initializePlatform()
{
    prevHandlers = new PreviousHandlers();

    struct sigaction sa;
    sa.sa_sigaction = crashSignalHandler;
    sigemptyset(&sa.sa_mask);
    sa.sa_flags = SA_SIGINFO;

    sigaction(SIGSEGV, &sa, &prevHandlers->segv);
    sigaction(SIGABRT, &sa, &prevHandlers->abrt);
    sigaction(SIGFPE,  &sa, &prevHandlers->fpe);
    sigaction(SIGBUS,  &sa, &prevHandlers->bus);

    return true;
}

void PluginCrashDetector::shutdownPlatform()
{
    if (prevHandlers != nullptr)
    {
        // Restore previous handlers
        sigaction(SIGSEGV, &prevHandlers->segv, nullptr);
        sigaction(SIGABRT, &prevHandlers->abrt, nullptr);
        sigaction(SIGFPE,  &prevHandlers->fpe,  nullptr);
        sigaction(SIGBUS,  &prevHandlers->bus,  nullptr);

        delete prevHandlers;
        prevHandlers = nullptr;
    }
}

#endif
