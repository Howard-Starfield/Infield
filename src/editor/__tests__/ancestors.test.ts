import { describe, expect, test, beforeEach, vi } from 'vitest'
import { getAncestors, clearAncestorsCache } from '../ancestors'
import type { WorkspaceNode } from '../../bindings'

function node(id: string, parent: string | null, name = id): WorkspaceNode {
  return {
    id, parent_id: parent, name, icon: '📄',
    node_type: 'document', position: 0, body: '',
    properties: '{}', created_at: 0, updated_at: 0,
    deleted_at: null, vault_rel_path: null, vault_version: 0,
  } as unknown as WorkspaceNode
}

function makeCommands(chain: Record<string, WorkspaceNode | undefined>) {
  const getNode = vi.fn(async (id: string) => {
    const n = chain[id]
    if (!n) return { status: 'error' as const, error: 'not found' }
    return { status: 'ok' as const, data: n }
  })
  return { getNode } as any
}

describe('getAncestors', () => {
  beforeEach(() => clearAncestorsCache())

  test('returns leaf-alone for a root node', async () => {
    const cmds = makeCommands({ root: node('root', null) })
    const chain = await getAncestors('root', cmds)
    expect(chain.map(n => n.id)).toEqual(['root'])
  })

  test('returns root-to-leaf order for a 3-level chain', async () => {
    const cmds = makeCommands({
      root: node('root', null),
      mid:  node('mid', 'root'),
      leaf: node('leaf', 'mid'),
    })
    const chain = await getAncestors('leaf', cmds)
    expect(chain.map(n => n.id)).toEqual(['root', 'mid', 'leaf'])
  })

  test('stops at missing parent (partial chain)', async () => {
    const cmds = makeCommands({
      leaf: node('leaf', 'ghost'),
    })
    const chain = await getAncestors('leaf', cmds)
    expect(chain.map(n => n.id)).toEqual(['leaf'])
  })

  test('cycle guard — self-parent returns single node (no infinite loop)', async () => {
    const cmds = makeCommands({
      cyclic: node('cyclic', 'cyclic'),
    })
    const chain = await getAncestors('cyclic', cmds)
    expect(chain.length).toBeLessThanOrEqual(64)
    expect(chain.length).toBeGreaterThan(0)
  })

  test('depth cap at 64 prevents unbounded walk', async () => {
    const chainMap: Record<string, WorkspaceNode> = {}
    for (let i = 0; i < 100; i++) {
      chainMap[`n${i}`] = node(`n${i}`, i === 0 ? null : `n${i - 1}`)
    }
    const cmds = makeCommands(chainMap)
    const chain = await getAncestors('n99', cmds)
    expect(chain.length).toBe(64)
  })

  test('cache hit — second call with same leaf id does not re-invoke getNode', async () => {
    const cmds = makeCommands({
      root: node('root', null),
      leaf: node('leaf', 'root'),
    })
    await getAncestors('leaf', cmds)
    cmds.getNode.mockClear()
    const second = await getAncestors('leaf', cmds)
    expect(cmds.getNode).not.toHaveBeenCalled()
    expect(second.map(n => n.id)).toEqual(['root', 'leaf'])
  })

  test('clearAncestorsCache forces re-fetch', async () => {
    const cmds = makeCommands({
      root: node('root', null),
      leaf: node('leaf', 'root'),
    })
    await getAncestors('leaf', cmds)
    clearAncestorsCache()
    cmds.getNode.mockClear()
    await getAncestors('leaf', cmds)
    expect(cmds.getNode).toHaveBeenCalled()
  })
})
