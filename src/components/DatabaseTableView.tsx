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
import { Plus } from 'lucide-react'
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
  { value: 'checklist', label: 'Checklist' },
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

const ROW_HEIGHT = 36
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
  } = useDatabase(dbId)

  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [addColOpen, setAddColOpen] = useState(false)
  const [addColName, setAddColName] = useState('')
  const [addColType, setAddColType] = useState<FieldType>('rich_text')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const addColInputRef = useRef<HTMLInputElement | null>(null)

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

  const columns = useMemo<ColumnDef<RowMeta>[]>(() => {
    const cols: ColumnDef<RowMeta>[] = [
      {
        id: '__title',
        header: 'Title',
        cell: ({ row }) => (
          <span
            className="db-table__title-cell"
            onClick={() => onOpenRow(row.original.id)}
          >
            {row.original.title || 'Untitled'}
          </span>
        ),
      },
      ...fields
        .filter(f => !f.is_primary)
        .map<ColumnDef<RowMeta>>(field => ({
          id: field.id,
          header: field.name,
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
        })),
    ]
    return cols
    // Intentionally excluding `cells`, `cellsVersion`, and `mutateCell` from deps —
    // ref-piped at render time so columns stay stable across keystrokes,
    // avoiding a TanStack column-model rebuild per cell mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, onOpenRow])

  const table = useReactTable({
    data: rowIndex,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: row => row.id,
  })

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
          <tbody>
            {paddingTop > 0 && (
              <tr style={{ height: paddingTop }} aria-hidden="true">
                <td colSpan={columns.length + 1} />
              </tr>
            )}
            {virtualItems.map(virtualRow => {
              const row = tableRows[virtualRow.index]
              return (
                <tr
                  key={row.id}
                  style={{ height: ROW_HEIGHT }}
                  onContextMenu={e => handleRowContextMenu(e, row.original.id)}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
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
      </div>

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
