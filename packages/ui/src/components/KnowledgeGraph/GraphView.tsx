import React, { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { Icon } from "../Icon/Icon";
import styles from "./GraphView.module.css";
import { getCSSVar } from "../../utils/cssVar";

export interface GraphNode {
  id: string;
  type: string;
  data: Record<string, any>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphViewProps {
  graph: GraphData;
  onNodeClick?: (nodeId: string) => void;
  width?: number;
  height?: number;
}

interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  opacity: number;
  scale: number;
  pulsePhase: number;
}

interface AnimationState {
  time: number;
  nodeAnimations: Map<string, NodeAnimation>;
  edgeAnimations: Map<string, EdgeAnimation>;
}

interface NodeAnimation {
  fadeInProgress: number;
  pulseIntensity: number;
  hoverIntensity: number;
  clickFeedback: number;
}

interface EdgeAnimation {
  flowProgress: number;
  highlightIntensity: number;
}

const NODE_COLOR_VARS: Record<string, string> = {
  Phrase: "--node-phrase",
  Motif: "--node-motif",
  Track: "--node-track",
  ExportVersion: "--node-export-version",
  TasteEvidence: "--node-taste-evidence",
  AgentDecision: "--node-agent-decision",
};

function getNodeColor(type: string): string {
  const varName = NODE_COLOR_VARS[type];
  return varName ? getCSSVar(varName) : getCSSVar("--canvas-node-default");
}
const NODE_RADIUS = 18;
const REPULSION = 8000;
const SPRING_LENGTH = 150;
const SPRING_K = 0.008;
const DAMPING = 0.8;
const ITERATIONS = 300;
const ANIMATION_DURATION = 500;
const PULSE_SPEED = 2;
const EDGE_FLOW_SPEED = 0.5;

/** v2.6.0：音高 → 音名（C4 记法，MIDI 60 = C4）。 */
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
/**
 * 从节点 data 里读 MIDI 音高。
 *
 * ⚠️ v2.8.0 修：ProjectNote 的字段名是 **pitchMidi**（见 core/src/io/midi-exporter.ts），
 * 而 v2.6.0 这里写的是 data.pitch —— undefined → NaN → Number.isFinite 为 false
 * → 着色回退成默认灰、文案回退成类型名。也就是说 v2.6.0「按音高着色 / 显示 C4」
 * 的改动**从未生效**，图谱一直是「21 个一样的灰点」。
 * 这里同时兼容 pitch，避免将来字段改名再次静默失效。
 */
function readPitchMidi(data?: Record<string, unknown>): number {
  const raw = data?.pitchMidi ?? data?.pitch;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

function pitchLabel(pitch: number): string {
  const p = Math.round(pitch);
  return `${NOTE_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`;
}

/**
 * v2.6.0：NoteSpan 按音高分档着色（低音暖 → 高音冷）。
 * 此前所有 NoteSpan 都落到 --canvas-node-default 的同一灰色，图谱看起来
 * 像是"21 个一样的点"，读不出任何音乐信息。
 */
const PITCH_TINTS = ["#fb7185", "#f59e0b", "#22c55e", "#00d4ff", "#818cf8", "#e879f9"];
function pitchTint(pitch: number): string {
  const clamped = Math.max(24, Math.min(96, pitch));
  return PITCH_TINTS[Math.max(0, Math.min(PITCH_TINTS.length - 1, Math.floor((clamped - 36) / 10)))];
}

function getColor(node: { type: string; data?: Record<string, unknown> }): string {
  if (node.type === "NoteSpan") {
    const pitch = readPitchMidi(node.data);
    if (Number.isFinite(pitch)) return pitchTint(pitch);
  }
  return getNodeColor(node.type);
}

function runForceLayout(graph: GraphData, w: number, h: number): LayoutNode[] {
  const nodes: LayoutNode[] = graph.nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(graph.nodes.length, 1);
    const r = Math.min(w, h) * 0.3;
    return {
      ...n,
      x: w / 2 + r * Math.cos(angle),
      y: h / 2 + r * Math.sin(angle),
      vx: 0,
      vy: 0,
      opacity: 0,
      scale: 0.5,
      pulsePhase: Math.random() * Math.PI * 2,
    };
  });

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    for (const edge of graph.edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = SPRING_K * (dist - SPRING_LENGTH);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const node of nodes) {
      node.vx *= DAMPING;
      node.vy *= DAMPING;
      node.x += node.vx;
      node.y += node.vy;
      node.x = Math.max(NODE_RADIUS + 10, Math.min(w - NODE_RADIUS - 10, node.x));
      node.y = Math.max(NODE_RADIUS + 10, Math.min(h - NODE_RADIUS - 10, node.y));
    }
  }

  return nodes;
}

export function GraphView({ graph, onNodeClick, width, height }: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<LayoutNode[]>([]);
  const transformRef = useRef({ panX: 0, panY: 0, zoom: 1 });
  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; panStartX: number; panStartY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    panStartX: 0,
    panStartY: 0,
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);
  const animationRef = useRef<AnimationState>({
    time: 0,
    nodeAnimations: new Map(),
    edgeAnimations: new Map(),
  });
  const startTimeRef = useRef<number>(0);
  const isAnimatingRef = useRef<boolean>(false);

  const initializeAnimations = useCallback(() => {
    const now = performance.now();
    startTimeRef.current = now;
    animationRef.current = {
      time: 0,
      nodeAnimations: new Map(),
      edgeAnimations: new Map(),
    };
    
    for (const node of layoutRef.current) {
      animationRef.current.nodeAnimations.set(node.id, {
        fadeInProgress: 0,
        pulseIntensity: 0,
        hoverIntensity: 0,
        clickFeedback: 0,
      });
    }
    
    for (let i = 0; i < graph.edges.length; i++) {
      const edge = graph.edges[i];
      const key = `${edge.source}->${edge.target}`;
      animationRef.current.edgeAnimations.set(key, {
        flowProgress: Math.random(),
        highlightIntensity: 0,
      });
    }
  }, [graph.edges]);

  const updateAnimations = useCallback((timestamp: number) => {
    const elapsed = timestamp - startTimeRef.current;
    animationRef.current.time = elapsed;
    
    for (const [nodeId, anim] of animationRef.current.nodeAnimations) {
      const node = layoutRef.current.find(n => n.id === nodeId);
      if (!node) continue;
      
      const fadeInDelay = Math.random() * 300;
      const fadeInStart = fadeInDelay;
      const fadeInEnd = fadeInStart + ANIMATION_DURATION;
      
      if (elapsed < fadeInStart) {
        anim.fadeInProgress = 0;
      } else if (elapsed < fadeInEnd) {
        anim.fadeInProgress = (elapsed - fadeInStart) / ANIMATION_DURATION;
      } else {
        anim.fadeInProgress = 1;
      }
      
      const isSelected = selectedRef.current === nodeId;
      const isHovered = hoveredRef.current === nodeId;
      
      if (isSelected) {
        anim.pulseIntensity = 0.5 + 0.5 * Math.sin(elapsed * PULSE_SPEED * 0.001);
        anim.clickFeedback = Math.max(0, anim.clickFeedback - 0.05);
      } else {
        anim.pulseIntensity = Math.max(0, anim.pulseIntensity - 0.05);
      }
      
      if (isHovered) {
        anim.hoverIntensity = Math.min(1, anim.hoverIntensity + 0.1);
      } else {
        anim.hoverIntensity = Math.max(0, anim.hoverIntensity - 0.05);
      }
      
      node.opacity = anim.fadeInProgress;
      node.scale = 0.5 + 0.5 * anim.fadeInProgress + 0.1 * anim.hoverIntensity + 0.05 * anim.pulseIntensity;
    }
    
    for (const [edgeKey, anim] of animationRef.current.edgeAnimations) {
      const [sourceId, targetId] = edgeKey.split('->');
      const isHighlighted = selectedRef.current === sourceId || selectedRef.current === targetId;
      
      anim.flowProgress = (anim.flowProgress + EDGE_FLOW_SPEED * 0.01) % 1;
      
      if (isHighlighted) {
        anim.highlightIntensity = Math.min(1, anim.highlightIntensity + 0.1);
      } else {
        anim.highlightIntensity = Math.max(0, anim.highlightIntensity - 0.05);
      }
    }
    
    const allNodesFadedIn = Array.from(animationRef.current.nodeAnimations.values())
      .every(anim => anim.fadeInProgress >= 1);
    
    if (!allNodesFadedIn || selectedRef.current || hoveredRef.current) {
      return true;
    }
    
    return false;
  }, []);

  /**
   * v2.6.0：把节点包围盒缩放 + 平移到画布内（含边距）。
   * 此前 transform 固定 {0,0,1}，力导向把节点簇推到画布下缘之外 → 底行节点
   * 被裁掉（实测底边有 600px 非背景像素、顶边 0）。canvas 的绘制尺寸本身已经
   * 是 clientWidth/Height（不是 props），所以只需修正视口变换。
   */
  const applyFitView = useCallback((nodes: LayoutNode[], w: number, h: number) => {
    const PAD = 56;
    if (nodes.length === 0 || w <= 0 || h <= 0) {
      transformRef.current = { panX: 0, panY: 0, zoom: 1 };
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const zoom = Math.max(
      0.15,
      Math.min(1.5, Math.min((w - PAD * 2) / spanX, (h - PAD * 2) / spanY)),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    transformRef.current = {
      zoom,
      panX: w / 2 - cx * zoom,
      panY: h / 2 - cy * zoom,
    };
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { panX, panY, zoom } = transformRef.current;
    const nodes = layoutRef.current;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getCSSVar("--canvas-bg");
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const selectedId = selectedRef.current;
    const hoveredId = hoveredRef.current;
    const connectedEdgeKeys = new Set<string>();

    if (selectedId) {
      for (const edge of graph.edges) {
        if (edge.source === selectedId || edge.target === selectedId) {
          connectedEdgeKeys.add(`${edge.source}->${edge.target}`);
        }
      }
    }

    for (const edge of graph.edges) {
      const a = nodeMap.get(edge.source);
      const b = nodeMap.get(edge.target);
      if (!a || !b) continue;

      const edgeKey = `${edge.source}->${edge.target}`;
      const isHighlighted = connectedEdgeKeys.has(edgeKey);
      const anim = animationRef.current.edgeAnimations.get(edgeKey);
      const highlightIntensity = anim?.highlightIntensity ?? 0;
      
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      
      // v2.6.0：原为 --canvas-grid（暗底上 #3a3a48，对比极低 → 连线几乎不可见）
      const baseColor = getCSSVar("--canvas-node-default");
      const highlightColor = getCSSVar("--canvas-highlight");
      
      if (isHighlighted && highlightIntensity > 0) {
        ctx.strokeStyle = highlightColor;
        ctx.lineWidth = 1 + highlightIntensity;
        ctx.globalAlpha = 0.3 + 0.7 * highlightIntensity;
      } else {
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.38;
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (isHighlighted && anim) {
        const flowPos = anim.flowProgress;
        const flowX = a.x + (b.x - a.x) * flowPos;
        const flowY = a.y + (b.y - a.y) * flowPos;
        
        ctx.beginPath();
        ctx.arc(flowX, flowY, 3, 0, Math.PI * 2);
        ctx.fillStyle = highlightColor;
        ctx.globalAlpha = 0.8;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ctx.font = "10px Inter, sans-serif";
      ctx.fillStyle = getCSSVar("--text-muted");
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.globalAlpha = isHighlighted ? 1 : 0.7;
      ctx.fillText(edge.type, mx, my - 4);
      ctx.globalAlpha = 1;
    }

    for (const node of nodes) {
      const isSelected = node.id === selectedId;
      const isHovered = node.id === hoveredId;
      const color = getColor(node);
      const anim = animationRef.current.nodeAnimations.get(node.id);
      
      if (!anim || node.opacity <= 0) continue;
      
      ctx.save();
      ctx.globalAlpha = node.opacity;
      ctx.translate(node.x, node.y);
      ctx.scale(node.scale, node.scale);
      
      if (isSelected && anim.pulseIntensity > 0) {
        const pulseRadius = NODE_RADIUS + 8 + 4 * anim.pulseIntensity;
        const pulseAlpha = 0.3 * (1 - anim.pulseIntensity);
        ctx.beginPath();
        ctx.arc(0, 0, pulseRadius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = pulseAlpha * node.opacity;
        ctx.fill();
        ctx.globalAlpha = node.opacity;
      }
      
      ctx.beginPath();
      ctx.arc(0, 0, NODE_RADIUS, 0, Math.PI * 2);
      
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, NODE_RADIUS);
      gradient.addColorStop(0, color + "66");
      gradient.addColorStop(1, color + "22");
      ctx.fillStyle = gradient;
      ctx.fill();
      
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3 : isHovered ? 2.5 : 1.5;
      ctx.stroke();
      
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(0, 0, NODE_RADIUS + 4, 0, Math.PI * 2);
        ctx.strokeStyle = color + "88";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
      if (isHovered && !isSelected) {
        ctx.beginPath();
        ctx.arc(0, 0, NODE_RADIUS + 2, 0, Math.PI * 2);
        ctx.strokeStyle = color + "44";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      
      ctx.font = "11px Inter, sans-serif";
      ctx.fillStyle = getCSSVar("--text-primary");
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // v2.6.0：NoteSpan 显示音高（C4）而不是类型名 "NoteSpan"
      const pitch = readPitchMidi(node.data);
      const label =
        node.data?.name ??
        (node.type === "NoteSpan" && Number.isFinite(pitch) ? pitchLabel(pitch) : node.type);
      
      const labelY = NODE_RADIUS + 4;
      
      if (isSelected || isHovered) {
        ctx.font = "bold 11px Inter, sans-serif";
        ctx.fillStyle = color;
      }
      
      ctx.fillText(label, 0, labelY);
      
      ctx.restore();
    }

    ctx.restore();
  }, [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const nodes = runForceLayout(graph, w, h);
    layoutRef.current = nodes;
    // v2.6.0：布局跑完后自动 fit-to-view。此前 transform 固定为 {0,0,1}，
    // 力导向把节点簇推到画布下缘之外 → 底行节点被裁掉一半（实测底边有 600px
    // 非背景像素、顶边 0）。
    applyFitView(nodes, w, h);
    
    initializeAnimations();
    isAnimatingRef.current = true;
    
    const animate = (timestamp: number) => {
      if (!isAnimatingRef.current) return;
      
      const needsContinue = updateAnimations(timestamp);
      render();
      
      if (needsContinue) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        isAnimatingRef.current = false;
      }
    };
    
    rafRef.current = requestAnimationFrame(animate);
    
    return () => {
      cancelAnimationFrame(rafRef.current);
      isAnimatingRef.current = false;
    };
  }, [graph, render, initializeAnimations, updateAnimations]);

  useEffect(() => {
    if (selectedNodeId || hoveredNodeId) {
      if (!isAnimatingRef.current) {
        isAnimatingRef.current = true;
        const animate = (timestamp: number) => {
          if (!isAnimatingRef.current) return;
          
          const needsContinue = updateAnimations(timestamp);
          render();
          
          if (needsContinue) {
            rafRef.current = requestAnimationFrame(animate);
          } else {
            isAnimatingRef.current = false;
          }
        };
        rafRef.current = requestAnimationFrame(animate);
      }
    }
  }, [selectedNodeId, hoveredNodeId, render, updateAnimations]);

  const getCanvasCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const { panX, panY, zoom } = transformRef.current;
    return {
      x: (e.clientX - rect.left - panX) / zoom,
      y: (e.clientY - rect.top - panY) / zoom,
    };
  }, []);

  const findNodeAtCoords = useCallback((x: number, y: number) => {
    for (const node of layoutRef.current) {
      const ndx = node.x - x;
      const ndy = node.y - y;
      if (ndx * ndx + ndy * ndy < NODE_RADIUS * NODE_RADIUS * 1.5) {
        return node;
      }
    }
    return null;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      panStartX: transformRef.current.panX,
      panStartY: transformRef.current.panY,
    };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragRef.current.dragging) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        transformRef.current.panX = dragRef.current.panStartX + dx;
        transformRef.current.panY = dragRef.current.panStartY + dy;
        render();
        return;
      }
      
      const { x, y } = getCanvasCoords(e);
      const hoveredNode = findNodeAtCoords(x, y);
      const newHoveredId = hoveredNode?.id ?? null;
      
      if (newHoveredId !== hoveredRef.current) {
        hoveredRef.current = newHoveredId;
        setHoveredNodeId(newHoveredId);
        
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.style.cursor = newHoveredId ? "pointer" : "grab";
        }
      }
    },
    [render, getCanvasCoords, findNodeAtCoords],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const dx = Math.abs(e.clientX - dragRef.current.startX);
      const dy = Math.abs(e.clientY - dragRef.current.startY);
      const wasDrag = dx > 3 || dy > 3;
      dragRef.current.dragging = false;

      if (wasDrag) return;

      const { x, y } = getCanvasCoords(e);
      const clickedNode = findNodeAtCoords(x, y);
      
      if (clickedNode) {
        selectedRef.current = clickedNode.id;
        setSelectedNodeId(clickedNode.id);
        onNodeClick?.(clickedNode.id);
        
        const anim = animationRef.current.nodeAnimations.get(clickedNode.id);
        if (anim) {
          anim.clickFeedback = 1;
        }
      } else {
        selectedRef.current = null;
        setSelectedNodeId(null);
      }
      
      if (!isAnimatingRef.current) {
        isAnimatingRef.current = true;
        const animate = (timestamp: number) => {
          if (!isAnimatingRef.current) return;
          
          const needsContinue = updateAnimations(timestamp);
          render();
          
          if (needsContinue) {
            rafRef.current = requestAnimationFrame(animate);
          } else {
            isAnimatingRef.current = false;
          }
        };
        rafRef.current = requestAnimationFrame(animate);
      }
    },
    [getCanvasCoords, findNodeAtCoords, onNodeClick, render, updateAnimations],
  );

  const handleMouseLeave = useCallback(() => {
    hoveredRef.current = null;
    setHoveredNodeId(null);
    
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = "grab";
    }
    
    render();
  }, [render]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { panX, panY, zoom } = transformRef.current;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(5, zoom * delta));
      transformRef.current = {
        panX: mx - (mx - panX) * (newZoom / zoom),
        panY: my - (my - panY) * (newZoom / zoom),
        zoom: newZoom,
      };
      render();
    },
    [render],
  );

  // v2.6.0：以画布中心为锚点缩放（此前图谱没有任何本地控件，只能靠滚轮）
  const zoomBy = useCallback(
    (factor: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { zoom, panX, panY } = transformRef.current;
      const next = Math.max(0.2, Math.min(4, zoom * factor));
      if (next === zoom) return;
      const cx = canvas.clientWidth / 2;
      const cy = canvas.clientHeight / 2;
      transformRef.current = {
        zoom: next,
        panX: cx - (cx - panX) * (next / zoom),
        panY: cy - (cy - panY) * (next / zoom),
      };
      render();
    },
    [render],
  );

  // v2.6.0：重新布局（力导向每次都从环形初值出发，重排可换一张网）
  const relayout = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const nodes = runForceLayout(graph, w, h);
    layoutRef.current = nodes;
    initializeAnimations();
    isAnimatingRef.current = true;
    applyFitView(nodes, w, h);
    render();
  }, [graph, initializeAnimations, render, applyFitView]);

  // v2.5.0：此前画布硬编码 800×600 显示尺寸，在 1600px 宽的窗口里
  // 图谱只占左上角一小块（画布已按 clientWidth 绘制，但显示尺寸没跟随容器）。
  // 改为默认铺满容器；同时补 ResizeObserver，使容器尺寸变化时重绘。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      render();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [render]);

  return (
    <div className={styles.viewport}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        data-testid="graph-canvas"
        style={{
          width: width !== undefined ? width : "100%",
          height: height !== undefined ? height : "100%",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      />
      {/* v2.6.0：图谱此前没有任何本地控件（只能靠滚轮缩放、无法重排） */}
      <div className={styles.canvasToolbar} data-testid="graph-toolbar">
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={() => zoomBy(1.25)}
          title="放大"
          aria-label="放大"
        >
          +
        </button>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={() => zoomBy(0.8)}
          title="缩小"
          aria-label="缩小"
        >
          −
        </button>
        <button
          type="button"
          className={styles.toolbarBtn}
          onClick={relayout}
          title="重新布局"
          aria-label="重新布局"
        >
          <Icon name="refresh" size={13} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
    </div>
  );
}
