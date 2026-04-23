import { describe, it, expect, vi, afterEach } from 'vitest'
import { resolveCrossDatabaseDropTarget } from './boardCrossWorkspaceDrop'
import {
  WORKSPACE_BOARD_DATABASE_ATTR,
  WORKSPACE_NODE_ID_ATTR,
  WORKSPACE_NODE_TYPE_ATTR,
  WORKSPACE_ROW_PARENT_ATTR,
} from './workspaceDropDataAttrs'

let origElementsFromPoint: typeof document.elementsFromPoint | undefined

function mockElementsFromPoint(elements: Element[]) {
  origElementsFromPoint = document.elementsFromPoint
  document.elementsFromPoint = vi.fn().mockReturnValue(elements) as typeof document.elementsFromPoint
}

afterEach(() => {
  if (origElementsFromPoint !== undefined) {
    document.elementsFromPoint = origElementsFromPoint
    origElementsFromPoint = undefined
  }
  vi.restoreAllMocks()
})

describe('resolveCrossDatabaseDropTarget', () => {
  it('returns target database id from another board strip (topmost)', () => {
    const strip = document.createElement('div')
    strip.setAttribute(WORKSPACE_BOARD_DATABASE_ATTR, 'db-target')
    mockElementsFromPoint([strip])
    expect(resolveCrossDatabaseDropTarget(10, 20, 'db-source')).toBe('db-target')
  })

  it('ignores same-database board strip and continues', () => {
    const sameStrip = document.createElement('div')
    sameStrip.setAttribute(WORKSPACE_BOARD_DATABASE_ATTR, 'db-source')
    const treeDb = document.createElement('div')
    treeDb.setAttribute(WORKSPACE_NODE_TYPE_ATTR, 'database')
    treeDb.setAttribute(WORKSPACE_NODE_ID_ATTR, 'db-target')
    mockElementsFromPoint([sameStrip, treeDb])
    expect(resolveCrossDatabaseDropTarget(0, 0, 'db-source')).toBe('db-target')
  })

  it('returns database id from tree database row', () => {
    const treeDb = document.createElement('div')
    treeDb.setAttribute(WORKSPACE_NODE_TYPE_ATTR, 'database')
    treeDb.setAttribute(WORKSPACE_NODE_ID_ATTR, 'db-other')
    mockElementsFromPoint([treeDb])
    expect(resolveCrossDatabaseDropTarget(5, 5, 'db-source')).toBe('db-other')
  })

  it('returns parent database from row tree node', () => {
    const row = document.createElement('div')
    row.setAttribute(WORKSPACE_NODE_TYPE_ATTR, 'row')
    row.setAttribute(WORKSPACE_ROW_PARENT_ATTR, 'db-parent')
    mockElementsFromPoint([row])
    expect(resolveCrossDatabaseDropTarget(1, 1, 'db-source')).toBe('db-parent')
  })

  it('returns null when stack only contains same source database', () => {
    const treeDb = document.createElement('div')
    treeDb.setAttribute(WORKSPACE_NODE_TYPE_ATTR, 'database')
    treeDb.setAttribute(WORKSPACE_NODE_ID_ATTR, 'db-source')
    mockElementsFromPoint([treeDb])
    expect(resolveCrossDatabaseDropTarget(0, 0, 'db-source')).toBe(null)
  })
})
