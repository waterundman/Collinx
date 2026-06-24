import React, { useState } from "react";
import type { DomainExplanation } from "@collinx/core";

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
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--accent-cyan)",
          cursor: "pointer",
          fontSize: "11px",
          padding: 0,
          fontFamily: "var(--font-ui)",
        }}
      >
        {expanded ? "▾" : "▸"} {explanations.length} domain explanation{explanations.length > 1 ? "s" : ""}
      </button>
      {expanded && (
        <ul
          style={{
            listStyle: "none",
            margin: "var(--space-1) 0 0",
            padding: 0,
          }}
        >
          {explanations.map((exp, i) => (
            <li
              key={i}
              style={{
                fontSize: "11px",
                color: "var(--text-secondary)",
                marginBottom: "var(--space-1)",
                paddingLeft: "var(--space-2)",
                borderLeft: "2px solid var(--border-secondary)",
              }}
            >
              <strong style={{ color: "var(--text-primary)" }}>{exp.label}:</strong>{" "}
              {exp.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
