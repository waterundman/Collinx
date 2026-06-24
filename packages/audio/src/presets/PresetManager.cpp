#include "PresetManager.h"
#include <algorithm>
#include <sstream>

namespace collinx {

PresetManager::PresetManager() = default;
PresetManager::~PresetManager() { shutdown(); }

// ── Initialization ──────────────────────────────────────────────────────

bool PresetManager::initialize(const juce::File& presetsRoot)
{
    if (!storage.initialize(presetsRoot))
        return false;

    storage.setStorageEventCallback([this](const juce::String& event,
                                            const juce::String& presetName) {
        notifyChange(event, "", presetName);
    });

    initialized = true;
    return true;
}

void PresetManager::shutdown()
{
    if (initialized)
    {
        storage.shutdown();
        initialized = false;
    }
}

// ── Preset Save/Load ────────────────────────────────────────────────────

juce::String PresetManager::saveCurrentState(juce::AudioProcessor& processor,
                                              const juce::String& name,
                                              const juce::String& category,
                                              const juce::String& description,
                                              const juce::String& author,
                                              const std::vector<juce::String>& tags)
{
    if (!initialized || name.isEmpty())
        return {};

    auto preset = PresetFormat::createFromProcessor(processor, name);
    preset.category = category.isNotEmpty() ? category : "Uncategorized";
    preset.description = description;
    preset.author = author;
    preset.tags = tags;

    // Populate plugin info from processor
    preset.pluginName = processor.getName();

    if (storage.savePreset(preset))
    {
        // Generate ID for notification (same as storage would use)
        auto index = storage.getIndex();
        for (const auto& entry : index)
        {
            if (entry.name == name)
            {
                notifyChange("saved", entry.id, name);
                return entry.id;
            }
        }
    }

    return {};
}

juce::String PresetManager::saveState(const juce::ValueTree& state,
                                       const juce::String& name,
                                       const juce::String& category,
                                       const juce::String& pluginName,
                                       const juce::String& pluginFormat,
                                       const juce::String& description,
                                       const juce::String& author,
                                       const std::vector<juce::String>& tags)
{
    if (!initialized || name.isEmpty() || !state.isValid())
        return {};

    auto preset = PresetFormat::createFromState(state, name);
    preset.category = category.isNotEmpty() ? category : "Uncategorized";
    preset.pluginName = pluginName;
    preset.pluginFormat = pluginFormat;
    preset.description = description;
    preset.author = author;
    preset.tags = tags;

    if (storage.savePreset(preset))
    {
        auto index = storage.getIndex();
        for (const auto& entry : index)
        {
            if (entry.name == name)
            {
                notifyChange("saved", entry.id, name);
                return entry.id;
            }
        }
    }

    return {};
}

bool PresetManager::loadPreset(const juce::String& id, juce::AudioProcessor& processor)
{
    if (!initialized)
        return false;

    auto preset = storage.loadPreset(id);
    if (!preset.has_value())
        return false;

    if (preset->applyToProcessor(processor))
    {
        notifyChange("loaded", id, preset->name);
        return true;
    }

    return false;
}

std::optional<PresetFormat> PresetManager::loadPreset(const juce::String& id)
{
    if (!initialized)
        return std::nullopt;

    return storage.loadPreset(id);
}

bool PresetManager::deletePreset(const juce::String& id)
{
    if (!initialized)
        return false;

    // Get name before deletion for notification
    auto index = storage.getIndex();
    juce::String name;
    for (const auto& entry : index)
    {
        if (entry.id == id)
        {
            name = entry.name;
            break;
        }
    }

    if (storage.deletePreset(id))
    {
        notifyChange("deleted", id, name);
        return true;
    }

    return false;
}

bool PresetManager::updatePreset(const juce::String& id,
                                  juce::AudioProcessor& processor,
                                  const juce::String& name,
                                  const juce::String& category,
                                  const juce::String& description,
                                  const std::vector<juce::String>& tags)
{
    if (!initialized)
        return false;

    auto existing = storage.loadPreset(id);
    if (!existing.has_value())
        return false;

    // Update state
    existing->state = processor.copyState();

    // Update metadata if provided
    if (name.isNotEmpty())
        existing->name = name;
    if (category.isNotEmpty())
        existing->category = category;
    if (description.isNotEmpty())
        existing->description = description;
    if (!tags.empty())
        existing->tags = tags;

    existing->modifiedTime = PresetFormat::getCurrentTimestamp();

    if (storage.savePreset(*existing))
    {
        notifyChange("updated", id, existing->name);
        return true;
    }

    return false;
}

// ── Search and Filtering ────────────────────────────────────────────────

std::vector<PresetManager::PresetInfo> PresetManager::searchPresets(
    const juce::String& query) const
{
    if (!initialized || query.isEmpty())
        return getAllPresets();

    PresetFilter filter;
    filter.textQuery = query;
    return filterPresets(filter);
}

std::vector<PresetManager::PresetInfo> PresetManager::filterPresets(
    const PresetFilter& filter) const
{
    if (!initialized)
        return {};

    auto allPresets = getAllPresets();
    std::vector<PresetInfo> results;

    std::copy_if(allPresets.begin(), allPresets.end(),
                 std::back_inserter(results),
                 [&filter](const PresetInfo& info) {
                     return matchesFilter(info, filter);
                 });

    return results;
}

std::vector<PresetManager::PresetInfo> PresetManager::getAllPresets() const
{
    if (!initialized)
        return {};

    auto indexEntries = storage.getIndex();
    std::vector<PresetInfo> presets;
    presets.reserve(indexEntries.size());

    for (const auto& entry : indexEntries)
        presets.push_back(toPresetInfo(entry));

    return presets;
}

std::vector<PresetManager::PresetInfo> PresetManager::getPresetsByCategory(
    const juce::String& category) const
{
    PresetFilter filter;
    filter.category = category;
    return filterPresets(filter);
}

std::vector<PresetManager::PresetInfo> PresetManager::getPresetsByPlugin(
    const juce::String& pluginName) const
{
    PresetFilter filter;
    filter.pluginName = pluginName;
    return filterPresets(filter);
}

std::vector<PresetManager::PresetInfo> PresetManager::getPresetsByTag(
    const juce::String& tag) const
{
    PresetFilter filter;
    filter.requiredTags = {tag};
    return filterPresets(filter);
}

// ── Category Management ─────────────────────────────────────────────────

std::vector<juce::String> PresetManager::getCategories() const
{
    if (!initialized)
        return {};

    return storage.getCategories();
}

bool PresetManager::createCategory(const juce::String& category)
{
    if (!initialized)
        return false;

    return storage.createCategory(category);
}

bool PresetManager::renameCategory(const juce::String& oldName,
                                    const juce::String& newName)
{
    if (!initialized || oldName.isEmpty() || newName.isEmpty())
        return false;

    // Get all presets in old category
    auto presets = getPresetsByCategory(oldName);
    if (presets.empty())
        return false;

    // Update each preset's category
    for (const auto& info : presets)
    {
        auto preset = storage.loadPreset(info.id);
        if (preset.has_value())
        {
            preset->category = newName;
            storage.savePreset(*preset);
        }
    }

    return true;
}

// ── Tag Management ──────────────────────────────────────────────────────

std::vector<juce::String> PresetManager::getAllTags() const
{
    if (!initialized)
        return {};

    std::vector<juce::String> allTags;
    auto index = storage.getIndex();

    for (const auto& entry : index)
    {
        for (const auto& tag : entry.tags)
        {
            if (std::find(allTags.begin(), allTags.end(), tag) == allTags.end())
                allTags.push_back(tag);
        }
    }

    return allTags;
}

bool PresetManager::addTagToPreset(const juce::String& id, const juce::String& tag)
{
    if (!initialized)
        return false;

    auto preset = storage.loadPreset(id);
    if (!preset.has_value())
        return false;

    preset->addTag(tag);
    return storage.savePreset(*preset);
}

bool PresetManager::removeTagFromPreset(const juce::String& id, const juce::String& tag)
{
    if (!initialized)
        return false;

    auto preset = storage.loadPreset(id);
    if (!preset.has_value())
        return false;

    preset->removeTag(tag);
    return storage.savePreset(*preset);
}

// ── Import/Export ───────────────────────────────────────────────────────

bool PresetManager::exportPreset(const juce::String& id, const juce::File& destination)
{
    if (!initialized)
        return false;

    return storage.exportPreset(id, destination);
}

bool PresetManager::importPreset(const juce::File& source, const juce::String& category)
{
    if (!initialized)
        return false;

    return storage.importPreset(source, category);
}

int PresetManager::exportAll(const juce::File& destination)
{
    if (!initialized)
        return 0;

    return storage.exportAllPresets(destination);
}

int PresetManager::importAll(const juce::File& source)
{
    if (!initialized)
        return 0;

    return storage.importPresetsFromDirectory(source);
}

// ── Callbacks ───────────────────────────────────────────────────────────

void PresetManager::setPresetChangeCallback(PresetChangeCallback callback)
{
    changeCallback = std::move(callback);
}

// ── Statistics ──────────────────────────────────────────────────────────

int PresetManager::getNumPresets() const
{
    if (!initialized)
        return 0;

    return static_cast<int>(storage.getIndex().size());
}

int PresetManager::getNumPresetsInCategory(const juce::String& category) const
{
    return static_cast<int>(getPresetsByCategory(category).size());
}

// ── Private ─────────────────────────────────────────────────────────────

PresetManager::PresetInfo PresetManager::toPresetInfo(const PresetFormat& preset)
{
    PresetInfo info;
    info.name = preset.name;
    info.description = preset.description;
    info.category = preset.category;
    info.author = preset.author;
    info.pluginName = preset.pluginName;
    info.pluginFormat = preset.pluginFormat;
    info.tags = preset.tags;
    info.createdTime = preset.createdTime;
    info.modifiedTime = preset.modifiedTime;
    return info;
}

PresetManager::PresetInfo PresetManager::toPresetInfo(
    const PresetStorage::IndexEntry& entry)
{
    PresetInfo info;
    info.id = entry.id;
    info.name = entry.name;
    info.category = entry.category;
    info.pluginName = entry.pluginName;
    info.pluginFormat = entry.pluginFormat;
    info.tags = entry.tags;
    info.modifiedTime = entry.modifiedTime;
    return info;
}

bool PresetManager::matchesFilter(const PresetInfo& info, const PresetFilter& filter)
{
    // Text query
    if (filter.textQuery.isNotEmpty())
    {
        bool textMatch = containsText(info.name, filter.textQuery) ||
                         containsText(info.description, filter.textQuery) ||
                         containsText(info.author, filter.textQuery) ||
                         containsText(info.category, filter.textQuery);

        if (!textMatch)
        {
            // Check tags
            bool tagMatch = false;
            for (const auto& tag : info.tags)
            {
                if (containsText(tag, filter.textQuery))
                {
                    tagMatch = true;
                    break;
                }
            }
            if (!tagMatch)
                return false;
        }
    }

    // Category
    if (filter.category.isNotEmpty() && info.category != filter.category)
        return false;

    // Author
    if (filter.author.isNotEmpty() && info.author != filter.author)
        return false;

    // Plugin name
    if (filter.pluginName.isNotEmpty() && info.pluginName != filter.pluginName)
        return false;

    // Plugin format
    if (filter.pluginFormat.isNotEmpty() && info.pluginFormat != filter.pluginFormat)
        return false;

    // Tags
    if (!filter.requiredTags.empty())
    {
        if (filter.matchAllTags)
        {
            // AND: all required tags must be present
            for (const auto& requiredTag : filter.requiredTags)
            {
                if (std::find(info.tags.begin(), info.tags.end(), requiredTag) == info.tags.end())
                    return false;
            }
        }
        else
        {
            // OR: at least one required tag must be present
            bool anyTagMatch = false;
            for (const auto& requiredTag : filter.requiredTags)
            {
                if (std::find(info.tags.begin(), info.tags.end(), requiredTag) != info.tags.end())
                {
                    anyTagMatch = true;
                    break;
                }
            }
            if (!anyTagMatch)
                return false;
        }
    }

    return true;
}

bool PresetManager::containsText(const juce::String& text, const juce::String& query)
{
    return text.toLowerCase().contains(query.toLowerCase());
}

void PresetManager::notifyChange(const juce::String& event,
                                  const juce::String& presetId,
                                  const juce::String& presetName)
{
    if (changeCallback)
        changeCallback(event, presetId, presetName);
}

} // namespace collinx
