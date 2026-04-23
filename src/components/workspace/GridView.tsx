import '@glideapps/glide-data-grid/dist/index.css'

import { convertFileSrc } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { CheckSquare, Plus, Trash2, X } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  GridColumnIcon,
  ImageWindowLoaderImpl,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Highlight,
  type Item,
  type DataEditorRef,
  type EditableGridCell,
  type EditListItem,
  TextCellEntry,
} from '@glideapps/glide-data-grid'
import type { HeaderClickedEventArgs, Rectangle } from '@glideapps/glide-data-grid'
import { getFieldTypeCatalogEntry } from '@/lib/fieldTypeCatalog'
import { isBoardColumnFieldType } from '@/lib/workspaceFieldSelect'
import { workspaceDataGridTheme } from '@/lib/workspaceAppearance'
import { useWorkspaceAppearanceStore } from '@/stores/workspaceAppearanceStore'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { evaluateSameRowFormulas, excelColumnLetter } from '@/lib/workspaceFormulas'
import { extractCellFormula, hasCellFormula } from '@/lib/workspaceCellPayload'
import { parseDatabaseProperties, parseRowProperties, type Field, type WorkspaceNode } from '../../types/workspace'
import { extractCellValue } from './GridCell'
import {
  buildHandyWorkspaceGridCell,
  clampGlideOverlayToTarget,
  handyEditToPersistedValue,
  handyWorkspaceCustomRenderer,
  isHandyWsData,
  provideHandyWorkspaceEditor,
} from './workspaceGlideHandy'
import { FieldEditorPopover } from './FieldEditorPopover'
import { RowActionMenu } from './RowActionMenu'

interface Props {
  databaseId: string
  viewId: string
  filteredRows: WorkspaceNode[]
}

/** Imperative hooks for DatabaseShell (e.g. commit overlay edits before switching views). */
export type GridViewHandle = {
  flushPendingCellEdit: () => void
}

const DEFAULT_COL_WIDTH = 180

/** Literal colors only — canvas `fillStyle` cannot use `var(...)`. Matches `:root --workspace-cream` in App.css. */
const GRID_TOOLBAR_H = 0
const SELECTION_BAR_H = 42
/** Always-on formula / cell-address strip (same height reserved in `chromeTop`). */
const FORMULA_BAR_H = 26
/** Thin vertical accent left of the Glide row-marker (checkbox) column. */
const ROW_MARKER_STRIP_W = 4
/** Inset Glide’s portal overlay inside `target` so it does not paint over 1px grid lines (feels “enlarged”). */
const GLIDE_OVERLAY_INSET_PX = 1
const GRID_HEADER_H = 30
/** Extra header strip when any column has a `group` label (Glide column groups). */
const GROUP_HEADER_H = 24

const SUPPORTED_GRID_IMAGE_MIME = new Set([
  'image/png',
  'image/gif',
  'image/bmp',
  'image/jpeg',
  'image/jpg',
  'image/webp',
])

const EMPTY_GRID_SELECTION: GridSelection = {
  columns: CompactSelection.empty(),
  rows: CompactSelection.empty(),
  current: undefined,
}

/** All data column indices for `remeasureColumns` after header/schema changes. */
function compactSelectionAllColumns(colCount: number): CompactSelection {
  if (colCount <= 0) return CompactSelection.empty()
  if (colCount === 1) return CompactSelection.fromSingleSelection(0)
  return CompactSelection.fromSingleSelection([0, colCount - 1])
}

function fieldTypeToGridIcon(fieldType: Field['field_type']): GridColumnIcon {
  switch (fieldType) {
    case 'number':
      return GridColumnIcon.HeaderNumber
    case 'checkbox':
      return GridColumnIcon.HeaderBoolean
    case 'date':
    case 'date_time':
      return GridColumnIcon.HeaderDate
    case 'time':
      return GridColumnIcon.HeaderTime
    case 'url':
      return GridColumnIcon.HeaderUri
    case 'media':
      return GridColumnIcon.HeaderImage
    case 'board':
    case 'single_select':
    case 'multi_select':
      return GridColumnIcon.HeaderArray
    case 'protected':
      return GridColumnIcon.HeaderCode
    default:
      return GridColumnIcon.HeaderString
  }
}

function displayForField(field: Field, rawCell: unknown, formulaDisplayOverride?: string): string {
  if (formulaDisplayOverride !== undefined) return formulaDisplayOverride
  const v = extractCellValue(rawCell)
  if (v === null || v === undefined) return ''
  if (isBoardColumnFieldType(field.field_type)) {
    const opt = field.type_option?.options?.find((o: { id: string }) => o.id === v)
    return opt?.name ?? String(v)
  }
  if (field.field_type === 'checkbox') return v === true ? 'Yes' : ''
  if (field.field_type === 'protected') return ''
  return String(v)
}

function readOnlyField(field: Field): boolean {
  return field.field_type === 'last_edited_time' || field.field_type === 'created_time'
}

const DEFAULT_PRIMARY_GRID_HEADER_NAME = 'Name'

function gridColumnHeaderTitle(field: Field, t: (key: string, defaultValue: string) => string): string {
  if (field.is_primary && field.name.trim() === DEFAULT_PRIMARY_GRID_HEADER_NAME) {
    const entry = getFieldTypeCatalogEntry(field.field_type)
    if (entry) return t(entry.labelKey, entry.labelDefault)
  }
  return field.name
}

function hrefForOpen(raw: string): string {
  const s = raw.trim()
  if (!s) return ''
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return new URL(s).href
    return new URL(`https://${s}`).href
  } catch {
    return s
  }
}

function toDisplayImageUrl(ref: string): string | null {
  const s = ref.trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s) || s.startsWith('blob:') || s.startsWith('data:image')) return s
  try {
    if (/^[a-zA-Z]:[\\/]/.test(s) || (s.startsWith('/') && !s.startsWith('//')) || s.startsWith('file:')) {
      return convertFileSrc(s, 'asset')
    }
  } catch {
    return null
  }
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|$)/i.test(s)) {
    try {
      return convertFileSrc(s, 'asset')
    } catch {
      return s
    }
  }
  return s
}

function mediaCellImageUrls(rawCell: unknown): string[] {
  const v = extractCellValue(rawCell)
  const arr: string[] = Array.isArray(v)
    ? (v as unknown[]).map((x) => String(x))
    : v !== null && v !== undefined && String(v).trim()
      ? [String(v).trim()]
      : []
  return arr.map(toDisplayImageUrl).filter((x): x is string => x != null && x.length > 0)
}

type BuildGridCellCtx = {
  openUrl: (href: string) => void | Promise<void>
}

/** Rejects batch fills/edits whose cell kind does not match the field (avoids text painted into boolean columns). */
function editableValueKindMatchesField(field: Field, newValue: EditableGridCell): boolean {
  if (field.field_type === 'checkbox') return newValue.kind === GridCellKind.Boolean
  if (field.field_type === 'number') return newValue.kind === GridCellKind.Number
  if (field.field_type === 'url') {
    return (
      newValue.kind === GridCellKind.Uri ||
      newValue.kind === GridCellKind.Text ||
      (newValue.kind === GridCellKind.Custom &&
        isHandyWsData(newValue.data) &&
        newValue.data.fieldType === 'url')
    )
  }
  if (field.field_type === 'media') return newValue.kind === GridCellKind.Image
  if (newValue.kind === GridCellKind.Custom && isHandyWsData(newValue.data)) {
    const ft = newValue.data.fieldType
    return (
      (isBoardColumnFieldType(field.field_type) && ft === 'single_select') ||
      (field.field_type === 'multi_select' && ft === 'multi_select') ||
      (field.field_type === 'date' && ft === 'date') ||
      (field.field_type === 'date_time' && ft === 'date_time') ||
      (field.field_type === 'time' && ft === 'time')
    )
  }
  return newValue.kind === GridCellKind.Text
}

/**
 * Glide's overlay root uses `width: max-content`, so GrowingEntry's hidden measure can widen the
 * editor past the cell. Clamp the portal overlay (`#gdg-overlay-*`) to `target`, then shrink
 * by `GLIDE_OVERLAY_INSET_PX` on each side so row/column hairlines stay visible.
 */
function WorkspaceGlideFlatTextOverlayEditor(p: {
  target: Rectangle
  rowPx: number
  onChange: (v: GridCell) => void
  value: GridCell
  validatedSelection?: readonly [number, number] | number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const start = wrapRef.current
    if (!start) return
    let el: HTMLElement | null = start
    while (el && !(typeof el.id === 'string' && el.id.startsWith('gdg-overlay-'))) {
      el = el.parentElement
    }
    if (!el) return
    const overlayEl = el
    const posKeys = ['left', 'top'] as const
    const dimKeys = ['width', 'min-width', 'max-width', 'height', 'min-height', 'max-height'] as const
    const padKeys = ['padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom'] as const
    const prior = new Map<string, string>()
    for (const k of posKeys) {
      prior.set(k, overlayEl.style.getPropertyValue(k))
    }
    for (const k of dimKeys) {
      prior.set(k, overlayEl.style.getPropertyValue(k))
    }
    for (const k of padKeys) {
      prior.set(k, overlayEl.style.getPropertyValue(k))
    }
    const inset = GLIDE_OVERLAY_INSET_PX
    const wPx = Math.max(1, Math.ceil(p.target.width) - inset * 2)
    const hPx = Math.max(1, Math.ceil(p.target.height) - inset * 2)
    const w = `${wPx}px`
    const h = `${hPx}px`
    overlayEl.style.setProperty('left', `${p.target.x + inset}px`)
    overlayEl.style.setProperty('top', `${p.target.y + inset}px`)
    for (const k of dimKeys) {
      overlayEl.style.setProperty(k, k.includes('width') ? w : h)
    }
    for (const k of padKeys) {
      overlayEl.style.setProperty(k, '0')
    }
    return () => {
      for (const k of [...posKeys, ...dimKeys, ...padKeys]) {
        const v = prior.get(k)
        if (v) overlayEl.style.setProperty(k, v)
        else overlayEl.style.removeProperty(k)
      }
    }
  }, [p.target.x, p.target.y, p.target.width, p.target.height])

  const v = p.value
  if (v.kind !== GridCellKind.Text) return null
  return (
    <div
      ref={wrapRef}
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      style={{
        alignSelf: 'stretch',
        width: '100%',
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        maxHeight: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        backgroundColor: 'var(--workspace-grid-bg-cell)',
        paddingLeft: 'var(--workspace-grid-cell-padding-h)',
        paddingRight: 'var(--workspace-grid-cell-padding-h)',
      }}
    >
      <div style={{ width: '100%', minWidth: 0, flexShrink: 0 }}>
        <TextCellEntry
          altNewline
          highlight={false}
          autoFocus={v.readonly !== true}
          disabled={v.readonly === true}
          value={v.data}
          validatedSelection={p.validatedSelection}
          onChange={(e) =>
            p.onChange({
              ...v,
              data: e.target.value,
            })
          }
        />
      </div>
    </div>
  )
}

function buildGridCell(
  field: Field,
  rawCell: unknown,
  formulaDisplayOverride?: string,
  ctx?: BuildGridCellCtx,
): GridCell {
  const v =
    formulaDisplayOverride !== undefined ? formulaDisplayOverride : extractCellValue(rawCell)
  const readOnly = field.field_type === 'last_edited_time' || field.field_type === 'created_time'
  const formulaSrcCell = extractCellFormula(rawCell)

  if (field.field_type === 'number') {
    const src = formulaDisplayOverride !== undefined ? formulaDisplayOverride : v
    const n = typeof src === 'number' ? src : parseFloat(String(src))
    let disp =
      formulaDisplayOverride !== undefined
        ? formulaDisplayOverride
        : v === null || v === undefined
          ? ''
          : String(v)
    const fmt = field.type_option?.format?.trim()
    if (fmt && Number.isFinite(n)) {
      const afterDot = fmt.split('.')[1]
      if (afterDot !== undefined && /^0+$/.test(afterDot)) {
        disp = n.toFixed(afterDot.length)
      }
    }
    return {
      kind: GridCellKind.Number,
      data: Number.isFinite(n) ? n : undefined,
      displayData: disp,
      allowOverlay: !readOnly,
      readonly: readOnly,
    }
  }

  if (field.field_type === 'checkbox') {
    return {
      kind: GridCellKind.Boolean,
      data: v === true,
      allowOverlay: false,
      readonly: readOnly,
    }
  }

  if (field.field_type === 'protected') {
    const s = v === null || v === undefined ? '' : String(v)
    return {
      kind: GridCellKind.Protected,
      copyData: s,
      allowOverlay: false,
    }
  }

  if (field.field_type === 'url' && formulaSrcCell == null) {
    const data = v === null || v === undefined ? '' : String(v).trim()
    const opener = ctx?.openUrl
    return {
      kind: GridCellKind.Uri,
      data,
      allowOverlay: !readOnly,
      hoverEffect: true,
      readonly: readOnly,
      ...(data && opener
        ? {
            onClickUri: (args) => {
              args.preventDefault()
              void opener(hrefForOpen(data))
            },
          }
        : {}),
    }
  }

  if (field.field_type === 'media') {
    const urls = mediaCellImageUrls(rawCell)
    return {
      kind: GridCellKind.Image,
      data: urls,
      allowOverlay: true,
      readonly: readOnly,
    }
  }

  const handy = buildHandyWorkspaceGridCell(field, rawCell, formulaDisplayOverride)
  if (handy) return handy

  const text = displayForField(field, rawCell, formulaDisplayOverride)
  const formulaSrc = extractCellFormula(rawCell)
  const dataForEdit = formulaSrc ?? text
  return {
    kind: GridCellKind.Text,
    data: dataForEdit,
    displayData: text,
    allowOverlay: !readOnly,
    readonly: readOnly,
  }
}

type ImageGridCell = Extract<GridCell, { kind: typeof GridCellKind.Image }>

function GridMediaImageOverlayEditor(p: {
  target: Rectangle
  value: ImageGridCell
  onChange: (v: GridCell) => void
  onFinishedEditing: (newValue?: GridCell, movement?: readonly [-1 | 0 | 1, -1 | 0 | 1]) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [text, setText] = useState(() => p.value.data.join('\n'))

  useLayoutEffect(() => {
    return clampGlideOverlayToTarget(wrapRef, p.target) ?? undefined
  }, [p.target.x, p.target.y, p.target.width, p.target.height])

  useEffect(() => {
    setText(p.value.data.join('\n'))
  }, [p.value.data])

  return (
    <div
      ref={wrapRef}
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      style={{
        alignSelf: 'stretch',
        width: '100%',
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        maxHeight: '100%',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        backgroundColor: 'var(--workspace-grid-bg-cell)',
        paddingLeft: 'var(--workspace-grid-cell-padding-h)',
        paddingRight: 'var(--workspace-grid-cell-padding-h)',
      }}
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            const lines = text
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean)
            const next: ImageGridCell = { ...p.value, data: lines }
            p.onChange(next)
            p.onFinishedEditing(next, [0, 1])
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            p.onFinishedEditing(undefined, [0, 0])
          }
          if (e.key === 'Tab') {
            e.preventDefault()
            const lines = text
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean)
            const next: ImageGridCell = { ...p.value, data: lines }
            p.onChange(next)
            p.onFinishedEditing(next, [e.shiftKey ? -1 : 1, 0])
          }
        }}
        onBlur={() => {
          const lines = text
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
          const next: ImageGridCell = { ...p.value, data: lines }
          p.onChange(next)
          p.onFinishedEditing(next, [0, 0])
        }}
        rows={4}
        style={{
          width: '100%',
          minWidth: 0,
          resize: 'vertical',
          fontSize: 12,
          fontFamily: 'Space Grotesk, sans-serif',
          border: '1px solid rgba(28,28,25,0.12)',
          borderRadius: 4,
          padding: 6,
          boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

export const GridView = forwardRef<GridViewHandle, Props>(function GridView(
  { databaseId, viewId, filteredRows },
  ref,
) {
  const {
    activeNode,
    views,
    loadNodeChildren,
    updateCell,
    updateView,
    createNode,
    addField,
    renameField,
    setFieldType,
    setFieldGroup,
    renameFieldGroup,
    deleteField,
    setActiveNode,
  } = useWorkspaceStore()
  const { t } = useTranslation()
  const resolvedAppearance = useWorkspaceAppearanceStore((s) => s.resolved)
  const dataGridTheme = useMemo(
    () => workspaceDataGridTheme(resolvedAppearance),
    [resolvedAppearance],
  )
  const gridRowHeight = resolvedAppearance.metrics.gridRowHeight
  const imageWindowLoader = useMemo(() => new ImageWindowLoaderImpl(), [])
  const [dragHighlights, setDragHighlights] = useState<readonly Highlight[] | undefined>(undefined)
  const handleOpenUrl = useCallback((href: string) => {
    if (!href) return
    void openUrl(href)
  }, [])

  const containerRef = useRef<HTMLDivElement>(null)
  const gridEditorRef = useRef<DataEditorRef>(null)

  useImperativeHandle(
    ref,
    () => ({
      flushPendingCellEdit: () => {
        if (!containerRef.current?.isConnected) return
        const portal = document.getElementById('portal')
        const clip = portal?.querySelector('.gdg-clip-region') as HTMLElement | null
        if (!clip) return
        clip.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            bubbles: true,
            cancelable: true,
          }),
        )
      },
    }),
    [],
  )
  const emptyGridAppendLockRef = useRef(false)
  const pendingScrollToLastRowRef = useRef(false)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [gridSelection, setGridSelection] = useState<GridSelection>(() => ({ ...EMPTY_GRID_SELECTION }))
  const [protectedEdit, setProtectedEdit] = useState<{ row: WorkspaceNode; field: Field } | null>(null)
  const [protectedDraft, setProtectedDraft] = useState('')

  useEffect(() => {
    setGridSelection({ ...EMPTY_GRID_SELECTION })
  }, [databaseId, viewId])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)
    setSize({ width: el.clientWidth, height: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    void loadNodeChildren(databaseId)
  }, [databaseId, loadNodeChildren])

  const fields = useMemo(() => {
    if (!activeNode) return []
    return parseDatabaseProperties(activeNode).fields.sort((a, b) => a.position - b.position)
  }, [activeNode])

  const rows = filteredRows

  useEffect(() => {
    if (rows.length > 0) emptyGridAppendLockRef.current = false
  }, [rows.length])

  const selectionBarH = gridSelection.rows.length > 0 ? SELECTION_BAR_H : 0
  const chromeTop = GRID_TOOLBAR_H + selectionBarH + FORMULA_BAR_H

  const activeView = views.find((v) => v.id === viewId)
  const viewOptions = useMemo((): Record<string, unknown> => {
    try {
      return JSON.parse(activeView?.view_options ?? '{}')
    } catch {
      return {}
    }
  }, [activeView?.view_options])

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    (viewOptions.columnWidths as Record<string, number>) ?? {},
  )

  const sortedFields = useMemo(() => {
    const opts = viewOptions as Record<string, unknown>
    const order: string[] | undefined = opts.columnOrder as string[]
    if (!order) return fields
    return [...fields].sort((a, b) => {
      const ia = order.indexOf(a.id)
      const ib = order.indexOf(b.id)
      if (ia === -1 && ib === -1) return a.position - b.position
      if (ia === -1) return 1
      if (ib === -1) return -1
      return ia - ib
    })
  }, [fields, viewOptions])

  /** Live-evaluated display strings for formula cells (same-row references). */
  const formulaDisplayByRowCol = useMemo(() => {
    const map = new Map<string, Map<number, string>>()
    for (const rowNode of rows) {
      const cells = parseRowProperties(rowNode).cells ?? {}
      const byId: Record<string, unknown> = {}
      for (const f of sortedFields) {
        byId[f.id] = cells[f.id]
      }
      if (!sortedFields.some((f) => hasCellFormula(cells[f.id]))) continue
      const ev = evaluateSameRowFormulas(sortedFields, byId)
      const colMap = new Map<number, string>()
      for (let col = 0; col < sortedFields.length; col++) {
        const f = sortedFields[col]
        if (!hasCellFormula(cells[f.id])) continue
        const e = ev[f.id]
        colMap.set(
          col,
          e?.evalError ? `#ERROR` : e?.value === null || e?.value === undefined ? '' : String(e.value),
        )
      }
      map.set(rowNode.id, colMap)
    }
    return map
  }, [rows, sortedFields])

  /** Excel-style address for the focused cell (row is 1-based for formula refs: first data row = 1). */
  const formulaBarAddress = useMemo(() => {
    const cur = gridSelection.current?.cell
    if (cur === undefined) return { label: '—', detail: 'Select a cell' as const }
    const [col, row] = cur
    if (col < 0 || col >= sortedFields.length) return { label: '—', detail: 'out' as const }
    const letter = excelColumnLetter(col)
    if (row < 0) return { label: `${letter}`, detail: 'header' as const }
    if (row >= rows.length) return { label: '—', detail: 'out' as const }
    return { label: `${letter}${row + 1}`, detail: 'cell' as const }
  }, [gridSelection, rows, sortedFields])

  const formulaBarExpr = useMemo(() => {
    const cur = gridSelection.current?.cell
    if (cur === undefined) return ''
    const [col, row] = cur
    if (row < 0 || row >= rows.length) return ''
    const field = sortedFields[col]
    if (!field) return ''
    const cells = parseRowProperties(rows[row]).cells ?? {}
    return extractCellFormula(cells[field.id]) ?? ''
  }, [gridSelection, rows, sortedFields])

  const hasColumnGroups = useMemo(
    () => sortedFields.some((f) => (f.group ?? '').trim().length > 0),
    [sortedFields],
  )

  /** Content height (+ trailing row); canvas stretches to pane when shorter so scrollbars sit at pane bottom. */
  const gridLayout = useMemo(() => {
    const trailingNewPageRows = 1
    const groupStrip = hasColumnGroups ? GROUP_HEADER_H : 0
    const headerTotal = groupStrip + GRID_HEADER_H
  const contentPx = headerTotal + (rows.length + trailingNewPageRows) * gridRowHeight + 2
  const absMin = headerTotal + trailingNewPageRows * gridRowHeight + 4
    const contentPixelHeight = Math.max(absMin, contentPx)
    const availableForEditor = Math.max(0, size.height - chromeTop)
    const gridCanvasHeight =
      size.height > 0 ? Math.max(contentPixelHeight, availableForEditor) : contentPixelHeight
    return { gridCanvasHeight, contentPixelHeight }
  }, [rows.length, hasColumnGroups, size.height, chromeTop])

  const glideColumns: GridColumn[] = useMemo(
    () =>
      sortedFields.map((f, i) => {
        const g = (f.group ?? '').trim()
        return {
          id: f.id,
          title: gridColumnHeaderTitle(f, t),
          width: columnWidths[f.id] ?? DEFAULT_COL_WIDTH,
          hasMenu: !f.is_primary,
          icon: fieldTypeToGridIcon(f.field_type),
          ...(g ? { group: g } : {}),
          // Last column grows to fill remaining width (single column → full grid width like Excel).
          ...(i === sortedFields.length - 1 ? { grow: 1 as const } : {}),
        }
      }),
    [sortedFields, columnWidths, t],
  )

  /** Glide caches header paint; after `rename_field` / group updates, force header rows to redraw. */
  const fieldHeaderRepaintKey = useMemo(
    () => sortedFields.map((f) => `${f.id}:${f.name}:${f.field_type}:${f.group ?? ''}`).join('\u001f'),
    [sortedFields],
  )
  const prevFieldHeaderRepaintKeyRef = useRef<string | null>(null)

  useEffect(() => {
    prevFieldHeaderRepaintKeyRef.current = null
  }, [databaseId])

  useEffect(() => {
    if (prevFieldHeaderRepaintKeyRef.current === null) {
      prevFieldHeaderRepaintKeyRef.current = fieldHeaderRepaintKey
      return
    }
    if (prevFieldHeaderRepaintKeyRef.current === fieldHeaderRepaintKey) return
    prevFieldHeaderRepaintKeyRef.current = fieldHeaderRepaintKey

    if (sortedFields.length === 0 || size.width <= 0) return

    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const editor = gridEditorRef.current
        if (!editor) return
        const damage: { cell: readonly [number, number] }[] = sortedFields.map((_, col) => ({
          cell: [col, -1] as const,
        }))
        if (hasColumnGroups) {
          for (let col = 0; col < sortedFields.length; col++) {
            damage.push({ cell: [col, -2] as const })
          }
        }
        editor.updateCells(damage)
        try {
          editor.remeasureColumns(compactSelectionAllColumns(sortedFields.length))
        } catch {
          /* older glide builds: ignore */
        }
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [fieldHeaderRepaintKey, sortedFields, hasColumnGroups, size.width])

  const persistViewOptions = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!activeView) return
      const newOpts = JSON.stringify({ ...viewOptions, ...patch })
      await updateView(
        activeView.id,
        activeView.name,
        activeView.color,
        activeView.filters,
        activeView.sorts,
        newOpts,
      )
    },
    [activeView, viewOptions, updateView],
  )

  const saveColumnWidths = useCallback(
    async (widths: Record<string, number>) => {
      await persistViewOptions({ columnWidths: widths })
    },
    [persistViewOptions],
  )

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, row] = cell
      const field = sortedFields[col]
      if (!field || row < 0 || row >= rows.length) {
        return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false, readonly: true }
      }
      const rowNode = rows[row]
      const cells = parseRowProperties(rowNode).cells ?? {}
      const override = formulaDisplayByRowCol.get(rowNode.id)?.get(col)
      return buildGridCell(field, cells[field.id], override, { openUrl: handleOpenUrl })
    },
    [rows, sortedFields, formulaDisplayByRowCol, handleOpenUrl],
  )

  const commitCellEdit = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      const [col, row] = cell
      const field = sortedFields[col]
      const rowNode = rows[row]
      if (!field || !rowNode) return
      if (readOnlyField(field) || field.field_type === 'protected') return
      if (!editableValueKindMatchesField(field, newValue)) {
        return
      }

      const cells = parseRowProperties(rowNode).cells ?? {}
      const prevFormula = extractCellFormula(cells[field.id])

      if (newValue.kind === GridCellKind.Custom && isHandyWsData(newValue.data)) {
        const s = newValue.data.edit.trim()
        if (s.startsWith('=')) {
          const byId: Record<string, unknown> = {
            ...cells,
            [field.id]: { type: field.field_type, value: null, formula: s },
          }
          const ev = evaluateSameRowFormulas(sortedFields, byId)
          const e = ev[field.id]
          void updateCell(
            rowNode.id,
            field.id,
            field.field_type,
            e?.evalError ? null : e?.value ?? null,
            field.is_primary,
            { formula: s, evalError: e?.evalError ?? null },
          )
          return
        }
        const value: unknown = handyEditToPersistedValue(newValue.data.fieldType, newValue.data.edit)
        const extras =
          prevFormula != null
            ? ({ formula: null, evalError: null } as { formula: string | null; evalError: string | null })
            : null
        void updateCell(rowNode.id, field.id, field.field_type, value, field.is_primary, extras)
        return
      }

      if (newValue.kind === GridCellKind.Uri) {
        const s = String(newValue.data ?? '').trim()
        const extras =
          prevFormula != null ? ({ formula: null, evalError: null } as { formula: string | null; evalError: string | null }) : null
        void updateCell(rowNode.id, field.id, field.field_type, s || null, field.is_primary, extras)
        return
      }

      if (newValue.kind === GridCellKind.Image) {
        const arr = newValue.data ?? []
        const value = arr.length === 0 ? null : [...arr]
        const extras =
          prevFormula != null ? ({ formula: null, evalError: null } as { formula: string | null; evalError: string | null }) : null
        void updateCell(rowNode.id, field.id, field.field_type, value, field.is_primary, extras)
        return
      }

      if (newValue.kind === GridCellKind.Text) {
        const s = String(newValue.data ?? '').trim()
        if (s.startsWith('=')) {
          const byId: Record<string, unknown> = { ...cells, [field.id]: { type: field.field_type, value: null, formula: s } }
          const ev = evaluateSameRowFormulas(sortedFields, byId)
          const e = ev[field.id]
          void updateCell(
            rowNode.id,
            field.id,
            field.field_type,
            e?.evalError ? null : e?.value ?? null,
            field.is_primary,
            { formula: s, evalError: e?.evalError ?? null },
          )
          return
        }
        const value: unknown = newValue.data
        const extras =
          prevFormula != null ? ({ formula: null, evalError: null } as { formula: string | null; evalError: string | null }) : null
        void updateCell(rowNode.id, field.id, field.field_type, value, field.is_primary, extras)
        return
      }

      let value: unknown
      if (newValue.kind === GridCellKind.Number) value = newValue.data ?? null
      else if (newValue.kind === GridCellKind.Boolean) value = newValue.data === true
      else return

      const extras =
        prevFormula != null ? ({ formula: null, evalError: null } as { formula: string | null; evalError: string | null }) : null
      void updateCell(rowNode.id, field.id, field.field_type, value, field.is_primary, extras)
    },
    [rows, sortedFields, updateCell],
  )

  const onCellEdited = useCallback(
    (cell: Item, newValue: EditableGridCell) => {
      commitCellEdit(cell, newValue)
    },
    [commitCellEdit],
  )

  const onCellsEdited = useCallback(
    (items: readonly EditListItem[]) => {
      for (const item of items) {
        commitCellEdit(item.location, item.value)
      }
      return true
    },
    [commitCellEdit],
  )

  type FieldEditorState =
    | { mode: 'add'; position: { x: number; y: number } }
    | { mode: 'edit'; field: Field; position: { x: number; y: number } }

  const [fieldEditor, setFieldEditor] = useState<FieldEditorState | null>(null)
  const [actionMenu, setActionMenu] = useState<{ row: WorkspaceNode; anchorRect: DOMRect } | null>(null)

  const queueFocusLastRow = useCallback(() => {
    pendingScrollToLastRowRef.current = true
  }, [])

  useEffect(() => {
    if (!pendingScrollToLastRowRef.current || rows.length === 0) return
    pendingScrollToLastRowRef.current = false
    const last = rows.length - 1
    requestAnimationFrame(() => {
      gridEditorRef.current?.scrollTo(0, last, 'both')
      gridEditorRef.current?.focus()
    })
  }, [rows, rows.length])

  const handleAddRow = useCallback(async () => {
    await createNode(databaseId, 'row', '')
    queueFocusLastRow()
  }, [databaseId, createNode, queueFocusLastRow])

  const handleInsertRow = useCallback(
    async (_row: WorkspaceNode) => {
      await createNode(databaseId, 'row', '')
      queueFocusLastRow()
    },
    [databaseId, createNode, queueFocusLastRow],
  )

  const handleDuplicate = useCallback(
    async (row: WorkspaceNode) => {
      const cells = parseRowProperties(row).cells ?? {}
      const newRow = await createNode(databaseId, 'row', row.name)
      if (newRow) {
        for (const [fieldId, cell] of Object.entries(cells)) {
          await updateCell(
            newRow.id,
            fieldId,
            (cell as { type?: string }).type ?? 'rich_text',
            (cell as { value?: unknown }).value,
          )
        }
        await loadNodeChildren(databaseId)
        queueFocusLastRow()
      }
    },
    [databaseId, createNode, updateCell, loadNodeChildren, queueFocusLastRow],
  )

  const handleDeleteRow = useCallback(
    async (row: WorkspaceNode) => {
      const deleteNode = useWorkspaceStore.getState().deleteNode
      await deleteNode(row.id)
      await loadNodeChildren(databaseId)
    },
    [databaseId, loadNodeChildren],
  )

  const handleBulkDeleteRowSelection = useCallback(
    async (rowSel: CompactSelection) => {
      const indices = rowSel.toArray()
      if (indices.length === 0) return
      if (
        !window.confirm(
          `Delete ${indices.length} row${indices.length === 1 ? '' : 's'}? This cannot be undone.`,
        )
      ) {
        return
      }
      const deleteNode = useWorkspaceStore.getState().deleteNode
      for (const idx of indices) {
        const rowNode = rows[idx]
        if (rowNode) await deleteNode(rowNode.id)
      }
      await loadNodeChildren(databaseId)
      setGridSelection({ ...EMPTY_GRID_SELECTION })
    },
    [rows, databaseId, loadNodeChildren],
  )

  const handleAddCheckboxColumnFromToolbar = useCallback(async () => {
    const lower = new Set(sortedFields.map((f) => f.name.trim().toLowerCase()))
    let name = 'Checkbox'
    let n = 2
    while (lower.has(name.toLowerCase())) {
      name = `Checkbox ${n}`
      n++
    }
    await addField(databaseId, name, 'checkbox')
    setGridSelection({ ...EMPTY_GRID_SELECTION })
  }, [sortedFields, databaseId, addField])

  const handleQuickAddTextColumn = useCallback(async () => {
    const lower = new Set(sortedFields.map((f) => f.name.trim().toLowerCase()))
    let name = 'Text'
    let n = 2
    while (lower.has(name.toLowerCase())) {
      name = `Text ${n}`
      n++
    }
    const node = await addField(databaseId, name, 'rich_text')
    const added = parseDatabaseProperties(node).fields.find((f) => f.name === name)
    if (!added) return
    setColumnWidths((prev) => {
      const next = { ...prev, [added.id]: DEFAULT_COL_WIDTH }
      void saveColumnWidths(next)
      return next
    })
    setGridSelection({ ...EMPTY_GRID_SELECTION })
  }, [sortedFields, databaseId, addField, saveColumnWidths])

  const onColumnMoved = useCallback(
    async (startIndex: number, endIndex: number) => {
      const order = sortedFields.map((f) => f.id)
      if (startIndex < 0 || startIndex >= order.length) return
      const next = [...order]
      const [removed] = next.splice(startIndex, 1)
      if (removed === undefined) return
      if (endIndex < 0 || endIndex > next.length) return
      next.splice(endIndex, 0, removed)
      await persistViewOptions({ columnOrder: next })
    },
    [sortedFields, persistViewOptions],
  )

  const onColumnProposeMove = useCallback(
    (startIndex: number, endIndex: number): boolean => {
      const primaryIdx = sortedFields.findIndex((f) => f.is_primary)
      if (primaryIdx < 0) return true
      if (startIndex === primaryIdx && endIndex !== primaryIdx) return false
      if (endIndex === primaryIdx && startIndex !== primaryIdx) return false
      return true
    },
    [sortedFields],
  )

  const onHeaderDoubleClickRename = useCallback(
    (colIndex: number, event: HeaderClickedEventArgs) => {
      if (event.isEdge) return
      if (!event.isDoubleClick) return
      const field = sortedFields[colIndex]
      if (!field) return
      const rect = containerRef.current?.getBoundingClientRect()
      const x = (rect?.left ?? 0) + event.localEventX
      const y = (rect?.top ?? 0) + event.localEventY + chromeTop
      setFieldEditor({ mode: 'edit', field, position: { x, y } })
    },
    [sortedFields, chromeTop],
  )

  const newColumnHeaderControl = useMemo(
    () => (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          alignSelf: 'stretch',
          height: '100%',
          minHeight: GRID_HEADER_H,
          padding: '0 8px',
          boxSizing: 'border-box',
        }}
      >
        <button
          type="button"
          onClick={() => {
            void handleQuickAddTextColumn()
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 6,
            border: '1px dashed rgba(28, 28, 25, 0.2)',
            background: 'transparent',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'Space Grotesk, sans-serif',
            cursor: 'pointer',
            color: 'var(--workspace-text-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          <Plus size={12} strokeWidth={2} />
          New column
        </button>
      </div>
    ),
    [handleQuickAddTextColumn],
  )

  const handyProvideEditor = useMemo(() => provideHandyWorkspaceEditor(gridRowHeight), [gridRowHeight])

  const provideWorkspaceCellEditor = useCallback(
    (cell: GridCell) => {
      const fromHandy = handyProvideEditor(cell)
      if (fromHandy !== undefined) return fromHandy
      const rowPx = gridRowHeight
      if (cell.kind === GridCellKind.Image) {
        if (cell.readonly === true) return undefined
        return {
          disablePadding: true,
          disableStyling: true,
          styleOverride: {
            padding: 0,
            minHeight: 120,
            height: 'auto',
            maxHeight: 320,
            backgroundColor: dataGridTheme.bgCell,
            boxSizing: 'border-box' as const,
            overflow: 'hidden',
            outline: 'none',
            boxShadow: 'none',
            borderRadius: 0,
          },
          editor: (p: {
            onChange: (v: GridCell) => void
            value: GridCell
            target: Rectangle
            onFinishedEditing: (newValue?: GridCell, movement?: readonly [-1 | 0 | 1, -1 | 0 | 1]) => void
          }) => {
            const v = p.value
            if (v.kind !== GridCellKind.Image) return null
            return (
              <GridMediaImageOverlayEditor
                target={p.target}
                value={v}
                onChange={p.onChange}
                onFinishedEditing={p.onFinishedEditing}
              />
            )
          },
        }
      }
      if (cell.kind === GridCellKind.Uri) return undefined
      if (cell.kind !== GridCellKind.Text) return undefined
      if (cell.readonly === true) return undefined
      return {
        disablePadding: true,
        disableStyling: true,
        styleOverride: {
          padding: 0,
          height: rowPx,
          maxHeight: rowPx,
          backgroundColor: dataGridTheme.bgCell,
          boxSizing: 'border-box' as const,
          overflow: 'hidden',
          outline: 'none',
          boxShadow: 'none',
          borderRadius: 0,
        },
        editor: (p: {
          onChange: (v: GridCell) => void
          value: GridCell
          validatedSelection?: readonly [number, number] | number
          target: Rectangle
        }) => {
          const v = p.value
          if (v.kind !== GridCellKind.Text) return null
          return (
            <WorkspaceGlideFlatTextOverlayEditor
              target={p.target}
              rowPx={rowPx}
              onChange={p.onChange}
              value={v}
              validatedSelection={p.validatedSelection}
            />
          )
        },
      }
    },
    [dataGridTheme.bgCell, gridRowHeight, handyProvideEditor],
  )

  const onDragOverMediaCell = useCallback(
    (cell: Item, dt: DataTransfer | null) => {
      if (!dt) {
        setDragHighlights(undefined)
        return
      }
      const [col, row] = cell
      const field = sortedFields[col]
      if (!field || field.field_type !== 'media' || row < 0 || row >= rows.length) {
        setDragHighlights(undefined)
        return
      }
      const { files } = dt
      if (!files || files.length === 0) {
        setDragHighlights(undefined)
        return
      }
      let ok = false
      for (let i = 0; i < files.length; i++) {
        if (SUPPORTED_GRID_IMAGE_MIME.has(files[i]!.type)) {
          ok = true
          break
        }
      }
      if (!ok) {
        setDragHighlights(undefined)
        return
      }
      setDragHighlights([
        {
          color: 'rgba(68, 187, 0, 0.15)',
          range: { x: col, y: row, width: 1, height: 1 },
        },
      ])
    },
    [sortedFields, rows.length],
  )

  const onDropMediaCell = useCallback(
    (cell: Item, dt: DataTransfer | null) => {
      setDragHighlights(undefined)
      if (!dt?.files?.length) return
      const [col, row] = cell
      const field = sortedFields[col]
      const rowNode = rows[row]
      if (!field || !rowNode || field.field_type !== 'media') return
      const paths: string[] = []
      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files[i]!
        if (!SUPPORTED_GRID_IMAGE_MIME.has(f.type)) continue
        const fp = (f as File & { path?: string }).path
        if (typeof fp === 'string' && fp.length > 0) paths.push(fp)
        else paths.push(URL.createObjectURL(f))
      }
      if (paths.length === 0) return
      const cells = parseRowProperties(rowNode).cells ?? {}
      const prev = extractCellValue(cells[field.id])
      const prevArr = Array.isArray(prev)
        ? [...(prev as string[])]
        : typeof prev === 'string' && prev.trim()
          ? [prev.trim()]
          : []
      void updateCell(rowNode.id, field.id, field.field_type, [...prevArr, ...paths], field.is_primary)
    },
    [rows, sortedFields, updateCell],
  )

  const onDragLeaveGrid = useCallback(() => {
    setDragHighlights(undefined)
  }, [])

  const handyCustomRenderers = useMemo(() => [handyWorkspaceCustomRenderer], [])

  const onColumnResize = useCallback(
    (_column: GridColumn, newSize: number, colIndex: number) => {
      const field = sortedFields[colIndex]
      if (!field) return
      setColumnWidths((prev) => ({ ...prev, [field.id]: newSize }))
    },
    [sortedFields],
  )

  const onColumnResizeEnd = useCallback(
    (_column: GridColumn, newSize: number, colIndex: number) => {
      const field = sortedFields[colIndex]
      if (!field) return
      setColumnWidths((prev) => {
        const next = { ...prev, [field.id]: newSize }
        void saveColumnWidths(next)
        return next
      })
    },
    [sortedFields, saveColumnWidths],
  )

  if (fields.length === 0) {
    return (
      <div
        ref={containerRef}
        className="workspace-grid-scroll"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            padding: 24,
            color: 'var(--workspace-text-soft)',
            fontSize: 13,
            fontFamily: 'Space Grotesk, sans-serif',
            textAlign: 'center',
            maxWidth: 420,
            margin: '0 auto',
          }}
        >
          <p style={{ margin: 0, lineHeight: 1.45 }}>
            No columns yet. Add a property to start this database. After the first column exists, you can also use the{' '}
            <strong>+</strong> New column control on the grid header rail.
          </p>
          <button
            type="button"
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setFieldEditor({ mode: 'add', position: { x: rect.left, y: rect.bottom + 4 } })
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--workspace-accent)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: 'Space Grotesk, sans-serif',
              cursor: 'pointer',
            }}
          >
            <Plus size={16} strokeWidth={2} />
            Add property
          </button>
        </div>
        {fieldEditor?.mode === 'add' && (
          <FieldEditorPopover
            mode="add"
            position={fieldEditor.position}
            onAdd={(name, fieldType) => addField(databaseId, name, fieldType)}
            onClose={() => setFieldEditor(null)}
          />
        )}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="workspace-grid-scroll"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflowY: 'auto',
      }}
    >
      {selectionBarH > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 8,
            padding: '6px 10px',
            minHeight: SELECTION_BAR_H,
            borderBottom: '1px solid rgba(28, 28, 25, 0.08)',
            flexShrink: 0,
            background: 'var(--workspace-bg-soft)',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 10px',
              borderRadius: 4,
              background: 'linear-gradient(180deg, #fffef9, #f0e8df)',
              color: '#1c1c19',
              border: '1px solid rgba(183, 35, 1, 0.22)',
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'Space Grotesk, sans-serif',
            }}
          >
            {gridSelection.rows.length} selected
          </span>
          <button
            type="button"
            title="Add a checkbox column to this database"
            onClick={() => {
              void handleAddCheckboxColumnFromToolbar()
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid rgba(28, 28, 25, 0.12)',
              background: 'transparent',
              fontSize: 12,
              fontFamily: 'Space Grotesk, sans-serif',
              cursor: 'pointer',
              color: 'var(--workspace-text)',
            }}
          >
            <CheckSquare size={14} strokeWidth={2} />
            Checkbox column
          </button>
          <button
            type="button"
            title="Delete selected rows"
            onClick={() => {
              void handleBulkDeleteRowSelection(gridSelection.rows)
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid rgba(28, 28, 25, 0.12)',
              background: 'transparent',
              fontSize: 12,
              fontFamily: 'Space Grotesk, sans-serif',
              cursor: 'pointer',
              color: 'var(--workspace-text-muted)',
            }}
          >
            <Trash2 size={14} />
          </button>
          <button
            type="button"
            title="Clear selection"
            onClick={() => setGridSelection({ ...EMPTY_GRID_SELECTION })}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '4px 8px',
              borderRadius: 6,
              border: '1px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--workspace-text-muted)',
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      <div
        style={{
          flexShrink: 0,
          height: FORMULA_BAR_H,
          minHeight: FORMULA_BAR_H,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 10px',
          fontSize: 12,
          color: 'var(--workspace-text)',
          background: 'rgba(183, 35, 1, 0.05)',
          borderBottom: '1px solid rgba(28, 28, 25, 0.08)',
        }}
        title="Cell address for same-row formulas (A1 = column A, row 1). Ask the assistant for a table using a handy_workspace_draft block to test create-table flow."
      >
        <span
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontWeight: 600,
            minWidth: 36,
            letterSpacing: '0.02em',
          }}
        >
          {formulaBarAddress.label}
        </span>
        {formulaBarAddress.detail === 'header' && (
          <span style={{ fontSize: 11, opacity: 0.55 }}>header</span>
        )}
        <span style={{ opacity: 0.45, flexShrink: 0 }}>fx</span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            opacity: formulaBarExpr.length > 0 ? 1 : 0.4,
          }}
        >
          {formulaBarExpr.length > 0 ? formulaBarExpr : '—'}
        </span>
        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            opacity: 0.48,
            maxWidth: '38%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          Same-row: B1 = col B this row
        </span>
      </div>

      {size.width > 0 && gridLayout.gridCanvasHeight > 0 && (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'stretch',
            width: '100%',
            background: '#fdf9f3',
            borderBottom: '1px solid rgba(28, 28, 25, 0.06)',
          }}
        >
          <div
            aria-hidden
            style={{
              width: ROW_MARKER_STRIP_W,
              flexShrink: 0,
              background: 'linear-gradient(180deg, rgba(183, 35, 1, 0.22) 0%, rgba(183, 35, 1, 0.08) 100%)',
              borderRight: '1px solid rgba(28, 28, 25, 0.06)',
            }}
          />
        <DataEditor
          ref={gridEditorRef}
          width={Math.max(0, size.width - ROW_MARKER_STRIP_W)}
          height={gridLayout.gridCanvasHeight}
          rowHeight={gridRowHeight}
          headerHeight={GRID_HEADER_H}
          groupHeaderHeight={hasColumnGroups ? GROUP_HEADER_H : undefined}
          columns={glideColumns}
          rows={rows.length}
          getCellContent={getCellContent}
          getCellsForSelection={true}
          onCellEdited={onCellEdited}
          onCellsEdited={onCellsEdited}
          gridSelection={gridSelection}
          onGridSelectionChange={setGridSelection}
          rowMarkers={{ kind: 'checkbox-visible', width: 36, checkboxStyle: 'circle' }}
          customRenderers={handyCustomRenderers}
          provideEditor={provideWorkspaceCellEditor}
          imageWindowLoader={imageWindowLoader}
          highlightRegions={dragHighlights}
          onDragOverCell={onDragOverMediaCell}
          onDrop={onDropMediaCell}
          onDragLeave={onDragLeaveGrid}
          cellActivationBehavior="double-click"
          editorBloom={[0, 0]}
          verticalBorder
          freezeColumns={0}
          getGroupDetails={(name) => ({
            name,
            icon: name ? GridColumnIcon.HeaderCode : undefined,
          })}
          onGroupHeaderRenamed={(oldName, newName) => {
            if (oldName === newName) return
            void renameFieldGroup(databaseId, oldName, newName)
          }}
          trailingRowOptions={{
            hint: '+ New page',
            sticky: false,
            tint: false,
          }}
          onRowAppended={async () => {
            await handleAddRow()
            return undefined
          }}
          onColumnResize={onColumnResize}
          onColumnResizeEnd={onColumnResizeEnd}
          onColumnMoved={onColumnMoved}
          onColumnProposeMove={onColumnProposeMove}
          onHeaderClicked={onHeaderDoubleClickRename}
          rightElement={newColumnHeaderControl}
          rightElementProps={{ fill: false, sticky: true }}
          onHeaderContextMenu={(colIndex, event) => {
            const field = sortedFields[colIndex]
            if (!field) return
            const rect = containerRef.current?.getBoundingClientRect()
            const x = (rect?.left ?? 0) + event.localEventX
            const y = (rect?.top ?? 0) + event.localEventY + chromeTop
            setFieldEditor({ mode: 'edit', field, position: { x, y } })
          }}
          onCellClicked={(cell, args) => {
            const [col, row] = cell
            const field = sortedFields[col]
            const rowNode = rows[row]
            if (!field || !rowNode) return
            if (field.field_type === 'protected' && args.isDoubleClick) {
              const cells = parseRowProperties(rowNode).cells ?? {}
              const cur = extractCellValue(cells[field.id])
              setProtectedDraft(cur === null || cur === undefined ? '' : String(cur))
              setProtectedEdit({ row: rowNode, field })
              return
            }
            /* Open row page only with Ctrl/Cmd+double-click so plain double-click can activate the cell editor. */
            if (field.is_primary && args.isDoubleClick && (args.ctrlKey || args.metaKey)) {
              setActiveNode(rowNode)
            }
          }}
          onKeyDown={(e) => {
            if (
              rows.length === 0 &&
              e.key.length === 1 &&
              /[ -~]/g.test(e.key) &&
              !e.ctrlKey &&
              !e.metaKey
            ) {
              const field = sortedFields.find(
                (f) =>
                  !readOnlyField(f) &&
                  f.field_type !== 'protected' &&
                  !isBoardColumnFieldType(f.field_type) &&
                  f.field_type !== 'multi_select' &&
                  f.field_type !== 'media',
              )
              if (!field) return
              e.cancel()
              if (emptyGridAppendLockRef.current) return
              emptyGridAppendLockRef.current = true
              void (async () => {
                try {
                  const newRow = await createNode(databaseId, 'row', '')
                  if (newRow)
                    await updateCell(newRow.id, field.id, field.field_type, e.key, field.is_primary)
                  queueFocusLastRow()
                } finally {
                  emptyGridAppendLockRef.current = false
                }
              })()
            }
          }}
          onCellContextMenu={(cell, args) => {
            args.preventDefault()
            const [, row] = cell
            const rowNode = rows[row]
            if (!rowNode) return
            const rect = containerRef.current?.getBoundingClientRect()
            const x = (rect?.left ?? 0) + args.localEventX
            const y = (rect?.top ?? 0) + args.localEventY + chromeTop
            setActionMenu({ row: rowNode, anchorRect: new DOMRect(x, y, 1, 24) })
          }}
          onDelete={(sel) => {
            if (sel.rows.length > 0) {
              void handleBulkDeleteRowSelection(sel.rows)
              return false
            }
            return true
          }}
          theme={dataGridTheme}
        />
        </div>
      )}

      {fieldEditor?.mode === 'add' && (
        <FieldEditorPopover
          mode="add"
          position={fieldEditor.position}
          onAdd={(name, fieldType) => addField(databaseId, name, fieldType)}
          onClose={() => setFieldEditor(null)}
        />
      )}
      {fieldEditor?.mode === 'edit' && (
        <FieldEditorPopover
          mode="edit"
          field={fieldEditor.field}
          position={fieldEditor.position}
          onRename={(fieldId, name) => {
            void renameField(databaseId, fieldId, name)
          }}
          onSetFieldType={(fieldId, fieldType) => {
            void setFieldType(databaseId, fieldId, fieldType)
          }}
          onSetGroup={(fieldId, group) => {
            void setFieldGroup(databaseId, fieldId, group)
          }}
          onDelete={(fieldId) => deleteField(databaseId, fieldId)}
          onClose={() => setFieldEditor(null)}
        />
      )}

      {protectedEdit && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="protected-edit-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setProtectedEdit(null)
            }
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 10,
              padding: 16,
              width: 'min(360px, 100%)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
              fontFamily: 'Space Grotesk, sans-serif',
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div id="protected-edit-title" style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>
              Set value — {protectedEdit.field.name}
            </div>
            <p style={{ fontSize: 12, color: 'var(--workspace-text-muted)', margin: '0 0 10px' }}>
              Stored as plain text in your workspace data (not encrypted). Double-click the cell to edit.
            </p>
            <input
              type="password"
              autoComplete="off"
              value={protectedDraft}
              onChange={(e) => setProtectedDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void updateCell(
                    protectedEdit.row.id,
                    protectedEdit.field.id,
                    'protected',
                    protectedDraft,
                    false,
                  )
                  setProtectedEdit(null)
                }
                if (e.key === 'Escape') setProtectedEdit(null)
              }}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid var(--workspace-border)',
                fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setProtectedEdit(null)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--workspace-border)',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void updateCell(
                    protectedEdit.row.id,
                    protectedEdit.field.id,
                    'protected',
                    protectedDraft,
                    false,
                  )
                  setProtectedEdit(null)
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--workspace-accent)',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {actionMenu && (
        <RowActionMenu
          row={actionMenu.row}
          anchorRect={actionMenu.anchorRect}
          onClose={() => setActionMenu(null)}
          onInsertAbove={handleAddRow}
          onInsertBelow={handleInsertRow}
          onDuplicate={handleDuplicate}
          onDelete={handleDeleteRow}
        />
      )}
    </div>
  )
})

GridView.displayName = 'GridView'
