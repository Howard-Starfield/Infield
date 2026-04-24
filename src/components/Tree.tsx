import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import { HerOSInput } from './HerOS'
import { HerOSMenu } from './HerOSMenu'
import { FileText, FolderPlus, Plus, Search, ChevronRight } from 'lucide-react'
import { commands, type WorkspaceNode } from '../bindings'
import { toast } from 'sonner'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface TreeProps {
  activeNodeId: string | null
  onSelect: (id: string) => void
  onCreateRoot: () => Promise<void>
  onCreateFolder: () => Promise<void>
  onCreateChild: (parentId: string) => Promise<void>
  onOpenInNewTab?: (nodeId: string) => void
  refreshToken?: number   // bump to force a re-fetch
}

export interface TreeState {
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

export interface FlatRow {
  id: string
  depth: number
  hasChildren: boolean
}

export function flattenVisible(state: TreeState): FlatRow[] {
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

function SortableRow(props: {
  row: FlatRow
  node: WorkspaceNode
  isActive: boolean
  isExpanded: boolean
  onToggle: (id: string) => void
  onSelect: (id: string) => void
  onOpenContextMenu: (anchor: { x: number; y: number }, targetId: string) => void
}) {
  const { row, node, isActive, isExpanded, onToggle, onSelect, onOpenContextMenu } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id })
  const style: React.CSSProperties = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    paddingLeft: `calc(var(--space-2) + ${row.depth} * var(--space-4))`,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      className={`tree-row ${isActive ? 'tree-row--active' : ''}`}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onSelect(row.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        onOpenContextMenu({ x: e.clientX, y: e.clientY }, row.id)
      }}
    >
      {row.hasChildren ? (
        <span
          className={`tree-row__caret ${isExpanded ? 'tree-row__caret--open' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggle(row.id)
          }}
        >
          <ChevronRight size={12} />
        </span>
      ) : (
        <span className="tree-row__caret" />
      )}
      <span className="tree-row__icon">{node.icon || <FileText size={12} />}</span>
      <span className="tree-row__label">{node.name}</span>
    </div>
  )
}

export function Tree({
  activeNodeId,
  onSelect,
  onCreateRoot,
  onCreateFolder,
  onCreateChild,
  onOpenInNewTab,
  refreshToken,
}: TreeProps) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [menu, setMenu] = useState<{ anchor: { x: number; y: number }; targetId: string } | null>(null)

  const openContextMenu = useCallback(
    (anchor: { x: number; y: number }, targetId: string) => setMenu({ anchor, targetId }),
    [],
  )

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )
  const [dragId, setDragId] = useState<string | null>(null)

  const handleDragStart = (e: DragStartEvent) => {
    setDragId(String(e.active.id))
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragId(null)
    if (!e.over || e.active.id === e.over.id) return
    const activeId = String(e.active.id)
    const overId = String(e.over.id)
    const visibleRows = flattenVisible(state)
    const activeIdx = visibleRows.findIndex((r) => r.id === activeId)
    const overIdx = visibleRows.findIndex((r) => r.id === overId)
    if (activeIdx === -1 || overIdx === -1) return

    // Target parent: same parent as the over-row (sibling reorder only
    // in W2 — re-parenting via drag deferred to W2.5).
    const overNode = state.nodes.get(overId)
    if (!overNode) return
    const targetParent = overNode.parent_id

    // Compute new position as midpoint of over-row and its neighbour
    // on the appropriate side of the drop.
    const siblings = (state.childrenByParent.get(targetParent ?? ROOT_KEY) ?? [])
      .map((id) => state.nodes.get(id))
      .filter((x): x is WorkspaceNode => !!x)
    const overSibIdx = siblings.findIndex((s) => s.id === overId)
    const droppingBefore = activeIdx > overIdx
    let newPos: number
    if (droppingBefore) {
      const prev = siblings[overSibIdx - 1]
      newPos = prev ? (prev.position + overNode.position) / 2 : overNode.position - 1
    } else {
      const next = siblings[overSibIdx + 1]
      newPos = next ? (overNode.position + next.position) / 2 : overNode.position + 1
    }

    try {
      const res = await commands.moveNode(activeId, targetParent, newPos)
      if (res.status !== 'ok') {
        toast.error('Move failed', { description: res.error })
        return
      }
      dispatch({ type: 'UPSERT_NODE', node: res.data })
      // Refresh parent's children list so order persists.
      if (targetParent) {
        const refreshRes = await commands.getNodeChildren(targetParent)
        if (refreshRes.status === 'ok') {
          dispatch({
            type: 'LOAD_CHILDREN',
            parentId: targetParent,
            nodes: refreshRes.data,
          })
        }
      } else {
        void loadRoots()
      }
    } catch (err) {
      toast.error('Move failed', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

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
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={rows.map((r) => r.id)}
            strategy={verticalListSortingStrategy}
          >
            {rows.map((row) => {
              const node = state.nodes.get(row.id)
              if (!node) return null
              return (
                <SortableRow
                  key={row.id}
                  row={row}
                  node={node}
                  isActive={row.id === activeNodeId}
                  isExpanded={state.expanded.has(row.id)}
                  onToggle={(id) => void handleToggle(id)}
                  onSelect={onSelect}
                  onOpenContextMenu={openContextMenu}
                />
              )
            })}
          </SortableContext>
          <DragOverlay>
            {dragId &&
              (() => {
                const n = state.nodes.get(dragId)
                return n ? (
                  <div className="tree-row tree-row--active">
                    <span className="tree-row__icon">
                      {n.icon || <FileText size={12} />}
                    </span>
                    <span className="tree-row__label">{n.name}</span>
                  </div>
                ) : null
              })()}
          </DragOverlay>
        </DndContext>
      </div>

      {menu && (() => {
        const target = state.nodes.get(menu.targetId)
        if (!target) return null
        return (
          <HerOSMenu
            anchor={menu.anchor}
            onDismiss={() => setMenu(null)}
            items={[
              {
                id: 'open',
                label: 'Open',
                onSelect: () => onSelect(menu.targetId),
              },
              {
                id: 'open-new-tab',
                label: 'Open in new tab',
                disabled: !onOpenInNewTab,
                onSelect: () => onOpenInNewTab?.(menu.targetId),
              },
              {
                id: 'new-child',
                label: 'New child document',
                onSelect: () => void onCreateChild(menu.targetId),
              },
              {
                id: 'delete',
                label: 'Delete',
                danger: true,
                onSelect: () => void handleDelete(menu.targetId),
              },
            ]}
          />
        )
      })()}
    </section>
  )
}
