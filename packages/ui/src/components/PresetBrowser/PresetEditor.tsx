import React, { useState, useCallback } from "react";
import type { PresetInfo } from "./PresetBrowser";
import styles from "./PresetEditor.module.css";

export interface PresetEditorProps {
  preset: PresetInfo;
  categories: string[];
  allTags: string[];
  onSave: (preset: PresetInfo) => void;
  onCancel: () => void;
}

export const PresetEditor: React.FC<PresetEditorProps> = ({
  preset,
  categories,
  allTags,
  onSave,
  onCancel,
}) => {
  const [name, setName] = useState(preset.name);
  const [description, setDescription] = useState(preset.description);
  const [author, setAuthor] = useState(preset.author);
  const [category, setCategory] = useState(preset.category);
  const [pluginName, setPluginName] = useState(preset.pluginName);
  const [pluginFormat, setPluginFormat] = useState(preset.pluginFormat);
  const [tags, setTags] = useState<string[]>([...preset.tags]);
  const [newTag, setNewTag] = useState("");

  const handleAddTag = useCallback(() => {
    const trimmed = newTag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setNewTag("");
  }, [newTag, tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const handleTagKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag],
  );

  const handleSave = useCallback(() => {
    if (!name.trim()) return;
    onSave({
      ...preset,
      name: name.trim(),
      description: description.trim(),
      author: author.trim(),
      category: category.trim(),
      pluginName: pluginName.trim(),
      pluginFormat: pluginFormat.trim(),
      tags,
      modifiedTime: new Date().toISOString(),
    });
  }, [preset, name, description, author, category, pluginName, pluginFormat, tags, onSave]);

  const canSave = name.trim().length > 0;

  return (
    <div className={styles.editor}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>编辑预设</span>
        <span className={styles.spacer} />
        <button className={styles.cancelBtn} onClick={onCancel}>
          取消
        </button>
        <button className={styles.saveBtn} onClick={handleSave} disabled={!canSave}>
          保存
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.field}>
          <label className={styles.label}>名称 *</label>
          <input
            className={styles.input}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="预设名称"
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label}>描述</label>
          <textarea
            className={styles.textarea}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="预设描述"
            rows={3}
          />
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label}>作者</label>
            <input
              className={styles.input}
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="作者名"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>分类</label>
            <select
              className={styles.select}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">未分类</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label}>插件名称</label>
            <input
              className={styles.input}
              type="text"
              value={pluginName}
              onChange={(e) => setPluginName(e.target.value)}
              placeholder="插件名"
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>插件格式</label>
            <input
              className={styles.input}
              type="text"
              value={pluginFormat}
              onChange={(e) => setPluginFormat(e.target.value)}
              placeholder="VST3, CLAP..."
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>标签</label>
          <div className={styles.tagInput}>
            <input
              className={styles.tagInputField}
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="输入标签后按 Enter 添加"
            />
            <button className={styles.tagAddBtn} onClick={handleAddTag} disabled={!newTag.trim()}>
              添加
            </button>
          </div>
          <div className={styles.tagList}>
            {tags.map((tag) => (
              <span key={tag} className={styles.tag}>
                {tag}
                <button className={styles.tagRemove} onClick={() => handleRemoveTag(tag)}>
                  ×
                </button>
              </span>
            ))}
          </div>
          {allTags.length > 0 && (
            <div className={styles.tagSuggestions}>
              <span className={styles.suggestionsLabel}>可用标签:</span>
              {allTags
                .filter((t) => !tags.includes(t))
                .slice(0, 10)
                .map((tag) => (
                  <button
                    key={tag}
                    className={styles.suggestionTag}
                    onClick={() => setTags((prev) => [...prev, tag])}
                  >
                    + {tag}
                  </button>
                ))}
            </div>
          )}
        </div>

        <div className={styles.metaInfo}>
          <span>创建时间: {preset.createdTime || "—"}</span>
          <span>修改时间: {preset.modifiedTime || "—"}</span>
          <span>ID: {preset.id}</span>
        </div>
      </div>
    </div>
  );
};
