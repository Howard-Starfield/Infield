import { describe, expect, it } from 'vitest'
import {
  applyCardDropToColumns,
  buildColumnRowIdMap,
  finalSiblingRowOrder,
  flattenBoardRowOrder,
  getRowSelectValue,
} from './boardDragHelpers'
import type { WorkspaceNode } from '@/types/workspace'

function row(id: string, opt: string | null, position: number): WorkspaceNode {
  const cells = opt === null ? {} : { f1: { value: opt } }
  return {
    id,
    parent_id: 'db1',
    node_type: 'row',
    name: id,
    icon: '',
    position,
    created_at: 0,
    updated_at: 0,
    deleted_at: null,
    properties: JSON.stringify({ cells }),
    body: '',
  }
}

describe('boardDragHelpers', () => {
  it('getRowSelectValue reads cell value for field', () => {
    const r = row('a', 'c1', 0)
    expect(getRowSelectValue(r, 'f1')).toBe('c1')
    expect(getRowSelectValue(row('b', null, 0), 'f1')).toBeNull()
  })

  it('buildColumnRowIdMap buckets by select value', () => {
    const children = [row('a', 'c1', 0), row('b', 'c2', 1), row('c', 'c1', 2)]
    const m = buildColumnRowIdMap(children, 'f1', ['c1', 'c2'])
    expect(m.get('c1')).toEqual(['a', 'c'])
    expect(m.get('c2')).toEqual(['b'])
  })

  it('buildColumnRowIdMap ignores rows whose option id is not in column list', () => {
    const children = [row('a', 'unknown', 0), row('b', 'c1', 1)]
    const m = buildColumnRowIdMap(children, 'f1', ['c1', 'c2'])
    expect(m.get('c1')).toEqual(['b'])
    expect(m.get('c2')).toEqual([])
  })

  it('applyCardDropToColumns returns null when active equals over', () => {
    const map = new Map<string, string[]>([
      ['c1', ['a', 'b']],
      ['c2', ['x']],
    ])
    expect(applyCardDropToColumns('a', 'a', ['c1', 'c2'], map)).toBeNull()
  })

  it('applyCardDropToColumns reorders within same column before target row', () => {
    const map = new Map<string, string[]>([
      ['c1', ['a', 'b', 'c']],
      ['c2', []],
    ])
    const next = applyCardDropToColumns('c', 'a', ['c1', 'c2'], map)
    expect(next!.get('c1')).toEqual(['c', 'a', 'b'])
    expect(next!.get('c2')).toEqual([])
  })

  it('applyCardDropToColumns moves card to another column before target row', () => {
    const map = new Map<string, string[]>([
      ['c1', ['a', 'b']],
      ['c2', ['x']],
    ])
    const next = applyCardDropToColumns('b', 'x', ['c1', 'c2'], map)
    expect(next).not.toBeNull()
    expect(next!.get('c1')).toEqual(['a'])
    expect(next!.get('c2')).toEqual(['b', 'x'])
  })

  it('applyCardDropToColumns appends when over is column id', () => {
    const map = new Map<string, string[]>([
      ['c1', ['a']],
      ['c2', ['x']],
    ])
    const next = applyCardDropToColumns('a', 'c2', ['c1', 'c2'], map)
    expect(next!.get('c1')).toEqual([])
    expect(next!.get('c2')).toEqual(['x', 'a'])
  })

  it('applyCardDropToColumns appends when over is column body droppable id', () => {
    const map = new Map<string, string[]>([
      ['c1', ['a']],
      ['c2', ['x']],
    ])
    const next = applyCardDropToColumns('a', 'board-col-body:c2', ['c1', 'c2'], map)
    expect(next!.get('c1')).toEqual([])
    expect(next!.get('c2')).toEqual(['x', 'a'])
  })

  it('finalSiblingRowOrder appends off-board rows', () => {
    const col = new Map<string, string[]>([
      ['c1', ['a']],
      ['c2', []],
    ])
    const children = [
      row('a', 'c1', 0),
      row('z', null, 1),
    ]
    expect(finalSiblingRowOrder(['c1', 'c2'], col, children)).toEqual(['a', 'z'])
  })

  it('flattenBoardRowOrder follows column order', () => {
    const col = new Map<string, string[]>([
      ['c1', ['a', 'b']],
      ['c2', ['x']],
    ])
    expect(flattenBoardRowOrder(['c1', 'c2'], col)).toEqual(['a', 'b', 'x'])
  })
})
