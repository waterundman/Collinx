#include "PluginHealthMonitor.h"
#include "PluginCrashDetector.h"
#include "../plugins/UnifiedPluginManager.h"

PluginHealthMonitor::PluginHealthMonitor(UnifiedPluginManager& pluginManager,
                                         PluginCrashDetector& crashDetector)
    : pluginManager(pluginManager), crashDetector(crashDetector)
{
}

PluginHealthMonitor::~PluginHealthMonitor()
{
    shutdown();
}

bool PluginHealthMonitor::initialize()
{
    if (initialized.load())
        return true;

    if (!crashDetector.isInitialized())
    {
        DBG("PluginHealthMonitor: CrashDetector not initialized");
        return false;
    }

    initialized.store(true);
    DBG("PluginHealthMonitor: Initialized");
    return true;
}

void PluginHealthMonitor::shutdown()
{
    if (!initialized.load())
        return;

    stopMonitoring();

    {
        std::lock_guard<std::mutex> lock(statusMutex);
        pluginStatuses.clear();
    }

    initialized.store(false);
    DBG("PluginHealthMonitor: Shut down");
}

void PluginHealthMonitor::registerPlugin(int pluginIndex, const juce::String& pluginName)
{
    std::lock_guard<std::mutex> lock(statusMutex);

    PluginHealthStatus status;
    status.pluginIndex = pluginIndex;
    status.pluginName = pluginName;
    status.state = HealthState::Healthy;
    status.consecutiveFailures = 0;
    status.lastSuccessfulCheck = currentTimeMs();
    status.lastCheckTime = currentTimeMs();
    status.autoRecoveryEnabled = true;

    pluginStatuses[pluginIndex] = status;
    DBG("PluginHealthMonitor: Registered plugin '" + pluginName
        + "' at index " + juce::String(pluginIndex));
}

void PluginHealthMonitor::unregisterPlugin(int pluginIndex)
{
    std::lock_guard<std::mutex> lock(statusMutex);
    pluginStatuses.erase(pluginIndex);
    DBG("PluginHealthMonitor: Unregistered plugin at index " + juce::String(pluginIndex));
}

void PluginHealthMonitor::startMonitoring()
{
    if (monitoring.load())
        return;

    monitoring.store(true);
    monitorThread = std::thread(&PluginHealthMonitor::monitoringLoop, this);
    DBG("PluginHealthMonitor: Monitoring started");
}

void PluginHealthMonitor::stopMonitoring()
{
    if (!monitoring.load())
        return;

    monitoring.store(false);
    if (monitorThread.joinable())
        monitorThread.join();
    DBG("PluginHealthMonitor: Monitoring stopped");
}

bool PluginHealthMonitor::checkPluginHealth(int pluginIndex)
{
    if (!initialized.load())
        return false;

    // Verify the plugin is still loaded
    if (!pluginManager.isPluginLoaded(pluginIndex))
    {
        if (updatePluginState(pluginIndex, HealthState::Disabled))
            attemptRecovery(pluginIndex);
        return false;
    }

    auto* plugin = pluginManager.getPlugin(pluginIndex);
    if (plugin == nullptr || plugin->instance == nullptr)
    {
        if (updatePluginState(pluginIndex, HealthState::Disabled))
            attemptRecovery(pluginIndex);
        return false;
    }

    // Execute a lightweight operation within the crash detector
    bool healthy = false;
    bool crashed = false;

    healthy = crashDetector.safeExecute(pluginIndex, [&]() {
        // Ping the plugin by querying its name — this exercises the plugin's
        // IPC boundary without triggering audio processing.
        auto name = plugin->instance->getName();
        (void)name;
    });

    crashed = crashDetector.didCrash();

    // Determine new state under lock, then apply state change outside lock
    // to avoid deadlock (updatePluginState fires callbacks and may trigger recovery)
    bool needsRecovery = false;
    bool result = healthy;

    {
        std::lock_guard<std::mutex> lock(statusMutex);
        auto it = pluginStatuses.find(pluginIndex);
        if (it == pluginStatuses.end())
            return false;

        auto& status = it->second;
        status.lastCheckTime = currentTimeMs();

        if (crashed)
        {
            status.consecutiveFailures++;
            if (status.consecutiveFailures >= maxConsecutiveFailures)
            {
                status.state = HealthState::Crashed;
                needsRecovery = status.autoRecoveryEnabled;
                result = false;
            }
            else
            {
                status.state = HealthState::Unresponsive;
                needsRecovery = status.autoRecoveryEnabled;
                result = false;
            }
        }
        else if (!healthy)
        {
            // Check if timed out
            auto elapsed = currentTimeMs() - status.lastSuccessfulCheck;
            if (elapsed > unresponsiveTimeoutMs)
            {
                status.consecutiveFailures++;
                if (status.consecutiveFailures >= maxConsecutiveFailures)
                {
                    status.state = HealthState::Crashed;
                    needsRecovery = status.autoRecoveryEnabled;
                }
                else
                {
                    status.state = HealthState::Unresponsive;
                    needsRecovery = status.autoRecoveryEnabled;
                }
                result = false;
            }
        }
        else
        {
            status.consecutiveFailures = 0;
            status.lastSuccessfulCheck = currentTimeMs();
            status.state = HealthState::Healthy;
            result = true;
        }
    }

    // Fire callbacks and attempt recovery outside the lock to prevent deadlock
    if (needsRecovery)
    {
        // Notify state change via callback
        if (healthStateCallback)
        {
            HealthState currentState = HealthState::Healthy;
            juce::String name;
            {
                std::lock_guard<std::mutex> lock(statusMutex);
                auto it = pluginStatuses.find(pluginIndex);
                if (it != pluginStatuses.end())
                {
                    currentState = it->second.state;
                    name = it->second.pluginName;
                }
            }
            DBG("PluginHealthMonitor: Plugin '" + name + "' state changed to "
                + juce::String(static_cast<int>(currentState)));
            healthStateCallback(pluginIndex, HealthState::Healthy, currentState);
        }

        attemptRecovery(pluginIndex);
    }

    return result;
}

int PluginHealthMonitor::checkAllPlugins()
{
    if (!initialized.load())
        return 0;

    int healthyCount = 0;

    std::vector<int> indices;
    {
        std::lock_guard<std::mutex> lock(statusMutex);
        for (const auto& [idx, status] : pluginStatuses)
            indices.push_back(idx);
    }

    for (int idx : indices)
    {
        if (checkPluginHealth(idx))
            ++healthyCount;
    }

    return healthyCount;
}

PluginHealthMonitor::PluginHealthStatus PluginHealthMonitor::getPluginHealth(int pluginIndex) const
{
    std::lock_guard<std::mutex> lock(statusMutex);

    auto it = pluginStatuses.find(pluginIndex);
    if (it != pluginStatuses.end())
        return it->second;

    return {};
}

std::vector<PluginHealthMonitor::PluginHealthStatus> PluginHealthMonitor::getAllPluginHealth() const
{
    std::lock_guard<std::mutex> lock(statusMutex);

    std::vector<PluginHealthStatus> result;
    result.reserve(pluginStatuses.size());
    for (const auto& [idx, status] : pluginStatuses)
        result.push_back(status);

    return result;
}

void PluginHealthMonitor::setCheckInterval(int intervalMs)
{
    checkIntervalMs = intervalMs;
}

void PluginHealthMonitor::setUnresponsiveTimeout(int timeoutMs)
{
    unresponsiveTimeoutMs = timeoutMs;
}

void PluginHealthMonitor::setMaxConsecutiveFailures(int maxFailures)
{
    maxConsecutiveFailures = maxFailures;
}

void PluginHealthMonitor::setAutoRecovery(int pluginIndex, bool enabled)
{
    std::lock_guard<std::mutex> lock(statusMutex);
    auto it = pluginStatuses.find(pluginIndex);
    if (it != pluginStatuses.end())
        it->second.autoRecoveryEnabled = enabled;
}

void PluginHealthMonitor::setHealthStateCallback(HealthStateCallback callback)
{
    healthStateCallback = std::move(callback);
}

void PluginHealthMonitor::setUnresponsiveCallback(UnresponsiveCallback callback)
{
    unresponsiveCallback = std::move(callback);
}

int PluginHealthMonitor::getNumRegistered() const
{
    std::lock_guard<std::mutex> lock(statusMutex);
    return static_cast<int>(pluginStatuses.size());
}

// ── Private ────────────────────────────────────────────────────────────

void PluginHealthMonitor::monitoringLoop()
{
    DBG("PluginHealthMonitor: Monitor thread started");

    while (monitoring.load())
    {
        checkAllPlugins();

        // Sleep in small increments so we can respond to stopMonitoring quickly
        for (int elapsed = 0; elapsed < checkIntervalMs && monitoring.load(); elapsed += 100)
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
    }

    DBG("PluginHealthMonitor: Monitor thread stopped");
}

bool PluginHealthMonitor::updatePluginState(int pluginIndex, HealthState newState)
{
    // Acquires statusMutex internally. Returns true if recovery should be attempted.
    HealthState oldState;
    juce::String pluginName;
    bool shouldRecover = false;
    HealthStateCallback stateCb;
    UnresponsiveCallback unrespCb;

    {
        std::lock_guard<std::mutex> lock(statusMutex);
        auto it = pluginStatuses.find(pluginIndex);
        if (it == pluginStatuses.end())
            return false;

        auto& status = it->second;
        oldState = status.state;

        if (oldState == newState)
            return false;

        status.state = newState;
        pluginName = status.pluginName;
        shouldRecover = (newState == HealthState::Unresponsive || newState == HealthState::Crashed)
                        && status.autoRecoveryEnabled;

        stateCb = healthStateCallback;
        unrespCb = unresponsiveCallback;
    }

    // Fire callbacks outside the lock
    DBG("PluginHealthMonitor: Plugin '" + pluginName + "' state changed: "
        + juce::String(static_cast<int>(oldState)) + " -> "
        + juce::String(static_cast<int>(newState)));

    if (stateCb)
        stateCb(pluginIndex, oldState, newState);

    if (newState == HealthState::Unresponsive && unrespCb)
        unrespCb(pluginIndex, pluginName);

    return shouldRecover;
}

bool PluginHealthMonitor::attemptRecovery(int pluginIndex)
{
    // Called WITHOUT statusMutex held. Acquires the lock only briefly for map access.
    juce::String pluginName;
    {
        std::lock_guard<std::mutex> lock(statusMutex);
        auto it = pluginStatuses.find(pluginIndex);
        if (it == pluginStatuses.end())
            return false;
        pluginName = it->second.pluginName;
        it->second.state = HealthState::Recovering;
    }

    DBG("PluginHealthMonitor: Attempting recovery for '" + pluginName + "'");

    // Attempt to unload and reload the plugin
    auto* plugin = pluginManager.getPlugin(pluginIndex);
    if (plugin == nullptr)
    {
        updatePluginState(pluginIndex, HealthState::Disabled);
        return false;
    }

    // Save the description for reloading
    juce::PluginDescription desc = plugin->description;
    double sampleRate = 44100.0;
    int blockSize = 512;

    // Unload the crashed plugin
    pluginManager.unloadPlugin(pluginIndex);

    // Reload
    int newIndex = pluginManager.loadPlugin(desc, sampleRate, blockSize);
    if (newIndex >= 0)
    {
        DBG("PluginHealthMonitor: Recovery succeeded for '" + pluginName
            + "' (new index: " + juce::String(newIndex) + ")");

        // Update registration directly under lock (avoid calling
        // unregisterPlugin/registerPlugin which each acquire the lock)
        {
            std::lock_guard<std::mutex> lock(statusMutex);
            pluginStatuses.erase(pluginIndex);

            PluginHealthStatus newStatus;
            newStatus.pluginIndex = newIndex;
            newStatus.pluginName = pluginName;
            newStatus.state = HealthState::Healthy;
            newStatus.consecutiveFailures = 0;
            newStatus.lastSuccessfulCheck = currentTimeMs();
            newStatus.lastCheckTime = currentTimeMs();
            newStatus.autoRecoveryEnabled = true;
            pluginStatuses[newIndex] = newStatus;
        }

        pluginManager.activatePlugin(newIndex);
        return true;
    }

    DBG("PluginHealthMonitor: Recovery failed for '" + pluginName + "'");
    updatePluginState(pluginIndex, HealthState::Disabled);
    return false;
}

int64_t PluginHealthMonitor::currentTimeMs()
{
    return static_cast<int64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count());
}
