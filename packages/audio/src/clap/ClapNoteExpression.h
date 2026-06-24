#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <cstdint>
#include <array>
#include <vector>
#include <functional>
#include <atomic>
#include <mutex>
#include <unordered_map>

/**
 * ClapNoteExpression — CLAP note expression and MPE support.
 *
 * Handles per-note expression events (pressure, tuning, brightness, etc.)
 * and MPE (MIDI Polyphonic Expression) zone management.
 *
 * Thread-safety: processNoteExpression() is called from the audio thread.
 * All configuration methods should be called from the message thread.
 */
class ClapNoteExpression
{
public:
    // ── CLAP note expression IDs (matches clap-note-expression) ────────

    enum class ExpressionId : uint32_t
    {
        Pressure    = 0,  // 0..1
        Tuning      = 1,  // semitones, continuous
        Brightness  = 2,  // 0..1 (CC74)
        Vibrato     = 3,  // 0..1
        Expression  = 4,  // 0..1 (generic)
        Brightness2 = 5,  // 0..1 (secondary)

        Count
    };

    // ── MPE zone configuration ──────────────────────────────────────────

    struct MpeZone
    {
        int startChannel = 1;   // 1-16
        int endChannel   = 16;  // 1-16
        int masterChannel = 1;  // Manager channel (typically 1 for lower, 16 for upper)
        bool isActive    = false;
    };

    // ── Per-note expression state ───────────────────────────────────────

    struct NoteExpressionState
    {
        std::array<double, static_cast<size_t>(ExpressionId::Count)> values{};

        NoteExpressionState() { values.fill(0.0); }

        double get(ExpressionId id) const
        {
            auto idx = static_cast<size_t>(id);
            return idx < values.size() ? values[idx] : 0.0;
        }

        void set(ExpressionId id, double value)
        {
            auto idx = static_cast<size_t>(id);
            if (idx < values.size())
                values[idx] = value;
        }
    };

    // ── Callback types ──────────────────────────────────────────────────

    using NoteExpressionCallback = std::function<void(int channel, int key,
                                                       ExpressionId id, double value)>;

    ClapNoteExpression();
    ~ClapNoteExpression();

    // ── Lifecycle ───────────────────────────────────────────────────────

    void prepare(double sampleRate, int maxVoices = 64);
    void release();
    void reset();

    // ── Note expression processing ──────────────────────────────────────

    /**
     * Process a note expression event.
     * @param channel MIDI channel (1-16, or MPE member channel 2-15).
     * @param key Note number (0-127).
     * @param id Expression type.
     * @param value Expression value (range depends on type).
     */
    void processNoteExpression(int channel, int key, ExpressionId id, double value);

    /**
     * Get the current expression state for a note.
     * @param channel MIDI channel.
     * @param key Note number.
     * @return Pointer to expression state, or nullptr if note not found.
     */
    const NoteExpressionState* getNoteExpression(int channel, int key) const;

    /**
     * Set a note expression callback for real-time notification.
     */
    void setCallback(NoteExpressionCallback cb);

    // ── MPE zone management ─────────────────────────────────────────────

    /**
     * Configure the lower MPE zone (manager on channel 1).
     * @param numChannels Number of member channels (0-14, 0 = zone off).
     */
    void setMpeLowerZone(int numChannels);

    /**
     * Configure the upper MPE zone (manager on channel 16).
     * @param numChannels Number of member channels (0-14, 0 = zone off).
     */
    void setMpeUpperZone(int numChannels);

    /**
     * Get MPE zone configuration.
     * @param isUpper false for lower zone, true for upper zone.
     */
    MpeZone getMpeZone(bool isUpper) const;

    /**
     * Check if a channel is an MPE member channel.
     * @param channel MIDI channel (1-16).
     */
    bool isMpeMemberChannel(int channel) const;

    /**
     * Check if a channel is an MPE manager channel.
     * @param channel MIDI channel (1-16).
     */
    bool isMpeManagerChannel(int channel) const;

    /**
     * Check if MPE mode is active (any zone enabled).
     */
    bool isMpeActive() const;

    // ── Pitch bend range ────────────────────────────────────────────────

    /**
     * Set the pitch bend range for MPE tuning expression.
     * @param semitones Range in semitones (default: 48).
     */
    void setPitchBendRange(int semitones);

    /**
     * Get the current pitch bend range.
     */
    int getPitchBendRange() const;

    // ── State queries ───────────────────────────────────────────────────

    bool isPrepared() const;

    /**
     * Get the number of active notes with expression data.
     */
    int getNumActiveNotes() const;

private:
    static constexpr int kMaxChannels = 16;
    static constexpr int kMaxKeys = 128;

    struct NoteKey
    {
        int channel;
        int key;

        bool operator==(const NoteKey& other) const
        {
            return channel == other.channel && key == other.key;
        }
    };

    struct NoteKeyHash
    {
        size_t operator()(const NoteKey& k) const
        {
            return std::hash<int>()(k.channel) ^ (std::hash<int>()(k.key) << 8);
        }
    };

    void applyPressure(int channel, int key, double value);
    void applyTuning(int channel, int key, double value);
    void applyBrightness(int channel, int key, double value);

    bool prepared = false;
    double currentSampleRate = 44100.0;
    int maxVoiceCount = 64;

    // Active note expressions (channel, key) -> state
    std::unordered_map<NoteKey, NoteExpressionState, NoteKeyHash> activeNotes;

    // MPE zones
    MpeZone lowerZone;
    MpeZone upperZone;

    // Pitch bend range for tuning expression (in semitones)
    std::atomic<int> pitchBendRange{48};

    // Callback
    NoteExpressionCallback callback;

    mutable std::mutex notesMutex;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(ClapNoteExpression)
};
