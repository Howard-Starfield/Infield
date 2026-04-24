import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { CompletionContext } from '@codemirror/autocomplete'
import { slashCompletionSource } from '../slashCompletion'
import { tier1SlashCommands } from '../slashCommands'

/** Build a minimal CompletionContext for testing. */
function ctx(doc: string, pos: number, explicit = false): CompletionContext {
  const state = EditorState.create({ doc })
  return {
    state,
    pos,
    explicit,
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

describe('slashCompletionSource', () => {
  const source = slashCompletionSource(tier1SlashCommands)

  it('triggers at the start of an empty line', () => {
    const result = source(ctx('/', 1))
    expect(result).not.toBeNull()
    expect(result!.options.length).toBe(tier1SlashCommands.length)
  })

  it('triggers after indentation only', () => {
    const result = source(ctx('  /', 3))
    expect(result).not.toBeNull()
  })

  it('does NOT trigger mid-sentence', () => {
    const result = source(ctx('go to /usr', 10))
    expect(result).toBeNull()
  })

  it('filters by query prefix, case-insensitive', () => {
    const result = source(ctx('/ta', 3))
    expect(result).not.toBeNull()
    const labels = result!.options.map((o) => o.label)
    expect(labels).toContain('Table')
    expect(labels).not.toContain('Heading 1')
  })

  it('matches aliases', () => {
    const result = source(ctx('/bullet', 7))
    expect(result).not.toBeNull()
    const labels = result!.options.map((o) => o.label)
    expect(labels).toContain('Bulleted list')
  })

  it('returns empty options when query matches nothing', () => {
    const result = source(ctx('/zzznothing', 11))
    expect(result).not.toBeNull()
    expect(result!.options.length).toBe(0)
  })
})
