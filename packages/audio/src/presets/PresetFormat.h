#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <string>
#include <vector>
#include <optional>
#include <chrono>

namespace collinx {

/**
 * PresetFormat — Defines the data structure for plugin presets.
 *
 * Supports JSON serialization/deserialization, versioning, and metadata
 * including categories, tags, and author information.
 *
 * Usage:
 *   PresetFormat preset;
 *   preset.name = "My Preset";
 *   preset.category = "Synth Leads";
 *   preset.tags = {"lead", "bright", "analog"};
 *   auto json = preset.toJson();
 *   auto loaded = PresetFormat::fromJson(json);
 */
struct PresetFormat
{
    // ── Metadata ────────────────────────────────────────────────────────
    juce::String name;
    juce::String description;
    juce::String author;
    juce::String category;
    std::vector<juce::String> tags;
    juce::String pluginName;
    juce::String pluginIdentifier;
    juce::String pluginFormat;  // "VST3", "CLAP", etc.

    // ── Version Info ────────────────────────────────────────────────────
    int version = 1;
    static constexpr int CURRENT_VERSION = 1;
    static constexpr const char* FORMAT_VERSION_KEY = "formatVersion";

    // ── Timestamps ──────────────────────────────────────────────────────
    juce::String createdTime;
    juce::String modifiedTime;

    // ── State Data ──────────────────────────────────────────────────────
    juce::ValueTree state;

    // ── Factory Methods ─────────────────────────────────────────────────

    /**
     * Create a preset from a plugin's current state.
     * @param processor The audio processor to capture state from.
     * @param name Preset name.
     * @return A new PresetFormat with captured state.
     */
    static PresetFormat createFromProcessor(juce::AudioProcessor& processor,
                                            const juce::String& name);

    /**
     * Create a preset from a ValueTree state.
     * @param state The state tree.
     * @param name Preset name.
     * @return A new PresetFormat.
     */
    static PresetFormat createFromState(const juce::ValueTree& state,
                                        const juce::String& name);

    // ── Serialization ───────────────────────────────────────────────────

    /**
     * Serialize to JSON string.
     * @return JSON representation of the preset.
     */
    juce::String toJson() const;

    /**
     * Serialize to ValueTree.
     * @return ValueTree representation of the preset.
     */
    juce::ValueTree toValueTree() const;

    /**
     * Deserialize from JSON string.
     * @param json JSON string to parse.
     * @return Parsed preset, or nullopt on failure.
     */
    static std::optional<PresetFormat> fromJson(const juce::String& json);

    /**
     * Deserialize from ValueTree.
     * @param tree ValueTree to parse.
     * @return Parsed preset, or nullopt on failure.
     */
    static std::optional<PresetFormat> fromValueTree(const juce::ValueTree& tree);

    // ── State Application ───────────────────────────────────────────────

    /**
     * Apply this preset's state to a processor.
     * @param processor The processor to apply state to.
     * @return true if state was applied successfully.
     */
    bool applyToProcessor(juce::AudioProcessor& processor) const;

    // ── Validation ──────────────────────────────────────────────────────

    /**
     * Check if the preset is valid.
     * @return true if the preset has required fields.
     */
    bool isValid() const;

    /**
     * Get a human-readable summary.
     */
    juce::String toString() const;

    // ── Tag Operations ──────────────────────────────────────────────────

    /**
     * Check if preset has a specific tag.
     */
    bool hasTag(const juce::String& tag) const;

    /**
     * Add a tag if not already present.
     */
    void addTag(const juce::String& tag);

    /**
     * Remove a tag.
     */
    void removeTag(const juce::String& tag);

    // ── Utilities ───────────────────────────────────────────────────────

    /**
     * Get current timestamp in ISO 8601 format.
     */
    static juce::String getCurrentTimestamp();

private:
    // No private members
};

} // namespace collinx
