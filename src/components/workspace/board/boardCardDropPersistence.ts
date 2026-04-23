import type { WorkspaceNode } from '@/types/workspace'
import { cursorDebugLog } from '@/lib/cursorDebugLog'
import {
  applyCardDropToColumns,
  buildColumnRowIdMap,
  finalSiblingRowOrder,
  getRowSelectValue,
} from '../boardDragHelpers'
export type BoardCardDropPersistenceDeps = {
  activeId: string
  overId: string
  childrenSnapshot: WorkspaceNode[]
  optionIds: string[]
  groupFieldId: string
  databaseId: string
  updateCell: (
    rowId: string,
    fieldId: string,
    cellType: string,
    value: unknown,
    isPrimary?: boolean,
    cellExtras?: { formula?: string | null; evalError?: string | null } | null,
  ) => Promise<void>
  moveNode: (id: string, parentId: string | null, position: number) => Promise<WorkspaceNode>
  loadNodeChildren: (parentId: string) => Promise<void>
  toastError: (message: string) => void
  onFinished: () => void
}

/** Persists in-board card drag: column change + sibling order. Calls `onFinished` when done or on early exit. */
export async function persistBoardCardDropAfterDrag(deps: BoardCardDropPersistenceDeps): Promise<void> {
  const {
    activeId,
    overId,
    childrenSnapshot,
    optionIds,
    groupFieldId,
    databaseId,
    updateCell,
    moveNode,
    loadNodeChildren,
    toastError,
    onFinished,
  } = deps

  try {
    const columnMap = buildColumnRowIdMap(childrenSnapshot, groupFieldId, optionIds)
    const nextMap = applyCardDropToColumns(activeId, overId, optionIds, columnMap)
    if (!nextMap) {
      cursorDebugLog({
        hypothesisId: 'H3',
        location: 'boardCardDropPersistence.ts',
        message: 'applyCardDropToColumns_null',
        data: {
          activeId,
          overId,
          optionIdsLen: optionIds.length,
          columnMapKeys: optionIds.map((oid) => [oid, (columnMap.get(oid) ?? []).length] as const),
          activeInAnyColumn: optionIds.some((oid) => (columnMap.get(oid) ?? []).includes(activeId)),
        },
        runId: 'pre',
      })
      onFinished()
      return
    }
    const targetOpt = optionIds.find((oid) => nextMap.get(oid)?.includes(activeId))
    if (!targetOpt) {
      onFinished()
      return
    }
    const row = childrenSnapshot.find((r) => r.id === activeId)
    if (!row) {
      onFinished()
      return
    }
    const oldOpt = getRowSelectValue(row, groupFieldId)
    if (oldOpt !== targetOpt) {
      await updateCell(activeId, groupFieldId, 'single_select', targetOpt)
    }
    const finalOrder = finalSiblingRowOrder(optionIds, nextMap, childrenSnapshot)
    for (let i = 0; i < finalOrder.length; i++) {
      await moveNode(finalOrder[i], databaseId, i)
    }
    await loadNodeChildren(databaseId)
  } catch (e) {
    toastError(String(e))
    await loadNodeChildren(databaseId)
  } finally {
    onFinished()
  }
}
