import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder, tooltips } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { autocompletion, completionKeymap } from '@codemirror/autocomplete'
import { commands, type WorkspaceNode } from '../bindings'
import { toast } from 'sonner'
import { herosEditorTheme } from '../editor/herosTheme'
import { slashCompletionSource } from '../editor/slashCompletion'
import { allSlashCommands } from '../editor/slashCommands'
import {
  wikilinkCompletionSource,
  type WikilinkSearchFn,
} from '../editor/wikilinkCompletion'
import { voiceMemoPillPlugin } from '../editor/voiceMemoPill'
import { nodeLinkClickPlugin } from '../editor/nodeLinkClick'
import {
  autosavePlugin,
  createDebouncedSaver,
  type DebouncedSaver,
} from '../editor/autosavePlugin'
import {
  conflictReducer,
  initialConflictState,
  isVaultConflictError,
  parseVaultConflictError,
} from '../editor/conflictState'
import { Breadcrumb } from './Breadcrumb'
import { EditorTitleBar } from './EditorTitleBar'
import { PropertiesPanel } from './PropertiesPanel'
import { clearAncestorsCache } from '../editor/ancestors'
import { emitBuddyEvent } from '../buddy/events'

interface MarkdownEditorProps {
  nodeId: string
  onNodeLinkClick: (id: string) => void
  onOpenInNewTab: (id: string) => void
  onDirtyChange?: (dirty: boolean) => void
  onScrollChange?: (scrollTop: number) => void
  initialScrollTop?: number
  autoFocusTitle?: boolean
}

/**
 * Thin adapter that unwraps the Tauri `Result<T, E>` returned by
 * `commands.searchWorkspaceTitle` into the shape `wikilinkCompletionSource`
 * expects. Autocomplete failures should be invisible to the user, so we
 * swallow the error side into an empty array.
 */
const tauriWikilinkSearch: WikilinkSearchFn = async (query, limit) => {
  const res = await commands.searchWorkspaceTitle(query, limit)
  return res.status === 'ok' ? res.data : []
}

export function MarkdownEditor({
  nodeId,
  onNodeLinkClick,
  onOpenInNewTab,
  onDirtyChange,
  onScrollChange,
  initialScrollTop,
  autoFocusTitle,
}: MarkdownEditorProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const saverRef = useRef<DebouncedSaver | null>(null)
  const nodeMetaRef = useRef<{
    name: string
    icon: string
    properties: string
  } | null>(null)
  const [state, dispatch] = useReducer(conflictReducer, initialConflictState)
  const [node, setNode] = useState<WorkspaceNode | null>(null)
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  const onNodeLinkClickRef = useRef(onNodeLinkClick)
  useEffect(() => {
    onNodeLinkClickRef.current = onNodeLinkClick
  }, [onNodeLinkClick])
  const onOpenInNewTabRef = useRef(onOpenInNewTab)
  useEffect(() => {
    onOpenInNewTabRef.current = onOpenInNewTab
  }, [onOpenInNewTab])
  const onDirtyChangeRef = useRef(onDirtyChange)
  useEffect(() => {
    onDirtyChangeRef.current = onDirtyChange
  }, [onDirtyChange])
  const onScrollChangeRef = useRef(onScrollChange)
  useEffect(() => {
    onScrollChangeRef.current = onScrollChange
  }, [onScrollChange])

  // Build the saver once per nodeId; its closure calls commands.updateNode
  // with the latest mtime from stateRef. Recreated on node switch because
  // the nodeId captured in the closure must match the active node.
  useEffect(() => {
    const doSave = async (body: string) => {
      const meta = nodeMetaRef.current
      if (!meta) return
      dispatch({ type: 'SAVE_START' })
      const res = await commands.updateNode(
        nodeId,
        meta.name,
        meta.icon,
        meta.properties,
        body,
        stateRef.current.lastSeenMtime,
      )
      if (res.status === 'ok') {
        dispatch({ type: 'SAVE_OK', updatedAt: res.data.updated_at })
        emitBuddyEvent('buddy:note-saved', { nodeId })
        return
      }
      if (isVaultConflictError(res.error)) {
        const parsed = parseVaultConflictError(res.error)
        if (parsed && parsed.nodeId === nodeId) {
          dispatch({
            type: 'SAVE_CONFLICT',
            diskMtimeSecs: parsed.diskMtimeSecs,
          })
          return
        }
      }
      dispatch({ type: 'SAVE_ERROR', message: res.error })
      toast.error('Save failed', { description: res.error })
    }
    saverRef.current = createDebouncedSaver(doSave, 300)
    return () => {
      saverRef.current?.cancel()
      saverRef.current = null
    }
  }, [nodeId])

  // Auto-fade saved indicator after 2s.
  useEffect(() => {
    if (state.status !== 'saved') return
    const t = window.setTimeout(() => dispatch({ type: 'CLEAR_SAVED' }), 2000)
    return () => window.clearTimeout(t)
  }, [state.status, state.savedAtMs])

  // Build CM6 view on nodeId change; destroy prior.
  useEffect(() => {
    let cancelled = false
    const build = async () => {
      // Flush pending save for the outgoing node.
      await saverRef.current?.flush().catch(() => {})

      // Tear down prior view.
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }

      // Fetch fresh node.
      const res = await commands.getNode(nodeId)
      if (cancelled || res.status !== 'ok' || !res.data) return
      const node = res.data
      nodeMetaRef.current = {
        name: node.name,
        icon: node.icon,
        properties: node.properties,
      }
      setNode(node)
      dispatch({ type: 'NODE_LOAD', mtime: node.updated_at })

      const saver = saverRef.current
      if (!saver) return

      const extensions = [
        tooltips({ parent: document.body }),
        EditorView.lineWrapping,
        history(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        markdown({ base: markdownLanguage, extensions: [GFM] }),
        placeholder('Type / for commands · [[ for links'),
        autocompletion({
          override: [
            slashCompletionSource(allSlashCommands),
            wikilinkCompletionSource(tauriWikilinkSearch),
          ],
          activateOnTyping: true,
          aboveCursor: false,
          tooltipClass: () => 'notes-editor-autocomplete',
        }),
        voiceMemoPillPlugin(),
        nodeLinkClickPlugin((id, { meta }) => {
          if (meta) onOpenInNewTabRef.current(id)
          else onNodeLinkClickRef.current(id)
        }),
        autosavePlugin(saver, (isDirty) => onDirtyChangeRef.current?.(isDirty)),
        herosEditorTheme,
      ]

      const editorState = EditorState.create({
        doc: node.body ?? '',
        extensions,
      })
      if (cancelled || !parentRef.current) return
      // Defensive: clear any stray children left by an aborted prior mount
      // before attaching the new view.
      while (parentRef.current.firstChild) {
        parentRef.current.removeChild(parentRef.current.firstChild)
      }
      const view = new EditorView({
        state: editorState,
        parent: parentRef.current,
      })
      viewRef.current = view

      if (initialScrollTop && initialScrollTop > 0) {
        requestAnimationFrame(() => {
          if (!cancelled) view.scrollDOM.scrollTop = initialScrollTop
        })
      }

      let scrollRafScheduled = false
      const onScroll = () => {
        if (scrollRafScheduled) return
        scrollRafScheduled = true
        requestAnimationFrame(() => {
          scrollRafScheduled = false
          onScrollChangeRef.current?.(view.scrollDOM.scrollTop)
        })
      }
      view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
      ;(view as any).__onScroll = onScroll

      view.focus()
    }
    void build()
    return () => {
      cancelled = true
      const prior = viewRef.current as any
      if (prior && prior.__onScroll) {
        prior.scrollDOM.removeEventListener('scroll', prior.__onScroll)
      }
    }
  }, [nodeId])

  // Unmount cleanup.
  useEffect(() => {
    return () => {
      saverRef.current?.flush().catch(() => {})
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [])

  const persistMeta = useCallback(
    async (partial: { name?: string; icon?: string; properties?: string }) => {
      const meta = nodeMetaRef.current
      if (!meta) return
      const nextName = partial.name ?? meta.name
      const nextIcon = partial.icon ?? meta.icon
      const nextProps = partial.properties ?? meta.properties
      const body = viewRef.current?.state.doc.toString() ?? ''
      const res = await commands.updateNode(
        nodeId,
        nextName,
        nextIcon,
        nextProps,
        body,
        stateRef.current.lastSeenMtime,
      )
      if (res.status === 'ok') {
        nodeMetaRef.current = { name: nextName, icon: nextIcon, properties: nextProps }
        dispatch({ type: 'SAVE_OK', updatedAt: res.data.updated_at })
        setNode((prev) =>
          prev
            ? { ...prev, name: nextName, icon: nextIcon, properties: nextProps, updated_at: res.data.updated_at }
            : prev,
        )
        clearAncestorsCache()
      } else {
        toast.error('Save failed', { description: res.error })
      }
    },
    [nodeId],
  )

  const handleRename = useCallback((next: string) => persistMeta({ name: next }), [persistMeta])
  const handleIconChange = useCallback((next: string) => persistMeta({ icon: next }), [persistMeta])
  const handleTagsChange = useCallback(
    async (tags: string[]) => {
      let base: Record<string, unknown> = {}
      try {
        base = JSON.parse(nodeMetaRef.current?.properties || '{}')
      } catch {
        /* keep empty */
      }
      base.tags = tags
      await persistMeta({ properties: JSON.stringify(base) })
    },
    [persistMeta],
  )

  return (
    <div className="editor-root">
      {state.status === 'conflicted' && (
        <ConflictBanner
          onReload={async () => {
            const res = await commands.getNode(nodeId)
            if (res.status !== 'ok' || !res.data) {
              toast.error('Reload failed', {
                description:
                  res.status === 'error' ? res.error : 'missing node',
              })
              return
            }
            if (viewRef.current) {
              viewRef.current.dispatch({
                changes: {
                  from: 0,
                  to: viewRef.current.state.doc.length,
                  insert: res.data.body ?? '',
                },
              })
            }
            dispatch({
              type: 'RESOLVE_RELOAD',
              newMtime: res.data.updated_at,
            })
          }}
          onKeepMine={() => {
            // RESOLVE_KEEP adopts disk mtime as the new baseline. The
            // reducer transitions to 'saving' optimistically — we must
            // fire the save immediately per its JSDoc contract.
            dispatch({ type: 'RESOLVE_KEEP' })
            const body = viewRef.current?.state.doc.toString() ?? ''
            saverRef.current?.schedule(body)
            void saverRef.current?.flush()
          }}
        />
      )}
      {node && (
        <>
          <Breadcrumb
            nodeId={node.id}
            onNavigate={(id) => onNodeLinkClickRef.current(id)}
          />
          <EditorTitleBar
            nodeId={node.id}
            name={node.name}
            icon={node.icon}
            onRename={handleRename}
            onIconChange={handleIconChange}
            autoFocusTitle={autoFocusTitle}
          />
          <PropertiesPanel
            node={node}
            onIconChange={handleIconChange}
            onTagsChange={handleTagsChange}
          />
        </>
      )}
      <div ref={parentRef} className="editor-cm-host" />
      <SaveFooter
        status={state.status}
        savedAtMs={state.savedAtMs}
        onRetry={() => {
          const body = viewRef.current?.state.doc.toString() ?? ''
          saverRef.current?.schedule(body)
          void saverRef.current?.flush()
        }}
      />
    </div>
  )
}

function ConflictBanner(props: {
  onReload: () => void
  onKeepMine: () => void
}) {
  return (
    <div className="editor-conflict-banner" role="alert">
      <span className="editor-conflict-banner__icon">⚠</span>
      <span className="editor-conflict-banner__message">
        This file changed on disk since you last opened it.
      </span>
      <button
        className="editor-conflict-banner__btn"
        onClick={props.onReload}
      >
        Reload
      </button>
      <button
        className="editor-conflict-banner__btn editor-conflict-banner__btn--primary"
        onClick={props.onKeepMine}
      >
        Keep mine
      </button>
      <button
        className="editor-conflict-banner__btn"
        disabled
        title="Coming in a later release"
      >
        Open diff
      </button>
    </div>
  )
}

function SaveFooter(props: {
  status: string
  savedAtMs: number | null
  onRetry?: () => void
}) {
  const { status, savedAtMs, onRetry } = props
  if (status === 'idle') return null
  if (status === 'saving') return <div className="editor-save-footer">Saving…</div>
  if (status === 'saved' && savedAtMs) {
    const t = new Date(savedAtMs)
    const stamp = t.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
    return (
      <div className="editor-save-footer editor-save-footer--ok">
        Saved {stamp}
      </div>
    )
  }
  if (status === 'error') {
    return (
      <button
        type="button"
        className="editor-save-footer editor-save-footer--err"
        onClick={onRetry}
      >
        Save failed — click to retry
      </button>
    )
  }
  return null
}
