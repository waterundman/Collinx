import React, { useCallback, useState } from "react";
import { useI18n } from "../../i18n/hooks";
import { useSettings } from "../../hooks/useSettings";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";
import { isPluginHostAvailable, scanInstalledPlugins } from "../../services/plugin-host";
import type { InstalledPlugin, PluginScanOutcome } from "../../services/plugin-host";
import styles from "./PluginSettings.module.css";

/**
 * v3.1.0：插件设置分区。
 *
 * 只做三件真实的事：探测宿主是否可用、扫描真实插件目录、列出结果。
 * 不提供「加载到轨道」—— 加载需要原生宿主进程，未接线前按钮只给原因，
 * 不做假成功（旧的 Vst3HostService 就是靠硬编码三个假插件撑起整个界面）。
 */
export const PluginSettingsSection: React.FC = () => {
  const { t } = useI18n();
  const { settings, updateSettings } = useSettings();
  const { plugins: pluginSettings } = settings;

  const available = isPluginHostAvailable();
  const [outcome, setOutcome] = useState<PluginScanOutcome | null>(null);
  const [scanning, setScanning] = useState(false);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setLoadMessage(null);
    try {
      const res = await scanInstalledPlugins(
        pluginSettings.scanPaths.length > 0 ? pluginSettings.scanPaths : undefined,
      );
      setOutcome(res);
    } finally {
      setScanning(false);
    }
  }, [pluginSettings.scanPaths]);

  const addScanPath = useCallback(() => {
    const next = [...pluginSettings.scanPaths, ""];
    updateSettings({ plugins: { ...pluginSettings, scanPaths: next } });
  }, [pluginSettings, updateSettings]);

  const updateScanPath = useCallback(
    (index: number, value: string) => {
      const next = pluginSettings.scanPaths.map((p, i) => (i === index ? value : p));
      updateSettings({ plugins: { ...pluginSettings, scanPaths: next } });
    },
    [pluginSettings, updateSettings],
  );

  const removeScanPath = useCallback(
    (index: number) => {
      const next = pluginSettings.scanPaths.filter((_, i) => i !== index);
      updateSettings({ plugins: { ...pluginSettings, scanPaths: next } });
    },
    [pluginSettings, updateSettings],
  );

  const visiblePlugins: InstalledPlugin[] =
    outcome?.status === "ok"
      ? pluginSettings.hideWithoutBinary
        ? outcome.plugins.filter((p) => p.hasBinary)
        : outcome.plugins
      : [];

  return (
    <div className={styles.root} data-testid="plugins-settings">
      <p className={styles.intro}>{t("settings.plugins.intro")}</p>

      {!available ? (
        <EmptyState
          testId="plugins-unavailable"
          title={t("settings.plugins.unavailable")}
        />
      ) : (
        <>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>{t("settings.plugins.scanPaths")}</h3>
            <p className={styles.hint}>{t("settings.plugins.scanPathsHint")}</p>
            {pluginSettings.scanPaths.map((p, i) => (
              <div key={i} className={styles.pathRow}>
                <input
                  className={styles.pathInput}
                  value={p}
                  placeholder={t("settings.plugins.pathPlaceholder")}
                  data-testid={`plugins-path-${i}`}
                  onChange={(e) => updateScanPath(i, e.target.value)}
                />
                <Button variant="ghost" onClick={() => removeScanPath(i)}>
                  {t("common.remove")}
                </Button>
              </div>
            ))}
            <div className={styles.actions}>
              <Button variant="ghost" onClick={addScanPath} testId="plugins-add-path">
                {t("settings.plugins.addPath")}
              </Button>
              <Button variant="primary" onClick={handleScan} testId="plugins-scan" disabled={scanning}>
                {scanning ? t("settings.plugins.scanning") : t("settings.plugins.scan")}
              </Button>
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              {t("settings.plugins.results", { count: visiblePlugins.length })}
            </h3>
            {outcome?.status === "error" && (
              <p className={styles.error} data-testid="plugins-error">
                {outcome.reason}
              </p>
            )}
            {outcome === null && (
              <p className={styles.hint}>{t("settings.plugins.notScanned")}</p>
            )}
            {outcome?.status === "ok" && visiblePlugins.length === 0 && (
              <EmptyState testId="plugins-empty" title={t("settings.plugins.empty")} />
            )}
            {visiblePlugins.length > 0 && (
              <ul className={styles.list} data-testid="plugins-list">
                {visiblePlugins.map((plugin) => (
                  <li key={plugin.id} className={styles.item}>
                    <span className={styles.name}>{plugin.name}</span>
                    <span className={styles.format}>{plugin.format.toUpperCase()}</span>
                    <span className={styles.path} title={plugin.path}>
                      {plugin.path}
                    </span>
                    <Button
                      variant="ghost"
                      testId={`plugins-load-${plugin.id}`}
                      onClick={() => setLoadMessage(t("settings.plugins.loadUnavailable"))}
                    >
                      {t("settings.plugins.load")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {loadMessage && (
              <p className={styles.hint} data-testid="plugins-load-message">
                {loadMessage}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default PluginSettingsSection;
