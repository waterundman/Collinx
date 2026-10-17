#include "PluginFormatRegistry.h"
#include "../clap/ClapPluginFormat.h"

PluginFormatRegistry::PluginFormatRegistry() = default;

PluginFormatRegistry::~PluginFormatRegistry()
{
    shutdown();
}

bool PluginFormatRegistry::initialize()
{
    if (initialized)
        return true;

    // Register built-in JUCE formats (VST3, AU, etc.)
    formatManager.addDefaultFormats();

    // Store references to default formats
    for (int i = 0; i < formatManager.getNumFormats(); ++i)
    {
        auto* format = formatManager.getFormat(i);
        if (format != nullptr)
        {
            FormatEntry entry;
            entry.rawFormat = format;
            entry.name = format->getName();
            formats.push_back(entry);
        }
    }

    // Register CLAP format (custom implementation)
    //
    // 所有权模型（v2.8.0 第 30 轮修正）：交给 AudioPluginFormatManager 的格式
    // 由它**独占**（JUCE 8.0.1 头文件注释："The object passed in will be owned
    // and deleted by the manager"）。registry 只保留裸指针用于查询。
    // 此前的写法是 make_shared 持有同一个对象、再把裸指针交给 manager，
    // 两者析构时各自 delete 一次 → 双重释放 → SegFault。
    auto* clapFormat = new ClapPluginFormat();
    registerFormat(clapFormat);
    formatManager.addFormat(clapFormat);

    initialized = true;
    DBG("PluginFormatRegistry: Initialized with " + juce::String(formats.size()) + " formats");
    return true;
}

void PluginFormatRegistry::shutdown()
{
    if (!initialized)
        return;

    // Clear format entries
    {
        std::lock_guard<std::mutex> lock(registryMutex);
        formats.clear();
    }

    initialized = false;
    DBG("PluginFormatRegistry: Shut down");
}

void PluginFormatRegistry::registerFormat(juce::AudioPluginFormat* format)
{
    if (format == nullptr)
        return;

    std::lock_guard<std::mutex> lock(registryMutex);

    // Check if already registered
    for (const auto& entry : formats)
    {
        if (entry.get()->getName() == format->getName())
        {
            DBG("PluginFormatRegistry: Format '" + format->getName() + "' already registered");
            return;
        }
    }

    FormatEntry entry;
    entry.rawFormat = format;
    entry.name = format->getName();
    formats.push_back(entry);

    DBG("PluginFormatRegistry: Registered format '" + format->getName() + "'");
}

void PluginFormatRegistry::registerFormat(std::shared_ptr<juce::AudioPluginFormat> format)
{
    if (format == nullptr)
        return;

    std::lock_guard<std::mutex> lock(registryMutex);

    // Check if already registered
    for (const auto& entry : formats)
    {
        if (entry.get()->getName() == format->getName())
        {
            DBG("PluginFormatRegistry: Format '" + format->getName() + "' already registered");
            return;
        }
    }

    FormatEntry entry;
    entry.ownedFormat = format;
    entry.rawFormat = format.get();
    entry.name = format->getName();
    formats.push_back(entry);

    // v2.8.0 第 30 轮：这里**不能**再调 formatManager.addFormat(format.get())。
    // addFormat 会接管所有权并 delete，而本重载的 shared_ptr 仍持有同一对象
    // → 双重释放。走本重载的格式只登记在 registry（shared 所有权归调用方），
    // 若还需要让它参与 formatManager 的实例创建，请改用裸指针重载，
    // 由 formatManager 独占（见 initialize() 中 CLAP 的注册方式）。

    DBG("PluginFormatRegistry: Registered format '" + format->getName() + "' (shared ownership)");
}

bool PluginFormatRegistry::unregisterFormat(const juce::String& formatName)
{
    std::lock_guard<std::mutex> lock(registryMutex);

    for (auto it = formats.begin(); it != formats.end(); ++it)
    {
        if (it->name == formatName)
        {
            formats.erase(it);
            DBG("PluginFormatRegistry: Unregistered format '" + formatName + "'");
            return true;
        }
    }

    return false;
}

juce::AudioPluginFormat* PluginFormatRegistry::getFormat(const juce::String& formatName) const
{
    std::lock_guard<std::mutex> lock(registryMutex);

    for (const auto& entry : formats)
    {
        if (entry.name == formatName)
            return entry.get();
    }

    return nullptr;
}

juce::StringArray PluginFormatRegistry::getRegisteredFormatNames() const
{
    std::lock_guard<std::mutex> lock(registryMutex);

    juce::StringArray names;
    for (const auto& entry : formats)
        names.add(entry.name);

    return names;
}

int PluginFormatRegistry::getNumFormats() const
{
    std::lock_guard<std::mutex> lock(registryMutex);
    return static_cast<int>(formats.size());
}

juce::AudioPluginFormat* PluginFormatRegistry::detectFormat(const juce::String& fileOrIdentifier) const
{
    std::lock_guard<std::mutex> lock(registryMutex);

    for (const auto& entry : formats)
    {
        auto* format = entry.get();
        if (format != nullptr && format->fileMightContainThisPluginType(fileOrIdentifier))
            return format;
    }

    return nullptr;
}

juce::String PluginFormatRegistry::getFormatName(const juce::String& fileOrIdentifier) const
{
    auto* format = detectFormat(fileOrIdentifier);
    return format ? format->getName() : juce::String();
}

bool PluginFormatRegistry::isKnownPluginFormat(const juce::String& fileOrIdentifier) const
{
    return detectFormat(fileOrIdentifier) != nullptr;
}
