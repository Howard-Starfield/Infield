import { invoke } from '@tauri-apps/api/core'
import type { WorkspaceNode } from '@/types/workspace'
import { cursorDebugLog } from '@/lib/cursorDebugLog'
import { resolveCrossDatabaseDropTarget } from './boardCrossWorkspaceDrop'

export type CrossDatabaseBoardDropDeps = {
  databaseId: string
  rowId: string
  /** From `useBoardDragPointerTracking` at drag end */
  pointer: { x: number; y: number } | null
  /** If kit reported a same-context target, skip cross-db */
  over: unknown
  moveNode: (id: string, parentId: string | null, position: number) => Promise<WorkspaceNode>
  loadNodeChildren: (parentId: string) => Promise<void>
  successMessage: string
  toastSuccess: (message: string) => void
  toastError: (message: string) => void
  onFinished: () => void
}

/**
 * When a card drag ends with `over == null`, try reparenting the row onto another database
 * under the pointer (tree or another board strip). Returns true if async work was started.
 */
export function startCrossDatabaseBoardDropIfNeeded(deps: CrossDatabaseBoardDropDeps): boolean {
  const {
    databaseId,
    rowId,
    pointer,
    over,
    successMessage,
    moveNode,
    loadNodeChildren,
    toastSuccess,
    toastError,
    onFinished,
  } = deps
  if (over || !pointer) return false

  const targetDb = resolveCrossDatabaseDropTarget(pointer.x, pointer.y, databaseId)
  cursorDebugLog({
    hypothesisId: 'H_cross_db',
    location: 'applyCrossDatabaseBoardDrop.ts',
    message: 'board_cross_db_probe',
    data: { databaseId, rowId, ptr: pointer, targetDb },
    runId: 'pre',
  })

  if (!targetDb) return false

  void (async () => {
    try {
      const siblings = await invoke<WorkspaceNode[]>('get_node_children', { parentId: targetDb })
      const rowSiblings = siblings.filter((n) => n.node_type === 'row')
      const maxPos = rowSiblings.length ? Math.max(...rowSiblings.map((r) => r.position)) : -1
      await moveNode(rowId, targetDb, maxPos + 1)
      await loadNodeChildren(databaseId)
      toastSuccess(successMessage)
    } catch (e) {
      toastError(String(e))
      await loadNodeChildren(databaseId)
    } finally {
      onFinished()
    }
  })()

  return true
}
