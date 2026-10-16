import React, { useState, useCallback, useRef, useEffect } from "react";
import { PluginEditorWindow } from "./PluginEditorWindow";
import styles from "./PluginWindowManager.module.css";

interface WindowInstance {
  id: string;
  pluginId: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  isMinimized: boolean;
}

interface PluginWindowManagerProps {
  openPlugins: string[];
  onClosePlugin: (pluginId: string) => void;
  onParameterChange?: (pluginId: string, paramId: number, value: number) => void;
}

const STORAGE_KEY = "collinx-plugin-windows";
const DEFAULT_SIZE = { width: 600, height: 500 };
const OFFSET_STEP = 30;

export const PluginWindowManager: React.FC<PluginWindowManagerProps> = ({
  openPlugins,
  onClosePlugin,
  onParameterChange,
}) => {
  const [windows, setWindows] = useState<Map<string, WindowInstance>>(new Map());
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const nextZIndex = useRef(1000);
  const offsetCount = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, Partial<WindowInstance>>;
        const restored = new Map<string, WindowInstance>();
        Object.entries(parsed).forEach(([id, data]) => {
          restored.set(id, {
            id,
            pluginId: id,
            position: data.position ?? { x: 100, y: 100 },
            size: data.size ?? DEFAULT_SIZE,
            zIndex: data.zIndex ?? 1000,
            isMinimized: data.isMinimized ?? false,
          });
        });
        setWindows(restored);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  useEffect(() => {
    const toSave: Record<string, Partial<WindowInstance>> = {};
    windows.forEach((win, id) => {
      toSave[id] = {
        position: win.position,
        size: win.size,
        isMinimized: win.isMinimized,
      };
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }, [windows]);

  useEffect(() => {
    setWindows((prev) => {
      const next = new Map(prev);
      const openSet = new Set(openPlugins);

      openPlugins.forEach((pluginId) => {
        if (!next.has(pluginId)) {
          const offset = offsetCount.current * OFFSET_STEP;
          offsetCount.current++;
          next.set(pluginId, {
            id: pluginId,
            pluginId,
            position: { x: 100 + offset, y: 100 + offset },
            size: DEFAULT_SIZE,
            zIndex: nextZIndex.current++,
            isMinimized: false,
          });
        }
      });

      next.forEach((_, id) => {
        if (!openSet.has(id)) {
          next.delete(id);
        }
      });

      return next;
    });
  }, [openPlugins]);

  const handleFocus = useCallback((pluginId: string) => {
    setActiveWindowId(pluginId);
    setWindows((prev) => {
      const next = new Map(prev);
      const win = next.get(pluginId);
      if (win) {
        next.set(pluginId, { ...win, zIndex: nextZIndex.current++ });
      }
      return next;
    });
  }, []);

  const handleClose = useCallback(
    (pluginId: string) => {
      setWindows((prev) => {
        const next = new Map(prev);
        next.delete(pluginId);
        return next;
      });
      if (activeWindowId === pluginId) {
        setActiveWindowId(null);
      }
      onClosePlugin(pluginId);
    },
    [activeWindowId, onClosePlugin]
  );

  const handleMinimize = useCallback((pluginId: string) => {
    setWindows((prev) => {
      const next = new Map(prev);
      const win = next.get(pluginId);
      if (win) {
        next.set(pluginId, { ...win, isMinimized: true });
      }
      return next;
    });
  }, []);

  const handleRestore = useCallback((pluginId: string) => {
    setWindows((prev) => {
      const next = new Map(prev);
      const win = next.get(pluginId);
      if (win) {
        next.set(pluginId, {
          ...win,
          isMinimized: false,
          zIndex: nextZIndex.current++,
        });
      }
      return next;
    });
  }, []);

  const handleParameterChange = useCallback(
    (pluginId: string, paramId: number, value: number) => {
      onParameterChange?.(pluginId, paramId, value);
    },
    [onParameterChange]
  );

  const windowArray = Array.from(windows.values());
  const minimizedWindows = windowArray.filter((w) => w.isMinimized);

  return (
    <div className={styles.manager}>
      <div className={styles.windowLayer}>
        {windowArray
          .filter((w) => !w.isMinimized)
          .map((win) => (
            <div
              key={win.id}
              className={styles.windowWrapper}
              style={{ zIndex: win.zIndex }}
              onMouseDown={() => handleFocus(win.pluginId)}
            >
              <PluginEditorWindow
                pluginId={win.pluginId}
                onClose={() => handleClose(win.pluginId)}
                onParameterChange={(paramId, value) =>
                  handleParameterChange(win.pluginId, paramId, value)
                }
              />
            </div>
          ))}
      </div>

      {minimizedWindows.length > 0 && (
        <div className={styles.taskbar}>
          {minimizedWindows.map((win) => (
            <button
              key={win.id}
              className={styles.taskbarItem}
              onClick={() => handleRestore(win.pluginId)}
              title={`Restore ${win.pluginId}`}
            >
              <span className={styles.taskbarIcon}>🎵</span>
              <span className={styles.taskbarLabel}>{win.pluginId}</span>
            </button>
          ))}
        </div>
      )}

      {windowArray.length > 1 && (
        <div className={styles.windowList}>
          <span className={styles.windowListTitle}>Windows ({windowArray.length})</span>
          {windowArray.map((win) => (
            <button
              key={win.id}
              className={`${styles.windowListItem} ${
                win.id === activeWindowId ? styles.windowListItemActive : ""
              } ${win.isMinimized ? styles.windowListItemMinimized : ""}`}
              onClick={() => {
                if (win.isMinimized) {
                  handleRestore(win.pluginId);
                } else {
                  handleFocus(win.pluginId);
                }
              }}
            >
              <span className={styles.windowListDot} />
              <span className={styles.windowListName}>{win.pluginId}</span>
              {win.isMinimized && <span className={styles.windowListBadge}>min</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
