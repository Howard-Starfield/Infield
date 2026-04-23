import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkspaceNode } from "@/types/workspace";

export interface WorkspaceRecentEntry {
  nodeId: string;
  viewedAt: number;
  name: string;
  node_type: WorkspaceNode["node_type"];
}

/**
 * Workspace sidebar recents (user preference + live node names).
 * Refetches when `recentsRevision` bumps (e.g. after navigating a page).
 */
export function useWorkspaceRecents() {
  const [recents, setRecents] = useState<WorkspaceRecentEntry[]>([]);
  const recentsRevision = useWorkspaceStore((s) => s.recentsRevision);

  const refresh = useCallback(async () => {
    try {
      const recentsJson = await invoke<string | null>("get_user_preference", {
        key: "recents",
      });
      const recentEntries: { nodeId: string; viewedAt: number }[] =
        recentsJson ? JSON.parse(recentsJson) : [];
      const valid: WorkspaceRecentEntry[] = [];
      for (const r of recentEntries) {
        const node = await invoke<WorkspaceNode | null>("get_node", {
          id: r.nodeId,
        });
        if (node && !node.deleted_at) {
          valid.push({
            ...r,
            name: node.name || "Untitled",
            node_type: node.node_type,
          });
        }
      }
      setRecents(valid);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [recentsRevision, refresh]);

  return { recents, refresh };
}
