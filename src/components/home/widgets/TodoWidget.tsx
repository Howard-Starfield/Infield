import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceNode } from "@/types/workspace";

interface ChecklistItem {
  text: string;
  noteId: string;
  noteTitle: string;
}

function extractTodosFromNodes(nodes: WorkspaceNode[]): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const node of nodes) {
    if (node.node_type !== "document" && node.node_type !== "row") continue;
    const lines = (node.body ?? "").split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*[-*]\s+\[\s\]\s+(.+?)\s*$/);
      if (!match) continue;
      items.push({
        text: match[1],
        noteId: node.id,
        noteTitle: node.name || "Untitled",
      });
      if (items.length >= 10) return items;
    }
  }
  return items.slice(0, 10);
}

export const TodoWidget: React.FC<{
  documents: WorkspaceNode[];
  onOpenNote: (id: string) => void;
}> = ({ documents, onOpenNote }) => {
  const { t } = useTranslation();
  const todos = useMemo(() => extractTodosFromNodes(documents), [documents]);

  if (todos.length === 0) {
    return (
      <p style={{ fontSize: 12, color: "var(--workspace-text-soft)", margin: 0 }}>
        {t("home.todo.empty")}
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {todos.map((item, i) => (
        <div
          key={`${item.noteId}-${i}`}
          style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}
          role="button"
          tabIndex={0}
          onClick={() => onOpenNote(item.noteId)}
          onKeyDown={(e) => { if (e.key === "Enter") onOpenNote(item.noteId); }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              border: "1.5px solid color-mix(in srgb, var(--workspace-accent) 45%, transparent)",
              flexShrink: 0,
              marginTop: 1,
            }}
          />
          <span style={{ fontSize: 12, color: "var(--workspace-text)", lineHeight: 1.4 }}>{item.text}</span>
        </div>
      ))}
    </div>
  );
};
