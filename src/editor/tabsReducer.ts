export interface Tab {
  id: string
  nodeId: string
  preview: boolean
  dirty: boolean
  scrollTop: number
}

export interface TabsState {
  tabs: Tab[]
  activeTabId: string | null
}

export const initialTabsState: TabsState = {
  tabs: [],
  activeTabId: null,
}

export type TabsAction =
  | { type: 'OPEN_PREVIEW'; nodeId: string }
  | { type: 'OPEN_IN_NEW_TAB'; nodeId: string }
  | { type: 'SWITCH_TAB'; tabId: string }
  | { type: 'CLOSE_TAB'; tabId: string }
  | { type: 'CLOSE_ACTIVE' }
  | { type: 'PROMOTE_PREVIEW'; tabId: string }
  | { type: 'MARK_DIRTY'; tabId: string; dirty: boolean }
  | { type: 'SET_SCROLL'; tabId: string; scrollTop: number }
  | { type: 'SWITCH_TO_INDEX'; index: number }

export type IdFactory = () => string

export const uuid: IdFactory = () => crypto.randomUUID()

export function tabsReducer(
  state: TabsState,
  action: TabsAction,
  idFactory: IdFactory = uuid,
): TabsState {
  switch (action.type) {
    case 'OPEN_PREVIEW': {
      const active = state.tabs.find(t => t.id === state.activeTabId)
      if (active && active.preview && !active.dirty) {
        // Replace in place — keeps tab id stable.
        const tabs = state.tabs.map(t =>
          t.id === active.id ? { ...t, nodeId: action.nodeId, scrollTop: 0 } : t,
        )
        return { ...state, tabs }
      }
      const newTab: Tab = {
        id: idFactory(),
        nodeId: action.nodeId,
        preview: true,
        dirty: false,
        scrollTop: 0,
      }
      return { tabs: [...state.tabs, newTab], activeTabId: newTab.id }
    }
    case 'OPEN_IN_NEW_TAB': {
      const newTab: Tab = {
        id: idFactory(),
        nodeId: action.nodeId,
        preview: false,
        dirty: false,
        scrollTop: 0,
      }
      return { tabs: [...state.tabs, newTab], activeTabId: newTab.id }
    }
    case 'SWITCH_TAB': {
      if (!state.tabs.some(t => t.id === action.tabId)) return state
      if (state.activeTabId === action.tabId) return state
      return { ...state, activeTabId: action.tabId }
    }
    case 'SWITCH_TO_INDEX': {
      if (state.tabs.length === 0) return state
      const i = Math.max(0, Math.min(action.index, state.tabs.length - 1))
      const next = state.tabs[i]
      if (state.activeTabId === next.id) return state
      return { ...state, activeTabId: next.id }
    }
    case 'CLOSE_TAB': {
      const i = state.tabs.findIndex(t => t.id === action.tabId)
      if (i === -1) return state
      const tabs = [...state.tabs.slice(0, i), ...state.tabs.slice(i + 1)]
      let activeTabId = state.activeTabId
      if (activeTabId === action.tabId) {
        const next = tabs[i] ?? tabs[i - 1] ?? null
        activeTabId = next?.id ?? null
      }
      return { tabs, activeTabId }
    }
    case 'CLOSE_ACTIVE': {
      if (!state.activeTabId) return state
      return tabsReducer(state, { type: 'CLOSE_TAB', tabId: state.activeTabId }, idFactory)
    }
    case 'PROMOTE_PREVIEW': {
      const tab = state.tabs.find(t => t.id === action.tabId)
      if (!tab || !tab.preview) return state
      const tabs = state.tabs.map(t =>
        t.id === action.tabId ? { ...t, preview: false } : t,
      )
      return { ...state, tabs }
    }
    case 'MARK_DIRTY': {
      const tab = state.tabs.find(t => t.id === action.tabId)
      if (!tab || tab.dirty === action.dirty) return state
      const tabs = state.tabs.map(t =>
        t.id === action.tabId ? { ...t, dirty: action.dirty } : t,
      )
      return { ...state, tabs }
    }
    case 'SET_SCROLL': {
      const tab = state.tabs.find(t => t.id === action.tabId)
      if (!tab || tab.scrollTop === action.scrollTop) return state
      const tabs = state.tabs.map(t =>
        t.id === action.tabId ? { ...t, scrollTop: action.scrollTop } : t,
      )
      return { ...state, tabs }
    }
    default: {
      const _exhaustive: never = action
      return state
    }
  }
}
