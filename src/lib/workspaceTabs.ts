import type { WorkspaceNode } from "@/types/workspace";

export type WorkspaceTabDescriptor = {
  nodeId: string;
  label: string;
  nodeType: WorkspaceNode["node_type"];
};

export const WORKSPACE_TAB_OPEN_EVENT = "handy-workspace-open-tab";

export function emitWorkspaceTabOpen(node: WorkspaceNode) {
  window.dispatchEvent(
    new CustomEvent<WorkspaceTabDescriptor>(WORKSPACE_TAB_OPEN_EVENT, {
      detail: {
        nodeId: node.id,
        label: node.name,
        nodeType: node.node_type,
      },
    }),
  );
}
