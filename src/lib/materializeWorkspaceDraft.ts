import { invoke } from '@tauri-apps/api/core'
import type { WorkspaceDatabaseDraft } from '@/lib/workspaceDraftSchema'
import { draftFieldTypeToAppFieldType } from '@/lib/workspaceDraftSchema'
import { evaluateSameRowFormulas } from '@/lib/workspaceFormulas'
import type { Field, WorkspaceNode } from '@/types/workspace'
import { parseDatabaseProperties } from '@/types/workspace'

export interface MaterializeDraftDeps {
  createNode: (parentId: string | null, nodeType: 'document' | 'database' | 'row', name: string) => Promise<WorkspaceNode>
  renameField: (databaseId: string, fieldId: string, name: string) => Promise<WorkspaceNode>
  addField: (databaseId: string, fieldName: string, fieldType: string) => Promise<WorkspaceNode>
  updateCell: (
    rowId: string,
    fieldId: string,
    cellType: string,
    value: unknown,
    isPrimary?: boolean,
    cellExtras?: { formula?: string | null; evalError?: string | null } | null,
  ) => Promise<void>
  loadNodeChildren: (databaseId: string) => Promise<void>
}

function rowPrimaryTitle(draft: WorkspaceDatabaseDraft, row: Record<string, unknown>): string {
  const primaryName = draft.fields[0]?.name?.trim() ?? 'Name'
  const v = row[primaryName]
  if (v === null || v === undefined) return ''
  if (typeof v === 'object' && v !== null && 'formula' in v) return ''
  return String(v)
}

export async function materializeWorkspaceDraft(
  draft: WorkspaceDatabaseDraft,
  parentId: string | null,
  deps: MaterializeDraftDeps,
): Promise<{ databaseId: string }> {
  const db = await deps.createNode(parentId, 'database', draft.database_name)
  const databaseId = db.id

  let node = await invoke<WorkspaceNode | null>('get_node', { id: databaseId })
  if (!node) throw new Error('Database node missing after create')
  let props = parseDatabaseProperties(node)
  let fields = [...props.fields].sort((a, b) => a.position - b.position)
  const first = fields[0]
  if (!first) throw new Error('Database has no default field')

  await deps.renameField(databaseId, first.id, draft.fields[0].name.trim())

  for (let i = 1; i < draft.fields.length; i++) {
    const df = draft.fields[i]
    const ft = draftFieldTypeToAppFieldType(df.field_type)
    node = await deps.addField(databaseId, df.name.trim(), ft)
  }

  node = await invoke<WorkspaceNode | null>('get_node', { id: databaseId })
  if (!node) throw new Error('Database reload failed')
  props = parseDatabaseProperties(node)
  fields = [...props.fields].sort((a, b) => a.position - b.position)

  const mergedForFormat: Field[] = fields.map((f) => {
    const df = draft.fields.find((d) => d.name.trim() === f.name.trim())
    if (f.field_type === 'number' && df?.format) {
      return { ...f, type_option: { ...f.type_option, format: df.format } }
    }
    return f
  })
  await invoke('update_node', {
    id: databaseId,
    name: node.name,
    icon: node.icon,
    properties: JSON.stringify({ fields: mergedForFormat }),
    body: node.body,
  })

  node = await invoke<WorkspaceNode | null>('get_node', { id: databaseId })
  if (!node) throw new Error('Database reload after format patch failed')
  fields = [...parseDatabaseProperties(node).fields].sort((a, b) => a.position - b.position)

  const primaryFieldId = fields[0]?.id
  const primaryName = draft.fields[0].name.trim()

  for (const row of draft.rows) {
    const title = rowPrimaryTitle(draft, row)
    const rowNode = await deps.createNode(databaseId, 'row', title || ' ')

    const cellsByFieldId: Record<string, unknown> = {}
    for (const f of fields) {
      const df = draft.fields.find((d) => d.name.trim() === f.name.trim())
      if (!df) continue
      const key = df.name.trim()
      if (!(key in row)) continue
      const cell = row[key]
      if (typeof cell === 'object' && cell !== null && 'formula' in cell && typeof (cell as { formula: unknown }).formula === 'string') {
        cellsByFieldId[f.id] = {
          type: f.field_type,
          value: null,
          formula: (cell as { formula: string }).formula,
        }
      } else {
        cellsByFieldId[f.id] = { type: f.field_type, value: cell }
      }
    }

    const evaluated = evaluateSameRowFormulas(fields, cellsByFieldId)

    for (const f of fields) {
      const df = draft.fields.find((d) => d.name.trim() === f.name.trim())
      if (!df) continue
      const key = df.name.trim()
      if (!(key in row)) continue

      const ev = evaluated[f.id]
      const staged = cellsByFieldId[f.id] as { formula?: string } | undefined
      const formula = typeof staged?.formula === 'string' ? staged.formula : null
      const isPrimary = f.id === primaryFieldId

      let value: unknown = ev?.value ?? null
      if (f.field_type === 'checkbox') {
        value = value === true || value === 'true' || value === 1 || value === '1'
      }
      if (f.field_type === 'number' && typeof value === 'string') {
        const n = parseFloat(value)
        value = Number.isFinite(n) ? n : null
      }

      const extras =
        formula != null && formula !== ''
          ? { formula, evalError: ev?.evalError ?? null }
          : ev?.evalError
            ? { formula: null, evalError: ev.evalError }
            : null

      await deps.updateCell(rowNode.id, f.id, f.field_type, value, isPrimary, extras)
    }

    const primaryVal = primaryFieldId ? evaluated[primaryFieldId]?.value : undefined
    const primaryStr =
      primaryVal === null || primaryVal === undefined ? '' : String(primaryVal)
    if (primaryFieldId && primaryStr !== title) {
      const fresh = await invoke<WorkspaceNode | null>('get_node', { id: rowNode.id })
      if (fresh) {
        await invoke('update_node', {
          id: rowNode.id,
          name: primaryStr || ' ',
          icon: fresh.icon,
          properties: fresh.properties,
          body: fresh.body,
        })
      }
    }
  }

  await deps.loadNodeChildren(databaseId)
  return { databaseId }
}
