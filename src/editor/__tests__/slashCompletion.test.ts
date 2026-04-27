import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { CompletionContext } from '@codemirror/autocomplete'
import { slashCompletionSource } from '../slashCompletion'
import { tier1SlashCommands, allSlashCommands } from '../slashCommands'

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
    // tier1SlashCommands all match (no query); plus one section header
    // per non-empty category — block + code => +2.
    const realCommands = result!.options.filter(
      (o) => o.type !== '__section_header',
    )
    expect(realCommands.length).toBe(tier1SlashCommands.length)
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
    const result = source(ctx('/he', 3))
    expect(result).not.toBeNull()
    const labels = result!.options.map((o) => o.label)
    expect(labels).toContain('Heading 1')
    expect(labels).toContain('Heading 2')
    expect(labels).not.toContain('Bulleted list')
  })

  it('does not include Table (deferred to database phase)', () => {
    const result = source(ctx('/', 1))
    expect(result).not.toBeNull()
    const labels = result!.options.map((o) => o.label)
    expect(labels).not.toContain('Table')
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

  it('emits a section header before each category in fixed order block → code → handy', () => {
    const source = slashCompletionSource(allSlashCommands)
    const result = source(ctx('/', 1))
    expect(result).not.toBeNull()
    const opts = result!.options
    const headers = opts.filter((o) => o.type === '__section_header')
    expect(headers.map((h) => h.label)).toEqual(['Basic blocks', 'Code', 'Handy'])

    const idxBlock = opts.findIndex((o) => o.label === 'Basic blocks')
    const idxCode = opts.findIndex((o) => o.label === 'Code')
    const idxHandy = opts.findIndex((o) => o.label === 'Handy')
    expect(idxBlock).toBeLessThan(idxCode)
    expect(idxCode).toBeLessThan(idxHandy)

    // First Heading row appears AFTER 'Basic blocks' header.
    const idxH1 = opts.findIndex((o) => o.label === 'Heading 1')
    expect(idxH1).toBeGreaterThan(idxBlock)
    expect(idxH1).toBeLessThan(idxCode)
  })

  it('omits empty categories (filtered query that matches only block commands)', () => {
    const source = slashCompletionSource(allSlashCommands)
    const result = source(ctx('/h', 2))
    expect(result).not.toBeNull()
    const headers = result!.options.filter((o) => o.type === '__section_header')
    // Only Basic blocks should appear — no /code or /handy match starts with "h".
    expect(headers.map((h) => h.label)).toEqual(['Basic blocks'])
  })

  it('synthesised headers are no-op when applied (apply: () => {})', () => {
    const source = slashCompletionSource(allSlashCommands)
    const result = source(ctx('/', 1))
    const header = result!.options.find((o) => o.type === '__section_header')!
    expect(typeof header.apply).toBe('function')
    // Calling apply with a stub view must not throw and must not return a value.
    expect((header.apply as Function)(/* view */ {}, /* completion */ {}, 0, 1)).toBeUndefined()
  })
})
