#include "ClapParamModulation.h"
#include <algorithm>
#include <cmath>

ClapParamModulation::ClapParamModulation() = default;
ClapParamModulation::~ClapParamModulation() = default;

// ── Lifecycle ───────────────────────────────────────────────────────

void ClapParamModulation::prepare(double sampleRate, int maxParams)
{
    currentSampleRate = sampleRate;
    maxParamCount = maxParams;
    prepared = true;
}

void ClapParamModulation::release()
{
    std::lock_guard<std::mutex> lock(modsMutex);
    paramMods.clear();
    routes.clear();
    sourceValues.clear();
    prepared = false;
}

void ClapParamModulation::reset()
{
    std::lock_guard<std::mutex> lock(modsMutex);
    sourceValues.clear();
}

// ── Parameter modulation (single entries) ───────────────────────────

void ClapParamModulation::setModulationDepth(uint32_t paramId, ModSource source,
                                              uint32_t sourceIndex, double depth,
                                              bool bipolar)
{
    if (!prepared)
        return;

    depth = std::clamp(depth, -1.0, 1.0);

    std::lock_guard<std::mutex> lock(modsMutex);
    auto& mods = paramMods[paramId];

    // Update existing entry or add new
    for (auto& entry : mods.entries)
    {
        if (entry.source == source && entry.sourceIndex == sourceIndex)
        {
            entry.depth = depth;
            entry.bipolar = bipolar;
            return;
        }
    }

    ModulationEntry entry;
    entry.paramId = paramId;
    entry.source = source;
    entry.sourceIndex = sourceIndex;
    entry.depth = depth;
    entry.bipolar = bipolar;
    mods.entries.push_back(entry);
}

double ClapParamModulation::getModulationDepth(uint32_t paramId, ModSource source,
                                                uint32_t sourceIndex) const
{
    std::lock_guard<std::mutex> lock(modsMutex);
    auto it = paramMods.find(paramId);
    if (it == paramMods.end())
        return 0.0;

    for (const auto& entry : it->second.entries)
    {
        if (entry.source == source && entry.sourceIndex == sourceIndex)
            return entry.depth;
    }
    return 0.0;
}

void ClapParamModulation::removeModulation(uint32_t paramId, ModSource source,
                                            uint32_t sourceIndex)
{
    std::lock_guard<std::mutex> lock(modsMutex);
    auto it = paramMods.find(paramId);
    if (it == paramMods.end())
        return;

    auto& entries = it->second.entries;
    entries.erase(
        std::remove_if(entries.begin(), entries.end(),
            [&](const ModulationEntry& e) {
                return e.source == source && e.sourceIndex == sourceIndex;
            }),
        entries.end());

    if (entries.empty())
        paramMods.erase(it);
}

void ClapParamModulation::clearParameterModulation(uint32_t paramId)
{
    std::lock_guard<std::mutex> lock(modsMutex);
    paramMods.erase(paramId);
}

void ClapParamModulation::clearAllModulations()
{
    std::lock_guard<std::mutex> lock(modsMutex);
    paramMods.clear();
    routes.clear();
}

// ── Modulation matrix ───────────────────────────────────────────────

void ClapParamModulation::addRoute(const ModRoute& route)
{
    if (!prepared)
        return;

    std::lock_guard<std::mutex> lock(modsMutex);

    // Check for duplicate
    for (const auto& r : routes)
    {
        if (r.source == route.source && r.sourceIndex == route.sourceIndex
            && r.paramId == route.paramId)
            return;
    }

    routes.push_back(route);

    // Also register as a modulation entry
    ModulationEntry entry;
    entry.paramId = route.paramId;
    entry.source = route.source;
    entry.sourceIndex = route.sourceIndex;
    entry.depth = route.depth;
    entry.bipolar = false;
    paramMods[route.paramId].entries.push_back(entry);
}

void ClapParamModulation::removeRoute(ModSource source, uint32_t sourceIndex,
                                       uint32_t paramId)
{
    std::lock_guard<std::mutex> lock(modsMutex);
    routes.erase(
        std::remove_if(routes.begin(), routes.end(),
            [&](const ModRoute& r) {
                return r.source == source && r.sourceIndex == sourceIndex
                    && r.paramId == paramId;
            }),
        routes.end());

    // Also remove from entries
    auto it = paramMods.find(paramId);
    if (it != paramMods.end())
    {
        auto& entries = it->second.entries;
        entries.erase(
            std::remove_if(entries.begin(), entries.end(),
                [&](const ModulationEntry& e) {
                    return e.source == source && e.sourceIndex == sourceIndex;
                }),
            entries.end());

        if (entries.empty())
            paramMods.erase(it);
    }
}

std::vector<ClapParamModulation::ModRoute>
ClapParamModulation::getActiveRoutes() const
{
    std::lock_guard<std::mutex> lock(modsMutex);
    std::vector<ModRoute> active;
    active.reserve(routes.size());
    for (const auto& r : routes)
    {
        if (r.active)
            active.push_back(r);
    }
    return active;
}

std::vector<ClapParamModulation::ModRoute>
ClapParamModulation::getRoutesForParam(uint32_t paramId) const
{
    std::lock_guard<std::mutex> lock(modsMutex);
    std::vector<ModRoute> result;
    for (const auto& r : routes)
    {
        if (r.paramId == paramId && r.active)
            result.push_back(r);
    }
    return result;
}

void ClapParamModulation::setNumMacros(int count)
{
    numMacros = std::clamp(count, 0, 8);
}

void ClapParamModulation::setSourceValue(ModSource source, uint32_t sourceIndex,
                                          double value)
{
    if (!prepared)
        return;

    std::lock_guard<std::mutex> lock(modsMutex);
    sourceValues[{source, sourceIndex}] = value;
}

double ClapParamModulation::getSourceValue(ModSource source, uint32_t sourceIndex) const
{
    std::lock_guard<std::mutex> lock(modsMutex);
    auto it = sourceValues.find({source, sourceIndex});
    return it != sourceValues.end() ? it->second : 0.0;
}

// ── Modulation processing ───────────────────────────────────────────

double ClapParamModulation::applyModulation(uint32_t paramId, double baseValue)
{
    if (!prepared)
        return baseValue;

    double totalMod = getTotalModulation(paramId);
    double result = baseValue + totalMod;

    // Clamp result to 0..1 (standard normalized parameter range)
    result = std::clamp(result, 0.0, 1.0);

    if (callback && totalMod != 0.0)
        callback(paramId, result);

    return result;
}

double ClapParamModulation::getTotalModulation(uint32_t paramId) const
{
    std::lock_guard<std::mutex> lock(modsMutex);

    auto it = paramMods.find(paramId);
    if (it == paramMods.end())
        return 0.0;

    double total = 0.0;
    for (const auto& entry : it->second.entries)
    {
        auto srcIt = sourceValues.find({entry.source, entry.sourceIndex});
        double srcValue = (srcIt != sourceValues.end()) ? srcIt->second : 0.0;

        if (!entry.bipolar)
            srcValue = std::clamp(srcValue, 0.0, 1.0);
        else
            srcValue = std::clamp(srcValue, -1.0, 1.0);

        total += srcValue * entry.depth;
    }

    return total;
}

void ClapParamModulation::setCallback(ModulationCallback cb)
{
    callback = std::move(cb);
}

// ── State queries ───────────────────────────────────────────────────

bool ClapParamModulation::isPrepared() const
{
    return prepared;
}

int ClapParamModulation::getNumModulations() const
{
    std::lock_guard<std::mutex> lock(modsMutex);
    int count = 0;
    for (const auto& [id, mods] : paramMods)
        count += static_cast<int>(mods.entries.size());
    return count;
}

int ClapParamModulation::getNumRoutes() const
{
    std::lock_guard<std::mutex> lock(modsMutex);
    return static_cast<int>(routes.size());
}
