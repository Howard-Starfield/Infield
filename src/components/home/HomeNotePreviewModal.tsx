import React, { useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { MDXEditorView } from "@/components/editor/MDXEditorView";
import type { WorkspaceNode } from "@/types/workspace";

export interface HomeNotePreviewModalProps {
  noteId: string | null;
  onClose: () => void;
  /** Opens the full note experience (search tab) and closes this modal. */
  onOpenInEditor: (noteId: string) => void;
}

export const HomeNotePreviewModal: React.FC<HomeNotePreviewModalProps> = ({
  noteId,
  onClose,
  onOpenInEditor,
}) => {
  const { t } = useTranslation();
  const [note, setNote] = React.useState<WorkspaceNode | null>(null);

  const markdown = useMemo(() => note?.body ?? "", [note]);

  useEffect(() => {
    let cancelled = false;
    if (!noteId) {
      setNote(null);
      return;
    }
    void (async () => {
      try {
        const node = await invoke<WorkspaceNode | null>("get_node", { id: noteId });
        if (!cancelled) setNote(node);
      } catch {
        if (!cancelled) setNote(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  useEffect(() => {
    if (!noteId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [noteId, onClose]);

  if (!noteId || !note) return null;

  const isDatabaseNote = note.node_type === "database";

  return (
    <div
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--workspace-modal-z)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--workspace-chat-backdrop)",
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-note-preview-title"
        style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "min(88vh, 900px)",
          display: "flex",
          flexDirection: "column",
          background: "var(--workspace-panel)",
          border: "1px solid var(--workspace-border-strong)",
          borderRadius: "var(--workspace-panel-radius)",
          boxShadow: "var(--workspace-shadow)",
          overflow: "hidden",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 16px",
            borderBottom: "1px solid var(--workspace-border)",
            flexShrink: 0,
            background: "var(--workspace-panel-muted)",
          }}
        >
          <h2
            id="home-note-preview-title"
            style={{
              flex: 1,
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              color: "var(--workspace-text)",
              fontFamily: "Manrope, sans-serif",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {note.name || t("notes.untitled")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: "var(--workspace-menu-radius)",
              border: "1px solid var(--workspace-border)",
              background: "var(--workspace-chat-surface-raised)",
              color: "var(--workspace-text-muted)",
              cursor: "pointer",
            }}
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "16px 20px 20px",
            background: "var(--editor-bg)",
          }}
        >
          {isDatabaseNote ? (
            <p style={{ fontSize: 13, color: "var(--workspace-text-muted)", margin: 0, lineHeight: 1.5 }}>
              {t("home.dashboard.previewDatabaseHint")}
            </p>
          ) : (
            <div className="mdx-shell" style={{ minHeight: 200 }}>
              <MDXEditorView
                markdown={markdown}
                readOnly
                className="mdx-shell"
                onChange={() => {}}
              />
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            padding: "12px 16px",
            borderTop: "1px solid var(--workspace-border)",
            flexShrink: 0,
            background: "var(--workspace-panel-muted)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "8px 14px",
              borderRadius: "var(--workspace-menu-radius)",
              border: "1px solid var(--workspace-border)",
              background: "transparent",
              color: "var(--workspace-text-muted)",
              cursor: "pointer",
              fontFamily: "Manrope, sans-serif",
            }}
          >
            {t("common.close")}
          </button>
          <button
            type="button"
            onClick={() => onOpenInEditor(note.id)}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "8px 14px",
              borderRadius: "var(--workspace-menu-radius)",
              border: "1px solid var(--workspace-border-strong)",
              background: "var(--workspace-accent-soft)",
              color: "var(--workspace-text)",
              cursor: "pointer",
              fontFamily: "Manrope, sans-serif",
            }}
          >
            {t("home.dashboard.editInNotes")}
          </button>
        </div>
      </div>
    </div>
  );
};
