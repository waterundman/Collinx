#include "CrashRecoveryManager.h"
#include "PluginCrashDetector.h"
#include "PluginHealthMonitor.h"
#include "../plugins/UnifiedPluginManager.h"
#include <chrono>

CrashRecoveryManager::CrashRecoveryManager(UnifiedPluginManager& pluginManager,
                                           PluginCrashDetector& crashDetector,
                                           PluginHealthMonitor& healthMonitor)
    : pluginManager(pluginManager),
      crashDetector(crashDetector),
      healthMonitor(healthMonitor)
{
}

CrashRecoveryManager::~CrashRecoveryManager()
{
    shutdown();
}

bool CrashRecoveryManager::initialize()
{
    if (initialized.load())
        return true;

    if (!crashDetector.isInitialized() || !healthMonitor.isInitialized())
    {
        DBG("CrashRecoveryManager: Dependencies not initialized");
        return false;
    }

    // Hook into crash detector
    crashDetector.setCrashCallback([this](const PluginCrashDetector::CrashInfo& info) {
        onCrashDetected(info);
    });

    // Hook into health monitor
    healthMonitor.setHealthStateCallback(
        [this](int idx, PluginHealthMonitor::HealthState oldState,
               PluginHealthMonitor::HealthState newState) {
            onHealthStateChanged(idx, oldState, newState);
        });

    initialized.store(true);
    DBG("CrashRecoveryManager: Initialized");
    return true;
}

void CrashRecoveryManager::shutdown()
{
    if (!initialized.load())
        return;

    // Disconnect callbacks
    crashDetector.setCrashCallback(nullptr);
    healthMonitor.setHealthStateCallback(nullptr);

    {
        std::lock_guard<std::mutex> lock(stateMutex);
        savedStates.clear();
    }

    initialized.store(false);
    DBG("CrashRecoveryManager: Shut down");
}

// ── State Save / Restore ───────────────────────────────────────────────

bool CrashRecoveryManager::savePluginState(int pluginIndex)
{
    if (!initialized.load())
        return false;

    auto* plugin = pluginManager.getPlugin(pluginIndex);
    if (plugin == nullptr || plugin->instance == nullptr)
        return false;

    PluginStateSnapshot snapshot;
    snapshot.originalIndex = pluginIndex;
    snapshot.pluginName = plugin->description.name;
    snapshot.pluginIdentifier = plugin->description.fileOrIdentifier;
    snapshot.formatName = plugin->formatName;
    snapshot.wasActive = plugin->isActive;
    snapshot.wasPrepared = plugin->isPrepared;
    snapshot.timestamp = static_cast<int64_t>(
        std::chrono::system_clock::now().time_since_epoch().count());

    // Serialize plugin state via JUCE's getStateInformation
    juce::MemoryBlock stateBlock;
    plugin->instance->getStateInformation(stateBlock);
    snapshot.binaryState = stateBlock;

    std::lock_guard<std::mutex> lock(stateMutex);
    savedStates[pluginIndex] = std::move(snapshot);

    DBG("CrashRecoveryManager: Saved state for plugin '" + plugin->description.name
        + "' at index " + juce::String(pluginIndex));
    return true;
}

int CrashRecoveryManager::saveAllPluginStates()
{
    if (!initialized.load())
        return 0;

    int count = 0;
    int numPlugins = pluginManager.getNumPlugins();

    for (int i = 0; i < numPlugins; ++i)
    {
        if (pluginManager.isPluginLoaded(i))
        {
            if (savePluginState(i))
                ++count;
        }
    }

    DBG("CrashRecoveryManager: Saved state for " + juce::String(count) + " plugins");
    return count;
}

bool CrashRecoveryManager::restorePluginState(int pluginIndex)
{
    if (!initialized.load())
        return false;

    PluginStateSnapshot snapshot;
    {
        std::lock_guard<std::mutex> lock(stateMutex);
        auto it = savedStates.find(pluginIndex);
        if (it == savedStates.end())
        {
            DBG("CrashRecoveryManager: No saved state for index " + juce::String(pluginIndex));
            return false;
        }
        snapshot = it->second;
    }

    return restoreFromSnapshot(snapshot) >= 0;
}

int CrashRecoveryManager::restoreFromSnapshot(const PluginStateSnapshot& snapshot)
{
    if (!initialized.load())
        return -1;

    DBG("CrashRecoveryManager: Restoring plugin '" + snapshot.pluginName + "'");

    // Re-create the plugin description
    juce::PluginDescription desc;
    desc.name = snapshot.pluginName;
    desc.fileOrIdentifier = snapshot.pluginIdentifier;
    desc.pluginFormatName = snapshot.formatName;

    // Load the plugin
    int newIndex = pluginManager.loadPlugin(desc, snapshot.sampleRate, snapshot.blockSize);
    if (newIndex < 0)
    {
        DBG("CrashRecoveryManager: Failed to reload plugin '" + snapshot.pluginName + "'");
        return -1;
    }

    // Restore binary state
    auto* plugin = pluginManager.getPlugin(newIndex);
    if (plugin != nullptr && plugin->instance != nullptr && snapshot.binaryState.getSize() > 0)
    {
        plugin->instance->setStateInformation(
            snapshot.binaryState.getData(),
            static_cast<int>(snapshot.binaryState.getSize()));
        DBG("CrashRecoveryManager: Restored state for '" + snapshot.pluginName + "'");
    }

    // Re-prepare and activate if it was active before
    if (snapshot.wasPrepared || snapshot.wasActive)
    {
        pluginManager.preparePlugin(newIndex, snapshot.sampleRate, snapshot.blockSize);
        if (snapshot.wasActive)
            pluginManager.activatePlugin(newIndex);
    }

    DBG("CrashRecoveryManager: Restored plugin '" + snapshot.pluginName
        + "' at new index " + juce::String(newIndex));
    return newIndex;
}

// ── Configuration ──────────────────────────────────────────────────────

void CrashRecoveryManager::enableAutoRecovery(bool enabled)
{
    autoRecovery.store(enabled);
    DBG("CrashRecoveryManager: Auto-recovery " + juce::String(enabled ? "enabled" : "disabled"));
}

void CrashRecoveryManager::setMaxRecoveryAttempts(int maxAttempts)
{
    maxRecoveryAttempts = maxAttempts;
}

void CrashRecoveryManager::setRecoveryConfirmCallback(RecoveryConfirmCallback callback)
{
    confirmCallback = std::move(callback);
}

void CrashRecoveryManager::setRecoveryCompleteCallback(RecoveryCompleteCallback callback)
{
    completeCallback = std::move(callback);
}

// ── Crash History ──────────────────────────────────────────────────────

std::vector<CrashRecoveryManager::RecoveryInfo> CrashRecoveryManager::getCrashHistory() const
{
    std::lock_guard<std::mutex> lock(historyMutex);
    return crashHistory;
}

void CrashRecoveryManager::clearCrashHistory()
{
    std::lock_guard<std::mutex> lock(historyMutex);
    crashHistory.clear();
}

// ── Saved State Management ─────────────────────────────────────────────

int CrashRecoveryManager::getNumSavedStates() const
{
    std::lock_guard<std::mutex> lock(stateMutex);
    return static_cast<int>(savedStates.size());
}

bool CrashRecoveryManager::hasSavedState(int pluginIndex) const
{
    std::lock_guard<std::mutex> lock(stateMutex);
    return savedStates.find(pluginIndex) != savedStates.end();
}

void CrashRecoveryManager::removeSavedState(int pluginIndex)
{
    std::lock_guard<std::mutex> lock(stateMutex);
    savedStates.erase(pluginIndex);
}

juce::MemoryBlock CrashRecoveryManager::serializeStates() const
{
    std::lock_guard<std::mutex> lock(stateMutex);

    juce::DynamicObject::Ptr root = new juce::DynamicObject();
    auto statesArray = std::make_unique<juce::Array<juce::var>>();

    for (const auto& [idx, snapshot] : savedStates)
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty("index", snapshot.originalIndex);
        obj->setProperty("name", snapshot.pluginName);
        obj->setProperty("identifier", snapshot.pluginIdentifier);
        obj->setProperty("format", snapshot.formatName);
        obj->setProperty("sampleRate", snapshot.sampleRate);
        obj->setProperty("blockSize", snapshot.blockSize);
        obj->setProperty("wasActive", snapshot.wasActive);
        obj->setProperty("wasPrepared", snapshot.wasPrepared);
        obj->setProperty("timestamp", static_cast<int64_t>(snapshot.timestamp));

        // Encode binary state as base64
        juce::String b64 = juce::Base64::toBase64(
            snapshot.binaryState.getData(), snapshot.binaryState.getSize());
        obj->setProperty("state", b64);

        statesArray->add(juce::var(obj));
    }

    root->setProperty("states", juce::var(statesArray.release()));
    juce::String json = juce::JSON::toString(juce::var(root.get()));

    juce::MemoryBlock block;
    block.append(json.toRawUTF8(), json.getNumBytesAsUTF8());
    return block;
}

int CrashRecoveryManager::deserializeStates(const juce::MemoryBlock& data)
{
    if (data.getSize() == 0)
        return 0;

    juce::String json(static_cast<const char*>(data.getData()), data.getSize());
    auto root = juce::JSON::parse(json);

    if (!root.isObject())
        return 0;

    auto* rootObj = root.getDynamicObject();
    if (rootObj == nullptr)
        return 0;

    auto statesVar = rootObj->getProperty("states", juce::var());
    if (!statesVar.isArray())
        return 0;

    auto* statesArray = statesVar.getArray();
    if (statesArray == nullptr)
        return 0;

    int count = 0;
    std::lock_guard<std::mutex> lock(stateMutex);

    for (const auto& stateVar : *statesArray)
    {
        if (!stateVar.isObject())
            continue;

        auto* obj = stateVar.getDynamicObject();
        if (obj == nullptr)
            continue;

        PluginStateSnapshot snapshot;
        snapshot.originalIndex = obj->getProperty("index", -1);
        snapshot.pluginName = obj->getProperty("name", "").toString();
        snapshot.pluginIdentifier = obj->getProperty("identifier", "").toString();
        snapshot.formatName = obj->getProperty("format", "").toString();
        snapshot.sampleRate = obj->getProperty("sampleRate", 44100.0);
        snapshot.blockSize = obj->getProperty("blockSize", 512);
        snapshot.wasActive = obj->getProperty("wasActive", false);
        snapshot.wasPrepared = obj->getProperty("wasPrepared", false);
        snapshot.timestamp = static_cast<int64_t>(obj->getProperty("timestamp", 0));

        // Decode base64 binary state
        juce::String b64 = obj->getProperty("state", "").toString();
        if (b64.isNotEmpty())
        {
            juce::MemoryOutputStream stream;
            juce::Base64::convertFromBase64(stream, b64);
            snapshot.binaryState = stream.getMemoryBlock();
        }

        savedStates[snapshot.originalIndex] = std::move(snapshot);
        ++count;
    }

    DBG("CrashRecoveryManager: Deserialized " + juce::String(count) + " plugin states");
    return count;
}

// ── Private ────────────────────────────────────────────────────────────

void CrashRecoveryManager::onCrashDetected(const PluginCrashDetector::CrashInfo& crashInfo)
{
    DBG("CrashRecoveryManager: Crash detected for plugin " + juce::String(crashInfo.pluginIndex));

    // Save state before recovery (if plugin was loaded)
    if (crashInfo.pluginIndex >= 0)
        savePluginState(crashInfo.pluginIndex);

    // Record in history
    RecoveryInfo info;
    info.pluginIndex = crashInfo.pluginIndex;
    info.crashReason = juce::String(crashInfo.signalName) + ": " + juce::String(crashInfo.description);
    info.crashTimestamp = static_cast<int64_t>(crashInfo.timestamp);

    {
        std::lock_guard<std::mutex> lock(stateMutex);
        auto it = savedStates.find(crashInfo.pluginIndex);
        if (it != savedStates.end())
        {
            info.pluginName = it->second.pluginName;
            info.savedState = it->second;
        }
    }

    {
        std::lock_guard<std::mutex> lock(historyMutex);
        crashHistory.push_back(info);
    }

    // Trigger recovery
    executeRecovery(crashInfo.pluginIndex, info.crashReason);
}

void CrashRecoveryManager::onHealthStateChanged(int pluginIndex,
                                                 PluginHealthMonitor::HealthState oldState,
                                                 PluginHealthMonitor::HealthState newState)
{
    if (newState == PluginHealthMonitor::HealthState::Crashed)
    {
        DBG("CrashRecoveryManager: Health monitor reports crash for plugin "
            + juce::String(pluginIndex));

        // Save state and trigger recovery
        savePluginState(pluginIndex);
        executeRecovery(pluginIndex, "Health monitor detected crash");
    }
}

bool CrashRecoveryManager::executeRecovery(int pluginIndex, const juce::String& reason)
{
    if (!initialized.load())
        return false;

    // Build recovery info
    RecoveryInfo info;
    info.pluginIndex = pluginIndex;
    info.crashReason = reason;

    {
        std::lock_guard<std::mutex> lock(stateMutex);
        auto it = savedStates.find(pluginIndex);
        if (it != savedStates.end())
            info.savedState = it->second;
        info.pluginName = info.savedState.pluginName;
    }

    // Check if user confirmation is required
    if (!autoRecovery.load() && confirmCallback)
    {
        if (!confirmCallback(info))
        {
            DBG("CrashRecoveryManager: Recovery declined by user for plugin '"
                + info.pluginName + "'");
            info.recoverySuccessful = false;

            std::lock_guard<std::mutex> lock(historyMutex);
            crashHistory.push_back(info);
            return false;
        }
    }

    // Check max attempts
    {
        std::lock_guard<std::mutex> lock(historyMutex);
        for (const auto& entry : crashHistory)
        {
            if (entry.pluginIndex == pluginIndex && !entry.recoverySuccessful)
                ++info.recoveryAttempts;
        }
    }

    if (info.recoveryAttempts >= maxRecoveryAttempts)
    {
        DBG("CrashRecoveryManager: Max recovery attempts reached for plugin '"
            + info.pluginName + "'");
        info.recoverySuccessful = false;

        std::lock_guard<std::mutex> lock(historyMutex);
        crashHistory.push_back(info);

        if (completeCallback)
            completeCallback(info);
        return false;
    }

    // Attempt recovery
    DBG("CrashRecoveryManager: Attempting recovery for '" + info.pluginName
        + "' (attempt " + juce::String(info.recoveryAttempts + 1) + ")");

    int newIndex = restoreFromSnapshot(info.savedState);
    info.recoverySuccessful = (newIndex >= 0);

    if (info.recoverySuccessful)
    {
        // Update the saved state with the new index
        std::lock_guard<std::mutex> lock(stateMutex);
        auto it = savedStates.find(pluginIndex);
        if (it != savedStates.end())
        {
            auto snapshot = std::move(it->second);
            snapshot.originalIndex = newIndex;
            savedStates.erase(it);
            savedStates[newIndex] = std::move(snapshot);
        }
    }

    {
        std::lock_guard<std::mutex> lock(historyMutex);
        crashHistory.push_back(info);
    }

    if (completeCallback)
        completeCallback(info);

    return info.recoverySuccessful;
}

juce::String CrashRecoveryManager::snapshotToJson(const PluginStateSnapshot& snapshot) const
{
    auto* obj = new juce::DynamicObject();
    obj->setProperty("index", snapshot.originalIndex);
    obj->setProperty("name", snapshot.pluginName);
    obj->setProperty("identifier", snapshot.pluginIdentifier);
    obj->setProperty("format", snapshot.formatName);
    obj->setProperty("sampleRate", snapshot.sampleRate);
    obj->setProperty("blockSize", snapshot.blockSize);
    obj->setProperty("wasActive", snapshot.wasActive);
    obj->setProperty("wasPrepared", snapshot.wasPrepared);
    obj->setProperty("timestamp", static_cast<int64_t>(snapshot.timestamp));

    juce::String b64 = juce::Base64::toBase64(
        snapshot.binaryState.getData(), snapshot.binaryState.getSize());
    obj->setProperty("state", b64);

    return juce::JSON::toString(juce::var(obj));
}

CrashRecoveryManager::PluginStateSnapshot
CrashRecoveryManager::snapshotFromJson(const juce::String& json) const
{
    PluginStateSnapshot snapshot;
    auto parsed = juce::JSON::parse(json);

    if (!parsed.isObject())
        return snapshot;

    auto* obj = parsed.getDynamicObject();
    if (obj == nullptr)
        return snapshot;

    snapshot.originalIndex = obj->getProperty("index", -1);
    snapshot.pluginName = obj->getProperty("name", "").toString();
    snapshot.pluginIdentifier = obj->getProperty("identifier", "").toString();
    snapshot.formatName = obj->getProperty("format", "").toString();
    snapshot.sampleRate = obj->getProperty("sampleRate", 44100.0);
    snapshot.blockSize = obj->getProperty("blockSize", 512);
    snapshot.wasActive = obj->getProperty("wasActive", false);
    snapshot.wasPrepared = obj->getProperty("wasPrepared", false);
    snapshot.timestamp = static_cast<int64_t>(obj->getProperty("timestamp", 0));

    juce::String b64 = obj->getProperty("state", "").toString();
    if (b64.isNotEmpty())
    {
        juce::MemoryOutputStream stream;
        juce::Base64::convertFromBase64(stream, b64);
        snapshot.binaryState = stream.getMemoryBlock();
    }

    return snapshot;
}
