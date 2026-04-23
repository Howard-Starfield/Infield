export interface WorkspaceNode {
  id: string
  parent_id: string | null
  node_type: 'document' | 'database' | 'row'
  name: string
  icon: string
  position: number
  created_at: number
  updated_at: number
  deleted_at: number | null
  properties: string // JSON — cell data for rows, field defs for databases
  body: string       // Raw markdown for documents/rows
}

export interface NodeView {
  id: string
  node_id: string
  name: string
  /** Supported layouts; legacy `list` / `gallery` / `table` rows are migrated to `grid` in DB + normalized on load. */
  layout: 'board' | 'grid' | 'calendar' | 'chart'
  position: number
  color: string | null
  filters: string   // JSON array
  sorts: string     // JSON array
  view_options: string // JSON object
  created_at: number
  updated_at: number
}

const NODE_VIEW_LAYOUTS = new Set<NodeView['layout']>(['board', 'grid', 'calendar', 'chart'])

/** Coerce legacy / unknown `node_views.layout` strings before rendering. */
export function normalizeNodeViewLayout(layout: string): NodeView['layout'] {
  if (layout === 'list' || layout === 'gallery' || layout === 'table') return 'grid'
  if (NODE_VIEW_LAYOUTS.has(layout as NodeView['layout'])) return layout as NodeView['layout']
  return 'grid'
}

export function normalizeNodeView(view: NodeView): NodeView {
  return { ...view, layout: normalizeNodeViewLayout(view.layout as string) }
}

export interface NodeComment {
  id: string
  node_id: string
  author: string
  content: string
  created_at: number
  updated_at: number
}

export interface NodeTemplate {
  id: string
  node_id: string
  name: string
  template_data: string // JSON { field_id -> default_value }
  position: number
  created_at: number
}

// ─── Database field type structures (from existing codebase) ───────────────────

export type FieldType =
  | 'rich_text'
  | 'number'
  | 'date_time'
  /** Board / kanban column (options + colors); legacy rows may still use `single_select`. */
  | 'board'
  | 'single_select'
  | 'multi_select'
  | 'checkbox'
  | 'url'
  | 'checklist'
  | 'last_edited_time'
  | 'created_time'
  | 'time'
  | 'media'
  | 'date'
  /** Stored as plain string in row JSON; grid masks display (not encrypted at rest). */
  | 'protected'

export interface SelectOption {
  id: string
  name: string
  color: string
}

export interface TypeOption {
  format?: string
  date_format?: string
  time_format?: string
  include_time?: boolean
  options?: SelectOption[]
}

export interface Field {
  id: string
  database_id: string
  name: string
  field_type: FieldType
  is_primary: boolean
  type_option: TypeOption
  position: number
  /** Optional Glide column group label (persisted on field JSON). */
  group?: string
}

/**
 * Stored per field in row `properties.cells[field_id]`; Rust `ws_update_cell` uses the same shape (`field::CellData`).
 * All database views (grid, board, calendar, chart) read this contract — no per-view cell schema.
 */
export interface CellData {
  type: string
  value: unknown
  /** Excel-style expression; evaluated client-side (HyperFormula). Cached result in `value`. */
  formula?: string | null
  /** Last evaluation error (e.g. HyperFormula), if any. */
  evalError?: string | null
}

// ─── Properties parsers ──────────────────────────────────────────────────────

export interface DatabaseProperties {
  fields: Field[]
}

export interface RowProperties {
  cells: Record<string, unknown>
}

/**
 * Workspace Rust code stores many `field.type_option` values as a JSON **string** (double-encoded in `properties`).
 * Plain `JSON.parse(properties)` leaves `type_option` as a string, so `type_option.options` is undefined in TS.
 */
export function normalizeFieldTypeOption(raw: unknown): TypeOption {
  if (raw == null) return {}
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return { options: [] }
    try {
      const o = JSON.parse(t) as unknown
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        return o as TypeOption
      }
      return {}
    } catch {
      return {}
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as TypeOption
  }
  return {}
}

export function parseDatabaseProperties(node: WorkspaceNode): DatabaseProperties {
  const parsed = JSON.parse(node.properties) as { fields?: Field[] }
  const rawFields = parsed.fields ?? []
  return {
    fields: rawFields.map((field) => ({
      ...field,
      type_option: normalizeFieldTypeOption((field as Field).type_option as unknown),
    })),
  }
}

export function parseRowProperties(node: WorkspaceNode): RowProperties {
  return JSON.parse(node.properties) as RowProperties
}

export function parseNodeBody(node: WorkspaceNode): unknown {
  return JSON.parse(node.body)
}

export function parseFilters(node: NodeView): unknown[] {
  return JSON.parse(node.filters)
}

export function parseSorts(node: NodeView): unknown[] {
  return JSON.parse(node.sorts)
}

export function parseViewOptions(node: NodeView): Record<string, unknown> {
  return JSON.parse(node.view_options)
}

/** `node_views.view_options` key: board layout groups cards by this `board` / `single_select` field id. */
export const BOARD_VIEW_GROUP_FIELD_OPTION_KEY = 'boardGroupFieldId'
