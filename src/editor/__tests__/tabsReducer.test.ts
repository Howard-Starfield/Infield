import { beforeEach, describe, expect, test } from 'vitest'
import {
  initialTabsState,
  tabsReducer,
  type TabsAction,
  type TabsState,
} from '../tabsReducer'

// Deterministic id factory — we can't rely on crypto.randomUUID in tests.
// The reducer accepts an `idFactory` prop via its module-level seam.
let counter = 0
const testIdFactory = () => `t${++counter}`

function run(state: TabsState, actions: TabsAction[]): TabsState {
  let s = state
  for (const a of actions) s = tabsReducer(s, a, testIdFactory)
  return s
}

describe('tabsReducer', () => {
  beforeEach(() => { counter = 0 })

  test('initial state has no tabs and null active', () => {
    expect(initialTabsState).toEqual({ tabs: [], activeTabId: null })
  })

  test('OPEN_PREVIEW on empty creates a new preview tab and activates it', () => {
    const s = run(initialTabsState, [{ type: 'OPEN_PREVIEW', nodeId: 'n1' }])
    expect(s.tabs).toHaveLength(1)
    expect(s.tabs[0]).toMatchObject({ nodeId: 'n1', preview: true, dirty: false, scrollTop: 0 })
    expect(s.activeTabId).toBe(s.tabs[0].id)
  })

  test('OPEN_PREVIEW with active preview + clean replaces nodeId in place (tab id stable)', () => {
    const s1 = run(initialTabsState, [{ type: 'OPEN_PREVIEW', nodeId: 'n1' }])
    const firstTabId = s1.tabs[0].id
    const s2 = run(s1, [{ type: 'OPEN_PREVIEW', nodeId: 'n2' }])
    expect(s2.tabs).toHaveLength(1)
    expect(s2.tabs[0].id).toBe(firstTabId)
    expect(s2.tabs[0].nodeId).toBe('n2')
    expect(s2.tabs[0].preview).toBe(true)
    expect(s2.tabs[0].scrollTop).toBe(0)
  })

  test('OPEN_PREVIEW with active preview + dirty creates a new preview tab', () => {
    const s1 = run(initialTabsState, [
      { type: 'OPEN_PREVIEW', nodeId: 'n1' },
      { type: 'MARK_DIRTY', tabId: 't1', dirty: true },
    ])
    const s2 = run(s1, [{ type: 'OPEN_PREVIEW', nodeId: 'n2' }])
    expect(s2.tabs).toHaveLength(2)
    expect(s2.tabs[0].nodeId).toBe('n1')
    expect(s2.tabs[1]).toMatchObject({ nodeId: 'n2', preview: true })
    expect(s2.activeTabId).toBe(s2.tabs[1].id)
  })

  test('OPEN_PREVIEW with active permanent creates a new preview tab', () => {
    const s1 = run(initialTabsState, [{ type: 'OPEN_IN_NEW_TAB', nodeId: 'n1' }])
    const s2 = run(s1, [{ type: 'OPEN_PREVIEW', nodeId: 'n2' }])
    expect(s2.tabs).toHaveLength(2)
    expect(s2.tabs[1].preview).toBe(true)
    expect(s2.activeTabId).toBe(s2.tabs[1].id)
  })

  test('OPEN_IN_NEW_TAB always appends a permanent tab and activates it', () => {
    const s = run(initialTabsState, [
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n1' },
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n2' },
    ])
    expect(s.tabs).toHaveLength(2)
    expect(s.tabs.every(t => !t.preview)).toBe(true)
    expect(s.activeTabId).toBe(s.tabs[1].id)
  })

  test('PROMOTE_PREVIEW flips preview → false; no-op if already permanent', () => {
    const s1 = run(initialTabsState, [{ type: 'OPEN_PREVIEW', nodeId: 'n1' }])
    const s2 = run(s1, [{ type: 'PROMOTE_PREVIEW', tabId: 't1' }])
    expect(s2.tabs[0].preview).toBe(false)
    const s3 = run(s2, [{ type: 'PROMOTE_PREVIEW', tabId: 't1' }])
    expect(s3).toBe(s2)  // reference-equal when no change
  })

  test('MARK_DIRTY flips flag; no-op if unchanged', () => {
    const s1 = run(initialTabsState, [{ type: 'OPEN_PREVIEW', nodeId: 'n1' }])
    const s2 = run(s1, [{ type: 'MARK_DIRTY', tabId: 't1', dirty: true }])
    expect(s2.tabs[0].dirty).toBe(true)
    const s3 = run(s2, [{ type: 'MARK_DIRTY', tabId: 't1', dirty: true }])
    expect(s3).toBe(s2)
  })

  test('CLOSE_TAB in middle activates next-right neighbour', () => {
    const s1 = run(initialTabsState, [
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n1' },
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n2' },
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n3' },
      { type: 'SWITCH_TAB', tabId: 't2' },
    ])
    const s2 = run(s1, [{ type: 'CLOSE_TAB', tabId: 't2' }])
    expect(s2.tabs.map(t => t.nodeId)).toEqual(['n1', 'n3'])
    expect(s2.activeTabId).toBe('t3')
  })

  test('CLOSE_TAB at end activates previous (left)', () => {
    const s1 = run(initialTabsState, [
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n1' },
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n2' },
    ])
    const s2 = run(s1, [{ type: 'CLOSE_TAB', tabId: 't2' }])
    expect(s2.tabs).toHaveLength(1)
    expect(s2.activeTabId).toBe('t1')
  })

  test('CLOSE_TAB last tab yields empty state', () => {
    const s1 = run(initialTabsState, [{ type: 'OPEN_PREVIEW', nodeId: 'n1' }])
    const s2 = run(s1, [{ type: 'CLOSE_TAB', tabId: 't1' }])
    expect(s2.tabs).toEqual([])
    expect(s2.activeTabId).toBeNull()
  })

  test('CLOSE_TAB on non-active tab does not change activeTabId', () => {
    const s1 = run(initialTabsState, [
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n1' },
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n2' },
      { type: 'SWITCH_TAB', tabId: 't2' },
    ])
    const s2 = run(s1, [{ type: 'CLOSE_TAB', tabId: 't1' }])
    expect(s2.tabs).toHaveLength(1)
    expect(s2.activeTabId).toBe('t2')
  })

  test('SWITCH_TAB to existing id updates activeTabId', () => {
    const s1 = run(initialTabsState, [
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n1' },
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n2' },
    ])
    const s2 = run(s1, [{ type: 'SWITCH_TAB', tabId: 't1' }])
    expect(s2.activeTabId).toBe('t1')
  })

  test('SWITCH_TAB to missing id is a no-op', () => {
    const s1 = run(initialTabsState, [{ type: 'OPEN_IN_NEW_TAB', nodeId: 'n1' }])
    const s2 = run(s1, [{ type: 'SWITCH_TAB', tabId: 'missing' }])
    expect(s2).toBe(s1)
  })

  test('SWITCH_TO_INDEX clamps to tabs.length - 1', () => {
    const s1 = run(initialTabsState, [
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n1' },
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n2' },
    ])
    const s2 = run(s1, [{ type: 'SWITCH_TO_INDEX', index: 5 }])
    expect(s2.activeTabId).toBe('t2')
    const s3 = run(s1, [{ type: 'SWITCH_TO_INDEX', index: 0 }])
    expect(s3.activeTabId).toBe('t1')
  })

  test('SET_SCROLL updates scrollTop for the named tab only', () => {
    const s1 = run(initialTabsState, [
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n1' },
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n2' },
    ])
    const s2 = run(s1, [{ type: 'SET_SCROLL', tabId: 't1', scrollTop: 420 }])
    expect(s2.tabs.find(t => t.id === 't1')!.scrollTop).toBe(420)
    expect(s2.tabs.find(t => t.id === 't2')!.scrollTop).toBe(0)
  })

  test('CLOSE_ACTIVE behaves like CLOSE_TAB on the active tab id', () => {
    const s1 = run(initialTabsState, [
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n1' },
      { type: 'OPEN_IN_NEW_TAB', nodeId: 'n2' },
    ])
    const s2 = run(s1, [{ type: 'CLOSE_ACTIVE' }])
    expect(s2.tabs).toHaveLength(1)
    expect(s2.tabs[0].nodeId).toBe('n1')
    expect(s2.activeTabId).toBe('t1')
  })
})
