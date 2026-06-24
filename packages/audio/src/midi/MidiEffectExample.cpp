#include "MidiEffectProcessor.h"
#include "MidiEffectChain.h"
#include "MidiRouter.h"
#include <iostream>

/**
 * Example: Using MIDI Effect Chain and Router
 * 
 * This example demonstrates how to:
 * 1. Create custom MIDI effects
 * 2. Build a MIDI effect chain
 * 3. Configure MIDI routing
 * 4. Process MIDI events
 */

// Example: Simple MIDI transposer effect
class MidiTransposer : public MidiEffectProcessor
{
public:
    MidiTransposer() = default;
    ~MidiTransposer() override = default;

    juce::String getName() const override { return "MIDI Transposer"; }

    void setTransposeAmount(int semitones)
    {
        transposeAmount = semitones;
    }

    void process(juce::MidiBuffer& midiMessages, int numSamples) override
    {
        if (isBypassed())
            return;

        juce::MidiBuffer processedMessages;
        
        for (const auto metadata : midiMessages)
        {
            const auto& message = metadata.getMessage();
            
            if (shouldProcessMessage(message))
            {
                if (message.isNoteOn())
                {
                    int newNote = juce::jlimit(0, 127, message.getNoteNumber() + transposeAmount);
                    auto newMessage = juce::MidiMessage::noteOn(
                        message.getChannel(), newNote, message.getFloatVelocity());
                    processedMessages.addEvent(newMessage, metadata.samplePosition);
                }
                else if (message.isNoteOff())
                {
                    int newNote = juce::jlimit(0, 127, message.getNoteNumber() + transposeAmount);
                    auto newMessage = juce::MidiMessage::noteOff(
                        message.getChannel(), newNote, message.getFloatVelocity());
                    processedMessages.addEvent(newMessage, metadata.samplePosition);
                }
                else
                {
                    // Pass through other messages
                    processedMessages.addEvent(message, metadata.samplePosition);
                }
            }
            else
            {
                // Pass through unprocessed messages
                processedMessages.addEvent(message, metadata.samplePosition);
            }
        }

        midiMessages.swapWith(processedMessages);
    }

    int getNumParameters() const override { return 1; }
    
    float getParameter(int index) const override
    {
        if (index == 0)
            return static_cast<float>(transposeAmount + 12) / 24.0f; // Normalize to 0-1
        return 0.0f;
    }
    
    void setParameter(int index, float value) override
    {
        if (index == 0)
            transposeAmount = static_cast<int>(value * 24.0f) - 12;
    }
    
    juce::String getParameterName(int index) const override
    {
        if (index == 0)
            return "Transpose";
        return {};
    }
    
    juce::String getParameterText(int index) const override
    {
        if (index == 0)
            return juce::String(transposeAmount) + " semitones";
        return {};
    }

private:
    int transposeAmount = 0;
};

// Example: Simple MIDI velocity scaler
class MidiVelocityScaler : public MidiEffectProcessor
{
public:
    MidiVelocityScaler() = default;
    ~MidiVelocityScaler() override = default;

    juce::String getName() const override { return "MIDI Velocity Scaler"; }

    void setScaleFactor(float factor)
    {
        scaleFactor = factor;
    }

    void process(juce::MidiBuffer& midiMessages, int numSamples) override
    {
        if (isBypassed())
            return;

        juce::MidiBuffer processedMessages;
        
        for (const auto metadata : midiMessages)
        {
            const auto& message = metadata.getMessage();
            
            if (shouldProcessMessage(message) && message.isNoteOn())
            {
                float scaledVelocity = message.getFloatVelocity() * scaleFactor;
                scaledVelocity = juce::jlimit(0.0f, 1.0f, scaledVelocity);
                
                auto newMessage = juce::MidiMessage::noteOn(
                    message.getChannel(), message.getNoteNumber(), scaledVelocity);
                processedMessages.addEvent(newMessage, metadata.samplePosition);
            }
            else
            {
                processedMessages.addEvent(message, metadata.samplePosition);
            }
        }

        midiMessages.swapWith(processedMessages);
    }

private:
    float scaleFactor = 1.0f;
};

int main()
{
    std::cout << "=== MIDI Effect Chain Example ===" << std::endl;

    // Create MIDI effect chain
    MidiEffectChain chain;
    
    // Add transposer effect
    auto transposer = std::make_unique<MidiTransposer>();
    transposer->setTransposeAmount(12); // Transpose up one octave
    chain.addEffect(std::move(transposer));
    
    // Add velocity scaler
    auto velocityScaler = std::make_unique<MidiVelocityScaler>();
    velocityScaler->setScaleFactor(0.5f); // Half velocity
    chain.addEffect(std::move(velocityScaler));
    
    // Prepare chain
    chain.prepare(44100.0, 512);
    chain.activateAll();
    
    // Create MIDI messages
    juce::MidiBuffer midiMessages;
    midiMessages.addEvent(juce::MidiMessage::noteOn(1, 60, (juce::uint8)100), 0); // Middle C
    midiMessages.addEvent(juce::MidiMessage::noteOff(1, 60, (juce::uint8)0), 500);
    
    std::cout << "Input MIDI events: " << midiMessages.getNumEvents() << std::endl;
    
    // Process through chain
    chain.process(midiMessages, 512);
    
    std::cout << "Output MIDI events: " << midiMessages.getNumEvents() << std::endl;
    
    // Print processed messages
    for (const auto metadata : midiMessages)
    {
        const auto& message = metadata.getMessage();
        if (message.isNoteOn())
        {
            std::cout << "Note On: Channel " << message.getChannel()
                      << ", Note " << message.getNoteNumber()
                      << ", Velocity " << message.getFloatVelocity() << std::endl;
        }
        else if (message.isNoteOff())
        {
            std::cout << "Note Off: Channel " << message.getChannel()
                      << ", Note " << message.getNoteNumber() << std::endl;
        }
    }
    
    // Create MIDI router
    MidiRouter router;
    router.prepare(44100.0, 512);
    
    // Configure routing: channel 1 -> channel 5
    router.setChannelMapping(1, 5);
    
    // Process routing
    juce::MidiBuffer inputMessages;
    inputMessages.addEvent(juce::MidiMessage::noteOn(1, 60, (juce::uint8)100), 0);
    
    juce::MidiBuffer outputMessages;
    router.process(inputMessages, outputMessages, 512);
    
    std::cout << "\nRouting example:" << std::endl;
    std::cout << "Input channel: 1" << std::endl;
    
    for (const auto metadata : outputMessages)
    {
        const auto& message = metadata.getMessage();
        std::cout << "Output channel: " << message.getChannel() << std::endl;
    }
    
    // Cleanup
    chain.release();
    router.release();
    
    std::cout << "\n=== Example Complete ===" << std::endl;
    
    return 0;
}