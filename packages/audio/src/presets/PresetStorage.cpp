#include "PresetStorage.h"
#include <algorithm>
#include <sstream>
#include <iomanip>
#include <random>

namespace collinx {

PresetStorage::PresetStorage() = default;
PresetStorage::~PresetStorage() { shutdown(); }

// ── Initialization ──────────────────────────────────────────────────────

bool PresetStorage::initialize(const juce::File& directory)
{
    std::lock_guard<std::mutex> lock(storageMutex);

    rootDirectory = directory;

    if (!rootDirectory.exists())
    {
        if (!rootDirectory.createDirectory())
            return false;
    }

    // Create default category directories
    ensureCategoryDirectory("Uncategorized");

    // Load or create index
    if (!loadIndex())
    {
        index.clear();
        rebuildIndex();
        saveIndex();
    }

    initialized = true;
    return true;
}

void PresetStorage::shutdown()
{
    std::lock_guard<std::mutex> lock(storageMutex);

    if (initialized)
    {
        saveIndex();
        initialized = false;
    }
}

// ── Preset CRUD ─────────────────────────────────────────────────────────

bool PresetStorage::savePreset(const PresetFormat& preset)
{
    if (!initialized || !preset.isValid())
        return false;

    std::lock_guard<std::mutex> lock(storageMutex);

    // Determine category
    juce::String category = preset.category.isNotEmpty() ? preset.category : "Uncategorized";
    ensureCategoryDirectory(category);

    // Generate ID if not set (we use name + timestamp)
    juce::String id = generatePresetId();

    // Get file path
    auto file = getPresetFilePath(id, category);

    // Serialize to JSON
    auto json = preset.toJson();

    // Write to file
    if (!file.replaceWithText(json))
        return false;

    // Update index
    IndexEntry entry;
    entry.id = id;
    entry.name = preset.name;
    entry.category = category;
    entry.filePath = file.getRelativePathFrom(rootDirectory);
    entry.pluginName = preset.pluginName;
    entry.pluginFormat = preset.pluginFormat;
    entry.modifiedTime = preset.modifiedTime;
    entry.tags = preset.tags;
    updateIndexEntry(entry);

    saveIndex();
    notifyEvent("saved", preset.name);

    return true;
}

std::optional<PresetFormat> PresetStorage::loadPreset(const juce::String& id)
{
    if (!initialized)
        return std::nullopt;

    std::lock_guard<std::mutex> lock(storageMutex);

    // Find in index
    auto it = std::find_if(index.begin(), index.end(),
        [&id](const IndexEntry& entry) { return entry.id == id; });

    if (it == index.end())
        return std::nullopt;

    auto file = rootDirectory.getChildFile(it->filePath);
    return loadPresetFromFile(file);
}

std::optional<PresetFormat> PresetStorage::loadPresetFromFile(const juce::File& file)
{
    if (!file.existsAsFile())
        return std::nullopt;

    auto json = file.loadFileAsString();
    return PresetFormat::fromJson(json);
}

bool PresetStorage::deletePreset(const juce::String& id)
{
    if (!initialized)
        return false;

    std::lock_guard<std::mutex> lock(storageMutex);

    // Find in index
    auto it = std::find_if(index.begin(), index.end(),
        [&id](const IndexEntry& entry) { return entry.id == id; });

    if (it == index.end())
        return false;

    auto file = rootDirectory.getChildFile(it->filePath);
    juce::String name = it->name;

    // Delete file
    if (!file.deleteFile())
        return false;

    // Remove from index
    removeIndexEntry(id);
    saveIndex();

    notifyEvent("deleted", name);
    return true;
}

bool PresetStorage::presetExists(const juce::String& id) const
{
    std::lock_guard<std::mutex> lock(storageMutex);

    return std::any_of(index.begin(), index.end(),
        [&id](const IndexEntry& entry) { return entry.id == id; });
}

// ── Batch Operations ────────────────────────────────────────────────────

std::vector<PresetFormat> PresetStorage::loadAllPresets()
{
    if (!initialized)
        return {};

    std::lock_guard<std::mutex> lock(storageMutex);

    std::vector<PresetFormat> presets;
    for (const auto& entry : index)
    {
        auto file = rootDirectory.getChildFile(entry.filePath);
        auto preset = PresetFormat::fromJson(file.loadFileAsString());
        if (preset.has_value())
            presets.push_back(std::move(*preset));
    }

    return presets;
}

std::vector<PresetStorage::IndexEntry> PresetStorage::getIndex() const
{
    std::lock_guard<std::mutex> lock(storageMutex);
    return index;
}

void PresetStorage::rebuildIndex()
{
    index.clear();

    if (!rootDirectory.exists())
        return;

    // Scan all JSON files in root and subdirectories
    auto files = rootDirectory.findChildFiles(
        juce::File::findFiles, true, "*.json");

    for (const auto& file : files)
    {
        if (file.getFileName() == "index.json")
            continue;

        auto json = file.loadFileAsString();
        auto preset = PresetFormat::fromJson(json);

        if (preset.has_value())
        {
            IndexEntry entry;
            entry.id = generatePresetId();
            entry.name = preset->name;
            entry.category = preset->category.isNotEmpty() ? preset->category : "Uncategorized";
            entry.filePath = file.getRelativePathFrom(rootDirectory);
            entry.pluginName = preset->pluginName;
            entry.pluginFormat = preset->pluginFormat;
            entry.modifiedTime = preset->modifiedTime;
            entry.tags = preset->tags;
            index.push_back(entry);
        }
    }
}

// ── Directory Management ────────────────────────────────────────────────

std::vector<juce::String> PresetStorage::getCategories() const
{
    std::lock_guard<std::mutex> lock(storageMutex);

    std::vector<juce::String> categories;
    for (const auto& entry : index)
    {
        if (std::find(categories.begin(), categories.end(), entry.category) == categories.end())
            categories.push_back(entry.category);
    }

    return categories;
}

bool PresetStorage::createCategory(const juce::String& category)
{
    std::lock_guard<std::mutex> lock(storageMutex);
    return ensureCategoryDirectory(category);
}

// ── Import/Export ───────────────────────────────────────────────────────

bool PresetStorage::exportPreset(const juce::String& id, const juce::File& destination)
{
    if (!initialized)
        return false;

    std::lock_guard<std::mutex> lock(storageMutex);

    auto it = std::find_if(index.begin(), index.end(),
        [&id](const IndexEntry& entry) { return entry.id == id; });

    if (it == index.end())
        return false;

    auto sourceFile = rootDirectory.getChildFile(it->filePath);
    return sourceFile.copyFileTo(destination);
}

bool PresetStorage::importPreset(const juce::File& source,
                                  const juce::String& category)
{
    if (!initialized || !source.existsAsFile())
        return false;

    auto json = source.loadFileAsString();
    auto preset = PresetFormat::fromJson(json);

    if (!preset.has_value())
        return false;

    // Override category if specified
    if (category.isNotEmpty())
        preset->category = category;

    return savePreset(*preset);
}

int PresetStorage::exportAllPresets(const juce::File& destination)
{
    if (!initialized || !destination.createDirectory())
        return 0;

    std::lock_guard<std::mutex> lock(storageMutex);

    int count = 0;
    for (const auto& entry : index)
    {
        auto sourceFile = rootDirectory.getChildFile(entry.filePath);
        auto destFile = destination.getChildFile(sourceFile.getFileName());

        if (sourceFile.copyFileTo(destFile))
            ++count;
    }

    return count;
}

int PresetStorage::importPresetsFromDirectory(const juce::File& source)
{
    if (!initialized || !source.exists())
        return 0;

    auto files = source.findChildFiles(juce::File::findFiles, true, "*.json");
    int count = 0;

    for (const auto& file : files)
    {
        if (importPreset(file))
            ++count;
    }

    return count;
}

// ── Callbacks ───────────────────────────────────────────────────────────

void PresetStorage::setStorageEventCallback(StorageEventCallback callback)
{
    eventCallback = std::move(callback);
}

// ── Utilities ───────────────────────────────────────────────────────────

juce::String PresetStorage::generatePresetId()
{
    static std::random_device rd;
    static std::mt19937 gen(rd());
    static std::uniform_int_distribution<uint64_t> dis;

    std::ostringstream oss;
    oss << std::hex << std::setfill('0') << std::setw(16) << dis(gen);
    return oss.str();
}

juce::String PresetStorage::sanitizeFilename(const juce::String& name)
{
    juce::String result = name;

    // Replace invalid characters
    const juce::String invalidChars = "<>:\"/\\|?*";
    for (auto ch : invalidChars)
        result = result.replaceCharacter(ch, '_');

    // Trim whitespace
    return result.trim();
}

// ── Private ─────────────────────────────────────────────────────────────

juce::File PresetStorage::getPresetFilePath(const juce::String& id,
                                             const juce::String& category) const
{
    auto categoryDir = rootDirectory.getChildFile(sanitizeFilename(category));
    return categoryDir.getChildFile(id + ".json");
}

bool PresetStorage::saveIndex()
{
    auto indexFile = rootDirectory.getChildFile("index.json");

    juce::DynamicObject::Ptr root = new juce::DynamicObject();
    juce::Array<juce::var> entries;

    for (const auto& entry : index)
    {
        juce::DynamicObject::Ptr obj = new juce::DynamicObject();
        obj->setProperty("id", entry.id);
        obj->setProperty("name", entry.name);
        obj->setProperty("category", entry.category);
        obj->setProperty("filePath", entry.filePath);
        obj->setProperty("pluginName", entry.pluginName);
        obj->setProperty("pluginFormat", entry.pluginFormat);
        obj->setProperty("modifiedTime", entry.modifiedTime);

        juce::Array<juce::var> tagsArray;
        for (const auto& tag : entry.tags)
            tagsArray.add(juce::var(tag));
        obj->setProperty("tags", tagsArray);

        entries.add(juce::var(obj.release()));
    }

    root->setProperty("entries", entries);
    root->setProperty("version", 1);

    return indexFile.replaceWithText(juce::JSON::toString(root.get(), true));
}

bool PresetStorage::loadIndex()
{
    auto indexFile = rootDirectory.getChildFile("index.json");

    if (!indexFile.existsAsFile())
        return false;

    auto json = indexFile.loadFileAsString();
    auto parsed = juce::JSON::parse(json);

    if (!parsed.isObject())
        return false;

    auto* obj = parsed.getDynamicObject();
    if (obj == nullptr)
        return false;

    auto entriesVar = obj->getProperty("entries", juce::var());
    if (!entriesVar.isArray())
        return false;

    auto* entriesArray = entriesVar.getArray();
    if (entriesArray == nullptr)
        return false;

    index.clear();
    for (const auto& entryVar : *entriesArray)
    {
        auto* entryObj = entryVar.getDynamicObject();
        if (entryObj == nullptr)
            continue;

        IndexEntry entry;
        entry.id = entryObj->getProperty("id", "");
        entry.name = entryObj->getProperty("name", "");
        entry.category = entryObj->getProperty("category", "");
        entry.filePath = entryObj->getProperty("filePath", "");
        entry.pluginName = entryObj->getProperty("pluginName", "");
        entry.pluginFormat = entryObj->getProperty("pluginFormat", "");
        entry.modifiedTime = entryObj->getProperty("modifiedTime", "");

        auto tagsVar = entryObj->getProperty("tags", juce::var());
        if (tagsVar.isArray())
        {
            auto* tagsArray = tagsVar.getArray();
            if (tagsArray != nullptr)
            {
                for (const auto& tag : *tagsArray)
                    entry.tags.push_back(tag.toString());
            }
        }

        index.push_back(entry);
    }

    return true;
}

void PresetStorage::updateIndexEntry(const IndexEntry& entry)
{
    auto it = std::find_if(index.begin(), index.end(),
        [&entry](const IndexEntry& e) { return e.id == entry.id; });

    if (it != index.end())
        *it = entry;
    else
        index.push_back(entry);
}

void PresetStorage::removeIndexEntry(const juce::String& id)
{
    index.erase(
        std::remove_if(index.begin(), index.end(),
            [&id](const IndexEntry& entry) { return entry.id == id; }),
        index.end());
}

void PresetStorage::notifyEvent(const juce::String& event,
                                 const juce::String& presetName)
{
    if (eventCallback)
        eventCallback(event, presetName);
}

bool PresetStorage::ensureCategoryDirectory(const juce::String& category)
{
    auto dir = rootDirectory.getChildFile(sanitizeFilename(category));
    if (!dir.exists())
        return dir.createDirectory();
    return true;
}

} // namespace collinx
