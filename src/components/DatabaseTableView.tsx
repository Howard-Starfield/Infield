/**
 * DatabaseTableView — TanStack Table v8 + react-virtual rendering of a
 * single database. ~50 rows in DOM at any time via row virtualization.
 *
 * Wires `useDatabase` cells/fields into `cellRenderers` per field type.
 * Right-click on a row opens a fixed-position context menu (Open / Delete).
 * Title cell click bubbles up via `onOpenRow` so the parent shell can
 * route to Notes view.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { Plus, Trash2 } from 'lucide-react'
import {
  CheckboxCell,
  DateCell,
  NumberCell,
  SelectCell,
  TextCell,
  UnsupportedCell,
} from '../database/cellRenderers'
import { useDatabase, type MutationKind, type RowMeta } from '../database/useDatabase'
import type { CellData, Field, FieldType } from '../bindings'

/// Field types the "+ Add column" picker offers. Mirrors backend FieldType
/// minus auto-only / specialised types (Protected, Media, Time-of-day, plus
/// the auto-fill timestamps LastEditedTime / CreatedTime, which the backend
/// populates without user-typed values). Order optimised for typical use.
const ADD_COLUMN_TYPES: { value: FieldType; label: string }[] = [
  { value: 'rich_text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'single_select', label: 'Single select' },
  { value: 'multi_select', label: 'Multi-select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'date_time', label: 'Date + time' },
  { value: 'url', label: 'URL' },
  // TODO: re-add 'checklist' once a real ChecklistCell renderer ships.
  // Today CellDispatcher falls through to UnsupportedCell for checklist
  // because TypeOption::Checklist has no item-storage shape and no UI.
]

interface Props {
  dbId: string
  onOpenRow: (rowId: string) => void
}

interface ContextMenuState {
  x: number
  y: number
  rowId: string
}

interface ColumnMenuState {
  x: number
  y: number
  fieldId: string
  isPrimary: boolean
}

/// Field types whose values fill copies cleanly with no extra context.
/// Other types (Media, Checklist, Url, complex formats) can be added later
/// — for now they simply opt out of the fill handle.
const FILLABLE_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'rich_text',
  'number',
  'checkbox',
  'single_select',
  'multi_select',
  'date',
  'date_time',
  'url',
])

const ROW_HEIGHT = 36
const DEFAULT_COL_WIDTH = 180
const MIN_COL_WIDTH = 60
const MAX_COL_WIDTH = 800

/// Build the localStorage key for a database's column-width map. One key
/// per database so widths don't leak across databases.
const colWidthsKey = (dbId: string) => `db-col-widths-${dbId}`

/// Read persisted column widths for a database (`Map<fieldId, px>`).
/// Returns an empty map on any error so the UI always has a fallback.
function loadColumnWidths(dbId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(colWidthsKey(dbId))
    return raw ? JSON.parse(raw) as Record<string, number> : {}
  } catch {
    return {}
  }
}

function saveColumnWidths(dbId: string, widths: Record<string, number>) {
  try {
    localStorage.setItem(colWidthsKey(dbId), JSON.stringify(widths))
  } catch {
    /* quota exceeded — non-fatal, widths just won't persist */
  }
}
const OVERSCAN = 10

export function DatabaseTableView({ dbId, onOpenRow }: Props) {
  const {
    fields,
    rowIndex,
    cells,
    cellsForRange,
    mutateCell,
    createRow,
    deleteRow,
    createField,
    renameField,
    deleteField,
    moveField,
  } = useDatabase(dbId)

  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [colMenu, setColMenu] = useState<ColumnMenuState | null>(null)
  const [addColOpen, setAddColOpen] = useState(false)
  const [addColName, setAddColName] = useState('')
  const [addColType, setAddColType] = useState<FieldType>('rich_text')
  const [colWidths, setColWidths] = useState<Record<string, number>>(() =>
    loadColumnWidths(dbId),
  )
  const [fillStartRowIdx, setFillStartRowIdx] = useState<number | null>(null)
  const [fillEndRowIdx, setFillEndRowIdx] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const addColInputRef = useRef<HTMLInputElement | null>(null)
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null)

  // Reload width map when switching databases — each db has its own
  // localStorage entry so user's table layout per database is preserved.
  useEffect(() => {
    setColWidths(loadColumnWidths(dbId))
  }, [dbId])

  const setColumnWidth = useCallback(
    (fieldId: string, width: number) => {
      const clamped = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, Math.round(width)))
      setColWidths(prev => {
        const next = { ...prev, [fieldId]: clamped }
        saveColumnWidths(dbId, next)
        return next
      })
    },
    [dbId],
  )

  // Dismiss the column-header context menu on any outside click / Escape.
  useEffect(() => {
    if (!colMenu) return
    const onDown = () => setColMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setColMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [colMenu])

  // Reset popover state whenever dbId changes — stale name/type from a
  // previous database would otherwise leak across the navigation.
  useEffect(() => {
    setAddColOpen(false)
    setAddColName('')
    setAddColType('rich_text')
  }, [dbId])

  // Auto-focus the name input when the popover opens.
  useEffect(() => {
    if (addColOpen) addColInputRef.current?.focus()
  }, [addColOpen])

  const handleAddColumnSubmit = useCallback(async () => {
    const name = addColName.trim()
    if (!name) return
    await createField(name, addColType)
    setAddColOpen(false)
    setAddColName('')
    setAddColType('rich_text')
  }, [addColName, addColType, createField])

  // Refs so the (stable) columns array can reach the latest cells map +
  // mutateCell at cell-render time without rebuilding every keystroke.
  const cellsRef = useRef(cells)
  const mutateCellRef = useRef(mutateCell)
  cellsRef.current = cells
  mutateCellRef.current = mutateCell

  // Resolve the column-width source so the header renderer can pull the
  // current px width without rebuilding the columns array on every drag tick.
  const colWidthsRef = useRef(colWidths)
  colWidthsRef.current = colWidths

  const primaryField = useMemo(() => fields.find(f => f.is_primary) ?? null, [fields])

  const columns = useMemo<ColumnDef<RowMeta>[]>(() => {
    const cols: ColumnDef<RowMeta>[] = []
    if (primaryField) {
      cols.push({
        id: primaryField.id,
        header: () => (
          <ColumnHeader
            field={primaryField}
            width={colWidthsRef.current[primaryField.id] ?? DEFAULT_COL_WIDTH}
            onRename={renameField}
            onResize={setColumnWidth}
            onOpenMenu={setColMenu}
          />
        ),
        cell: ({ row }) => (
          <span
            className="db-table__title-cell"
            onClick={() => onOpenRow(row.original.id)}
          >
            {row.original.title || 'Untitled'}
          </span>
        ),
      })
    }
    fields
      .filter(f => !f.is_primary)
      .forEach(field => {
        cols.push({
          id: field.id,
          header: () => (
            <ColumnHeader
              field={field}
              width={colWidthsRef.current[field.id] ?? DEFAULT_COL_WIDTH}
              onRename={renameField}
              onResize={setColumnWidth}
              onOpenMenu={setColMenu}
            />
          ),
          cell: ({ row }) => {
            const cellValue = cellsRef.current.get(row.original.id)?.get(field.id)
            return (
              <CellDispatcher
                field={field}
                rowId={row.original.id}
                cellValue={cellValue}
                onMutateCell={mutateCellRef.current}
              />
            )
          },
        })
      })
    return cols
    // Intentionally excluding `cells`, `cellsVersion`, `mutateCell`, and
    // `colWidths` from deps — ref-piped at render time so columns stay stable
    // across keystrokes / resize drags.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, primaryField, onOpenRow, renameField, setColumnWidth])

  const table = useReactTable({
    data: rowIndex,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: row => row.id,
  })

  // dnd-kit sensors. activationConstraint: distance=4 lets a 4px drag start
  // a sortable, while pointer-down on the resize handle (which stops
  // propagation) bypasses it. Same threshold pattern as DatabaseBoardView.
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  // Sortable order is the non-primary fields. Primary field is fixed in
  // first position (not part of the sortable context).
  const sortableFieldIds = useMemo(
    () => fields.filter(f => !f.is_primary).map(f => f.id),
    [fields],
  )

  const handleColumnDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      // moveField positions are 0-indexed across ALL fields including
      // the primary. Add 1 to the non-primary index to leave the primary
      // field anchored at position 0.
      const newIndexInNonPrimary = sortableFieldIds.indexOf(String(over.id))
      if (newIndexInNonPrimary === -1) return
      const targetPosition = newIndexInNonPrimary + 1
      void moveField(String(active.id), targetPosition)
    },
    [moveField, sortableFieldIds],
  )

  const handleDeleteColumn = useCallback(
    (fieldId: string) => {
      setColMenu(null)
      void deleteField(fieldId)
    },
    [deleteField],
  )

  const tableRowIds = useMemo(() => rowIndex.map(r => r.id), [rowIndex])

  // Pointerdown on a fill handle starts a drag. The handle's data-row-idx /
  // data-field-id attrs identify the source cell — no "active cell" state
  // needed, so plain clicks on cells stay inert and don't re-render their
  // editors. We track the cursor's y against rendered <tr> rects to find
  // the inclusive end-row, and on pointerup copy the source value into
  // (startIdx, endIdx]. Hover-only visibility is purely CSS.
  const handleFillPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const handle = e.currentTarget
      const fieldId = handle.dataset.fieldId
      const startIdxAttr = handle.dataset.rowIdx
      if (!fieldId || startIdxAttr == null) return
      const startIdx = parseInt(startIdxAttr, 10)
      if (!Number.isFinite(startIdx) || startIdx < 0) return
      const startRowId = tableRowIds[startIdx]
      if (!startRowId) return
      const sourceValue = cellsRef.current.get(startRowId)?.get(fieldId)
      if (!sourceValue) return // nothing to fill

      e.preventDefault()
      e.stopPropagation()
      setFillStartRowIdx(startIdx)

      const computeRowIdxFromPointer = (clientY: number): number => {
        const tbody = tbodyRef.current
        if (!tbody) return startIdx
        const trs = tbody.querySelectorAll<HTMLTableRowElement>('tr[data-row-idx]')
        let best = startIdx
        for (const tr of trs) {
          const r = tr.getBoundingClientRect()
          if (clientY >= r.top) {
            const idxAttr = tr.getAttribute('data-row-idx')
            if (idxAttr !== null) best = parseInt(idxAttr, 10)
          }
        }
        return best
      }

      const onMove = (ev: PointerEvent) => {
        setFillEndRowIdx(Math.max(startIdx, computeRowIdxFromPointer(ev.clientY)))
      }
      const onUp = (ev: PointerEvent) => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        const endIdx = Math.max(startIdx, computeRowIdxFromPointer(ev.clientY))
        setFillEndRowIdx(null)
        setFillStartRowIdx(null)
        if (endIdx <= startIdx) return
        const targets = tableRowIds.slice(startIdx + 1, endIdx + 1)
        for (const rowId of targets) {
          void mutateCellRef.current(rowId, fieldId, sourceValue, 'immediate')
        }
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [tableRowIds],
  )

  const { rows: tableRows } = table.getRowModel()

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // Trigger cellsForRange ONLY when the visible range changes. Tracking the
  // (start, end) tuple in a ref avoids effect loops driven by cellsVersion.
  const lastRangeRef = useRef<{ start: number; end: number } | null>(null)
  useEffect(() => {
    if (virtualItems.length === 0) return
    const start = virtualItems[0].index
    const end = virtualItems[virtualItems.length - 1].index
    const last = lastRangeRef.current
    if (last && last.start === start && last.end === end) return
    lastRangeRef.current = { start, end }
    cellsForRange(start, end)
  }, [virtualItems, cellsForRange])

  // Close the context menu on any subsequent click anywhere, or on Escape.
  useEffect(() => {
    if (!menu) return
    const closeOnClick = () => setMenu(null)
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('click', closeOnClick)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('click', closeOnClick)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menu])

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent<HTMLTableRowElement>, rowId: string) => {
      // Allow native browser context menu inside editable surfaces (text cell
      // contenteditable, number input, date input) so users keep cut/copy/paste.
      const target = e.target as HTMLElement
      if (target.closest('[contenteditable="true"], input, textarea')) return
      e.preventDefault()
      // Clamp to viewport so the menu doesn't render off-screen near edges.
      const MENU_W = 160
      const MENU_H = 80
      const x = Math.min(e.clientX, window.innerWidth - MENU_W - 4)
      const y = Math.min(e.clientY, window.innerHeight - MENU_H - 4)
      setMenu({ x, y, rowId })
    },
    [],
  )

  const handleMenuOpen = useCallback(() => {
    if (!menu) return
    onOpenRow(menu.rowId)
    setMenu(null)
  }, [menu, onOpenRow])

  const handleMenuDelete = useCallback(() => {
    if (!menu) return
    void deleteRow(menu.rowId)
    setMenu(null)
  }, [menu, deleteRow])

  const totalSize = virtualizer.getTotalSize()
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0

  return (
    <>
      <div ref={scrollRef} className="db-table-scroll">
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleColumnDragEnd}
        >
          <SortableContext
            items={sortableFieldIds}
            strategy={horizontalListSortingStrategy}
          >
        <table className="db-table">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <th key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
                <th className="db-table__add-col-cell">
                  <button
                    type="button"
                    className="db-table__add-col-btn"
                    title="Add column"
                    onClick={() => setAddColOpen(prev => !prev)}
                  >
                    <Plus size={14} />
                  </button>
                  {addColOpen && (
                    <div
                      className="db-add-col-popover"
                      onClick={e => e.stopPropagation()}
                    >
                      <input
                        ref={addColInputRef}
                        type="text"
                        className="db-add-col-popover__input"
                        placeholder="Column name"
                        value={addColName}
                        onChange={e => setAddColName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') void handleAddColumnSubmit()
                          else if (e.key === 'Escape') setAddColOpen(false)
                        }}
                      />
                      <select
                        className="db-add-col-popover__type"
                        value={addColType}
                        onChange={e => setAddColType(e.target.value as FieldType)}
                      >
                        {ADD_COLUMN_TYPES.map(t => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <div className="db-add-col-popover__actions">
                        <button
                          type="button"
                          className="db-add-col-popover__cancel"
                          onClick={() => setAddColOpen(false)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="db-add-col-popover__submit"
                          onClick={() => void handleAddColumnSubmit()}
                          disabled={!addColName.trim()}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  )}
                </th>
              </tr>
            ))}
          </thead>
          <tbody ref={tbodyRef}>
            {paddingTop > 0 && (
              <tr style={{ height: paddingTop }} aria-hidden="true">
                <td colSpan={columns.length + 1} />
              </tr>
            )}
            {virtualItems.map(virtualRow => {
              const row = tableRows[virtualRow.index]
              const rowIdx = virtualRow.index
              const isInFillRange =
                fillEndRowIdx != null &&
                fillStartRowIdx != null &&
                rowIdx > fillStartRowIdx &&
                rowIdx <= fillEndRowIdx
              return (
                <tr
                  key={row.id}
                  data-row-idx={rowIdx}
                  className={isInFillRange ? 'db-table__row--fill-preview' : undefined}
                  style={{ height: ROW_HEIGHT }}
                  onContextMenu={e => handleRowContextMenu(e, row.original.id)}
                >
                  {row.getVisibleCells().map(cell => {
                    const fieldId = cell.column.id
                    const field = fields.find(f => f.id === fieldId)
                    const isFillable =
                      !!field && FILLABLE_FIELD_TYPES.has(field.field_type)
                    return (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        {isFillable && (
                          <div
                            className="db-fill-handle"
                            data-row-idx={rowIdx}
                            data-field-id={fieldId}
                            onPointerDown={handleFillPointerDown}
                            title="Drag to fill below"
                          />
                        )}
                      </td>
                    )
                  })}
                  {/* Trailing cell aligned with the "+ Add column" header. */}
                  <td className="db-table__add-col-spacer" />
                </tr>
              )
            })}
            {paddingBottom > 0 && (
              <tr style={{ height: paddingBottom }} aria-hidden="true">
                <td colSpan={columns.length + 1} />
              </tr>
            )}
          </tbody>
        </table>
          </SortableContext>
        </DndContext>
      </div>

      {colMenu && (
        <div
          className="db-context-menu"
          style={{ left: colMenu.x, top: colMenu.y }}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            type="button"
            className="db-context-menu__item db-context-menu__item--danger"
            disabled={colMenu.isPrimary}
            title={colMenu.isPrimary ? 'The primary column cannot be deleted' : 'Delete this column'}
            onClick={() => handleDeleteColumn(colMenu.fieldId)}
          >
            <Trash2 size={12} /> Delete column
          </button>
        </div>
      )}

      <div className="db-footer">
        <span>{rowIndex.length} rows</span>
        <button
          type="button"
          className="db-footer__add-row"
          onClick={() => void createRow()}
        >
          + New row
        </button>
      </div>

      {menu && (
        <div
          className="db-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            className="db-context-menu__item"
            onClick={handleMenuOpen}
          >
            Open
          </button>
          <button
            type="button"
            className="db-context-menu__item db-context-menu__item--danger"
            onClick={handleMenuDelete}
          >
            Delete
          </button>
        </div>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// CellDispatcher — chooses the right renderer for a (row, field) pair
// and wraps the cellRenderer onChange callbacks back into CellData
// for mutateCell.
// ─────────────────────────────────────────────────────────────────────

interface CellDispatcherProps {
  field: Field
  rowId: string
  cellValue: CellData | undefined
  onMutateCell: (rowId: string, fieldId: string, data: CellData, kind: MutationKind) => Promise<void>
}

const CellDispatcher = memo(
  function CellDispatcher({ field, rowId, cellValue, onMutateCell }: CellDispatcherProps) {
    const cell = cellValue ?? null

    switch (field.field_type) {
      case 'rich_text': {
        const value = cell && cell.type === 'rich_text' ? cell.value : ''
        return (
          <TextCell
            fieldId={field.id}
            rowId={rowId}
            value={value}
            onChange={(next, kind) =>
              void onMutateCell(rowId, field.id, { type: 'rich_text', value: next }, kind)
            }
          />
        )
      }
      case 'number': {
        const value = cell && cell.type === 'number' ? cell.value : null
        return (
          <NumberCell
            fieldId={field.id}
            rowId={rowId}
            value={value}
            onChange={(next, kind) => {
              // NumberCell drops empty input (Fix 4); a non-finite next is
              // also defensively guarded here so we never send NaN/0 through
              // the wire on a stray onChange.
              if (next == null || !Number.isFinite(next)) return
              void onMutateCell(rowId, field.id, { type: 'number', value: next }, kind)
            }}
          />
        )
      }
      case 'date': {
        // Branch on field_type: a `date` field stores `{ type: 'date', value }`,
        // not `date_time`. Reading or writing the wrong variant silently corrupts
        // the cell on save.
        const value = cell && cell.type === 'date' ? cell.value : null
        return (
          <DateCell
            fieldId={field.id}
            rowId={rowId}
            value={value}
            mode="date"
            onChange={(next, kind) => {
              if (next == null) return
              void onMutateCell(rowId, field.id, { type: 'date', value: next }, kind)
            }}
          />
        )
      }
      case 'date_time': {
        const value = cell && cell.type === 'date_time' ? cell.value : null
        return (
          <DateCell
            fieldId={field.id}
            rowId={rowId}
            value={value}
            mode="date_time"
            onChange={(next, kind) => {
              if (next == null) return
              void onMutateCell(rowId, field.id, { type: 'date_time', value: next }, kind)
            }}
          />
        )
      }
      case 'checkbox': {
        const value = cell && cell.type === 'checkbox' ? cell.value : false
        return (
          <CheckboxCell
            fieldId={field.id}
            rowId={rowId}
            value={value}
            onChange={(next, kind) =>
              void onMutateCell(rowId, field.id, { type: 'checkbox', value: next }, kind)
            }
          />
        )
      }
      case 'single_select': {
        const value = cell && cell.type === 'single_select' ? cell.value : null
        return (
          <SelectCell
            fieldId={field.id}
            rowId={rowId}
            field={field}
            value={value}
            onChange={(next, kind) => {
              if (typeof next !== 'string' || next == null) return
              void onMutateCell(rowId, field.id, { type: 'single_select', value: next }, kind)
            }}
          />
        )
      }
      case 'multi_select': {
        const value = cell && cell.type === 'multi_select' ? cell.value : []
        return (
          <SelectCell
            fieldId={field.id}
            rowId={rowId}
            field={field}
            value={value}
            onChange={(next, kind) => {
              const arr = Array.isArray(next) ? next : []
              void onMutateCell(rowId, field.id, { type: 'multi_select', value: arr }, kind)
            }}
          />
        )
      }
      default:
        return <UnsupportedCell fieldId={field.id} rowId={rowId} cell={cell} />
    }
  },
  (prev, next) =>
    // Fine-grained equality: only re-render this leaf when its own (row, field,
    // value, type) changes. Comparing `cellValue` reference works because the
    // cells map is rebuilt with new inner Maps on every mutation in useDatabase.
    prev.field.id === next.field.id &&
    prev.rowId === next.rowId &&
    prev.cellValue === next.cellValue &&
    prev.field.field_type === next.field.field_type,
)

// ─── ColumnHeader ──────────────────────────────────────────────────────────
// Sortable column header with three behaviours:
//   - Double-click → inline rename (Enter saves, Escape cancels)
//   - Right-click → context menu with "Delete column" (primary disabled)
//   - Drag right edge → resize, persisted via setColumnWidth
// The whole header is a dnd-kit sortable item so dragging the body of the
// header reorders the column. The resize handle on the right edge stops
// pointerdown propagation so resize and reorder don't conflict.

interface ColumnHeaderProps {
  field: Field
  width: number
  onRename: (fieldId: string, newName: string) => Promise<void>
  onResize: (fieldId: string, width: number) => void
  onOpenMenu: (state: ColumnMenuState) => void
}

function ColumnHeader({ field, width, onRename, onResize, onOpenMenu }: ColumnHeaderProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(field.name)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // dnd-kit sortable wiring. Disabled while editing/resizing so those
  // interactions don't trigger an accidental drag.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
    disabled: editing || field.is_primary,
  })

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else {
      setDraft(field.name)
    }
  }, [editing, field.name])

  const submit = useCallback(async () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== field.name) {
      await onRename(field.id, trimmed)
    }
  }, [draft, field.id, field.name, onRename])

  const onContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const x = Math.min(e.clientX, window.innerWidth - 200)
      const y = Math.min(e.clientY, window.innerHeight - 80)
      onOpenMenu({ x, y, fieldId: field.id, isPrimary: field.is_primary })
    },
    [field.id, field.is_primary, onOpenMenu],
  )

  // Resize handle: pointer-down captures the mouse and updates width on move.
  // Stops propagation so it doesn't start a sortable drag.
  const onResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startW = width
      const onMove = (ev: PointerEvent) => {
        onResize(field.id, startW + (ev.clientX - startX))
      }
      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    },
    [field.id, onResize, width],
  )

  const style: React.CSSProperties = {
    width,
    minWidth: width,
    transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.5 : undefined,
    cursor: editing ? 'text' : field.is_primary ? 'default' : 'grab',
  }

  return (
    <div
      ref={setNodeRef}
      className="db-col-header"
      style={style}
      onDoubleClick={() => setEditing(true)}
      onContextMenu={onContextMenu}
      {...attributes}
      {...listeners}
    >
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          className="db-col-header__input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => void submit()}
          onKeyDown={e => {
            if (e.key === 'Enter') void submit()
            else if (e.key === 'Escape') {
              setDraft(field.name)
              setEditing(false)
            }
          }}
          // Don't let the inline input bubble pointer events to the
          // sortable wrapper.
          onPointerDown={e => e.stopPropagation()}
        />
      ) : (
        <span className="db-col-header__label" title="Double-click to rename, right-click for menu">
          {field.name}
        </span>
      )}
      <div
        className="db-col-header__resize"
        onPointerDown={onResizeStart}
        onClick={e => e.stopPropagation()}
        onDoubleClick={e => e.stopPropagation()}
      />
    </div>
  )
}
