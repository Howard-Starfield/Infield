import { describe, it, expect } from 'vitest'
import { flattenVisible } from '../Tree'
import type { WorkspaceNode } from '../../bindings'

function n(id: string, name: string, parent: string | null = null): WorkspaceNode {
  return {
    id, name, parent_id: parent, node_type: 'document', icon: '📄',
    position: 1, created_at: 0, updated_at: 0, deleted_at: null,
    properties: '{}', body: '',
  }
}

function state(roots: string[], children: Record<string, string[]>, nodes: WorkspaceNode[], expanded: string[] = [], filter = '') {
  const nmap = new Map<string, WorkspaceNode>()
  for (const x of nodes) nmap.set(x.id, x)
  const cmap = new Map<string, string[]>()
  cmap.set('__root__', roots)
  for (const k of Object.keys(children)) cmap.set(k, children[k])
  return {
    nodes: nmap,
    childrenByParent: cmap,
    expanded: new Set(expanded),
    filter,
    loading: false,
    error: null,
  }
}

describe('flattenVisible', () => {
  it('returns roots in order when nothing is expanded', () => {
    const s = state(['a', 'b'], {}, [n('a', 'Alpha'), n('b', 'Beta')])
    const rows = flattenVisible(s)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
    expect(rows.every((r) => r.depth === 0)).toBe(true)
  })

  it('shows children when parent is expanded', () => {
    const s = state(
      ['a'],
      { a: ['a1', 'a2'] },
      [n('a', 'Alpha'), n('a1', 'Alpha1', 'a'), n('a2', 'Alpha2', 'a')],
      ['a'],
    )
    const rows = flattenVisible(s)
    expect(rows.map((r) => r.id)).toEqual(['a', 'a1', 'a2'])
    expect(rows[1].depth).toBe(1)
  })

  it('filters by substring case-insensitively', () => {
    const s = state(
      ['a', 'b'],
      {},
      [n('a', 'Alpha'), n('b', 'Beta Gamma')],
      [],
      'gamma',
    )
    const rows = flattenVisible(s)
    expect(rows.map((r) => r.id)).toEqual(['b'])
  })

  it('keeps ancestor visible when descendant matches', () => {
    const s = state(
      ['a'],
      { a: ['a1'] },
      [n('a', 'Outer'), n('a1', 'Target Leaf', 'a')],
      [],
      'target',
    )
    const rows = flattenVisible(s)
    expect(rows.map((r) => r.id)).toEqual(['a', 'a1'])
  })
})
