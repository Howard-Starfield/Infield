import type { WorkspaceNode } from '@/types/workspace'

/** Droppable id prefix for each column's card list (empty space / below cards). Must match `BoardColumn` `useDroppable` ids. */
export const BOARD_COLUMN_BODY_PREFIX = 'board-col-body:'

/**
 * Pure helpers for board card/column layout persistence (`BoardView` dragEnd).
 * DnD uses nested `@dnd-kit` SortableContexts (columns + cards). Drops must resolve to a
 * **card** or **column** id; if narrow gutters make that unreliable, tune `collisionDetection`
 * in `BoardView` (e.g. `pointerWithin`) rather than changing this math.
 */
export function getRowSelectValue(row: WorkspaceNode, fieldId: string): string | null {
  const cells = JSON.parse(row.properties).cells ?? {}
  const cell = cells[fieldId]
  return (cell as { value?: string } | undefined)?.value ?? null
}

/** Row ids per single-select option, in current global sibling order within each bucket. */
export function buildColumnRowIdMap(
  children: WorkspaceNode[],
  fieldId: string,
  optionIds: string[],
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const oid of optionIds) map.set(oid, [])
  for (const row of children) {
    if (row.node_type !== 'row') continue
    const v = getRowSelectValue(row, fieldId)
    if (v !== null && map.has(v)) map.get(v)!.push(row.id)
  }
  return map
}

/**
 * Apply a card drop: remove active from its column, insert before `over` row or append if `over` is a column id.
 * Returns a new map, or null if the drop cannot be applied.
 */
export function applyCardDropToColumns(
  activeId: string,
  overId: string,
  optionIds: string[],
  columnMap: Map<string, string[]>,
): Map<string, string[]> | null {
  if (activeId === overId) return null

  const map = new Map<string, string[]>()
  for (const oid of optionIds) map.set(oid, [...(columnMap.get(oid) ?? [])])

  let fromCol: string | null = null
  let fromIdx = -1
  for (const oid of optionIds) {
    const list = map.get(oid)!
    const idx = list.indexOf(activeId)
    if (idx !== -1) {
      fromCol = oid
      fromIdx = idx
      break
    }
  }
  if (fromCol === null) return null

  map.get(fromCol)!.splice(fromIdx, 1)

  let targetCol: string | undefined
  let insertAt: number | undefined

  if (overId.startsWith(BOARD_COLUMN_BODY_PREFIX)) {
    const colId = overId.slice(BOARD_COLUMN_BODY_PREFIX.length)
    if (optionIds.includes(colId)) {
      targetCol = colId
      insertAt = map.get(targetCol)!.length
    }
  }

  if (targetCol === undefined && optionIds.includes(overId)) {
    targetCol = overId
    insertAt = map.get(targetCol)!.length
  }

  if (targetCol === undefined) {
    for (const oid of optionIds) {
      const list = map.get(oid)!
      const i = list.indexOf(overId)
      if (i !== -1) {
        targetCol = oid
        insertAt = i
        break
      }
    }
    if (targetCol === undefined || insertAt === undefined) return null
  }

  if (insertAt === undefined) return null

  map.get(targetCol)!.splice(insertAt, 0, activeId)
  return map
}

export function flattenBoardRowOrder(optionIds: string[], columnMap: Map<string, string[]>): string[] {
  return optionIds.flatMap((oid) => [...(columnMap.get(oid) ?? [])])
}

/** Board row order first (left-to-right columns), then rows not shown on the board (e.g. unset select). */
export function finalSiblingRowOrder(
  optionIds: string[],
  columnMap: Map<string, string[]>,
  children: WorkspaceNode[],
): string[] {
  const boardFlat = flattenBoardRowOrder(optionIds, columnMap)
  const onBoard = new Set(boardFlat)
  const others = children
    .filter((r) => r.node_type === 'row' && !onBoard.has(r.id))
    .sort((a, b) => a.position - b.position)
    .map((r) => r.id)
  return [...boardFlat, ...others]
}
