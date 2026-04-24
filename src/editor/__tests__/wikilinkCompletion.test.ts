import { describe, it, expect, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { CompletionContext } from '@codemirror/autocomplete'
import { wikilinkCompletionSource } from '../wikilinkCompletion'

function ctx(doc: string, pos: number): CompletionContext {
  const state = EditorState.create({ doc })
  return {
    state,
    pos,
    explicit: false,
    aborted: false,
    matchBefore: (re: RegExp) => {
      const line = state.doc.lineAt(pos)
      const text = state.sliceDoc(line.from, pos)
      const match = text.match(re)
      if (!match) return null
      return { from: pos - match[0].length, to: pos, text: match[0] }
    },
    tokenBefore: () => null,
    addEventListener: () => {},
  } as unknown as CompletionContext
}

describe('wikilinkCompletionSource', () => {
  it('triggers on [[ with no query', async () => {
    const fakeSearch = vi.fn().mockResolvedValue([
      { id: 'abc-1', name: 'Project Alpha', node_type: 'document', icon: '📄', parent_name: null },
    ])
    const source = wikilinkCompletionSource(fakeSearch)
    const result = await source(ctx('[[', 2))
    expect(result).not.toBeNull()
    expect(fakeSearch).toHaveBeenCalledWith('', 10)
    expect(result!.options[0].label).toBe('Project Alpha')
  })

  it('triggers on [[query and forwards query to search', async () => {
    const fakeSearch = vi.fn().mockResolvedValue([])
    const source = wikilinkCompletionSource(fakeSearch)
    const result = await source(ctx('[[proj', 6))
    expect(result).not.toBeNull()
    expect(fakeSearch).toHaveBeenCalledWith('proj', 10)
  })

  it('does NOT trigger when only one [ present', async () => {
    const fakeSearch = vi.fn()
    const source = wikilinkCompletionSource(fakeSearch)
    const result = await source(ctx('[proj', 5))
    expect(result).toBeNull()
    expect(fakeSearch).not.toHaveBeenCalled()
  })

  it('does NOT trigger after the closing ]]', async () => {
    const fakeSearch = vi.fn()
    const source = wikilinkCompletionSource(fakeSearch)
    const result = await source(ctx('[[done]] more', 13))
    expect(result).toBeNull()
  })

  it('apply replaces [[query with [title](node://uuid)', async () => {
    const fakeSearch = vi.fn().mockResolvedValue([
      { id: 'abc-123', name: 'Project Alpha', node_type: 'document', icon: '📄', parent_name: null },
    ])
    const source = wikilinkCompletionSource(fakeSearch)
    const result = await source(ctx('[[proj', 6))
    const opt = result!.options[0]
    expect(result!.from).toBe(0)
    expect(result!.to).toBe(6)
    expect(typeof opt.apply).toBe('function')
  })
})
