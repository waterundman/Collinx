import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { Vst3PluginInfo, Vst3Parameter } from "../../services/Vst3HostService";
import { getVst3HostService } from "../../services/Vst3HostService";
import styles from "./PluginEditorWindow.module.css";

interface PluginEditorWindowProps {
  pluginId: string;
  onClose?: () => void;
  onParameterChange?: (paramId: number, value: number) => void;
}

interface WindowState {
  width: number;
  height: number;
  isMaximized: boolean;
  isMinimized: boolean;
  position: { x: number; y: number };
}

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 500;

export const PluginEditorWindow: React.FC<PluginEditorWindowProps> = ({
  pluginId,
  onClose,
  onParameterChange,
}) => {
  const service = getVst3HostService();
  const plugin = service.getPlugin(pluginId);

  const [windowState, setWindowState] = useState<WindowState>({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    isMaximized: false,
    isMinimized: false,
    position: { x: 100, y: 100 },
  });

  const [parameters, setParameters] = useState<Vst3Parameter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [activeTab, setActiveTab] = useState<"editor" | "params">("editor");

  const windowRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; windowX: number; windowY: number } | null>(null);
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  useEffect(() => {
    const loadParameters = async () => {
      if (!plugin?.isLoaded) return;

      setIsLoading(true);
      try {
        const params = await service.getParameters(pluginId);
        setParameters(params);
      } catch (error) {
        console.error("Failed to load parameters:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadParameters();

    const handleParameterChanged = (event: { pluginId?: string; data?: { paramId: number; value: number } }) => {
      if (event.pluginId === pluginId && event.data) {
        setParameters((prev) =>
          prev.map((p) =>
            p.id === event.data!.paramId ? { ...p, value: event.data!.value } : p
          )
        );
      }
    };

    service.on("parameterChanged", handleParameterChanged);

    return () => {
      service.off("parameterChanged", handleParameterChanged);
    };
  }, [pluginId, plugin?.isLoaded]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      windowX: windowState.position.x,
      windowY: windowState.position.y,
    };
  }, [windowState.position]);

  const handleDragMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragStartRef.current) return;

    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;

    setWindowState((prev) => ({
      ...prev,
      position: {
        x: Math.max(0, dragStartRef.current!.windowX + deltaX),
        y: Math.max(0, dragStartRef.current!.windowY + deltaY),
      },
    }));
  }, [isDragging]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    dragStartRef.current = null;
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: windowState.width,
      height: windowState.height,
    };

    const handleResizeMove = (moveEvent: MouseEvent) => {
      if (!resizeStartRef.current) return;

      const deltaX = moveEvent.clientX - resizeStartRef.current.x;
      const deltaY = moveEvent.clientY - resizeStartRef.current.y;

      setWindowState((prev) => {
        let newWidth = resizeStartRef.current!.width;
        let newHeight = resizeStartRef.current!.height;

        if (direction.includes("e")) {
          newWidth = Math.max(MIN_WIDTH, resizeStartRef.current!.width + deltaX);
        }
        if (direction.includes("s")) {
          newHeight = Math.max(MIN_HEIGHT, resizeStartRef.current!.height + deltaY);
        }
        if (direction.includes("w")) {
          newWidth = Math.max(MIN_WIDTH, resizeStartRef.current!.width - deltaX);
        }
        if (direction.includes("n")) {
          newHeight = Math.max(MIN_HEIGHT, resizeStartRef.current!.height - deltaY);
        }

        return { ...prev, width: newWidth, height: newHeight };
      });
    };

    const handleResizeEnd = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
      document.removeEventListener("mousemove", handleResizeMove);
      document.removeEventListener("mouseup", handleResizeEnd);
    };

    document.addEventListener("mousemove", handleResizeMove);
    document.addEventListener("mouseup", handleResizeEnd);
  }, [windowState]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleDragMove);
      document.addEventListener("mouseup", handleDragEnd);
    }

    return () => {
      document.removeEventListener("mousemove", handleDragMove);
      document.removeEventListener("mouseup", handleDragEnd);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  const handleMaximize = useCallback(() => {
    setWindowState((prev) => ({
      ...prev,
      isMaximized: !prev.isMaximized,
      width: prev.isMaximized ? DEFAULT_WIDTH : window.innerWidth,
      height: prev.isMaximized ? DEFAULT_HEIGHT : window.innerHeight,
      position: prev.isMaximized ? { x: 100, y: 100 } : { x: 0, y: 0 },
    }));
  }, []);

  const handleMinimize = useCallback(() => {
    setWindowState((prev) => ({ ...prev, isMinimized: !prev.isMinimized }));
  }, []);

  const handleParameterChange = useCallback(
    async (paramId: number, value: number) => {
      try {
        await service.setParameter(pluginId, paramId, value);
        onParameterChange?.(paramId, value);
      } catch (error) {
        console.error("Failed to set parameter:", error);
      }
    },
    [service, pluginId, onParameterChange]
  );

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  if (!plugin) {
    return null;
  }

  if (windowState.isMinimized) {
    return (
      <div className={styles.minimizedBar} onClick={handleMinimize}>
        <span className={styles.minimizedIcon}>🎵</span>
        <span className={styles.minimizedName}>{plugin.name}</span>
        <button
          className={styles.minimizedClose}
          onClick={(e) => {
            e.stopPropagation();
            handleClose();
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  const windowStyle: React.CSSProperties = {
    width: windowState.width,
    height: windowState.height,
    left: windowState.position.x,
    top: windowState.position.y,
  };

  return (
    <div
      ref={windowRef}
      className={`${styles.window} ${isDragging ? styles.windowDragging : ""} ${isResizing ? styles.windowResizing : ""}`}
      style={windowStyle}
    >
      <div className={styles.titleBar} onMouseDown={handleDragStart}>
        <div className={styles.titleBarLeft}>
          <span className={styles.windowIcon}>🎵</span>
          <span className={styles.windowTitle}>{plugin.name}</span>
          <span className={styles.windowVendor}>{plugin.vendor}</span>
        </div>

        <div className={styles.titleBarControls}>
          <button
            className={styles.controlButton}
            onClick={handleMinimize}
            title="Minimize"
          >
            ─
          </button>
          <button
            className={styles.controlButton}
            onClick={handleMaximize}
            title="Maximize"
          >
            {windowState.isMaximized ? "❐" : "□"}
          </button>
          <button
            className={`${styles.controlButton} ${styles.closeButton}`}
            onClick={handleClose}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === "editor" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("editor")}
        >
          Editor
        </button>
        <button
          className={`${styles.tab} ${activeTab === "params" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("params")}
        >
          Parameters
        </button>
      </div>

      <div className={styles.content}>
        {activeTab === "editor" && (
          <div className={styles.editorContainer}>
            {plugin.hasEditor ? (
              <div className={styles.editorPlaceholder}>
                <div className={styles.editorMockup}>
                  <div className={styles.mockupHeader}>
                    <span className={styles.mockupTitle}>{plugin.name}</span>
                    <span className={styles.mockupVersion}>v{plugin.version}</span>
                  </div>

                  <div className={styles.mockupControls}>
                    <div className={styles.mockupKnobGroup}>
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className={styles.mockupKnob}>
                          <div className={styles.mockupKnobInner} />
                          <span className={styles.mockupKnobLabel}>
                            {["Drive", "Tone", "Mix", "Output"][i]}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className={styles.mockupDisplay}>
                      <div className={styles.mockupWaveform}>
                        {[...Array(32)].map((_, i) => (
                          <div
                            key={i}
                            className={styles.mockupBar}
                            style={{
                              height: `${Math.random() * 80 + 20}%`,
                              background: `hsl(${180 + i * 5}, 80%, 60%)`,
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className={styles.mockupPresets}>
                      <span className={styles.mockupPresetLabel}>Preset:</span>
                      <select className={styles.mockupSelect}>
                        <option>Default</option>
                        <option>Warm</option>
                        <option>Bright</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className={styles.noEditor}>
                <span className={styles.noEditorIcon}>🖥</span>
                <span className={styles.noEditorText}>No editor available for this plugin</span>
                <span className={styles.noEditorHint}>Use the Parameters tab to adjust settings</span>
              </div>
            )}
          </div>
        )}

        {activeTab === "params" && (
          <div className={styles.paramsContainer}>
            {isLoading ? (
              <div className={styles.loadingState}>Loading parameters...</div>
            ) : parameters.length === 0 ? (
              <div className={styles.emptyState}>No parameters available</div>
            ) : (
              <div className={styles.paramGrid}>
                {parameters.map((param) => (
                  <div key={param.id} className={styles.paramCard}>
                    <div className={styles.paramCardHeader}>
                      <span className={styles.paramLabel}>{param.label}</span>
                      <span className={styles.paramCurrentValue}>
                        {param.value.toFixed(3)}
                      </span>
                    </div>

                    <div className={styles.paramSliderContainer}>
                      <input
                        type="range"
                        className={styles.paramSlider}
                        min={param.minValue}
                        max={param.maxValue}
                        step={param.step}
                        value={param.value}
                        onChange={(e) => handleParameterChange(param.id, parseFloat(e.target.value))}
                      />
                    </div>

                    <div className={styles.paramMeta}>
                      <span className={styles.paramRange}>
                        {param.minValue.toFixed(1)} - {param.maxValue.toFixed(1)}
                      </span>
                      {param.isAutomatable && (
                        <span className={styles.automatableBadge}>Auto</span>
                      )}
                    </div>

                    <div className={styles.paramActions}>
                      <button
                        className={styles.resetButton}
                        onClick={() => handleParameterChange(param.id, param.defaultValue)}
                        title="Reset to default"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.statusBar}>
        <span className={styles.statusItem}>
          {plugin.inputChannels}in → {plugin.outputChannels}out
        </span>
        <span className={styles.statusItem}>
          {plugin.isLoaded ? "● Loaded" : "○ Unloaded"}
        </span>
        <span className={styles.statusItem}>
          {parameters.length} params
        </span>
      </div>

      <div
        className={`${styles.resizeHandle} ${styles.resizeHandleE}`}
        onMouseDown={(e) => handleResizeStart(e, "e")}
      />
      <div
        className={`${styles.resizeHandle} ${styles.resizeHandleS}`}
        onMouseDown={(e) => handleResizeStart(e, "s")}
      />
      <div
        className={`${styles.resizeHandle} ${styles.resizeHandleSE}`}
        onMouseDown={(e) => handleResizeStart(e, "se")}
      />
    </div>
  );
};
