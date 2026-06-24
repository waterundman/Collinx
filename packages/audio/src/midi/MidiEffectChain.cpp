#include "MidiEffectChain.h"

MidiEffectChain::MidiEffectChain() = default;

MidiEffectChain::~MidiEffectChain()
{
    release();
}

// ── Lifecycle ──────────────────────────────────────────────────────────

void MidiEffectChain::prepare(double sampleRate, int samplesPerBlock)
{
    currentSampleRate = sampleRate;
    currentBlockSize = samplesPerBlock;

    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (auto& effect : effects)
    {
        if (effect != nullptr)
            effect->prepare(sampleRate, samplesPerBlock);
    }

    isPrepared = true;
    rebuildSnapshot();
}

void MidiEffectChain::release()
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (auto& effect : effects)
    {
        if (effect != nullptr)
        {
            if (effect->isActive())
                effect->deactivate();
            effect->release();
        }
    }

    isPrepared = false;
    rebuildSnapshot();
}

void MidiEffectChain::activateAll()
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (auto& effect : effects)
    {
        if (effect != nullptr && effect->isPrepared())
            effect->activate();
    }

    rebuildSnapshot();
}

void MidiEffectChain::deactivateAll()
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (auto& effect : effects)
    {
        if (effect != nullptr)
            effect->deactivate();
    }

    rebuildSnapshot();
}

// ── Processing ─────────────────────────────────────────────────────────

void MidiEffectChain::process(juce::MidiBuffer& midiMessages, int numSamples)
{
    // Lock-free fast path: copy the snapshot pointers
    ChainSnapshot localSnapshot;
    {
        std::lock_guard<std::mutex> lock(snapshotMutex);
        localSnapshot = snapshot;
    }

    if (localSnapshot.chainBypassed)
        return;

    for (auto* effect : localSnapshot.processors)
    {
        if (effect == nullptr)
            continue;

        if (effect->isBypassed())
            continue;

        effect->process(midiMessages, numSamples);
    }
}

// ── Chain manipulation ─────────────────────────────────────────────────

int MidiEffectChain::addEffect(std::unique_ptr<MidiEffectProcessor> effect)
{
    if (effect == nullptr)
        return -1;

    int index;
    {
        std::lock_guard<std::mutex> lock(snapshotMutex);

        index = static_cast<int>(effects.size());
        effects.push_back(std::move(effect));

        if (isPrepared)
            prepareAndActivateEffect(*effects.back());

        rebuildSnapshot();
    }

    if (chainChangeCallback)
        chainChangeCallback();

    return index;
}

void MidiEffectChain::removeEffect(int index)
{
    {
        std::lock_guard<std::mutex> lock(snapshotMutex);

        if (index < 0 || index >= static_cast<int>(effects.size()))
            return;

        auto& effect = effects[static_cast<size_t>(index)];
        if (effect != nullptr)
        {
            if (effect->isActive())
                effect->deactivate();
            effect->release();
        }

        effects.erase(effects.begin() + index);
        rebuildSnapshot();
    }

    if (chainChangeCallback)
        chainChangeCallback();
}

void MidiEffectChain::removeEffectById(int effectId)
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (size_t i = 0; i < effects.size(); ++i)
    {
        if (effects[i] != nullptr && effects[i]->getId() == effectId)
        {
            auto& effect = effects[i];
            if (effect->isActive())
                effect->deactivate();
            effect->release();

            effects.erase(effects.begin() + static_cast<int>(i));
            rebuildSnapshot();

            if (chainChangeCallback)
                chainChangeCallback();

            return;
        }
    }
}

void MidiEffectChain::moveEffect(int fromIndex, int toIndex)
{
    {
        std::lock_guard<std::mutex> lock(snapshotMutex);

        int numEffects = static_cast<int>(effects.size());
        if (fromIndex < 0 || fromIndex >= numEffects)
            return;
        if (toIndex < 0 || toIndex >= numEffects)
            return;
        if (fromIndex == toIndex)
            return;

        auto effect = std::move(effects[static_cast<size_t>(fromIndex)]);
        effects.erase(effects.begin() + fromIndex);
        effects.insert(effects.begin() + toIndex, std::move(effect));

        rebuildSnapshot();
    }

    if (chainChangeCallback)
        chainChangeCallback();
}

const MidiEffectProcessor* MidiEffectChain::getEffect(int index) const
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    if (index < 0 || index >= static_cast<int>(effects.size()))
        return nullptr;

    return effects[static_cast<size_t>(index)].get();
}

MidiEffectProcessor* MidiEffectChain::getEffect(int index)
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    if (index < 0 || index >= static_cast<int>(effects.size()))
        return nullptr;

    return effects[static_cast<size_t>(index)].get();
}

MidiEffectProcessor* MidiEffectChain::getEffectById(int effectId)
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    for (auto& effect : effects)
    {
        if (effect != nullptr && effect->getId() == effectId)
            return effect.get();
    }

    return nullptr;
}

int MidiEffectChain::getNumEffects() const
{
    std::lock_guard<std::mutex> lock(snapshotMutex);
    return static_cast<int>(effects.size());
}

bool MidiEffectChain::isEmpty() const
{
    std::lock_guard<std::mutex> lock(snapshotMutex);
    return effects.empty();
}

// ── Bypass ─────────────────────────────────────────────────────────────

void MidiEffectChain::setChainBypassed(bool shouldBypass)
{
    chainBypassed.store(shouldBypass);

    std::lock_guard<std::mutex> lock(snapshotMutex);
    rebuildSnapshot();
}

bool MidiEffectChain::isChainBypassed() const
{
    return chainBypassed.load();
}

// ── Queries ────────────────────────────────────────────────────────────

std::vector<juce::String> MidiEffectChain::getEffectNames() const
{
    std::lock_guard<std::mutex> lock(snapshotMutex);

    std::vector<juce::String> names;
    names.reserve(effects.size());

    for (const auto& effect : effects)
    {
        if (effect != nullptr)
            names.push_back(effect->getName());
        else
            names.push_back("<null>");
    }

    return names;
}

void MidiEffectChain::setChainChangeCallback(ChainChangeCallback callback)
{
    chainChangeCallback = std::move(callback);
}

// ── Internal ───────────────────────────────────────────────────────────

void MidiEffectChain::rebuildSnapshot()
{
    snapshot.processors.clear();
    snapshot.processors.reserve(effects.size());
    snapshot.chainBypassed = chainBypassed.load();

    for (const auto& effect : effects)
    {
        snapshot.processors.push_back(effect.get());
    }
}

void MidiEffectChain::prepareAndActivateEffect(MidiEffectProcessor& effect)
{
    effect.prepare(currentSampleRate, currentBlockSize);
    effect.activate();
}