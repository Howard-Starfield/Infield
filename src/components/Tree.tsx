import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { HerOSInput } from './HerOS'
import { FileText, FolderPlus, Plus, Search, ChevronRight } from 'lucide-react'
import { commands, type WorkspaceNode } from '../bindings'
import { toast } from 'sonner'

interface TreeProps {
  activeNodeId: string | null
  onSelect: (id: string) => void
  onCreateRoot: () => Promise<void>
  onCreateFolder: () => Promise<void>
  onCreateChild: (parentId: string) => Promise<void>
  refreshToken?: number   // bump to force a re-fetch
}

interface TreeState {
  nodes: Map<string, WorkspaceNode>
  childrenByParent: Map<string, string[]>   // "__root__" | parentId
  expanded: Set<string>
  filter: string
  loading: boolean
  error: string | null
}

const ROOT_KEY = '__root__'

const initialState: TreeState = {
  nodes: new Map(),
  childrenByParent: new Map(),
  expanded: new Set(),
  filter: '',
  loading: true,
  error: null,
}

type Action =
  | { type: 'LOAD_ROOTS'; nodes: WorkspaceNode[] }
  | { type: 'LOAD_CHILDREN'; parentId: string; nodes: WorkspaceNode[] }
  | { type: 'TOGGLE_EXPAND'; id: string }
  | { type: 'SET_FILTER'; value: string }
  | { type: 'SET_ERROR'; message: string }
  | { type: 'REMOVE_NODE'; id: string }
  | { type: 'UPSERT_NODE'; node: WorkspaceNode }

function reducer(state: TreeState, action: Action): TreeState {
  switch (action.type) {
    case 'LOAD_ROOTS': {
      const nodes = new Map(state.nodes)
      const rootIds: string[] = []
      for (const n of action.nodes) {
        nodes.set(n.id, n)
        rootIds.push(n.id)
      }
      const childrenByParent = new Map(state.childrenByParent)
      childrenByParent.set(ROOT_KEY, rootIds)
      return { ...state, nodes, childrenByParent, loading: false, error: null }
    }
    case 'LOAD_CHILDREN': {
      const nodes = new Map(state.nodes)
      const ids: string[] = []
      for (const n of action.nodes) {
        nodes.set(n.id, n)
        ids.push(n.id)
      }
      const childrenByParent = new Map(state.childrenByParent)
      childrenByParent.set(action.parentId, ids)
      return { ...state, nodes, childrenByParent }
    }
    case 'TOGGLE_EXPAND': {
      const expanded = new Set(state.expanded)
      if (expanded.has(action.id)) expanded.delete(action.id)
      else expanded.add(action.id)
      return { ...state, expanded }
    }
    case 'SET_FILTER':
      return { ...state, filter: action.value }
    case 'SET_ERROR':
      return { ...state, loading: false, error: action.message }
    case 'REMOVE_NODE': {
      const nodes = new Map(state.nodes)
      nodes.delete(action.id)
      const childrenByParent = new Map(state.childrenByParent)
      for (const [k, v] of childrenByParent) {
        const filtered = v.filter((x) => x !== action.id)
        if (filtered.length !== v.length) childrenByParent.set(k, filtered)
      }
      return { ...state, nodes, childrenByParent }
    }
    case 'UPSERT_NODE': {
      const nodes = new Map(state.nodes)
      nodes.set(action.node.id, action.node)
      return { ...state, nodes }
    }
    default:
      return state
  }
}

interface FlatRow {
  id: string
  depth: number
  hasChildren: boolean
}

function flattenVisible(state: TreeState): FlatRow[] {
  const rows: FlatRow[] = []
  const q = state.filter.toLowerCase()
  const rootIds = state.childrenByParent.get(ROOT_KEY) ?? []

  const matches = (id: string): boolean => {
    const n = state.nodes.get(id)
    if (!n) return false
    if (!q) return true
    if (n.name.toLowerCase().includes(q)) return true
    // Also show ancestor if any descendant matches (handled by walk).
    return false
  }

  const hasMatchingDescendant = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false
    seen.add(id)
    const kids = state.childrenByParent.get(id) ?? []
    for (const kid of kids) {
      if (matches(kid)) return true
      if (hasMatchingDescendant(kid, seen)) return true
    }
    return false
  }

  const walk = (id: string, depth: number, seen = new Set<string>()) => {
    if (seen.has(id)) return
    seen.add(id)
    const n = state.nodes.get(id)
    if (!n) return
    const kids = state.childrenByParent.get(id) ?? []
    const anyChildren = kids.length > 0
    const shouldShow =
      !q || matches(id) || hasMatchingDescendant(id)
    if (!shouldShow) return
    rows.push({ id, depth, hasChildren: anyChildren })
    const isExpanded =
      state.expanded.has(id) || (q.length > 0 && hasMatchingDescendant(id))
    if (isExpanded) {
      for (const kid of kids) walk(kid, depth + 1, seen)
    }
  }

  for (const rid of rootIds) walk(rid, 0)
  return rows
}

export function Tree({
  activeNodeId,
  onSelect,
  onCreateRoot,
  onCreateFolder,
  onCreateChild,
  refreshToken,
}: TreeProps) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const loadRoots = useCallback(async () => {
    try {
      const res = await commands.getRootNodes()
      if (res.status === 'ok') {
        dispatch({ type: 'LOAD_ROOTS', nodes: res.data })
      } else {
        dispatch({ type: 'SET_ERROR', message: res.error })
      }
    } catch (e) {
      dispatch({
        type: 'SET_ERROR',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }, [])

  useEffect(() => {
    void loadRoots()
  }, [loadRoots, refreshToken])

  const handleToggle = useCallback(
    async (id: string) => {
      dispatch({ type: 'TOGGLE_EXPAND', id })
      if (!state.childrenByParent.has(id)) {
        try {
          const res = await commands.getNodeChildren(id)
          if (res.status === 'ok') {
            dispatch({ type: 'LOAD_CHILDREN', parentId: id, nodes: res.data })
          } else {
            toast.error('Could not load children', { description: res.error })
          }
        } catch (e) {
          toast.error('Could not load children', {
            description: e instanceof Error ? e.message : String(e),
          })
        }
      }
    },
    [state.childrenByParent],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        const res = await commands.deleteNode(id)
        if (res.status === 'ok') {
          dispatch({ type: 'REMOVE_NODE', id })
          toast.success('Moved to trash')
        } else {
          toast.error('Delete failed', { description: res.error })
        }
      } catch (e) {
        toast.error('Delete failed', {
          description: e instanceof Error ? e.message : String(e),
        })
      }
    },
    [],
  )

  const rows = useMemo(() => flattenVisible(state), [state])

  // Keyboard nav: handle at the container level so tree rows don't need tabindex.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!activeNodeId) return
    const idx = rows.findIndex((r) => r.id === activeNodeId)
    if (idx === -1) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = rows[Math.min(idx + 1, rows.length - 1)]
      if (next) onSelect(next.id)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = rows[Math.max(idx - 1, 0)]
      if (next) onSelect(next.id)
    } else if (e.key === 'ArrowRight') {
      const row = rows[idx]
      if (row?.hasChildren && !state.expanded.has(row.id)) {
        e.preventDefault()
        void handleToggle(row.id)
      }
    } else if (e.key === 'ArrowLeft') {
      const row = rows[idx]
      if (row?.hasChildren && state.expanded.has(row.id)) {
        e.preventDefault()
        dispatch({ type: 'TOGGLE_EXPAND', id: row.id })
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      void handleDelete(activeNodeId)
    }
  }

  return (
    <section
      className="heros-glass-card notes-tree-root"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="notes-tree-header">
        <HerOSInput
          icon={<Search size={14} />}
          value={state.filter}
          onChange={(e) =>
            dispatch({ type: 'SET_FILTER', value: e.currentTarget.value })
          }
          placeholder="Filter…"
          style={{ flex: 1, minWidth: 120 }}
        />
        <div className="notes-tree-header__actions">
          <button
            className="notes-tree-header__btn"
            onClick={() => void onCreateRoot()}
            title="New document (⌘N)"
          >
            <Plus size={12} /> Doc
          </button>
          <button
            className="notes-tree-header__btn"
            onClick={() => void onCreateFolder()}
            title="New folder"
          >
            <FolderPlus size={12} /> Folder
          </button>
        </div>
      </div>

      {state.error && (
        <div className="notes-backlinks__empty">{state.error}</div>
      )}

      <div className="notes-tree-list">
        {state.loading && !state.error && (
          <div className="notes-backlinks__empty">Loading…</div>
        )}
        {!state.loading && rows.length === 0 && (
          <div className="notes-backlinks__empty">
            No notes yet. Click &quot;Doc&quot; to create one.
          </div>
        )}
        {rows.map((row) => {
          const n = state.nodes.get(row.id)
          if (!n) return null
          const isActive = row.id === activeNodeId
          const isExpanded = state.expanded.has(row.id)
          return (
            <div
              key={row.id}
              className={`tree-row ${isActive ? 'tree-row--active' : ''}`}
              style={{
                paddingLeft: `calc(var(--space-2) + ${row.depth} * var(--space-4))`,
              }}
              onClick={() => onSelect(row.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                // Minimal W2 context menu: "New child document"
                if (window.confirm(`Create new child document under "${n.name}"?`)) {
                  void onCreateChild(row.id)
                }
              }}
            >
              {row.hasChildren ? (
                <span
                  className={`tree-row__caret ${isExpanded ? 'tree-row__caret--open' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleToggle(row.id)
                  }}
                >
                  <ChevronRight size={12} />
                </span>
              ) : (
                <span className="tree-row__caret" />
              )}
              <span className="tree-row__icon">{n.icon || <FileText size={12} />}</span>
              <span className="tree-row__label">{n.name}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
