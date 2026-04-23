import { extractPlainTextFromMarkdown } from '@/lib/utils/editorUtils'
import type { Field, WorkspaceNode } from '@/types/workspace'

/** Single-line plain preview of row markdown for board cards. */
export function boardCardBodyPreview(body: string | undefined | null, maxLen = 160): string {
  const plain = extractPlainTextFromMarkdown(body ?? '')
  if (!plain) return ''
  const oneLine = plain.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= maxLen) return oneLine
  return `${oneLine.slice(0, maxLen)}…`
}

/** Plain string from a row's `rich_text` cell for the given field. */
export function readRichTextCellString(row: WorkspaceNode, field: Field | undefined): string {
  if (!field) return ''
  try {
    const cells = JSON.parse(row.properties || '{}').cells ?? {}
    const cell = cells[field.id] as { value?: unknown } | undefined
    const v = cell?.value
    if (v == null) return ''
    if (field.field_type === 'number' && typeof v === 'number') return String(v)
    return typeof v === 'string' ? v : String(v)
  } catch {
    return ''
  }
}

/**
 * Text used for the muted “content” line on board cards: `card_content` cell when the schema
 * defines that column, otherwise legacy `row.body`.
 */
export function boardCardContentSourceText(row: WorkspaceNode, contentField: Field | undefined): string {
  if (contentField) {
    const fromCell = readRichTextCellString(row, contentField)
    if (fromCell.trim()) return fromCell
  }
  return row.body ?? ''
}

export function boardCardBodyPreviewFromRow(
  row: WorkspaceNode,
  contentField: Field | undefined,
  maxLen = 160,
): string {
  return boardCardBodyPreview(boardCardContentSourceText(row, contentField), maxLen)
}
