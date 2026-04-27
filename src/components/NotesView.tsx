import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Tree } from './Tree'
import { MarkdownEditor } from './MarkdownEditor'
import { BacklinksPane } from './BacklinksPane'
import { NotesTabs } from './NotesTabs'
import { commands } from '../bindings'
import { toast } from 'sonner'
import {
  initialTabsState,
  tabsReducer as baseTabsReducer,
  type Tab,
  type TabsAction,
  type TabsState,
} from '../editor/tabsReducer'
import { clearAncestorsCache } from '../editor/ancestors'
import { emitBuddyEvent } from '../buddy/events'

// Bind the reducer to crypto.randomUUID in production; the pure reducer
// is injectable for tests.
function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  return baseTabsReducer(state, action, () => crypto.randomUUID())
}

export function NotesView() {
  const [state, dispatch] = useReducer(tabsReducer, initialTabsState)
  const [refreshToken, setRefreshToken] = useState(0)
  const [nodeMetaById, setNodeMetaById] = useState<Map<string, { name: string; icon: string }>>(
    () => new Map(),
  )
  // Set of node ids we should auto-focus-title on open (newly-created docs).
  const autoFocusNodeIds = useRef<Set<string>>(new Set())

  const activeTab: Tab | null =
    state.tabs.find((t) => t.id === state.activeTabId) ?? null

  const bumpRefresh = useCallback(() => {
    setRefreshToken((n) => n + 1)
    clearAncestorsCache()
  }, [])

  // Keep the nodeMetaById map up to date for every tab's node.
  useEffect(() => {
    const ids = Array.from(new Set(state.tabs.map((t) => t.nodeId)))
    let cancelled = false
    ;(async () => {
      const entries: Array<[string, { name: string; icon: string }]> = []
      for (const id of ids) {
        const existing = nodeMetaById.get(id)
        if (existing) {
          entries.push([id, existing])
          continue
        }
        const res = await commands.getNode(id)
        if (res.status === 'ok' && res.data) {
          entries.push([id, { name: res.data.name, icon: res.data.icon }])
        }
      }
      if (!cancelled) {
        setNodeMetaById((prev) => {
          const next = new Map(prev)
          for (const [k, v] of entries) next.set(k, v)
          return next
        })
      }
    })()
    return () => { cancelled = true }
  }, [state.tabs, refreshToken])  // refreshToken forces a re-read after rename/delete

  const openFromShortcut = useCallback(
    async (nodeId: string, opts: { newTab?: boolean; autoFocusTitle?: boolean } = {}) => {
      if (opts.autoFocusTitle) autoFocusNodeIds.current.add(nodeId)
      dispatch(
        opts.newTab
          ? { type: 'OPEN_IN_NEW_TAB', nodeId }
          : { type: 'OPEN_PREVIEW', nodeId },
      )
      bumpRefresh()
    },
    [bumpRefresh],
  )

  const handleCreateRoot = useCallback(async () => {
    try {
      const res = await commands.createNode(null, 'document', 'Untitled')
      if (res.status !== 'ok') {
        toast.error('Could not create document', { description: res.error })
        return
      }
      emitBuddyEvent('buddy:note-created', { nodeId: res.data.id })
      autoFocusNodeIds.current.add(res.data.id)
      dispatch({ type: 'OPEN_IN_NEW_TAB', nodeId: res.data.id })
      bumpRefresh()
    } catch (e) {
      toast.error('Could not create document', {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }, [bumpRefresh])

  const handleCreateFolder = useCallback(async () => {
    try {
      const res = await commands.createNode(null, 'document', 'New Folder')
      if (res.status !== 'ok') {
        toast.error('Could not create folder', { description: res.error })
        return
      }
      await commands.updateNode(
        res.data.id, res.data.name, '📁',
        res.data.properties, res.data.body, res.data.updated_at,
      )
      emitBuddyEvent('buddy:note-created', { nodeId: res.data.id })
      autoFocusNodeIds.current.add(res.data.id)
      dispatch({ type: 'OPEN_IN_NEW_TAB', nodeId: res.data.id })
      bumpRefresh()
    } catch (e) {
      toast.error('Could not create folder', {
        description: e instanceof Error ? e.message : String(e),
      })
    }
  }, [bumpRefresh])

  const handleCreateChild = useCallback(
    async (parentId: string) => {
      try {
        const res = await commands.createNode(parentId, 'document', 'Untitled')
        if (res.status !== 'ok') {
          toast.error('Could not create child document', { description: res.error })
          return
        }
        emitBuddyEvent('buddy:note-created', { nodeId: res.data.id })
        autoFocusNodeIds.current.add(res.data.id)
        dispatch({ type: 'OPEN_IN_NEW_TAB', nodeId: res.data.id })
        bumpRefresh()
      } catch (e) {
        toast.error('Could not create child document', {
          description: e instanceof Error ? e.message : String(e),
        })
      }
    },
    [bumpRefresh],
  )

  // Listen for 'notes:open' (Cmd+Shift+J today's daily; also Cmd+N legacy path)
  // and 'notes:new-tab' (Cmd+T) and 'notes:close-active' (Cmd+W) and
  // 'notes:switch-index' (Cmd+1..9) from AppShell.
  useEffect(() => {
    const onOpen = (ev: Event) => {
      const id = (ev as CustomEvent).detail
      if (typeof id === 'string') void openFromShortcut(id, { newTab: false })
    }
    const onNewTab = async () => { await handleCreateRoot() }
    const onCloseActive = () => {
      if (!activeTab) return
      // NotesView is the UI layer; per spec §7.2 dirty-close guard, the
      // MarkdownEditor's autosave has already debounced. The actual
      // flush happens inside MarkdownEditor's unmount path (triggered
      // by the tab close → reducer → remount diff). Good enough for
      // W2.5; the conflict banner fires in-editor if the flush races.
      dispatch({ type: 'CLOSE_ACTIVE' })
    }
    const onSwitchIndex = (ev: Event) => {
      const i = (ev as CustomEvent).detail
      if (typeof i === 'number') dispatch({ type: 'SWITCH_TO_INDEX', index: i })
    }
    const onOpenNewTab = (ev: Event) => {
      const id = (ev as CustomEvent).detail
      if (typeof id === 'string') {
        autoFocusNodeIds.current.delete(id)  // not auto-focus on cross-page open
        dispatch({ type: 'OPEN_IN_NEW_TAB', nodeId: id })
        bumpRefresh()
      }
    }
    window.addEventListener('notes:open', onOpen)
    window.addEventListener('notes:new-tab', onNewTab)
    window.addEventListener('notes:close-active', onCloseActive)
    window.addEventListener('notes:switch-index', onSwitchIndex)
    window.addEventListener('notes:open-new-tab', onOpenNewTab)
    return () => {
      window.removeEventListener('notes:open', onOpen)
      window.removeEventListener('notes:new-tab', onNewTab)
      window.removeEventListener('notes:close-active', onCloseActive)
      window.removeEventListener('notes:switch-index', onSwitchIndex)
      window.removeEventListener('notes:open-new-tab', onOpenNewTab)
    }
  }, [openFromShortcut, handleCreateRoot, activeTab])

  const currentNodeId = activeTab?.nodeId ?? null
  const shouldAutoFocusTitle =
    currentNodeId !== null && autoFocusNodeIds.current.has(currentNodeId)

  // Clear the auto-focus intent once consumed.
  useEffect(() => {
    if (shouldAutoFocusTitle && currentNodeId) autoFocusNodeIds.current.delete(currentNodeId)
  }, [shouldAutoFocusTitle, currentNodeId])

  return (
    <div className="notes-split">
      <Tree
        activeNodeId={currentNodeId}
        onSelect={(id) => dispatch({ type: 'OPEN_PREVIEW', nodeId: id })}
        onOpenInNewTab={(id) => dispatch({ type: 'OPEN_IN_NEW_TAB', nodeId: id })}
        onCreateRoot={handleCreateRoot}
        onCreateFolder={handleCreateFolder}
        onCreateChild={handleCreateChild}
        refreshToken={refreshToken}
      />
      <section className="heros-glass-card notes-editor-column">
        <NotesTabs
          tabs={state.tabs}
          activeTabId={state.activeTabId}
          nodeMetaById={nodeMetaById}
          onSelect={(id) => dispatch({ type: 'SWITCH_TAB', tabId: id })}
          onClose={(id) => dispatch({ type: 'CLOSE_TAB', tabId: id })}
          onPromote={(id) => dispatch({ type: 'PROMOTE_PREVIEW', tabId: id })}
          onNewTab={() => void handleCreateRoot()}
        />
        {activeTab && currentNodeId ? (
          <MarkdownEditor
            key={`${activeTab.id}:${activeTab.nodeId}`}
            nodeId={currentNodeId}
            initialScrollTop={activeTab.scrollTop}
            autoFocusTitle={shouldAutoFocusTitle}
            onScrollChange={(top) =>
              dispatch({ type: 'SET_SCROLL', tabId: activeTab.id, scrollTop: top })
            }
            onDirtyChange={(dirty) => {
              dispatch({ type: 'MARK_DIRTY', tabId: activeTab.id, dirty })
              if (dirty && activeTab.preview) {
                dispatch({ type: 'PROMOTE_PREVIEW', tabId: activeTab.id })
              }
            }}
            onNodeLinkClick={(id) =>
              dispatch({ type: 'OPEN_PREVIEW', nodeId: id })
            }
            onOpenInNewTab={(id) =>
              dispatch({ type: 'OPEN_IN_NEW_TAB', nodeId: id })
            }
          />
        ) : (
          <div
            className="notes-backlinks__empty"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}
          >
            Select a note or create one with <kbd>⌘N</kbd>.
          </div>
        )}
      </section>
      <BacklinksPane
        activeNodeId={currentNodeId}
        onSelect={(id) => dispatch({ type: 'OPEN_PREVIEW', nodeId: id })}
      />
    </div>
  )
}
