#pragma once

#include "PresetFormat.h"
#include <vector>
#include <unordered_map>
#include <functional>
#include <mutex>

namespace collinx {

/**
 * PresetStorage — Manages persistent storage of presets.
 *
 * Handles file I/O, directory structure, indexing, and import/export
 * of presets. Presets are stored as JSON files in a structured directory.
 *
 * Directory structure:
 *   presetsRoot/
 *     ├── index.json          (preset index)
 *     ├── Synth Leads/
 *     │   ├── preset1.json
 *     │   └── preset2.json
 *     ├── Bass/
 *     │   └── bass_preset.json
 *     └── Uncategorized/
 *         └── misc_preset.json
 *
 * Usage:
 *   PresetStorage storage;
 *   storage.initialize(juce::File("~/.collinx/presets"));
 *   storage.savePreset(preset);
 *   auto presets = storage.loadAllPresets();
 */
class PresetStorage
{
public:
    /**
     * Represents an entry in the preset index.
     */
    struct IndexEntry
    {
        juce::String id;
        juce::String name;
        juce::String category;
        juce::String filePath;
        juce::String pluginName;
        juce::String pluginFormat;
        juce::String modifiedTime;
        std::vector<juce::String> tags;
    };

    /**
     * Storage event callback type.
     * @param event Event description (e.g., "saved", "deleted", "imported").
     * @param presetName Name of the affected preset.
     */
    using StorageEventCallback = std::function<void(
        const juce::String& event,
        const juce::String& presetName)>;

    PresetStorage();
    ~PresetStorage();

    /**
     * Initialize the storage with a root directory.
     * Creates directory structure if it doesn't exist.
     * @param rootDirectory Root directory for preset storage.
     * @return true if initialization succeeded.
     */
    bool initialize(const juce::File& rootDirectory);

    /**
     * Shut down the storage and flush any pending changes.
     */
    void shutdown();

    /**
     * Check if storage is initialized.
     */
    bool isInitialized() const { return initialized; }

    // ── Preset CRUD ─────────────────────────────────────────────────────

    /**
     * Save a preset to storage.
     * @param preset Preset to save.
     * @return true if save succeeded.
     */
    bool savePreset(const PresetFormat& preset);

    /**
     * Load a preset by ID.
     * @param id Preset ID.
     * @return Loaded preset, or nullopt if not found.
     */
    std::optional<PresetFormat> loadPreset(const juce::String& id);

    /**
     * Load a preset from a file path.
     * @param file Path to the preset file.
     * @return Loaded preset, or nullopt on failure.
     */
    std::optional<PresetFormat> loadPresetFromFile(const juce::File& file);

    /**
     * Delete a preset by ID.
     * @param id Preset ID to delete.
     * @return true if deletion succeeded.
     */
    bool deletePreset(const juce::String& id);

    /**
     * Check if a preset exists.
     * @param id Preset ID.
     * @return true if preset exists.
     */
    bool presetExists(const juce::String& id) const;

    // ── Batch Operations ────────────────────────────────────────────────

    /**
     * Load all presets from storage.
     * @return Vector of all presets.
     */
    std::vector<PresetFormat> loadAllPresets();

    /**
     * Get the index of all presets without loading full data.
     * @return Vector of index entries.
     */
    std::vector<IndexEntry> getIndex() const;

    /**
     * Rebuild the preset index from disk.
     */
    void rebuildIndex();

    // ── Directory Management ────────────────────────────────────────────

    /**
     * Get all category names.
     * @return Vector of category names.
     */
    std::vector<juce::String> getCategories() const;

    /**
     * Create a new category directory.
     * @param category Category name.
     * @return true if creation succeeded.
     */
    bool createCategory(const juce::String& category);

    /**
     * Get the root directory.
     */
    juce::File getRootDirectory() const { return rootDirectory; }

    // ── Import/Export ───────────────────────────────────────────────────

    /**
     * Export a preset to a file.
     * @param id Preset ID to export.
     * @param destination Destination file path.
     * @return true if export succeeded.
     */
    bool exportPreset(const juce::String& id, const juce::File& destination);

    /**
     * Import a preset from a file.
     * @param source Source file path.
     * @param category Optional category override.
     * @return true if import succeeded.
     */
    bool importPreset(const juce::File& source,
                      const juce::String& category = "");

    /**
     * Export all presets to a directory.
     * @param destination Destination directory.
     * @return Number of presets exported.
     */
    int exportAllPresets(const juce::File& destination);

    /**
     * Import all presets from a directory.
     * @param source Source directory.
     * @return Number of presets imported.
     */
    int importPresetsFromDirectory(const juce::File& source);

    // ── Callbacks ───────────────────────────────────────────────────────

    /**
     * Set a callback for storage events.
     */
    void setStorageEventCallback(StorageEventCallback callback);

    // ── Utilities ───────────────────────────────────────────────────────

    /**
     * Generate a unique ID for a preset.
     */
    static juce::String generatePresetId();

    /**
     * Sanitize a name for use as a filename.
     */
    static juce::String sanitizeFilename(const juce::String& name);

private:
    juce::File rootDirectory;
    std::vector<IndexEntry> index;
    mutable std::mutex storageMutex;
    StorageEventCallback eventCallback;
    bool initialized = false;

    /**
     * Get the file path for a preset.
     */
    juce::File getPresetFilePath(const juce::String& id,
                                 const juce::String& category) const;

    /**
     * Save the index to disk.
     */
    bool saveIndex();

    /**
     * Load the index from disk.
     */
    bool loadIndex();

    /**
     * Add or update an entry in the index.
     */
    void updateIndexEntry(const IndexEntry& entry);

    /**
     * Remove an entry from the index.
     */
    void removeIndexEntry(const juce::String& id);

    /**
     * Notify a storage event.
     */
    void notifyEvent(const juce::String& event, const juce::String& presetName);

    /**
     * Ensure category directory exists.
     */
    bool ensureCategoryDirectory(const juce::String& category);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PresetStorage)
};

} // namespace collinx
