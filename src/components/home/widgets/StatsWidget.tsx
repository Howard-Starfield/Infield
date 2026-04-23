import React from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceNode } from "@/types/workspace";
import { totalWordsFromNodes } from "@/lib/homeWorkspaceMetrics";

export const StatsWidget: React.FC<{ documents: WorkspaceNode[] }> = ({ documents }) => {
  const { t } = useTranslation();
  const totalNotes = documents.length;
  const totalWords = totalWordsFromNodes(documents);

  const statNum: React.CSSProperties = {
    fontSize: 22,
    fontWeight: 800,
    color: "var(--workspace-accent)",
    fontFamily: "Manrope, Inter, system-ui, sans-serif",
  };
  const statLabel: React.CSSProperties = {
    fontSize: 10,
    color: "var(--workspace-text-soft)",
    textTransform: "uppercase",
    letterSpacing: ".06em",
    fontFamily: "Manrope, sans-serif",
  };

  return (
    <div style={{ display: "flex", gap: 16 }}>
      <div>
        <div style={statNum}>{totalNotes}</div>
        <div style={statLabel}>{t("home.stats.notes")}</div>
      </div>
      <div>
        <div style={statNum}>{totalWords.toLocaleString()}</div>
        <div style={statLabel}>{t("home.stats.words")}</div>
      </div>
      <div>
        <div
          style={{
            ...statNum,
            color: "var(--workspace-text-soft)",
          }}
        >
          —
        </div>
        <div style={statLabel}>{t("home.stats.hours")}</div>
      </div>
    </div>
  );
};
