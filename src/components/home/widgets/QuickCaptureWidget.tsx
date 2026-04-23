import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceNode } from "@/types/workspace";

export const QuickCaptureWidget: React.FC<{
  onCreateNote: (title: string, body: string) => Promise<WorkspaceNode | null>;
  onOpenNote: (id: string) => void;
}> = ({ onCreateNote, onOpenNote }) => {
  const { t } = useTranslation();
  const [text, setText] = useState("");

  const handleSave = async () => {
    if (!text.trim()) return;
    const firstLine = text.split("\n")[0]?.trim() || `Quick Note — ${new Date().toLocaleTimeString()}`;
    const note = await onCreateNote(firstLine, text.trim());
    if (note) {
      onOpenNote(note.id);
    }
    setText("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("home.quickCapture.placeholder")}
        style={{
          width: "100%",
          minHeight: 72,
          background: "color-mix(in srgb, var(--workspace-panel-muted) 55%, transparent)",
          border: "1px solid var(--workspace-border-strong)",
          borderRadius: "var(--workspace-panel-radius)",
          color: "var(--workspace-text)",
          fontSize: 12,
          padding: "8px 10px",
          resize: "none",
          outline: "none",
          fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif",
        }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void handleSave(); }}
      />
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={!text.trim()}
        style={{
          alignSelf: "flex-end",
          padding: "4px 14px",
          background: text.trim()
            ? "var(--workspace-accent)"
            : "color-mix(in srgb, var(--workspace-border) 50%, transparent)",
          border: text.trim() ? "1px solid color-mix(in srgb, var(--workspace-accent) 35%, transparent)" : "1px solid var(--workspace-border)",
          borderRadius: "var(--workspace-panel-radius)",
          color: text.trim() ? "var(--workspace-panel)" : "var(--workspace-text-soft)",
          fontSize: 11,
          fontWeight: 700,
          cursor: text.trim() ? "pointer" : "default",
          fontFamily: "Manrope, sans-serif",
          textTransform: "uppercase",
          letterSpacing: ".06em",
        }}
      >
        {t("common.save")}
      </button>
    </div>
  );
};
