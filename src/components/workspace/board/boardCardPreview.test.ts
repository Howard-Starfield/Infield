import { describe, it, expect } from 'vitest'
import { boardCardBodyPreview, boardCardContentSourceText } from './boardCardPreview'
import type { Field, WorkspaceNode } from '@/types/workspace'

describe('boardCardBodyPreview', () => {
  it('returns empty for blank markdown', () => {
    expect(boardCardBodyPreview('')).toBe('')
    expect(boardCardBodyPreview('   \n  ')).toBe('')
  })

  it('flattens and truncates long plain text', () => {
    const long = 'a'.repeat(200)
    const out = boardCardBodyPreview(long, 50)
    expect(out.length).toBeLessThanOrEqual(51)
    expect(out.endsWith('…')).toBe(true)
  })

  it('strips simple markdown to plain', () => {
    expect(boardCardBodyPreview('## Hello **world**')).toContain('Hello world')
  })
})

describe('boardCardContentSourceText', () => {
  const contentField: Field = {
    id: 'cf1',
    database_id: 'db',
    name: 'card_content',
    field_type: 'rich_text',
    is_primary: false,
    type_option: {},
    position: 2,
  }

  it('prefers cell value when non-empty', () => {
    const row = {
      id: 'r1',
      properties: JSON.stringify({
        cells: { cf1: { type: 'rich_text', value: 'From cell' } },
      }),
      body: 'From body',
    } as WorkspaceNode
    expect(boardCardContentSourceText(row, contentField)).toBe('From cell')
  })

  it('falls back to row.body when cell empty', () => {
    const row = {
      id: 'r2',
      properties: JSON.stringify({ cells: {} }),
      body: 'Legacy markdown',
    } as WorkspaceNode
    expect(boardCardContentSourceText(row, contentField)).toBe('Legacy markdown')
  })

  it('uses row.body when no content field', () => {
    const row = { id: 'r3', properties: '{}', body: 'Only body' } as WorkspaceNode
    expect(boardCardContentSourceText(row, undefined)).toBe('Only body')
  })
})
