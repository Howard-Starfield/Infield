import { describe, expect, it } from 'vitest'
import {
  parseWorkspaceDatabaseDraftJson,
  tryExtractWorkspaceDraftFromAssistantText,
} from './workspaceDraftSchema'

describe('workspaceDraftSchema', () => {
  it('parses minimal valid draft', () => {
    const raw = {
      database_name: 'Tasks',
      fields: [{ name: 'Title', field_type: 'rich_text' as const, is_primary: true }, { name: 'Done', field_type: 'checkbox' as const }],
      rows: [{ Title: 'A', Done: true }],
    }
    const r = parseWorkspaceDatabaseDraftJson(raw)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.draft.database_name).toBe('Tasks')
      expect(r.draft.rows[0].Title).toBe('A')
    }
  })

  it('rejects non-rich_text first field', () => {
    const r = parseWorkspaceDatabaseDraftJson({
      database_name: 'X',
      fields: [{ name: 'N', field_type: 'number' }],
      rows: [],
    })
    expect(r.ok).toBe(false)
  })

  it('extracts from handy_workspace_draft fence', () => {
    const body = {
      database_name: 'Z',
      fields: [{ name: 'Title', field_type: 'rich_text' }],
      rows: [],
    }
    const text = `Here\n\`\`\`handy_workspace_draft\n${JSON.stringify(body)}\n\`\`\``
    const r = tryExtractWorkspaceDraftFromAssistantText(text)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.draft.database_name).toBe('Z')
  })
})
