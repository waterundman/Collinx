import React, { useState } from "react";
import type { DomainExplanation } from "@collinx/core";
import styles from "./ExplanationView.module.css";

interface ExplanationViewProps {
  explanations: DomainExplanation[];
}

export function ExplanationView({ explanations }: ExplanationViewProps) {
  const [expanded, setExpanded] = useState(false);

  if (explanations.length === 0) {
    return null;
  }

  return (
    <div>
      <button type="button" onClick={() => setExpanded((v) => !v)} className={styles.toggle}>
        {expanded ? "▾" : "▸"} {explanations.length} domain explanation{explanations.length > 1 ? "s" : ""}
      </button>
      {expanded && (
        <ul className={styles.list}>
          {explanations.map((exp, i) => (
            <li key={i} className={styles.item}>
              <strong className={styles.label}>{exp.label}:</strong> {exp.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
