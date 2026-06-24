#pragma once

#include "PresetFormat.h"
#include "PresetStorage.h"
#include <vector>
#include <functional>
#include <mutex>
#include <unordered_map>

namespace collinx {

/**
 * PresetManager — High-level preset management for plugins.
 *
 * Provides save/load, categorization, tagging, search, and filtering
 * of presets. Integrates with PresetStorage for persistence.
 *
 * Usage:
 *   PresetManager manager;
 *   manager.initialize(juce::File("~/.collinx/presets"));
 *   manager.saveCurrentState(processor, "My Preset", "Synth Leads");
 *   auto results = manager.searchPresets("lead");
 *   manager.loadPreset(results[0].id, processor);
 */
class PresetManager
{
public:
    /**
     * Represents a preset summary for search/listing.
     */
    struct PresetInfo
    {
        juce::String id;
        juce::String name;
        juce::String description;
        juce::String category;
        juce::String author;
        juce::String pluginName;
        juce::String pluginFormat;
        std::vector<juce::String> tags;
        juce::String createdTime;
        juce::String modifiedTime;
    };

    /**
     * Filter criteria for preset search.
     */
    struct PresetFilter
    {
        juce::String textQuery;
        juce::String category;
        juce::String author;
        juce::String pluginName;
        juce::String pluginFormat;
        std::vector<juce::String> requiredTags;
        bool matchAllTags = false;  // true = AND, false = OR
    };

    /**
     * Preset change callback type.
     * @param event Event type ("saved", "loaded", "deleted", "imported").
     * @param presetId ID of the affected preset.
     * @param presetName Name of the affected preset.
     */
    using PresetChangeCallback = std::function<void(
        const juce::String& event,
        const juce::String& presetId,
        const juce::String& presetName)>;

    PresetManager();
    ~PresetManager();

    /**
     * Initialize the preset manager.
     * @param presetsRoot Root directory for preset storage.
     * @return true if initialization succeeded.
     */
    bool initialize(const juce::File& presetsRoot);

    /**
     * Shut down the manager.
     */
    void shutdown();

    /**
     * Check if manager is initialized.
     */
    bool isInitialized() const { return initialized; }

    // ── Preset Save/Load ────────────────────────────────────────────────

    /**
     * Save the current state of a processor as a preset.
     * @param processor Audio processor to capture state from.
     * @param name Preset name.
     * @param category Preset category.
     * @param description Optional description.
     * @param author Optional author.
     * @param tags Optional tags.
     * @return Preset ID if saved successfully, empty string on failure.
     */
    juce::String saveCurrentState(juce::AudioProcessor& processor,
                                  const juce::String& name,
                                  const juce::String& category = "",
                                  const juce::String& description = "",
                                  const juce::String& author = "",
                                  const std::vector<juce::String>& tags = {});

    /**
     * Save a preset from a ValueTree state.
     * @param state ValueTree state to save.
     * @param name Preset name.
     * @param category Preset category.
     * @param pluginName Plugin name for metadata.
     * @param pluginFormat Plugin format for metadata.
     * @param description Optional description.
     * @param author Optional author.
     * @param tags Optional tags.
     * @return Preset ID if saved successfully, empty string on failure.
     */
    juce::String saveState(const juce::ValueTree& state,
                           const juce::String& name,
                           const juce::String& category = "",
                           const juce::String& pluginName = "",
                           const juce::String& pluginFormat = "",
                           const juce::String& description = "",
                           const juce::String& author = "",
                           const std::vector<juce::String>& tags = {});

    /**
     * Load a preset and apply it to a processor.
     * @param id Preset ID.
     * @param processor Processor to apply state to.
     * @return true if preset was loaded and applied.
     */
    bool loadPreset(const juce::String& id, juce::AudioProcessor& processor);

    /**
     * Load a preset and return its state.
     * @param id Preset ID.
     * @return Preset format, or nullopt if not found.
     */
    std::optional<PresetFormat> loadPreset(const juce::String& id);

    /**
     * Delete a preset.
     * @param id Preset ID.
     * @return true if deletion succeeded.
     */
    bool deletePreset(const juce::String& id);

    /**
     * Update an existing preset.
     * @param id Preset ID.
     * @param processor Processor with new state.
     * @param name Optional new name (empty = keep existing).
     * @param category Optional new category (empty = keep existing).
     * @param description Optional new description (empty = keep existing).
     * @param tags Optional new tags (empty = keep existing).
     * @return true if update succeeded.
     */
    bool updatePreset(const juce::String& id,
                      juce::AudioProcessor& processor,
                      const juce::String& name = "",
                      const juce::String& category = "",
                      const juce::String& description = "",
                      const std::vector<juce::String>& tags = {});

    // ── Search and Filtering ────────────────────────────────────────────

    /**
     * Search presets with a text query.
     * Searches name, description, author, tags, and category.
     * @param query Text to search for.
     * @return Matching presets.
     */
    std::vector<PresetInfo> searchPresets(const juce::String& query) const;

    /**
     * Filter presets by criteria.
     * @param filter Filter criteria.
     * @return Matching presets.
     */
    std::vector<PresetInfo> filterPresets(const PresetFilter& filter) const;

    /**
     * Get all presets.
     * @return All preset info.
     */
    std::vector<PresetInfo> getAllPresets() const;

    /**
     * Get presets by category.
     * @param category Category name.
     * @return Presets in the category.
     */
    std::vector<PresetInfo> getPresetsByCategory(const juce::String& category) const;

    /**
     * Get presets by plugin.
     * @param pluginName Plugin name.
     * @return Presets for the plugin.
     */
    std::vector<PresetInfo> getPresetsByPlugin(const juce::String& pluginName) const;

    /**
     * Get presets by tag.
     * @param tag Tag to filter by.
     * @return Presets with the tag.
     */
    std::vector<PresetInfo> getPresetsByTag(const juce::String& tag) const;

    // ── Category Management ─────────────────────────────────────────────

    /**
     * Get all categories.
     * @return List of category names.
     */
    std::vector<juce::String> getCategories() const;

    /**
     * Create a new category.
     * @param category Category name.
     * @return true if creation succeeded.
     */
    bool createCategory(const juce::String& category);

    /**
     * Rename a category.
     * @param oldName Old category name.
     * @param newName New category name.
     * @return true if rename succeeded.
     */
    bool renameCategory(const juce::String& oldName, const juce::String& newName);

    // ── Tag Management ──────────────────────────────────────────────────

    /**
     * Get all unique tags across all presets.
     * @return List of tags.
     */
    std::vector<juce::String> getAllTags() const;

    /**
     * Add a tag to a preset.
     * @param id Preset ID.
     * @param tag Tag to add.
     * @return true if tag was added.
     */
    bool addTagToPreset(const juce::String& id, const juce::String& tag);

    /**
     * Remove a tag from a preset.
     * @param id Preset ID.
     * @param tag Tag to remove.
     * @return true if tag was removed.
     */
    bool removeTagFromPreset(const juce::String& id, const juce::String& tag);

    // ── Import/Export ───────────────────────────────────────────────────

    /**
     * Export a preset to a file.
     * @param id Preset ID.
     * @param destination Destination file.
     * @return true if export succeeded.
     */
    bool exportPreset(const juce::String& id, const juce::File& destination);

    /**
     * Import a preset from a file.
     * @param source Source file.
     * @param category Optional category override.
     * @return true if import succeeded.
     */
    bool importPreset(const juce::File& source, const juce::String& category = "");

    /**
     * Export all presets to a directory.
     * @param destination Destination directory.
     * @return Number of presets exported.
     */
    int exportAll(const juce::File& destination);

    /**
     * Import presets from a directory.
     * @param source Source directory.
     * @return Number of presets imported.
     */
    int importAll(const juce::File& source);

    // ── Callbacks ───────────────────────────────────────────────────────

    /**
     * Set a callback for preset changes.
     */
    void setPresetChangeCallback(PresetChangeCallback callback);

    // ── Statistics ──────────────────────────────────────────────────────

    /**
     * Get the total number of presets.
     */
    int getNumPresets() const;

    /**
     * Get the number of presets in a category.
     */
    int getNumPresetsInCategory(const juce::String& category) const;

private:
    PresetStorage storage;
    PresetChangeCallback changeCallback;
    bool initialized = false;

    /**
     * Convert a PresetFormat to PresetInfo.
     */
    static PresetInfo toPresetInfo(const PresetFormat& preset);

    /**
     * Convert an IndexEntry to PresetInfo.
     */
    static PresetInfo toPresetInfo(const PresetStorage::IndexEntry& entry);

    /**
     * Check if a preset matches a filter.
     */
    static bool matchesFilter(const PresetInfo& info, const PresetFilter& filter);

    /**
     * Check if text contains a query (case-insensitive).
     */
    static bool containsText(const juce::String& text, const juce::String& query);

    /**
     * Notify a preset change.
     */
    void notifyChange(const juce::String& event,
                      const juce::String& presetId,
                      const juce::String& presetName);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PresetManager)
};

} // namespace collinx
