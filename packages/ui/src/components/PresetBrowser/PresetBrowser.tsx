import React, { useState, useMemo, useCallback } from "react";
import { PresetCard } from "./PresetCard";
import { PresetEditor } from "./PresetEditor";
import styles from "./PresetBrowser.module.css";

export interface PresetInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  author: string;
  pluginName: string;
  pluginFormat: string;
  tags: string[];
  createdTime: string;
  modifiedTime: string;
}

export interface PresetFilter {
  textQuery: string;
  category: string;
  author: string;
  pluginName: string;
  pluginFormat: string;
  requiredTags: string[];
  matchAllTags: boolean;
}

export interface PresetBrowserProps {
  presets: PresetInfo[];
  categories: string[];
  allTags: string[];
  onLoad?: (presetId: string) => void;
  onDelete?: (presetId: string) => void;
  onSave?: (preset: PresetInfo) => void;
  onImport?: (file: File) => void;
  onExport?: (presetId: string) => void;
}

type ViewMode = "browse" | "edit";

const EMPTY_FILTER: PresetFilter = {
  textQuery: "",
  category: "",
  author: "",
  pluginName: "",
  pluginFormat: "",
  requiredTags: [],
  matchAllTags: false,
};

function matchesFilter(preset: PresetInfo, filter: PresetFilter): boolean {
  if (filter.textQuery) {
    const q = filter.textQuery.toLowerCase();
    const searchable = [
      preset.name,
      preset.description,
      preset.author,
      preset.category,
      preset.pluginName,
      ...preset.tags,
    ]
      .join(" ")
      .toLowerCase();
    if (!searchable.includes(q)) return false;
  }

  if (filter.category && preset.category !== filter.category) return false;
  if (filter.author && preset.author !== filter.author) return false;
  if (filter.pluginName && preset.pluginName !== filter.pluginName) return false;
  if (filter.pluginFormat && preset.pluginFormat !== filter.pluginFormat) return false;

  if (filter.requiredTags.length > 0) {
    if (filter.matchAllTags) {
      if (!filter.requiredTags.every((t) => preset.tags.includes(t))) return false;
    } else {
      if (!filter.requiredTags.some((t) => preset.tags.includes(t))) return false;
    }
  }

  return true;
}

export const PresetBrowser: React.FC<PresetBrowserProps> = ({
  presets,
  categories,
  allTags,
  onLoad,
  onDelete,
  onSave,
  onImport,
  onExport,
}) => {
  const [filter, setFilter] = useState<PresetFilter>({ ...EMPTY_FILTER });
  const [viewMode, setViewMode] = useState<ViewMode>("browse");
  const [editingPreset, setEditingPreset] = useState<PresetInfo | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const filteredPresets = useMemo(
    () => presets.filter((p) => matchesFilter(p, { ...filter, requiredTags: selectedTags, matchAllTags: false })),
    [presets, filter, selectedTags],
  );

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilter((prev) => ({ ...prev, textQuery: e.target.value }));
    },
    [],
  );

  const handleCategoryChange = useCallback(
    (category: string) => {
      setFilter((prev) => ({
        ...prev,
        category: prev.category === category ? "" : category,
      }));
    },
    [],
  );

  const handleTagToggle = useCallback(
    (tag: string) => {
      setSelectedTags((prev) =>
        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
      );
    },
    [],
  );

  const handleClearFilters = useCallback(() => {
    setFilter({ ...EMPTY_FILTER });
    setSelectedTags([]);
  }, []);

  const handleEdit = useCallback(
    (presetId: string) => {
      const preset = presets.find((p) => p.id === presetId);
      if (preset) {
        setEditingPreset(preset);
        setViewMode("edit");
      }
    },
    [presets],
  );

  const handleSaveEdit = useCallback(
    (updated: PresetInfo) => {
      onSave?.(updated);
      setEditingPreset(null);
      setViewMode("browse");
    },
    [onSave],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingPreset(null);
    setViewMode("browse");
  }, []);

  const handleImportClick = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) onImport?.(file);
    };
    input.click();
  }, [onImport]);

  const hasActiveFilters =
    filter.textQuery ||
    filter.category ||
    filter.author ||
    filter.pluginName ||
    filter.pluginFormat ||
    selectedTags.length > 0;

  if (viewMode === "edit" && editingPreset) {
    return (
      <div className={styles.browser}>
        <PresetEditor
          preset={editingPreset}
          categories={categories}
          allTags={allTags}
          onSave={handleSaveEdit}
          onCancel={handleCancelEdit}
        />
      </div>
    );
  }

  return (
    <div className={styles.browser}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>预设浏览器</span>
        <span className={styles.headerCount}>{filteredPresets.length} / {presets.length}</span>
        <span className={styles.spacer} />
        <button className={styles.iconBtn} onClick={() => setShowFilters((v) => !v)} title="高级过滤">
          {showFilters ? "▲" : "▼"} 过滤
        </button>
        <button className={styles.iconBtn} onClick={handleImportClick} title="导入预设">
          导入
        </button>
      </div>

      <div className={styles.searchBar}>
        <input
          className={styles.searchInput}
          type="text"
          placeholder="搜索预设名称、描述、标签..."
          value={filter.textQuery}
          onChange={handleSearchChange}
        />
        {hasActiveFilters && (
          <button className={styles.clearBtn} onClick={handleClearFilters}>
            清除
          </button>
        )}
      </div>

      <div className={styles.categoryBar}>
        <button
          className={`${styles.categoryBtn} ${!filter.category ? styles.categoryBtnActive : ""}`}
          onClick={() => setFilter((prev) => ({ ...prev, category: "" }))}
        >
          全部
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            className={`${styles.categoryBtn} ${filter.category === cat ? styles.categoryBtnActive : ""}`}
            onClick={() => handleCategoryChange(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {showFilters && (
        <div className={styles.advancedFilters}>
          <div className={styles.filterRow}>
            <label className={styles.filterLabel}>作者</label>
            <input
              className={styles.filterInput}
              type="text"
              placeholder="按作者过滤"
              value={filter.author}
              onChange={(e) => setFilter((prev) => ({ ...prev, author: e.target.value }))}
            />
          </div>
          <div className={styles.filterRow}>
            <label className={styles.filterLabel}>插件</label>
            <input
              className={styles.filterInput}
              type="text"
              placeholder="按插件名过滤"
              value={filter.pluginName}
              onChange={(e) => setFilter((prev) => ({ ...prev, pluginName: e.target.value }))}
            />
          </div>
          <div className={styles.filterRow}>
            <label className={styles.filterLabel}>格式</label>
            <input
              className={styles.filterInput}
              type="text"
              placeholder="VST3, CLAP..."
              value={filter.pluginFormat}
              onChange={(e) => setFilter((prev) => ({ ...prev, pluginFormat: e.target.value }))}
            />
          </div>
          {allTags.length > 0 && (
            <div className={styles.tagSection}>
              <span className={styles.filterLabel}>标签</span>
              <div className={styles.tagList}>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    className={`${styles.tagBtn} ${selectedTags.includes(tag) ? styles.tagBtnActive : ""}`}
                    onClick={() => handleTagToggle(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className={styles.presetList}>
        {filteredPresets.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>&#9835;</div>
            <div className={styles.emptyText}>
              {hasActiveFilters ? "没有匹配的预设" : "暂无预设"}
            </div>
          </div>
        ) : (
          filteredPresets.map((preset) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              onLoad={onLoad}
              onDelete={onDelete}
              onEdit={handleEdit}
              onExport={onExport}
            />
          ))
        )}
      </div>
    </div>
  );
};
