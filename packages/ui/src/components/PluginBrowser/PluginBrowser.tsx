import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { Vst3PluginInfo, Vst3Parameter, Vst3Preset } from "../../services/Vst3HostService";
import { getVst3HostService } from "../../services/Vst3HostService";
import styles from "./PluginBrowser.module.css";

interface PluginBrowserProps {
  onPluginLoad?: (pluginId: string) => void;
  onPluginUnload?: (pluginId: string) => void;
  onPluginSelect?: (pluginId: string) => void;
}

type SortField = "name" | "vendor" | "category";
type SortDirection = "asc" | "desc";

export const PluginBrowser: React.FC<PluginBrowserProps> = ({
  onPluginLoad,
  onPluginUnload,
  onPluginSelect,
}) => {
  const [plugins, setPlugins] = useState<Vst3PluginInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [parameters, setParameters] = useState<Vst3Parameter[]>([]);
  const [presets, setPresets] = useState<Vst3Preset[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const service = getVst3HostService();

  useEffect(() => {
    const loadInitialPlugins = async () => {
      setIsLoading(true);
      try {
        const allPlugins = service.getAllPlugins();
        setPlugins(allPlugins);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialPlugins();

    const handlePluginLoaded = (event: { pluginId?: string }) => {
      if (event.pluginId) {
        setPlugins(service.getAllPlugins());
        if (event.pluginId === selectedPlugin) {
          loadPluginDetails(event.pluginId);
        }
      }
    };

    const handlePluginUnloaded = (event: { pluginId?: string }) => {
      if (event.pluginId) {
        setPlugins(service.getAllPlugins());
      }
    };

    const handleScanProgress = (event: { data?: { scanned: number; total: number } }) => {
      if (event.data) {
        setScanProgress((event.data.scanned / event.data.total) * 100);
      }
    };

    service.on("pluginLoaded", handlePluginLoaded);
    service.on("pluginUnloaded", handlePluginUnloaded);
    service.on("scanProgress", handleScanProgress);

    return () => {
      service.off("pluginLoaded", handlePluginLoaded);
      service.off("pluginUnloaded", handlePluginUnloaded);
      service.off("scanProgress", handleScanProgress);
    };
  }, [selectedPlugin]);

  const categories = useMemo(() => {
    const cats = new Set(plugins.map((p) => p.category));
    return ["all", ...Array.from(cats)];
  }, [plugins]);

  const filteredPlugins = useMemo(() => {
    let filtered = plugins;

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(query) ||
          p.vendor.toLowerCase().includes(query) ||
          p.category.toLowerCase().includes(query)
      );
    }

    if (selectedCategory !== "all") {
      filtered = filtered.filter((p) => p.category === selectedCategory);
    }

    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "vendor":
          comparison = a.vendor.localeCompare(b.vendor);
          break;
        case "category":
          comparison = a.category.localeCompare(b.category);
          break;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return filtered;
  }, [plugins, searchQuery, selectedCategory, sortField, sortDirection]);

  const loadPluginDetails = useCallback(
    async (pluginId: string) => {
      try {
        const [params, presetList] = await Promise.all([
          service.getParameters(pluginId),
          service.getPresets(pluginId),
        ]);
        setParameters(params);
        setPresets(presetList);
      } catch (error) {
        console.error("Failed to load plugin details:", error);
      }
    },
    [service]
  );

  const handlePluginClick = useCallback(
    (pluginId: string) => {
      setSelectedPlugin(pluginId);
      onPluginSelect?.(pluginId);

      if (service.isPluginLoaded(pluginId)) {
        loadPluginDetails(pluginId);
      }
    },
    [onPluginSelect, service, loadPluginDetails]
  );

  const handleLoadPlugin = useCallback(
    async (pluginId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        if (service.isPluginLoaded(pluginId)) {
          await service.unloadPlugin(pluginId);
          onPluginUnload?.(pluginId);
        } else {
          await service.loadPlugin(pluginId);
          onPluginLoad?.(pluginId);
          await loadPluginDetails(pluginId);
        }
      } catch (error) {
        console.error("Failed to toggle plugin:", error);
      }
    },
    [service, onPluginLoad, onPluginUnload, loadPluginDetails]
  );

  const handleScan = useCallback(async () => {
    setIsScanning(true);
    setScanProgress(0);
    try {
      await service.scanForPlugins();
      setPlugins(service.getAllPlugins());
    } finally {
      setIsScanning(false);
      setScanProgress(100);
    }
  }, [service]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDirection("asc");
      }
    },
    [sortField]
  );

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setSearchQuery("");
      searchInputRef.current?.blur();
    }
  }, []);

  const selectedPluginInfo = selectedPlugin ? service.getPlugin(selectedPlugin) : null;

  return (
    <div className={styles.browser}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <span className={styles.title}>Plugin Browser</span>
          <span className={styles.count}>
            {filteredPlugins.length} / {plugins.length}
          </span>
        </div>

        <div className={styles.searchBar}>
          <input
            ref={searchInputRef}
            type="text"
            className={styles.searchInput}
            placeholder="Search plugins..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <button
            className={styles.scanButton}
            onClick={handleScan}
            disabled={isScanning}
          >
            {isScanning ? `Scanning... ${scanProgress.toFixed(0)}%` : "Scan"}
          </button>
        </div>

        <div className={styles.filters}>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`${styles.filterChip} ${selectedCategory === cat ? styles.filterChipActive : ""}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat === "all" ? "All" : cat}
            </button>
          ))}
        </div>

        <div className={styles.sortBar}>
          <span className={styles.sortLabel}>Sort:</span>
          {(["name", "vendor", "category"] as SortField[]).map((field) => (
            <button
              key={field}
              className={`${styles.sortButton} ${sortField === field ? styles.sortButtonActive : ""}`}
              onClick={() => handleSort(field)}
            >
              {field}
              {sortField === field && (sortDirection === "asc" ? " ▲" : " ▼")}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.pluginList}>
          {isLoading ? (
            <div className={styles.loadingState}>Loading plugins...</div>
          ) : filteredPlugins.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>🎵</span>
              <span>No plugins found</span>
              {plugins.length === 0 && (
                <button className={styles.scanButton} onClick={handleScan}>
                  Scan for Plugins
                </button>
              )}
            </div>
          ) : (
            filteredPlugins.map((plugin) => (
              <div
                key={plugin.id}
                className={`${styles.pluginCard} ${selectedPlugin === plugin.id ? styles.pluginCardSelected : ""}`}
                onClick={() => handlePluginClick(plugin.id)}
              >
                <div className={styles.pluginCardHeader}>
                  <span className={styles.pluginName}>{plugin.name}</span>
                  <span className={styles.pluginVendor}>{plugin.vendor}</span>
                </div>

                <div className={styles.pluginCardMeta}>
                  <span className={styles.pluginCategory}>{plugin.category}</span>
                  <span className={styles.pluginVersion}>v{plugin.version}</span>
                </div>

                <div className={styles.pluginCardFooter}>
                  <div className={styles.pluginChannels}>
                    {plugin.inputChannels > 0 && <span>{plugin.inputChannels}in</span>}
                    <span>→</span>
                    <span>{plugin.outputChannels}out</span>
                  </div>

                  <div className={styles.pluginActions}>
                    {plugin.hasEditor && (
                      <span className={styles.editorBadge} title="Has UI Editor">
                        UI
                      </span>
                    )}
                    <button
                      className={`${styles.loadButton} ${plugin.isLoaded ? styles.loadButtonActive : ""}`}
                      onClick={(e) => handleLoadPlugin(plugin.id, e)}
                    >
                      {plugin.isLoaded ? "Unload" : "Load"}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {selectedPluginInfo && (
          <div className={styles.detailPanel}>
            <div className={styles.detailHeader}>
              <span className={styles.detailTitle}>{selectedPluginInfo.name}</span>
              <span className={styles.detailSubtitle}>{selectedPluginInfo.vendor}</span>
            </div>

            <div className={styles.detailSection}>
              <span className={styles.sectionLabel}>Info</span>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}>
                  <span className={styles.infoKey}>Category</span>
                  <span className={styles.infoValue}>{selectedPluginInfo.category}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoKey}>Version</span>
                  <span className={styles.infoValue}>{selectedPluginInfo.version}</span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoKey}>Path</span>
                  <span className={styles.infoValue} title={selectedPluginInfo.path}>
                    {selectedPluginInfo.path.split("/").pop()}
                  </span>
                </div>
                <div className={styles.infoItem}>
                  <span className={styles.infoKey}>Status</span>
                  <span className={`${styles.infoValue} ${selectedPluginInfo.isLoaded ? styles.statusLoaded : styles.statusUnloaded}`}>
                    {selectedPluginInfo.isLoaded ? "Loaded" : "Unloaded"}
                  </span>
                </div>
              </div>
            </div>

            {selectedPluginInfo.isLoaded && parameters.length > 0 && (
              <div className={styles.detailSection}>
                <span className={styles.sectionLabel}>Parameters</span>
                <div className={styles.paramList}>
                  {parameters.map((param) => (
                    <div key={param.id} className={styles.paramItem}>
                      <div className={styles.paramHeader}>
                        <span className={styles.paramName}>{param.label}</span>
                        <span className={styles.paramValue}>
                          {param.value.toFixed(2)}
                        </span>
                      </div>
                      <input
                        type="range"
                        className={styles.paramSlider}
                        min={param.minValue}
                        max={param.maxValue}
                        step={param.step}
                        value={param.value}
                        onChange={(e) => {
                          service.setParameter(selectedPlugin!, param.id, parseFloat(e.target.value));
                          setParameters((prev) =>
                            prev.map((p) =>
                              p.id === param.id ? { ...p, value: parseFloat(e.target.value) } : p
                            )
                          );
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedPluginInfo.isLoaded && presets.length > 0 && (
              <div className={styles.detailSection}>
                <span className={styles.sectionLabel}>Presets</span>
                <div className={styles.presetList}>
                  {presets.map((preset) => (
                    <button
                      key={preset.id}
                      className={styles.presetButton}
                      onClick={() => service.loadPreset(selectedPlugin!, preset.id)}
                    >
                      <span className={styles.presetName}>{preset.name}</span>
                      <span className={styles.presetCategory}>{preset.category}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
