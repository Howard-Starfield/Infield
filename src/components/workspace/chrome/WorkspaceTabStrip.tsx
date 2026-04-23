import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkspaceNode } from "@/types/workspace";
import {
  emitWorkspaceTabOpen,
  WORKSPACE_TAB_OPEN_EVENT,
  type WorkspaceTabDescriptor,
} from "@/lib/workspaceTabs";
type WorkspaceTab = WorkspaceTabDescriptor;

const STORAGE_KEY = "handy-workspace-tabs";

function loadStoredTabs(): WorkspaceTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WorkspaceTab[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistTabs(tabs: WorkspaceTab[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // ignore persistence failures
  }
}

function tabAccent(nodeType: WorkspaceNode["node_type"]) {
  if (nodeType === "database") return "#b72301";
  if (nodeType === "row") return "#8a4a2a";
  return "#6a3b52";
}

export function WorkspaceTabStrip() {
  const activeNode = useWorkspaceStore((state) => state.activeNode);
  const navigateTo = useWorkspaceStore((state) => state.navigateTo);
  const createNode = useWorkspaceStore((state) => state.createNode);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => loadStoredTabs());

  useEffect(() => {
    if (!activeNode) return;
    setTabs((prev) => {
      const existing = prev.find((entry) => entry.nodeId === activeNode.id);
      if (!existing) return prev;
      const next = prev.map((entry) =>
        entry.nodeId === activeNode.id
          ? {
              nodeId: activeNode.id,
              label: activeNode.name,
              nodeType: activeNode.node_type,
            }
          : entry,
      );
      persistTabs(next);
      return next;
    });
  }, [activeNode]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceTabDescriptor>).detail;
      if (!detail) return;
      setTabs((prev) => {
        const existing = prev.find((entry) => entry.nodeId === detail.nodeId);
        const next = existing
          ? prev.map((entry) => (entry.nodeId === detail.nodeId ? detail : entry))
          : [...prev, detail];
        persistTabs(next);
        return next;
      });
    };

    window.addEventListener(WORKSPACE_TAB_OPEN_EVENT, handler);
    return () => window.removeEventListener(WORKSPACE_TAB_OPEN_EVENT, handler);
  }, []);

  const activeId = activeNode?.id ?? null;
  const canCreateNew = useMemo(() => true, []);

  const closeTab = (nodeId: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;

      const index = prev.findIndex((entry) => entry.nodeId === nodeId);
      const next = prev.filter((entry) => entry.nodeId !== nodeId);
      persistTabs(next);

      if (nodeId === activeId) {
        const neighbor = next[index] ?? next[index - 1] ?? next[0];
        if (neighbor) {
          void navigateTo(neighbor.nodeId, { source: "tree" });
        }
      }

      return next;
    });
  };

  const handleCreateTab = async () => {
    const node = await createNode(null, "document", "Untitled");
    emitWorkspaceTabOpen(node);
    await navigateTo(node.id, { source: "tree" });
  };

  return (
    <div
      className="workspace-tab-strip"
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 2,
        minHeight: 38,
        padding: "0 10px 0 8px",
        background: "var(--bg-sidebar)",
        borderBottom: "1px solid rgba(28, 28, 25, 0.08)",
        overflowX: "auto",
        overflowY: "hidden",
        flexShrink: 0,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.nodeId === activeId;
        return (
          <div
            key={tab.nodeId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
              maxWidth: 250,
              height: isActive ? 31 : 28,
              marginTop: isActive ? 6 : 8,
              marginBottom: isActive ? 0 : 3,
              padding: isActive ? "0 12px 0 11px" : "0 10px",
              borderTopLeftRadius: 10,
              borderTopRightRadius: 10,
              border: isActive ? "1px solid rgba(28, 28, 25, 0.08)" : "1px solid transparent",
              borderBottom: isActive ? "1px solid var(--bg-main)" : "1px solid transparent",
              background: isActive ? "var(--bg-main)" : "transparent",
              color: isActive ? "var(--workspace-text)" : "var(--workspace-text-muted)",
              boxShadow: isActive ? "0 -1px 0 rgba(255,255,255,0.45)" : "none",
              transition: "background var(--transition-fast), color var(--transition-fast)",
              flexShrink: 0,
            }}
          >
            <button
              type="button"
              onClick={() => {
                void navigateTo(tab.nodeId, { source: "tree" });
              }}
              style={{
                border: "none",
                background: "transparent",
                color: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
                padding: 0,
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 3,
                  background: tabAccent(tab.nodeType),
                  opacity: isActive ? 1 : 0.7,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: isActive ? 600 : 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {tab.label}
              </span>
            </button>

            <button
              type="button"
              onClick={() => closeTab(tab.nodeId)}
              aria-label={`Close ${tab.label}`}
              style={{
                width: 18,
                height: 18,
                border: "none",
                borderRadius: 5,
                background: "transparent",
                color: "var(--workspace-text-soft)",
                display: "grid",
                placeItems: "center",
                cursor: tabs.length > 1 ? "pointer" : "default",
                opacity: tabs.length > 1 ? 1 : 0.35,
                transition: "background var(--transition-fast), color var(--transition-fast)",
              }}
              disabled={tabs.length <= 1}
            >
              <X size={10} strokeWidth={1.9} aria-hidden />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        aria-label="New tab"
        disabled={!canCreateNew}
        onClick={() => {
          void handleCreateTab();
        }}
        style={{
          width: 26,
          height: 26,
          margin: "0 4px 4px 2px",
          border: "none",
          borderRadius: 7,
          background: "transparent",
          color: "var(--workspace-text-soft)",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
          cursor: "pointer",
          transition: "background var(--transition-fast), color var(--transition-fast)",
        }}
      >
        <Plus size={14} strokeWidth={1.8} aria-hidden />
      </button>

      <div style={{ flex: 1, minWidth: 20 }} />
    </div>
  );
}
