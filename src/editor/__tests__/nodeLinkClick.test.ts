import { describe, it, expect, vi, afterEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { findNodeLinkRanges, nodeLinkClickPlugin } from '../nodeLinkClick'

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

describe('nodeLinkClickPlugin click handler', () => {
  let view: EditorView | null = null

  afterEach(() => {
    view?.destroy()
    view = null
  })

  const mountWith = (onClick: (id: string, opts: { meta: boolean }) => void) => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const state = EditorState.create({
      doc: 'See [Alpha](node://abc-123) for details.',
      extensions: [markdown(), nodeLinkClickPlugin(onClick)],
    })
    view = new EditorView({ state, parent })
    return view
  }

  const findDecoratedEl = (v: EditorView) => {
    const el = v.dom.querySelector<HTMLElement>('[data-node-id]')
    expect(el, 'expected a decorated [data-node-id] span').toBeTruthy()
    return el!
  }

  it('plain click invokes onClick with meta:false', () => {
    const onClick = vi.fn()
    const v = mountWith(onClick)
    const el = findDecoratedEl(v)
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      metaKey: false,
      ctrlKey: false,
    })
    el.dispatchEvent(ev)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith('abc-123', { meta: false })
  })

  it('Cmd-click invokes onClick with meta:true', () => {
    const onClick = vi.fn()
    const v = mountWith(onClick)
    const el = findDecoratedEl(v)
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      ctrlKey: false,
    })
    el.dispatchEvent(ev)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith(expect.any(String), { meta: true })
  })

  it('Ctrl-click invokes onClick with meta:true', () => {
    const onClick = vi.fn()
    const v = mountWith(onClick)
    const el = findDecoratedEl(v)
    const ev = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      metaKey: false,
      ctrlKey: true,
    })
    el.dispatchEvent(ev)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith(expect.any(String), { meta: true })
  })
})
