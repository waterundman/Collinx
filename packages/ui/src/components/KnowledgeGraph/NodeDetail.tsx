import React from "react";
import styles from "./GraphView.module.css";

function getCSSVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export interface ConnectedNode {
  id: string;
  type: string;
  edgeType: string;
}

export interface NodeDetailProps {
  node: { id: string; type: string; data: Record<string, any> };
  connectedNodes: ConnectedNode[];
  onClose: () => void;
}

const NODE_COLOR_VARS: Record<string, string> = {
  Phrase: "--node-phrase",
  Motif: "--node-motif",
  Track: "--node-track",
  ExportVersion: "--node-export-version",
  TasteEvidence: "--node-taste-evidence",
};

function getNodeColor(type: string): string {
  const varName = NODE_COLOR_VARS[type];
  return varName ? getCSSVar(varName) : getCSSVar("--canvas-node-default");
}

export function NodeDetail({ node, connectedNodes, onClose }: NodeDetailProps) {
  const color = getNodeColor(node.type);

  return (
    <div className={styles.detailPanel} data-testid="node-detail">
      <div className={styles.detailHeader}>
        <span className={styles.detailBadge} style={{ background: color + "33", color, borderColor: color }}>
          {node.type}
        </span>
        <button className={styles.detailClose} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className={styles.detailId}>{node.id}</div>

      <div className={styles.detailSection}>
        <div className={styles.detailSectionTitle}>Properties</div>
        {Object.entries(node.data).length === 0 ? (
          <div className={styles.detailEmpty}>No data</div>
        ) : (
          <div className={styles.detailKvList}>
            {Object.entries(node.data).map(([key, value]) => (
              <div key={key} className={styles.detailKv}>
                <span className={styles.detailKey}>{key}</span>
                <span className={styles.detailValue}>{String(value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {connectedNodes.length > 0 && (
        <div className={styles.detailSection}>
          <div className={styles.detailSectionTitle}>Connected ({connectedNodes.length})</div>
          <div className={styles.detailConnectedList}>
            {connectedNodes.map((cn) => (
              <div key={cn.id} className={styles.detailConnected}>
                <span className={styles.detailConnectedType} style={{ color: getNodeColor(cn.type) }}>
                  {cn.type}
                </span>
                <span className={styles.detailConnectedEdge}>→ {cn.edgeType}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
