import React, { useRef, useEffect, useState, useCallback } from "react";
import { TasteStore } from "@collinx/core";
import styles from "./TastePanel.module.css";

interface TasteTimelineViewProps {
  store: TasteStore;
  onSelectVersion?: (version: number) => void;
  onRevertTo?: (version: number) => void;
}

interface NodeData {
  version: number;
  timestamp: string;
  message: string;
  paramCount: number;
  x: number;
  y: number;
  radius: number;
}

const PADDING_X = 60;
const PADDING_Y = 40;
const MIN_RADIUS = 6;
const MAX_RADIUS = 18;
const VERSION_SPACING_Y = 50;

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const TasteTimelineView: React.FC<TasteTimelineViewProps> = ({
  store,
  onSelectVersion,
  onRevertTo,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [hoveredNode, setHoveredNode] = useState<NodeData | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 600, height: 400 });
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const nodesRef = useRef<NodeData[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height: h } = entry.contentRect;
        setCanvasSize({ width: Math.floor(width), height: Math.floor(h) });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const buildNodes = useCallback((): NodeData[] => {
    const history = store.getVersionHistory();
    if (history.length === 0) return [];

    const timestamps = history.map((e) => new Date(e.timestamp).getTime());
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const timeRange = maxTime - minTime || 1;

    let maxParams = 1;
    for (const entry of history) {
      const count = Object.keys(entry.genomeJson.domains).length;
      if (count > maxParams) maxParams = count;
    }

    const usableWidth = canvasSize.width - PADDING_X * 2;
    const usableHeight = Math.max(canvasSize.height - PADDING_Y * 2, 100);
    const yStep = history.length > 1 ? Math.min(VERSION_SPACING_Y, usableHeight / (history.length - 1)) : VERSION_SPACING_Y;

    return history.map((entry, i) => {
      const paramCount = Object.keys(entry.genomeJson.domains).length;
      const ratio = maxParams > 0 ? paramCount / maxParams : 0.1;
      const radius = MIN_RADIUS + ratio * (MAX_RADIUS - MIN_RADIUS);
      const x = PADDING_X + ((new Date(entry.timestamp).getTime() - minTime) / timeRange) * usableWidth;
      const y = PADDING_Y + i * yStep;
      return {
        version: entry.version,
        timestamp: entry.timestamp,
        message: entry.message,
        paramCount,
        x,
        y,
        radius,
      };
    });
  }, [store, canvasSize]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;
    ctx.scale(dpr, dpr);

    const w = canvasSize.width;
    const h = canvasSize.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getCSSVar('--bg-surface');
    ctx.fillRect(0, 0, w, h);

    const nodes = buildNodes();
    nodesRef.current = nodes;

    if (nodes.length === 0) {
      ctx.fillStyle = getCSSVar('--text-disabled');
      ctx.font = "14px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("尚无版本历史，保存你的第一个Genome来开始记录", w / 2, h / 2);
      return;
    }

    if (nodes.length > 1) {
      ctx.strokeStyle = getCSSVar('--border-primary');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(nodes[0].x, nodes[0].y);
      for (let i = 1; i < nodes.length; i++) {
        ctx.lineTo(nodes[i].x, nodes[i].y);
      }
      ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = getCSSVar('--text-disabled');
    ctx.font = "9px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("时间 →", canvasSize.width - 20, PADDING_Y - 10);
    ctx.textAlign = "left";
    ctx.fillText("版本号", 6, PADDING_Y + 10);

    // Time labels
    if (nodes.length > 0) {
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      ctx.textAlign = "left";
      ctx.fillText(formatDateTime(first.timestamp), first.x - 30, first.y - 12);
      if (first !== last) {
        ctx.textAlign = "right";
        ctx.fillText(formatDateTime(last.timestamp), last.x + 30, last.y - 12);
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isSelected = selectedNode?.version === node.version;
      const isHovered = hoveredNode?.version === node.version;

      // Version label
      ctx.fillStyle = getCSSVar('--text-disabled');
      ctx.font = "10px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`v${node.version}`, node.x - node.radius - 8, node.y + 3);

      // Connecting line dot shadow
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 212, 255, 0.1)";
      if (isSelected || isHovered) {
        ctx.fill();
      }

      // Node circle
      const grad = ctx.createRadialGradient(node.x - 1, node.y - 1, 0, node.x, node.y, node.radius);
      if (isSelected) {
        grad.addColorStop(0, getCSSVar('--accent-cyan'));
        grad.addColorStop(1, getCSSVar('--accent-cyan-dark'));
      } else if (isHovered) {
        grad.addColorStop(0, getCSSVar('--accent-cyan-light'));
        grad.addColorStop(1, getCSSVar('--accent-cyan-dark'));
      } else {
        grad.addColorStop(0, getCSSVar('--accent-purple'));
        grad.addColorStop(1, getCSSVar('--accent-purple-dark'));
      }
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.strokeStyle = isSelected || isHovered ? getCSSVar('--accent-cyan') : "rgba(162, 155, 254, 0.4)";
      ctx.lineWidth = isSelected || isHovered ? 2 : 1;
      ctx.stroke();

      // Param count inside node
      if (node.radius >= 10) {
        ctx.fillStyle = getCSSVar("--text-primary");
        ctx.font = "bold 9px 'Segoe UI', system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(node.paramCount), node.x, node.y);
      }
    }
  }, [canvasSize, buildNodes, selectedNode, hoveredNode]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const getNodeAtPos = useCallback(
    (x: number, y: number): NodeData | null => {
      for (const node of nodesRef.current) {
        const dx = node.x - x;
        const dy = node.y - y;
        if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 4) {
          return node;
        }
      }
      return null;
    },
    []
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const node = getNodeAtPos(x, y);
      setSelectedNode(node);
      if (node) {
        onSelectVersion?.(node.version);
      }
    },
    [getNodeAtPos, onSelectVersion]
  );

  const handleCanvasMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setMousePos({ x: e.clientX - 6, y: e.clientY - 40 });
      const node = getNodeAtPos(x, y);
      setHoveredNode(node);
    },
    [getNodeAtPos]
  );

  const handleCanvasLeave = useCallback(() => {
    setHoveredNode(null);
  }, []);

  const handleExport = useCallback(() => {
    try {
      const pkg = store.exportPackage();
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `collinx-taste-v${store.getVersion()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
    }
  }, [store]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const pkg = JSON.parse(reader.result as string);
          store.importPackage(pkg);
          drawCanvas();
        } catch {
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [store, drawCanvas]);

  const handleRevert = useCallback(
    (version: number) => {
      onRevertTo?.(version);
      drawCanvas();
    },
    [onRevertTo, drawCanvas]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }} data-testid="taste-timeline">
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-primary)",
          background: "var(--bg-surface)",
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--accent-cyan)" }}>版本时间线</span>
        <span style={{ fontSize: "11px", color: "var(--text-disabled)" }}>
          共 {store.getVersionHistory().length} 个版本
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
          <button className={styles.timelineActionBtn} onClick={handleExport}>
            导出
          </button>
          <button className={styles.timelineActionBtn} onClick={handleImport}>
            导入
          </button>
        </div>
      </div>

      <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "100%" }}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMove}
          onMouseLeave={handleCanvasLeave}
        />

        {hoveredNode && (
          <div
            className={styles.timelineTooltip}
            style={{
              left: mousePos.x,
              top: mousePos.y,
            }}
          >
            <div className={styles.timelineTooltipTitle}>版本 {hoveredNode.version}</div>
            <div className={styles.timelineTooltipRow}>
              {formatDateTime(hoveredNode.timestamp)}
            </div>
            <div className={styles.timelineTooltipRow}>
              参数: {hoveredNode.paramCount} 个
            </div>
            <div className={styles.timelineTooltipRow}>
              {hoveredNode.message}
            </div>
          </div>
        )}
      </div>

      {selectedNode && (
        <div
          style={{
            padding: "8px 12px",
            borderTop: "1px solid var(--border-primary)",
            background: "var(--bg-surface)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            已选中 v{selectedNode.version} — {selectedNode.paramCount} 个参数 — {formatDateTime(selectedNode.timestamp)}
          </span>
          <div style={{ marginLeft: "auto" }}>
            <button
              className={styles.timelineRevertBtn}
              onClick={() => handleRevert(selectedNode.version)}
            >
              回滚到此处
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
