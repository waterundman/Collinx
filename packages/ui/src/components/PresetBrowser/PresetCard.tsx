import React, { useCallback } from "react";
import type { PresetInfo } from "./PresetBrowser";
import styles from "./PresetCard.module.css";

export interface PresetCardProps {
  preset: PresetInfo;
  onLoad?: (presetId: string) => void;
  onDelete?: (presetId: string) => void;
  onEdit?: (presetId: string) => void;
  onExport?: (presetId: string) => void;
}

export const PresetCard: React.FC<PresetCardProps> = ({
  preset,
  onLoad,
  onDelete,
  onEdit,
  onExport,
}) => {
  const handleLoad = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onLoad?.(preset.id);
    },
    [onLoad, preset.id],
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete?.(preset.id);
    },
    [onDelete, preset.id],
  );

  const handleEdit = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onEdit?.(preset.id);
    },
    [onEdit, preset.id],
  );

  const handleExport = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onExport?.(preset.id);
    },
    [onExport, preset.id],
  );

  const formatDate = (iso: string): string => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardInfo}>
          <span className={styles.cardName}>{preset.name}</span>
          {preset.category && (
            <span className={styles.cardCategory}>{preset.category}</span>
          )}
          {preset.pluginFormat && (
            <span className={styles.cardFormat}>{preset.pluginFormat}</span>
          )}
        </div>
        <div className={styles.cardActions}>
          <button className={styles.actionBtn} onClick={handleLoad} title="加载预设">
            加载
          </button>
          <button className={styles.actionBtn} onClick={handleEdit} title="编辑预设">
            编辑
          </button>
          <button className={styles.actionBtn} onClick={handleExport} title="导出预设">
            导出
          </button>
          <button
            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
            onClick={handleDelete}
            title="删除预设"
          >
            删除
          </button>
        </div>
      </div>

      {preset.description && (
        <div className={styles.cardDescription}>{preset.description}</div>
      )}

      <div className={styles.cardMeta}>
        {preset.author && (
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>作者:</span> {preset.author}
          </span>
        )}
        {preset.pluginName && (
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>插件:</span> {preset.pluginName}
          </span>
        )}
        {preset.modifiedTime && (
          <span className={styles.metaItem}>
            <span className={styles.metaLabel}>修改:</span> {formatDate(preset.modifiedTime)}
          </span>
        )}
      </div>

      {preset.tags.length > 0 && (
        <div className={styles.cardTags}>
          {preset.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};
