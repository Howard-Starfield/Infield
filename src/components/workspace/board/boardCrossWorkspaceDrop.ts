import {
  WORKSPACE_BOARD_DATABASE_ATTR,
  WORKSPACE_NODE_ID_ATTR,
  WORKSPACE_NODE_TYPE_ATTR,
  WORKSPACE_ROW_PARENT_ATTR,
} from './workspaceDropDataAttrs'

/**
 * Hit-test for moving a board card to another database when the pointer ends outside
 * this board's `DndContext` (e.g. workspace tree uses a separate context).
 */
export function resolveCrossDatabaseDropTarget(
  clientX: number,
  clientY: number,
  sourceDatabaseId: string,
): string | null {
  const stack = document.elementsFromPoint(clientX, clientY)
  for (const el of stack) {
    const strip = el.closest(`[${WORKSPACE_BOARD_DATABASE_ATTR}]`)
    if (strip) {
      const id = strip.getAttribute(WORKSPACE_BOARD_DATABASE_ATTR)
      if (id && id !== sourceDatabaseId) return id
      continue
    }
    const dbNode = el.closest(`[${WORKSPACE_NODE_TYPE_ATTR}="database"][${WORKSPACE_NODE_ID_ATTR}]`)
    if (dbNode) {
      const id = dbNode.getAttribute(WORKSPACE_NODE_ID_ATTR)
      if (id && id !== sourceDatabaseId) return id
    }
    const rowNode = el.closest(`[${WORKSPACE_NODE_TYPE_ATTR}="row"][${WORKSPACE_ROW_PARENT_ATTR}]`)
    if (rowNode) {
      const pid = rowNode.getAttribute(WORKSPACE_ROW_PARENT_ATTR)
      if (pid && pid !== sourceDatabaseId) return pid
    }
  }
  return null
}
