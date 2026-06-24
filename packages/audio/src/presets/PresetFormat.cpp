#include "PresetFormat.h"
#include <sstream>
#include <iomanip>

namespace collinx {

// ── Factory Methods ─────────────────────────────────────────────────────

PresetFormat PresetFormat::createFromProcessor(juce::AudioProcessor& processor,
                                               const juce::String& name)
{
    PresetFormat preset;
    preset.name = name;
    preset.state = processor.copyState();
    preset.createdTime = getCurrentTimestamp();
    preset.modifiedTime = preset.createdTime;
    preset.version = CURRENT_VERSION;
    return preset;
}

PresetFormat PresetFormat::createFromState(const juce::ValueTree& state,
                                           const juce::String& name)
{
    PresetFormat preset;
    preset.name = name;
    preset.state = state.createCopy();
    preset.createdTime = getCurrentTimestamp();
    preset.modifiedTime = preset.createdTime;
    preset.version = CURRENT_VERSION;
    return preset;
}

// ── Serialization ───────────────────────────────────────────────────────

juce::String PresetFormat::toJson() const
{
    juce::DynamicObject::Ptr root = new juce::DynamicObject();

    // Metadata
    root->setProperty("name", name);
    root->setProperty("description", description);
    root->setProperty("author", author);
    root->setProperty("category", category);
    root->setProperty("pluginName", pluginName);
    root->setProperty("pluginIdentifier", pluginIdentifier);
    root->setProperty("pluginFormat", pluginFormat);

    // Version info
    root->setProperty(FORMAT_VERSION_KEY, version);

    // Timestamps
    root->setProperty("createdTime", createdTime);
    root->setProperty("modifiedTime", modifiedTime);

    // Tags
    juce::Array<juce::var> tagsArray;
    for (const auto& tag : tags)
        tagsArray.add(juce::var(tag));
    root->setProperty("tags", tagsArray);

    // State data
    if (state.isValid())
    {
        juce::String stateXml;
        auto* xml = state.createXml();
        if (xml != nullptr)
        {
            stateXml = xml->toString();
            delete xml;
        }
        root->setProperty("stateXml", stateXml);
    }

    return juce::JSON::toString(root.get(), true);
}

juce::ValueTree PresetFormat::toValueTree() const
{
    juce::ValueTree tree("Preset");

    // Metadata
    tree.setProperty("name", name, nullptr);
    tree.setProperty("description", description, nullptr);
    tree.setProperty("author", author, nullptr);
    tree.setProperty("category", category, nullptr);
    tree.setProperty("pluginName", pluginName, nullptr);
    tree.setProperty("pluginIdentifier", pluginIdentifier, nullptr);
    tree.setProperty("pluginFormat", pluginFormat, nullptr);

    // Version
    tree.setProperty(FORMAT_VERSION_KEY, version, nullptr);

    // Timestamps
    tree.setProperty("createdTime", createdTime, nullptr);
    tree.setProperty("modifiedTime", modifiedTime, nullptr);

    // Tags
    juce::ValueTree tagsTree("Tags");
    for (const auto& tag : tags)
    {
        juce::ValueTree tagTree("Tag");
        tagTree.setProperty("value", tag, nullptr);
        tagsTree.addChild(tagTree, -1, nullptr);
    }
    tree.addChild(tagsTree, -1, nullptr);

    // State
    if (state.isValid())
        tree.addChild(state.createCopy(), -1, nullptr);

    return tree;
}

std::optional<PresetFormat> PresetFormat::fromJson(const juce::String& json)
{
    auto parsed = juce::JSON::parse(json);
    if (!parsed.isObject())
        return std::nullopt;

    auto* obj = parsed.getDynamicObject();
    if (obj == nullptr)
        return std::nullopt;

    PresetFormat preset;

    // Metadata
    preset.name = obj->getProperty("name", "");
    preset.description = obj->getProperty("description", "");
    preset.author = obj->getProperty("author", "");
    preset.category = obj->getProperty("category", "");
    preset.pluginName = obj->getProperty("pluginName", "");
    preset.pluginIdentifier = obj->getProperty("pluginIdentifier", "");
    preset.pluginFormat = obj->getProperty("pluginFormat", "");

    // Version
    preset.version = static_cast<int>(obj->getProperty(FORMAT_VERSION_KEY, 1));

    // Timestamps
    preset.createdTime = obj->getProperty("createdTime", "");
    preset.modifiedTime = obj->getProperty("modifiedTime", "");

    // Tags
    auto tagsVar = obj->getProperty("tags", juce::var());
    if (tagsVar.isArray())
    {
        auto* tagsArray = tagsVar.getArray();
        if (tagsArray != nullptr)
        {
            for (const auto& tag : *tagsArray)
                preset.tags.push_back(tag.toString());
        }
    }

    // State from XML
    auto stateXml = obj->getProperty("stateXml", "").toString();
    if (stateXml.isNotEmpty())
    {
        auto xml = juce::XmlDocument::parse(stateXml);
        if (xml != nullptr)
        {
            preset.state = juce::ValueTree::fromXml(*xml);
        }
    }

    return preset;
}

std::optional<PresetFormat> PresetFormat::fromValueTree(const juce::ValueTree& tree)
{
    if (!tree.hasType("Preset"))
        return std::nullopt;

    PresetFormat preset;

    // Metadata
    preset.name = tree.getProperty("name", "");
    preset.description = tree.getProperty("description", "");
    preset.author = tree.getProperty("author", "");
    preset.category = tree.getProperty("category", "");
    preset.pluginName = tree.getProperty("pluginName", "");
    preset.pluginIdentifier = tree.getProperty("pluginIdentifier", "");
    preset.pluginFormat = tree.getProperty("pluginFormat", "");

    // Version
    preset.version = static_cast<int>(tree.getProperty(FORMAT_VERSION_KEY, 1));

    // Timestamps
    preset.createdTime = tree.getProperty("createdTime", "");
    preset.modifiedTime = tree.getProperty("modifiedTime", "");

    // Tags
    auto tagsTree = tree.getChildWithName("Tags");
    if (tagsTree.isValid())
    {
        for (int i = 0; i < tagsTree.getNumChildren(); ++i)
        {
            auto tagTree = tagsTree.getChild(i);
            preset.tags.push_back(tagTree.getProperty("value", "").toString());
        }
    }

    // State (first non-metadata child that isn't "Tags")
    for (int i = 0; i < tree.getNumChildren(); ++i)
    {
        auto child = tree.getChild(i);
        if (!child.hasType("Tags"))
        {
            preset.state = child.createCopy();
            break;
        }
    }

    return preset;
}

// ── State Application ───────────────────────────────────────────────────

bool PresetFormat::applyToProcessor(juce::AudioProcessor& processor) const
{
    if (!state.isValid())
        return false;

    processor.replaceState(state);
    return true;
}

// ── Validation ──────────────────────────────────────────────────────────

bool PresetFormat::isValid() const
{
    return name.isNotEmpty() && state.isValid();
}

juce::String PresetFormat::toString() const
{
    juce::String result;
    result << "Preset: " << name << "\n";
    result << "  Category: " << (category.isNotEmpty() ? category : "(none)") << "\n";
    result << "  Author: " << (author.isNotEmpty() ? author : "(unknown)") << "\n";
    result << "  Plugin: " << pluginName << " (" << pluginFormat << ")\n";
    result << "  Tags: ";
    if (tags.empty())
        result << "(none)";
    else
    {
        for (size_t i = 0; i < tags.size(); ++i)
        {
            if (i > 0) result << ", ";
            result << tags[i];
        }
    }
    result << "\n";
    result << "  Version: " << version << "\n";
    result << "  Created: " << createdTime << "\n";
    result << "  Modified: " << modifiedTime;
    return result;
}

// ── Tag Operations ──────────────────────────────────────────────────────

bool PresetFormat::hasTag(const juce::String& tag) const
{
    return std::find(tags.begin(), tags.end(), tag) != tags.end();
}

void PresetFormat::addTag(const juce::String& tag)
{
    if (!hasTag(tag))
        tags.push_back(tag);
}

void PresetFormat::removeTag(const juce::String& tag)
{
    tags.erase(std::remove(tags.begin(), tags.end(), tag), tags.end());
}

// ── Private ─────────────────────────────────────────────────────────────

juce::String PresetFormat::getCurrentTimestamp()
{
    auto now = std::chrono::system_clock::now();
    auto time = std::chrono::system_clock::to_time_t(now);
    std::tm tm;
#ifdef _WIN32
    localtime_s(&tm, &time);
#else
    localtime_r(&time, &tm);
#endif
    std::ostringstream oss;
    oss << std::put_time(&tm, "%Y-%m-%dT%H:%M:%S");
    return oss.str();
}

} // namespace collinx
