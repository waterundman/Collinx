#include <juce_audio_processors/juce_audio_processors.h>
#include "presets/PresetFormat.h"
#include "presets/PresetStorage.h"
#include "presets/PresetManager.h"
#include <cassert>
#include <iostream>
#include <filesystem>

using namespace collinx;

// ── Test Utilities ──────────────────────────────────────────────────────

class TestProcessor : public juce::AudioProcessor
{
public:
    TestProcessor() : AudioProcessor(BusesProperties()) {}

    const juce::String getName() const override { return "TestProcessor"; }

    void prepareToPlay(double, int) override {}
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override {}

    juce::AudioProcessorEditor* createEditor() override { return nullptr; }
    bool hasEditor() const override { return false; }

    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }

    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override
    {
        destData.setSize(4, true);
        *reinterpret_cast<int*>(destData.getData()) = testState;
    }

    void setStateInformation(const void* data, int sizeInBytes) override
    {
        if (sizeInBytes >= 4)
            testState = *reinterpret_cast<const int*>(data);
    }

    int testState = 42;
};

static int testsPassed = 0;
static int testsFailed = 0;

#define TEST(name) \
    std::cout << "Running: " << #name << "... "; \
    try { \
        name(); \
        std::cout << "PASSED\n"; \
        testsPassed++; \
    } catch (const std::exception& e) { \
        std::cout << "FAILED: " << e.what() << "\n"; \
        testsFailed++; \
    }

#define ASSERT(condition) \
    if (!(condition)) throw std::runtime_error("Assertion failed: " #condition);

#define ASSERT_EQ(a, b) \
    if ((a) != (b)) throw std::runtime_error("Assertion failed: " #a " == " #b);

// ── PresetFormat Tests ──────────────────────────────────────────────────

void testPresetFormatCreateFromProcessor()
{
    TestProcessor processor;
    auto preset = PresetFormat::createFromProcessor(processor, "Test Preset");

    ASSERT_EQ(preset.name, "Test Preset");
    ASSERT(preset.state.isValid());
    ASSERT(preset.isValid());
    ASSERT(preset.createdTime.isNotEmpty());
}

void testPresetFormatJsonSerialization()
{
    TestProcessor processor;
    auto original = PresetFormat::createFromProcessor(processor, "JSON Test");
    original.category = "Synth Leads";
    original.author = "Test Author";
    original.description = "A test preset";
    original.tags = {"lead", "bright", "analog"};

    auto json = original.toJson();
    ASSERT(json.isNotEmpty());

    auto loaded = PresetFormat::fromJson(json);
    ASSERT(loaded.has_value());
    ASSERT_EQ(loaded->name, original.name);
    ASSERT_EQ(loaded->category, original.category);
    ASSERT_EQ(loaded->author, original.author);
    ASSERT_EQ(loaded->description, original.description);
    ASSERT_EQ(loaded->tags.size(), original.tags.size());
}

void testPresetFormatValueTreeSerialization()
{
    TestProcessor processor;
    auto original = PresetFormat::createFromProcessor(processor, "VT Test");
    original.category = "Bass";
    original.tags = {"bass", "deep"};

    auto tree = original.toValueTree();
    ASSERT(tree.isValid());

    auto loaded = PresetFormat::fromValueTree(tree);
    ASSERT(loaded.has_value());
    ASSERT_EQ(loaded->name, original.name);
    ASSERT_EQ(loaded->category, original.category);
}

void testPresetFormatTagOperations()
{
    PresetFormat preset;
    preset.name = "Tag Test";

    preset.addTag("lead");
    preset.addTag("bass");
    preset.addTag("lead");  // Duplicate - should not add

    ASSERT(preset.hasTag("lead"));
    ASSERT(preset.hasTag("bass"));
    ASSERT_EQ(preset.tags.size(), 2);

    preset.removeTag("lead");
    ASSERT(!preset.hasTag("lead"));
    ASSERT_EQ(preset.tags.size(), 1);
}

void testPresetFormatVersion()
{
    PresetFormat preset;
    ASSERT_EQ(preset.version, PresetFormat::CURRENT_VERSION);
}

void testPresetFormatInvalidJson()
{
    auto result = PresetFormat::fromJson("invalid json");
    ASSERT(!result.has_value());
}

// ── PresetStorage Tests ─────────────────────────────────────────────────

void testPresetStorageInit()
{
    auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                       .getChildFile("collinx_test_presets");
    tempDir.deleteRecursively();

    PresetStorage storage;
    ASSERT(storage.initialize(tempDir));
    ASSERT(storage.isInitialized());
    ASSERT(tempDir.exists());

    storage.shutdown();
    tempDir.deleteRecursively();
}

void testPresetStorageSaveLoad()
{
    auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                       .getChildFile("collinx_test_presets");
    tempDir.deleteRecursively();

    PresetStorage storage;
    storage.initialize(tempDir);

    PresetFormat preset;
    preset.name = "Storage Test";
    preset.category = "Test Category";
    preset.state = juce::ValueTree("TestState");
    preset.createdTime = "2025-01-01T00:00:00";
    preset.modifiedTime = preset.createdTime;

    ASSERT(storage.savePreset(preset));

    auto index = storage.getIndex();
    ASSERT_EQ(index.size(), 1);
    ASSERT_EQ(index[0].name, "Storage Test");

    auto loaded = storage.loadPreset(index[0].id);
    ASSERT(loaded.has_value());
    ASSERT_EQ(loaded->name, "Storage Test");

    storage.shutdown();
    tempDir.deleteRecursively();
}

void testPresetStorageDelete()
{
    auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                       .getChildFile("collinx_test_presets");
    tempDir.deleteRecursively();

    PresetStorage storage;
    storage.initialize(tempDir);

    PresetFormat preset;
    preset.name = "Delete Test";
    preset.category = "Test";
    preset.state = juce::ValueTree("TestState");
    preset.createdTime = "2025-01-01T00:00:00";
    preset.modifiedTime = preset.createdTime;

    storage.savePreset(preset);
    auto index = storage.getIndex();
    ASSERT_EQ(index.size(), 1);

    ASSERT(storage.deletePreset(index[0].id));
    index = storage.getIndex();
    ASSERT_EQ(index.size(), 0);

    storage.shutdown();
    tempDir.deleteRecursively();
}

void testPresetStorageCategories()
{
    auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                       .getChildFile("collinx_test_presets");
    tempDir.deleteRecursively();

    PresetStorage storage;
    storage.initialize(tempDir);

    // Save presets with different categories
    for (int i = 0; i < 3; ++i)
    {
        PresetFormat preset;
        preset.name = "Preset " + juce::String(i);
        preset.category = (i < 2) ? "Category A" : "Category B";
        preset.state = juce::ValueTree("State");
        preset.createdTime = "2025-01-01T00:00:00";
        preset.modifiedTime = preset.createdTime;
        storage.savePreset(preset);
    }

    auto categories = storage.getCategories();
    ASSERT_EQ(categories.size(), 2);

    storage.shutdown();
    tempDir.deleteRecursively();
}

void testPresetStorageImportExport()
{
    auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                       .getChildFile("collinx_test_presets");
    tempDir.deleteRecursively();

    auto exportDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                         .getChildFile("collinx_test_export");
    exportDir.deleteRecursively();

    PresetStorage storage;
    storage.initialize(tempDir);

    PresetFormat preset;
    preset.name = "Export Test";
    preset.category = "Test";
    preset.state = juce::ValueTree("State");
    preset.createdTime = "2025-01-01T00:00:00";
    preset.modifiedTime = preset.createdTime;
    storage.savePreset(preset);

    auto index = storage.getIndex();
    auto exportFile = exportDir.getChildFile("export_test.json");
    exportDir.createDirectory();

    ASSERT(storage.exportPreset(index[0].id, exportFile));
    ASSERT(exportFile.existsAsFile());

    // Test import
    ASSERT(storage.importPreset(exportFile, "Imported"));
    auto newIndex = storage.getIndex();
    ASSERT_EQ(newIndex.size(), 2);

    storage.shutdown();
    tempDir.deleteRecursively();
    exportDir.deleteRecursively();
}

// ── PresetManager Tests ─────────────────────────────────────────────────

void testPresetManagerInit()
{
    auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                       .getChildFile("collinx_test_presets");
    tempDir.deleteRecursively();

    PresetManager manager;
    ASSERT(manager.initialize(tempDir));
    ASSERT(manager.isInitialized());

    manager.shutdown();
    tempDir.deleteRecursively();
}

void testPresetManagerSaveLoad()
{
    auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                       .getChildFile("collinx_test_presets");
    tempDir.deleteRecursively();

    PresetManager manager;
    manager.initialize(tempDir);

    TestProcessor processor;
    auto id = manager.saveCurrentState(processor, "Manager Test", "Test Category",
                                       "Description", "Author", {"tag1", "tag2"});
    ASSERT(id.isNotEmpty());

    ASSERT(manager.loadPreset(id, processor));
    ASSERT_EQ(processor.testState, 42);

    manager.shutdown();
    tempDir.deleteRecursively();
}

void testPresetManagerSearch()
{
    auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                       .getChildFile("collinx_test_presets");
    tempDir.deleteRecursively();

    PresetManager manager;
    manager.initialize(tempDir);

    TestProcessor processor;
    manager.saveCurrentState(processor, "Lead Synth", "Synth Leads", "Bright lead", "", {"lead", "bright"});
    manager.saveCurrentState(processor, "Bass Sound", "Bass", "Deep bass", "", {"bass", "deep"});
    manager.saveCurrentState(processor, "Pad Ambient", "Pads", "Atmospheric pad", "", {"pad", "ambient"});

    // Search by name
    auto results = manager.searchPresets("lead");
    ASSERT_EQ(results.size(), 1);
    ASSERT_EQ(results[0].name, "Lead Synth");

    // Search by category
    results = manager.getPresetsByCategory("Bass");
    ASSERT_EQ(results.size(), 1);
    ASSERT_EQ(results[0].name, "Bass Sound");

    // Search by tag
    results = manager.getPresetsByTag("ambient");
    ASSERT_EQ(results.size(), 1);
    ASSERT_EQ(results[0].name, "Pad Ambient");

    manager.shutdown();
    tempDir.deleteRecursively();
}

void testPresetManagerFilter()
{
    auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                       .getChildFile("collinx_test_presets");
    tempDir.deleteRecursively();

    PresetManager manager;
    manager.initialize(tempDir);

    TestProcessor processor;
    manager.saveCurrentState(processor, "Lead 1", "Synth Leads", "", "", {"lead", "bright"});
    manager.saveCurrentState(processor, "Lead 2", "Synth Leads", "", "", {"lead", "dark"});
    manager.saveCurrentState(processor, "Bass 1", "Bass", "", "", {"bass"});

    PresetManager::PresetFilter filter;
    filter.category = "Synth Leads";
    filter.requiredTags = {"bright"};
    filter.matchAllTags = true;

    auto results = manager.filterPresets(filter);
    ASSERT_EQ(results.size(), 1);
    ASSERT_EQ(results[0].name, "Lead 1");

    manager.shutdown();
    tempDir.deleteRecursively();
}

void testPresetManagerDelete()
{
    auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                       .getChildFile("collinx_test_presets");
    tempDir.deleteRecursively();

    PresetManager manager;
    manager.initialize(tempDir);

    TestProcessor processor;
    auto id = manager.saveCurrentState(processor, "Delete Test", "Test");
    ASSERT_EQ(manager.getNumPresets(), 1);

    ASSERT(manager.deletePreset(id));
    ASSERT_EQ(manager.getNumPresets(), 0);

    manager.shutdown();
    tempDir.deleteRecursively();
}

void testPresetManagerCategories()
{
    auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                       .getChildFile("collinx_test_presets");
    tempDir.deleteRecursively();

    PresetManager manager;
    manager.initialize(tempDir);

    TestProcessor processor;
    manager.saveCurrentState(processor, "Preset 1", "Category A");
    manager.saveCurrentState(processor, "Preset 2", "Category B");

    auto categories = manager.getCategories();
    ASSERT_EQ(categories.size(), 2);

    manager.shutdown();
    tempDir.deleteRecursively();
}

void testPresetManagerTags()
{
    auto tempDir = juce::File::getSpecialLocation(juce::File::tempDirectory)
                       .getChildFile("collinx_test_presets");
    tempDir.deleteRecursively();

    PresetManager manager;
    manager.initialize(tempDir);

    TestProcessor processor;
    auto id = manager.saveCurrentState(processor, "Tag Test", "Test", "", "", {"tag1", "tag2"});

    auto tags = manager.getAllTags();
    ASSERT_EQ(tags.size(), 2);

    manager.addTagToPreset(id, "tag3");
    tags = manager.getAllTags();
    ASSERT_EQ(tags.size(), 3);

    manager.removeTagFromPreset(id, "tag1");
    auto preset = manager.loadPreset(id);
    ASSERT(preset.has_value());
    ASSERT_EQ(preset->tags.size(), 2);

    manager.shutdown();
    tempDir.deleteRecursively();
}

// ── Main ────────────────────────────────────────────────────────────────

int main()
{
    std::cout << "=== Preset System Unit Tests ===\n\n";

    // PresetFormat tests
    std::cout << "--- PresetFormat Tests ---\n";
    TEST(testPresetFormatCreateFromProcessor);
    TEST(testPresetFormatJsonSerialization);
    TEST(testPresetFormatValueTreeSerialization);
    TEST(testPresetFormatTagOperations);
    TEST(testPresetFormatVersion);
    TEST(testPresetFormatInvalidJson);

    // PresetStorage tests
    std::cout << "\n--- PresetStorage Tests ---\n";
    TEST(testPresetStorageInit);
    TEST(testPresetStorageSaveLoad);
    TEST(testPresetStorageDelete);
    TEST(testPresetStorageCategories);
    TEST(testPresetStorageImportExport);

    // PresetManager tests
    std::cout << "\n--- PresetManager Tests ---\n";
    TEST(testPresetManagerInit);
    TEST(testPresetManagerSaveLoad);
    TEST(testPresetManagerSearch);
    TEST(testPresetManagerFilter);
    TEST(testPresetManagerDelete);
    TEST(testPresetManagerCategories);
    TEST(testPresetManagerTags);

    std::cout << "\n=== Results ===\n";
    std::cout << "Passed: " << testsPassed << "\n";
    std::cout << "Failed: " << testsFailed << "\n";

    return testsFailed > 0 ? 1 : 0;
}
