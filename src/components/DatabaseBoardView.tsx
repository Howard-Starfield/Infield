/**
 * DatabaseBoardView — kanban board for the W4 Databases surface.
 *
 * Columns are derived from the first SingleSelect field in the database
 * (per spec §3). Cards are draggable across columns via dnd-kit:
 *   - Drop into a different column → moveRowGroup writes the new option id.
 *   - Reorder within a column → no-op for W4 (deferred until reorderRows
 *     command exists; see commit message).
 *   - Per-column "+" creates a row pre-tagged with that option id.
 *
 * Read-first: pitfall.md "Tree drag-and-drop" — board uses
 * `verticalListSortingStrategy` (cards SHOULD shift to show drop target,
 * the OPPOSITE of the tree). DragOverlay disables drop animation.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from './EmptyState'
import { useDatabase, type RowMeta } from '../database/useDatabase'
import type { Field, SelectOption } from '../bindings'

interface Props {
  dbId: string
  onOpenRow: (rowId: string) => void
}

// Pointer-first collision: cards travel under the cursor; fall back to
// closest-centre when the pointer is in the gap between cards.
const boardCollisionDetection: CollisionDetection = args => {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : closestCenter(args)
}

const NULL_COLUMN_ID = '__nogroup__'
const COLUMN_DROPPABLE_PREFIX = 'board-column-'

function optionsFor(field: Field): SelectOption[] {
  const t = field.type_option
  if (t.type === 'single_select' || t.type === 'multi_select') return t.config.options
  return []
}

interface ColumnDescriptor {
  id: string // option id, or NULL_COLUMN_ID for ungrouped
  option: SelectOption | null
  rows: RowMeta[]
}

export function DatabaseBoardView({ dbId, onOpenRow }: Props) {
  const {
    fields,
    rowIndex,
    cells,
    cellsVersion,
    cellsForRange,
    createRowInGroup,
    moveRowGroup,
  } = useDatabase(dbId)

  const groupField = useMemo(
    () => fields.find(f => f.field_type === 'single_select') ?? null,
    [fields],
  )

  // Board needs every row's group-key — fetch the whole range on mount /
  // when row count changes. Tracked in a ref so we don't refetch when only
  // cellsVersion bumps.
  const lastFetchKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!groupField || rowIndex.length === 0) return
    const key = `${groupField.id}:${rowIndex.length}`
    if (lastFetchKeyRef.current === key) return
    lastFetchKeyRef.current = key
    cellsForRange(0, rowIndex.length - 1)
  }, [groupField, rowIndex.length, cellsForRange])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const columns = useMemo<ColumnDescriptor[]>(() => {
    if (!groupField) return []
    const opts = optionsFor(groupField)
    const buckets = new Map<string, RowMeta[]>()
    buckets.set(NULL_COLUMN_ID, [])
    for (const opt of opts) buckets.set(opt.id, [])
    for (const row of rowIndex) {
      const cell = cells.get(row.id)?.get(groupField.id)
      const optionId = cell?.type === 'single_select' ? cell.value : null
      const bucketKey = optionId && buckets.has(optionId) ? optionId : NULL_COLUMN_ID
      buckets.get(bucketKey)!.push(row)
    }
    const result: ColumnDescriptor[] = opts.map(opt => ({
      id: opt.id,
      option: opt,
      rows: buckets.get(opt.id) ?? [],
    }))
    result.push({ id: NULL_COLUMN_ID, option: null, rows: buckets.get(NULL_COLUMN_ID) ?? [] })
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupField?.id, rowIndex, cellsVersion])

  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const activeRow = useMemo(
    () => (activeRowId ? rowIndex.find(r => r.id === activeRowId) ?? null : null),
    [activeRowId, rowIndex],
  )

  // Stable handler so React.memo on SortableCard holds equality across re-renders.
  const stableOnOpenRow = useCallback(
    (rowId: string) => onOpenRow(rowId),
    [onOpenRow],
  )

  // One-time notice flags for silent no-ops (drop into "No status" + within-column reorder).
  // Refs persist across renders, debounce naturally — first drop teaches; subsequent ones stay silent.
  const noticeShownRef = useRef({ droppedToNull: false, reorderedWithin: false })

  if (!groupField) {
    return (
      <EmptyState
        variant="empty-inbox"
        title="No SingleSelect field"
        description="Add a SingleSelect field to this database to use the Board view."
        compact
      />
    )
  }

  const handleDragStart = (event: DragStartEvent) => {
    setActiveRowId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveRowId(null)
    const { active, over } = event
    if (!over || !groupField) return

    const draggedRowId = String(active.id)
    const overId = String(over.id)

    // Resolve target column id. Two cases:
    //   1. Dropped on a column droppable → id = "board-column-<optId>"
    //   2. Dropped on another card → look up the card's current column.
    let targetColumnId: string | null = null
    if (overId.startsWith(COLUMN_DROPPABLE_PREFIX)) {
      targetColumnId = overId.slice(COLUMN_DROPPABLE_PREFIX.length)
    } else {
      // Card-on-card: find which column the over-card lives in.
      for (const col of columns) {
        if (col.rows.some(r => r.id === overId)) {
          targetColumnId = col.id
          break
        }
      }
    }
    if (targetColumnId == null) return

    // Resolve current column for the dragged row.
    let sourceColumnId: string | null = null
    for (const col of columns) {
      if (col.rows.some(r => r.id === draggedRowId)) {
        sourceColumnId = col.id
        break
      }
    }

    if (sourceColumnId === targetColumnId) {
      // Within-column reorder: deferred until a reorderRows command exists.
      // No-op for W4 — cards visually settle back to their stored position.
      // One-time toast so the silence doesn't read as a bug.
      if (!noticeShownRef.current.reorderedWithin) {
        toast.info('Reordering within a column will arrive in a future update.')
        noticeShownRef.current.reorderedWithin = true
      }
      return
    }

    // Cross-column move. The NULL bucket maps to "clear the cell"; the
    // backend's update_cell for single_select expects a non-empty option
    // id, so for now we only commit moves into a real option column.
    if (targetColumnId === NULL_COLUMN_ID) {
      if (!noticeShownRef.current.droppedToNull) {
        toast.info('Drop into a status column to change status. Editing the status to "none" must be done in the row.')
        noticeShownRef.current.droppedToNull = true
      }
      return
    }
    void moveRowGroup(draggedRowId, groupField.id, targetColumnId)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveRowId(null)}
    >
      <div className="db-board">
        {columns.map(col => (
          <BoardColumn
            key={col.id}
            column={col}
            onOpenRow={stableOnOpenRow}
            onAddRow={() => {
              if (!groupField) return
              if (col.id === NULL_COLUMN_ID) return
              void createRowInGroup(groupField.id, col.id)
            }}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeRow ? (
          <div className="db-board__card db-board__card--dragging">
            <span className="db-board__card-title">
              {activeRow.title || 'Untitled'}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

// ─────────────────────────────────────────────────────────────────────
// BoardColumn — droppable container + sortable card list per option.
// Distinct ids: SortableContext id ≠ useSortable item id (pitfall.md).
// ─────────────────────────────────────────────────────────────────────

interface BoardColumnProps {
  column: ColumnDescriptor
  onOpenRow: (rowId: string) => void
  onAddRow: () => void
}

function BoardColumn({ column, onOpenRow, onAddRow }: BoardColumnProps) {
  const droppableId = `${COLUMN_DROPPABLE_PREFIX}${column.id}`
  const { setNodeRef } = useDroppable({ id: droppableId })

  const colorVar = column.option
    ? `var(--select-color-${column.option.color})`
    : 'transparent'

  return (
    <div className="db-board__col">
      <div className="db-board__col-head">
        <span
          aria-hidden="true"
          className="db-board__col-dot"
          // Rule 12 carve-out: data-driven color resolves to a token via the
          // `--select-color-${color}` family declared in App.css :root.
          style={{ background: colorVar }}
        />
        <span>{column.option ? column.option.name : 'No status'}</span>
        <span className="db-board__col-count">{column.rows.length}</span>
        {column.option && (
          <button
            type="button"
            className="db-board__col-add"
            onClick={onAddRow}
            aria-label={`Add row to ${column.option.name}`}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      <SortableContext
        id={droppableId}
        items={column.rows.map(r => r.id)}
        strategy={verticalListSortingStrategy}
      >
        <div ref={setNodeRef} className="db-board__cards">
          {column.rows.map(row => (
            <SortableCard key={row.id} row={row} onOpenRow={onOpenRow} />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// SortableCard — single draggable card.
// ─────────────────────────────────────────────────────────────────────

interface SortableCardProps {
  row: RowMeta
  onOpenRow: (rowId: string) => void
}

const SortableCard = memo(function SortableCard({ row, onOpenRow }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: row.id })
  return (
    <div
      ref={setNodeRef}
      className={
        isDragging ? 'db-board__card db-board__card--dragging' : 'db-board__card'
      }
      {...attributes}
      {...listeners}
    >
      <span
        className="db-board__card-title"
        // Stop the click from registering as a drag activator before the
        // PointerSensor distance threshold (4px) — bare clicks open the row.
        onPointerDown={e => e.stopPropagation()}
        onClick={() => onOpenRow(row.id)}
      >
        {row.title || 'Untitled'}
      </span>
    </div>
  )
})
