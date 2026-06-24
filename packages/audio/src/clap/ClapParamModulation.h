#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <cstdint>
#include <string>
#include <vector>
#include <unordered_map>
#include <functional>
#include <atomic>
#include <mutex>

/**
 * ClapParamModulation — CLAP parameter modulation with modulation matrix.
 *
 * Provides per-parameter modulation depth, source tracking, and a
 * modulation matrix for routing modulation sources to parameter targets.
 *
 * Thread-safety: applyModulation() is called from the audio thread.
 * All configuration methods should be called from the message thread.
 */
class ClapParamModulation
{
public:
    // ── Modulation source types ─────────────────────────────────────────

    enum class ModSource : uint32_t
    {
        None            = 0,
        Macro           = 1,   // User macro (0-7)
        MpePressure     = 2,   // MPE channel pressure
        MpeSlide        = 3,   // MPE slide (CC74)
        MpeTuning       = 4,   // MPE per-note tuning
        MidiCc          = 5,   // Any MIDI CC
        Lfo             = 6,   // Internal LFO
        Envelope        = 7,   // Internal envelope
        Velocity        = 8,   // Note velocity
        KeyTrack        = 9,   // Key tracking
        ModWheel        = 10,  // CC1
        Breath          = 11,  // CC2
        FootController  = 12,  // CC4

        Count
    };

    // ── Modulation entry ────────────────────────────────────────────────

    struct ModulationEntry
    {
        uint32_t paramId = 0;       // Target parameter ID
        ModSource source = ModSource::None;
        uint32_t sourceIndex = 0;   // Sub-index (e.g., macro index, CC number)
        double depth = 0.0;         // Modulation depth (-1..+1)
        bool bipolar = false;       // false = unipolar (0..1), true = bipolar (-1..1)

        bool operator==(const ModulationEntry& other) const
        {
            return paramId == other.paramId
                && source == other.source
                && sourceIndex == other.sourceIndex;
        }
    };

    // ── Modulation route (matrix cell) ──────────────────────────────────

    struct ModRoute
    {
        ModSource source = ModSource::None;
        uint32_t sourceIndex = 0;
        uint32_t paramId = 0;
        double depth = 0.0;
        bool active = true;
    };

    // ── Callback types ──────────────────────────────────────────────────

    using ModulationCallback = std::function<void(uint32_t paramId, double modulatedValue)>;

    ClapParamModulation();
    ~ClapParamModulation();

    // ── Lifecycle ───────────────────────────────────────────────────────

    void prepare(double sampleRate, int maxParams = 256);
    void release();
    void reset();

    // ── Parameter modulation (single entries) ───────────────────────────

    /**
     * Set modulation depth for a parameter from a source.
     * @param paramId Target parameter ID.
     * @param source Modulation source.
     * @param sourceIndex Sub-index (macro number, CC number, etc.).
     * @param depth Modulation depth (-1..+1).
     * @param bipolar Whether the source is bipolar.
     */
    void setModulationDepth(uint32_t paramId, ModSource source,
                            uint32_t sourceIndex, double depth, bool bipolar = false);

    /**
     * Get modulation depth for a parameter from a specific source.
     * @return Depth value, or 0.0 if no modulation exists.
     */
    double getModulationDepth(uint32_t paramId, ModSource source,
                              uint32_t sourceIndex) const;

    /**
     * Remove a specific modulation entry.
     */
    void removeModulation(uint32_t paramId, ModSource source, uint32_t sourceIndex);

    /**
     * Remove all modulation for a parameter.
     */
    void clearParameterModulation(uint32_t paramId);

    /**
     * Remove all modulation entries.
     */
    void clearAllModulations();

    // ── Modulation matrix ───────────────────────────────────────────────

    /**
     * Add a route to the modulation matrix.
     * @param route Modulation route to add.
     */
    void addRoute(const ModRoute& route);

    /**
     * Remove a route from the modulation matrix.
     */
    void removeRoute(ModSource source, uint32_t sourceIndex, uint32_t paramId);

    /**
     * Get all active routes.
     */
    std::vector<ModRoute> getActiveRoutes() const;

    /**
     * Get routes for a specific parameter.
     */
    std::vector<ModRoute> getRoutesForParam(uint32_t paramId) const;

    /**
     * Set the number of available macros.
     * @param count Number of macros (0-8).
     */
    void setNumMacros(int count);

    /**
     * Set the value of a modulation source.
     * @param source Source type.
     * @param sourceIndex Sub-index.
     * @param value Source value (0..1 for unipolar, -1..1 for bipolar).
     */
    void setSourceValue(ModSource source, uint32_t sourceIndex, double value);

    /**
     * Get the current value of a modulation source.
     */
    double getSourceValue(ModSource source, uint32_t sourceIndex) const;

    // ── Modulation processing ───────────────────────────────────────────

    /**
     * Apply all modulation to a parameter and return the modulated value.
     * @param paramId Target parameter ID.
     * @param baseValue The unmodulated parameter value.
     * @return The modulated parameter value.
     */
    double applyModulation(uint32_t paramId, double baseValue);

    /**
     * Get the total modulation amount for a parameter (sum of all active modulations).
     * @param paramId Target parameter ID.
     * @return Total modulation offset.
     */
    double getTotalModulation(uint32_t paramId) const;

    /**
     * Set a callback for real-time modulation change notifications.
     */
    void setCallback(ModulationCallback cb);

    // ── State queries ───────────────────────────────────────────────────

    bool isPrepared() const;

    /**
     * Get the number of active modulation entries.
     */
    int getNumModulations() const;

    /**
     * Get the number of active routes in the matrix.
     */
    int getNumRoutes() const;

private:
    struct SourceKey
    {
        ModSource source;
        uint32_t index;

        bool operator==(const SourceKey& other) const
        {
            return source == other.source && index == other.index;
        }
    };

    struct SourceKeyHash
    {
        size_t operator()(const SourceKey& k) const
        {
            return std::hash<uint32_t>()(static_cast<uint32_t>(k.source))
                ^ (std::hash<uint32_t>()(k.index) << 4);
        }
    };

    struct ParamModulations
    {
        std::vector<ModulationEntry> entries;
    };

    bool prepared = false;
    double currentSampleRate = 44100.0;
    int maxParamCount = 256;
    int numMacros = 0;

    // Modulation entries indexed by param ID
    std::unordered_map<uint32_t, ParamModulations> paramMods;

    // Modulation matrix routes
    std::vector<ModRoute> routes;

    // Current source values
    std::unordered_map<SourceKey, double, SourceKeyHash> sourceValues;

    // Callback
    ModulationCallback callback;

    mutable std::mutex modsMutex;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ClapParamModulation)
};
