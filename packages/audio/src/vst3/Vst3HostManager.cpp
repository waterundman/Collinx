#include "Vst3HostManager.h"
#include "../plugins/UnifiedPluginManager.h"

Vst3HostManager::Vst3HostManager() = default;

Vst3HostManager::~Vst3HostManager()
{
    shutdown();
}

bool Vst3HostManager::initialize()
{
    if (initialized)
        return true;

    // Add VST3 plugin format to the manager
    formatManager.addDefaultFormats();

    // Initialize the scanner with format manager
    if (!scanner.initialize(&formatManager))
    {
        DBG("Vst3HostManager: Failed to initialize scanner");
        return false;
    }

    // Initialize the loader with format manager
    if (!loader.initialize(&formatManager))
    {
        DBG("Vst3HostManager: Failed to initialize loader");
        return false;
    }

    initialized = true;
    DBG("Vst3HostManager: Initialized successfully");
    return true;
}

void Vst3HostManager::shutdown()
{
    if (!initialized)
        return;

    // Unload all plugins first
    loader.unloadAll();

    scanner.shutdown();
    loader.shutdown();

    // Detach from unified manager if integrated
    unifiedManager = nullptr;

    initialized = false;
    DBG("Vst3HostManager: Shut down");
}

void Vst3HostManager::setUnifiedManager(UnifiedPluginManager* manager)
{
    unifiedManager = manager;

    if (manager != nullptr)
    {
        DBG("Vst3HostManager: Integrated with UnifiedPluginManager");
    }
    else
    {
        DBG("Vst3HostManager: Detached from UnifiedPluginManager");
    }
}
