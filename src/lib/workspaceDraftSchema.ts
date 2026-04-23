import { z } from 'zod'
import type { FieldType } from '@/types/workspace'

/** Max limits for AI-generated workspace database drafts (preview + materialize). */
export const WORKSPACE_DRAFT_MAX_FIELDS = 32
export const WORKSPACE_DRAFT_MAX_ROWS = 200
export const WORKSPACE_DRAFT_MAX_NAME_LEN = 200
export const WORKSPACE_DRAFT_MAX_CELL_STR = 8000
export const WORKSPACE_DRAFT_MAX_FORMULA_LEN = 4096

const draftableFieldTypes = z.enum([
  'rich_text',
  'number',
  'checkbox',
  'date',
  'date_time',
  'url',
])

export type DraftableFieldType = z.infer<typeof draftableFieldTypes>

const cellPrimitive = z.union([
  z.string().max(WORKSPACE_DRAFT_MAX_CELL_STR),
  z.number(),
  z.boolean(),
  z.null(),
])

const cellWithFormula = z.object({
  formula: z.string().min(1).max(WORKSPACE_DRAFT_MAX_FORMULA_LEN),
})

const draftRowCell = z.union([cellPrimitive, cellWithFormula])

export const workspaceDraftFieldSchema = z.object({
  name: z.string().trim().min(1).max(WORKSPACE_DRAFT_MAX_NAME_LEN),
  field_type: draftableFieldTypes,
  is_primary: z.boolean().optional(),
  /** Number format hint (e.g. `0.00`, `currency`); applied to `number` fields when materializing. */
  format: z.string().max(80).optional(),
})

export const workspaceDatabaseDraftSchema = z
  .object({
    database_name: z.string().trim().min(1).max(WORKSPACE_DRAFT_MAX_NAME_LEN),
    fields: z.array(workspaceDraftFieldSchema).min(1).max(WORKSPACE_DRAFT_MAX_FIELDS),
    rows: z.array(z.record(z.string(), draftRowCell)).max(WORKSPACE_DRAFT_MAX_ROWS),
  })
  .superRefine((data, ctx) => {
    const names = data.fields.map((f) => f.name.trim().toLowerCase())
    const dup = names.find((n, i) => names.indexOf(n) !== i)
    if (dup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate field name (case-insensitive): ${dup}`,
        path: ['fields'],
      })
    }
    const primaryCount = data.fields.filter((f) => f.is_primary === true).length
    if (primaryCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At most one field may have is_primary: true',
        path: ['fields'],
      })
    }
    const first = data.fields[0]
    if (first.field_type !== 'rich_text') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'First field must be rich_text (primary title column)',
        path: ['fields', 0, 'field_type'],
      })
    }
    const keySet = new Set(data.fields.map((f) => f.name.trim()))
    for (let ri = 0; ri < data.rows.length; ri++) {
      const row = data.rows[ri]
      for (const k of Object.keys(row)) {
        if (!keySet.has(k.trim())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Row ${ri}: unknown column "${k}" (not in fields)`,
            path: ['rows', ri, k],
          })
        }
      }
    }
  })

export type WorkspaceDatabaseDraft = z.infer<typeof workspaceDatabaseDraftSchema>

export type WorkspaceDraftParseResult =
  | { ok: true; draft: WorkspaceDatabaseDraft }
  | { ok: false; error: string }

export function parseWorkspaceDatabaseDraftJson(raw: unknown): WorkspaceDraftParseResult {
  const parsed = workspaceDatabaseDraftSchema.safeParse(raw)
  if (!parsed.success) {
    const msg = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')
    return { ok: false, error: msg }
  }
  return { ok: true, draft: parsed.data }
}

/** Fenced block marker for LLM fallback (Option C in plan). */
export const WORKSPACE_DRAFT_FENCE = '```handy_workspace_draft'

export function tryExtractWorkspaceDraftFromAssistantText(text: string): WorkspaceDraftParseResult {
  const lower = text.indexOf(WORKSPACE_DRAFT_FENCE)
  if (lower === -1) {
    const fence = '```json'
    const i = text.lastIndexOf(fence)
    if (i === -1) return { ok: false, error: 'No handy_workspace_draft or json fence found' }
    const after = text.slice(i + fence.length)
    const end = after.indexOf('```')
    const body = (end === -1 ? after : after.slice(0, end)).trim()
    try {
      return parseWorkspaceDatabaseDraftJson(JSON.parse(body))
    } catch {
      return { ok: false, error: 'Invalid JSON inside ```json fence' }
    }
  }
  const after = text.slice(lower + WORKSPACE_DRAFT_FENCE.length)
  const nl = after.indexOf('\n')
  const bodyStart = nl === -1 ? after : after.slice(nl + 1)
  const end = bodyStart.indexOf('```')
  const body = (end === -1 ? bodyStart : bodyStart.slice(0, end)).trim()
  try {
    return parseWorkspaceDatabaseDraftJson(JSON.parse(body))
  } catch {
    return { ok: false, error: 'Invalid JSON inside handy_workspace_draft fence' }
  }
}

export function draftFieldTypeToAppFieldType(t: DraftableFieldType): FieldType {
  return t as FieldType
}
