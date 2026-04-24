import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { findNodeLinkRanges } from '../nodeLinkClick'

describe('findNodeLinkRanges', () => {
  const stateOf = (doc: string) =>
    EditorState.create({ doc, extensions: [markdown()] })

  it('finds one node:// URL', () => {
    const state = stateOf('See [Alpha](node://abc-123) for details.')
    const ranges = findNodeLinkRanges(state)
    expect(ranges).toHaveLength(1)
    expect(ranges[0].nodeId).toBe('abc-123')
    const sliced = state.sliceDoc(ranges[0].from, ranges[0].to)
    expect(sliced).toContain('node://abc-123')
  })

  it('ignores non-node URLs', () => {
    const state = stateOf('See [docs](https://example.com) too.')
    expect(findNodeLinkRanges(state)).toHaveLength(0)
  })

  it('handles multiple links', () => {
    const state = stateOf(
      'First [A](node://aaa) second [B](node://bbb) third.',
    )
    const ranges = findNodeLinkRanges(state)
    expect(ranges).toHaveLength(2)
    expect(ranges.map((r) => r.nodeId)).toEqual(['aaa', 'bbb'])
  })
})
