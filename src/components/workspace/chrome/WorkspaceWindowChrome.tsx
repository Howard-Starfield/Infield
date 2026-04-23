import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderClosed,
  Minus,
  Search,
  Square,
  X,
} from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkspaceNode } from "@/types/workspace";

type Breadcrumb = {
  id: string;
  label: string;
  kind: "section" | "document" | "database" | "row";
  clickable: boolean;
};

function iconForBreadcrumb(kind: Breadcrumb["kind"]) {
  if (kind === "database") {
    return <FolderClosed size={12} strokeWidth={1.7} aria-hidden />;
  }
  return <FileText size={12} strokeWidth={1.7} aria-hidden />;
}

async function buildBreadcrumbs(node: WorkspaceNode | null): Promise<Breadcrumb[]> {
  if (!node) {
    return [{ id: "workspace-root", label: "Workspace", kind: "section", clickable: false }];
  }

  const chain: WorkspaceNode[] = [];
  let parentId = node.parent_id;
  const seen = new Set<string>();

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = await invoke<WorkspaceNode | null>("get_node", { id: parentId });
    if (!parent) break;
    chain.unshift(parent);
    parentId = parent.parent_id;
  }

  const sectionLabel =
    node.node_type === "database" ||
    node.node_type === "row" ||
    chain.some((entry) => entry.node_type === "database")
      ? "Databases"
      : "Documents";

  const items: Breadcrumb[] = [
    {
      id: "workspace-section",
      label: sectionLabel,
      kind: "section",
      clickable: false,
    },
  ];

  for (const entry of chain) {
    items.push({
      id: entry.id,
      label: entry.name,
      kind:
        entry.node_type === "database"
          ? "database"
          : entry.node_type === "row"
            ? "row"
            : "document",
      clickable: true,
    });
  }

  items.push({
    id: node.id,
    label: node.name,
    kind: node.node_type === "database" ? "database" : node.node_type === "row" ? "row" : "document",
    clickable: false,
  });

  return items;
}

export function WorkspaceWindowChrome() {
  const activeNode = useWorkspaceStore((state) => state.activeNode);
  const historyDepth = useWorkspaceStore((state) => state.historyStack.length);
  const goBack = useWorkspaceStore((state) => state.goBack);
  const navigateTo = useWorkspaceStore((state) => state.navigateTo);
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([
    { id: "workspace-root", label: "Workspace", kind: "section", clickable: false },
  ]);
  const isWindows = useMemo(() => platform() === "windows", []);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const next = await buildBreadcrumbs(activeNode);
      if (!cancelled) {
        setBreadcrumbs(next);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [activeNode]);

  const shellButtonStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    color: "var(--workspace-text-soft)",
    width: 24,
    height: 24,
    borderRadius: 6,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    transition: "background var(--transition-fast), color var(--transition-fast)",
  };

  return (
    <div
      data-tauri-drag-region
      style={{
        display: "flex",
        alignItems: "stretch",
        minHeight: 38,
        background: "var(--bg-sidebar)",
        borderBottom: "1px solid rgba(28, 28, 25, 0.08)",
        boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.55)",
        flexShrink: 0,
      }}
    >
      <div
        data-tauri-drag-region
        style={{
          width: 208,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 14px 0 16px",
          borderRight: "1px solid rgba(28, 28, 25, 0.07)",
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: 5,
            background: "var(--workspace-accent)",
            display: "grid",
            placeItems: "center",
            color: "#fff",
            fontSize: 11,
            fontWeight: 700,
            lineHeight: 1,
            fontFamily: "Inter, sans-serif",
            boxShadow: "0 1px 2px rgba(28, 28, 25, 0.15)",
          }}
        >
          H
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--workspace-text)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Handy
          </div>
        </div>
      </div>

      <div
        data-tauri-drag-region
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px 0 14px",
        }}
      >
        <button
          type="button"
          onClick={() => goBack()}
          disabled={historyDepth === 0}
          aria-label="Go back"
          style={{
            ...shellButtonStyle,
            color:
              historyDepth === 0
                ? "rgba(60, 50, 45, 0.35)"
                : "var(--workspace-text-muted)",
            cursor: historyDepth === 0 ? "default" : "pointer",
          }}
        >
          <ChevronLeft size={14} strokeWidth={1.8} aria-hidden />
        </button>
        <button
          type="button"
          disabled
          aria-label="Go forward"
          style={{
            ...shellButtonStyle,
            color: "rgba(60, 50, 45, 0.35)",
            cursor: "default",
          }}
        >
          <ChevronRight size={14} strokeWidth={1.8} aria-hidden />
        </button>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 2,
            minWidth: 0,
          }}
        >
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;
            return (
              <div
                key={crumb.id}
                style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}
              >
                {index > 0 ? (
                  <ChevronRight
                    size={11}
                    strokeWidth={1.7}
                    aria-hidden
                    color="var(--workspace-text-soft)"
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (crumb.clickable) {
                      void navigateTo(crumb.id, { source: "tree" });
                    }
                  }}
                  disabled={!crumb.clickable}
                  style={{
                    border: "none",
                    background: isLast ? "rgba(255,255,255,0.45)" : "transparent",
                    color: isLast ? "var(--workspace-text)" : "var(--workspace-text-muted)",
                    padding: "4px 8px",
                    borderRadius: 7,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    fontWeight: isLast ? 600 : 500,
                    minWidth: 0,
                    maxWidth: index === 0 ? 110 : 240,
                    cursor: crumb.clickable ? "pointer" : "default",
                    boxShadow: isLast ? "inset 0 0 0 1px rgba(28, 28, 25, 0.05)" : "none",
                    transition: "background var(--transition-fast), color var(--transition-fast)",
                  }}
                >
                  {crumb.kind !== "section" ? iconForBreadcrumb(crumb.kind) : null}
                  <span
                    style={{
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {crumb.label}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1 }} />

        <button
          type="button"
          aria-label="Search or jump"
          style={{
            height: 26,
            minWidth: 260,
            maxWidth: 320,
            borderRadius: 8,
            border: "1px solid rgba(28, 28, 25, 0.06)",
            background: "rgba(255,255,255,0.48)",
            color: "var(--workspace-text-soft)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 10px",
            fontSize: 12,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.55)",
          }}
        >
          <Search size={12} strokeWidth={1.8} aria-hidden />
          <span>Search or jump to...</span>
          <div style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "2px 6px",
              borderRadius: 5,
              background: "rgba(28, 28, 25, 0.04)",
              color: "var(--workspace-text-soft)",
            }}
          >
            Ctrl K
          </span>
        </button>
      </div>

      {isWindows ? (
        <div style={{ display: "flex", alignItems: "stretch" }}>
          <button
            type="button"
            aria-label="Minimize"
            onClick={() => {
              void getCurrentWindow().minimize();
            }}
            className="workspace-window-control"
            style={{ width: 46 }}
          >
            <Minus size={12} strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Maximize"
            onClick={() => {
              void getCurrentWindow().toggleMaximize();
            }}
            className="workspace-window-control"
            style={{ width: 46 }}
          >
            <Square size={10} strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              void getCurrentWindow().close();
            }}
            className="workspace-window-control workspace-window-control-danger"
            style={{ width: 46 }}
          >
            <X size={12} strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
