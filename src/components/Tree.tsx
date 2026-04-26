import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HerOSInput } from './HerOS'
import { HerOSMenu } from './HerOSMenu'
import { FileText, FolderPlus, Plus, Search, ChevronRight, RefreshCw, Trash2, RotateCcw, X, Database, Rows3 } from 'lucide-react'
import { commands, type WorkspaceNode } from '../bindings'
import { toast } from 'sonner'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable'

// Prefer pointer-based "am I literally inside this droppable?" detection;
// fall back to closest-centre for the gap between rows.
function treeCollisionDetection(args: Parameters<typeof pointerWithin>[0]) {
  const hits = pointerWithin(args)
  return hits.length > 0 ? hits : closestCenter(args)
}

// Items stay in their original DOM positions during drag; the drop indicator
// communicates placement instead of shuffling siblings around.
const noopSortingStrategy = () => null

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
const EXPANDED_STORAGE_KEY = 'handy.notes.tree.expanded'

function readStoredExpandedIds(): string[] {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

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
  | { type: 'EXPAND_NODE'; id: string }
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
    case 'EXPAND_NODE': {
      const expanded = new Set(state.expanded)
      expanded.add(action.id)
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
  isFirstSibling: boolean
  isLastSibling: boolean
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
    const siblingIds = state.childrenByParent.get(n.parent_id ?? ROOT_KEY) ?? rootIds
    const siblingIndex = siblingIds.indexOf(id)
    const shouldShow =
      !q || matches(id) || hasMatchingDescendant(id)
    if (!shouldShow) return
    rows.push({
      id,
      depth,
      hasChildren: anyChildren,
      isFirstSibling: siblingIndex <= 0,
      isLastSibling: siblingIndex === siblingIds.length - 1,
    })
    const isExpanded =
      state.expanded.has(id) || (q.length > 0 && hasMatchingDescendant(id))
    if (isExpanded) {
      for (const kid of kids) walk(kid, depth + 1, seen)
    }
  }

  for (const rid of rootIds) walk(rid, 0)
  return rows
}

export function isVisibleDescendant(rows: FlatRow[], ancestorId: string, candidateId: string): boolean {
  const ancestorIdx = rows.findIndex((r) => r.id === ancestorId)
  if (ancestorIdx === -1) return false
  const ancestorDepth = rows[ancestorIdx].depth
  for (let i = ancestorIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (row.depth <= ancestorDepth) return false
    if (row.id === candidateId) return true
  }
  return false
}

// Filters out children when their parent is already in the selection (avoids double-operations on bulk actions).
function filterNestedSelection(ids: string[], nodes: Map<string, WorkspaceNode>): string[] {
  const selected = new Set(ids)
  return ids.filter((id) => {
    let parentId = nodes.get(id)?.parent_id ?? null
    while (parentId) {
      if (selected.has(parentId)) return false
      parentId = nodes.get(parentId)?.parent_id ?? null
    }
    return true
  })
}

function SortableRow(props: {
  row: FlatRow
  node: WorkspaceNode
  isActive: boolean
  isSelected: boolean
  isDropTarget: boolean
  isExpanded: boolean
  isDragging?: boolean
  onToggle: (id: string) => void
  onRowClick: (row: FlatRow, event: React.MouseEvent<HTMLDivElement>) => void
  onOpenContextMenu: (anchor: { x: number; y: number }, targetId: string) => void
}) {
  const { row, node, isActive, isSelected, isDropTarget, isExpanded, isDragging: isPreviewDragging = false, onToggle, onRowClick, onOpenContextMenu } = props
  const { attributes, listeners, setNodeRef, isDragging: isSortableDragging } =
    useSortable({ id: row.id })
  const style: React.CSSProperties = {
    paddingLeft: `var(--space-2)`,
  }
  return (
    <div
      ref={setNodeRef}
      className={`tree-row ${row.depth > 0 ? 'tree-row--child' : ''} ${isSelected ? 'tree-row--selected' : ''} ${isActive ? 'tree-row--active' : ''} ${isDropTarget ? 'tree-row--drop-target' : ''} ${isSortableDragging ? 'tree-row--drag-source' : ''}`}
      style={style}
      data-tree-row-id={row.id}
      {...attributes}
      {...listeners}
      onClick={(event) => {
        if (isPreviewDragging) return
        onRowClick(row, event)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        if (isSortableDragging || isPreviewDragging) return
        onOpenContextMenu({ x: e.clientX, y: e.clientY }, row.id)
      }}
    >
      {row.depth > 0 && (
        <span
          aria-hidden="true"
          className="tree-row__branch"
          style={{
            ['--tree-depth' as '--tree-depth']: row.depth,
            ['--branch-top' as '--branch-top']: row.isFirstSibling ? '50%' : '0%',
            ['--branch-bottom' as '--branch-bottom']: row.isLastSibling ? '50%' : '0%',
          } as React.CSSProperties}
        />
      )}
      {row.hasChildren ? (
        <span
          className={`tree-row__caret ${isExpanded ? 'tree-row__caret--open' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            if (isPreviewDragging) return
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
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    expanded: new Set(readStoredExpandedIds()),
  })
  const [menu, setMenu] = useState<{ anchor: { x: number; y: number }; targetId: string } | null>(null)
  const [dragState, setDragState] = useState<{
    id: string
    width: number
    height: number
  } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{ overId: string; mode: 'before' | 'after' | 'inside' } | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [trashedNodes, setTrashedNodes] = useState<WorkspaceNode[]>([])
  const [trashLoading, setTrashLoading] = useState(false)
  const loadGeneration = useRef(0)

  const openContextMenu = useCallback(
    (anchor: { x: number; y: number }, targetId: string) => setMenu({ anchor, targetId }),
    [],
  )

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(Array.from(state.expanded)))
    } catch {
      /* persistence best-effort */
    }
  }, [state.expanded])

  const hydrateBranch = useCallback(
    async (
      parentId: string,
      expandedIds: Set<string>,
      visited: Set<string>,
      generation: number,
    ) => {
      if (visited.has(parentId)) return
      visited.add(parentId)

      const res = await commands.getNodeChildren(parentId)
      if (generation !== loadGeneration.current) return
      if (res.status !== 'ok') {
        throw new Error(res.error)
      }

      // Notes tree is documents only. Database/row mirrors live under their
      // own DatabasesView surface — filter them out here so they don't pollute
      // the notes hierarchy.
      const docs = res.data.filter((n) => n.node_type === 'document')
      dispatch({ type: 'LOAD_CHILDREN', parentId, nodes: docs })

      if (!expandedIds.has(parentId)) return
      await Promise.all(
        docs.map((child) => hydrateBranch(child.id, expandedIds, visited, generation)),
      )
    },
    [],
  )

  const loadRoots = useCallback(async () => {
    const generation = ++loadGeneration.current
    try {
      const res = await commands.getRootNodes()
      if (generation !== loadGeneration.current) return
      if (res.status === 'ok') {
        // Notes tree is documents only — database mirrors live in DatabasesView.
        const docs = res.data.filter((n) => n.node_type === 'document')
        dispatch({ type: 'LOAD_ROOTS', nodes: docs })
        const expandedIds = new Set(readStoredExpandedIds())
        const visited = new Set<string>()
        await Promise.all(
          docs.map((root) => hydrateBranch(root.id, expandedIds, visited, generation)),
        )
      } else {
        dispatch({ type: 'SET_ERROR', message: res.error })
      }
    } catch (e) {
      dispatch({
        type: 'SET_ERROR',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }, [hydrateBranch])

  useEffect(() => {
    void loadRoots()
  }, [loadRoots, refreshToken])

  const loadTrash = useCallback(async () => {
    setTrashLoading(true)
    try {
      const res = await commands.getDeletedNodes()
      if (res.status === 'ok') setTrashedNodes(res.data)
      else toast.error('Could not load trash', { description: res.error })
    } catch (e) {
      toast.error('Could not load trash', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setTrashLoading(false)
    }
  }, [])

  useEffect(() => {
    if (trashOpen) void loadTrash()
  }, [trashOpen, loadTrash])

  const loadChildren = useCallback(async (parentId: string) => {
    const res = await commands.getNodeChildren(parentId)
    if (res.status === 'ok') {
      dispatch({ type: 'LOAD_CHILDREN', parentId, nodes: res.data })
      return res.data
    }
    throw new Error(res.error)
  }, [])

  const refreshParent = useCallback(
    async (parentId: string | null) => {
      if (parentId) {
        await loadChildren(parentId)
      } else {
        await loadRoots()
      }
    },
    [loadChildren, loadRoots],
  )

  const handleToggle = useCallback(
    async (id: string) => {
      dispatch({ type: 'TOGGLE_EXPAND', id })
      if (!state.childrenByParent.has(id)) {
        try {
          await loadChildren(id)
        } catch (e) {
          toast.error('Could not load children', {
            description: e instanceof Error ? e.message : String(e),
          })
        }
      }
    },
    [loadChildren, state.childrenByParent],
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

  const handleRestoreNode = useCallback(async (id: string) => {
    try {
      const res = await commands.restoreNode(id)
      if (res.status === 'ok') {
        toast.success('Restored')
        await loadRoots()
        await loadTrash()
      } else {
        toast.error('Restore failed', { description: res.error })
      }
    } catch (e) {
      toast.error('Restore failed', { description: e instanceof Error ? e.message : String(e) })
    }
  }, [loadRoots, loadTrash])

  const handlePermDelete = useCallback(async (id: string) => {
    try {
      const res = await commands.permanentDeleteNode(id)
      if (res.status === 'ok') {
        await loadTrash()
      } else {
        toast.error('Delete failed', { description: res.error })
      }
    } catch (e) {
      toast.error('Delete failed', { description: e instanceof Error ? e.message : String(e) })
    }
  }, [loadTrash])

  const handleEmptyTrash = useCallback(async () => {
    try {
      const res = await commands.emptyTrash()
      if (res.status === 'ok') {
        setTrashedNodes([])
        toast.success('Trash emptied')
      } else {
        toast.error('Empty trash failed', { description: res.error })
      }
    } catch (e) {
      toast.error('Empty trash failed', { description: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  const handleBulkDelete = useCallback(async () => {
    const ids = filterNestedSelection(Array.from(selectedIds), state.nodes)
    await Promise.all(ids.map((id) => handleDelete(id)))
    setSelectedIds(new Set())
    setSelectionAnchorId(null)
  }, [selectedIds, state.nodes, handleDelete])

  const handleCreateChildInTree = useCallback(
    async (parentId: string) => {
      try {
        await onCreateChild(parentId)
        await loadChildren(parentId)
        dispatch({ type: 'EXPAND_NODE', id: parentId })
      } catch (err) {
        toast.error('Could not create child document', {
          description: err instanceof Error ? err.message : String(err),
        })
      }
    },
    [loadChildren, onCreateChild],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  )

  const handleDragOver = useCallback((e: DragOverEvent) => {
    if (!e.over || e.active.id === e.over.id) {
      setDropIndicator(null)
      return
    }
    const overId = String(e.over.id)
    const pointer = e.activatorEvent as PointerEvent
    const currentY = pointer.clientY + e.delta.y
    const rect = e.over.rect

    // Top half → before. Bottom half + moved right ≥32px → inside. Bottom half → after.
    const inBottomHalf = currentY >= rect.top + rect.height * 0.5
    const movedRight = e.delta.x > 32
    let mode: 'before' | 'after' | 'inside'
    if (!inBottomHalf) {
      mode = 'before'
    } else if (movedRight) {
      mode = 'inside'
    } else {
      mode = 'after'
    }
    setDropIndicator({ overId, mode })
  }, [])

  const handleDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id)
    const rowEl = document.querySelector<HTMLElement>(`[data-tree-row-id="${id}"]`)
    const rect = rowEl?.getBoundingClientRect()
    setDragState({
      id,
      width: rect?.width ?? 240,
      height: rect?.height ?? 32,
    })
  }

  const handleDragEnd = async (e: DragEndEvent) => {
    setDragState(null)
    setDropIndicator(null)
    if (!e.over || e.active.id === e.over.id) return
    const activeId = String(e.active.id)
    const overId = String(e.over.id)
    const visibleRows = flattenVisible(state)
    const activeIdx = visibleRows.findIndex((r) => r.id === activeId)
    const overIdx = visibleRows.findIndex((r) => r.id === overId)
    if (activeIdx === -1 || overIdx === -1) return

    const overNode = state.nodes.get(overId)
    if (!overNode) return
    const activeNode = state.nodes.get(activeId)
    if (!activeNode) return
    const sourceParent = activeNode.parent_id

    // Use the visual indicator's mode for drop placement — consistent with what the user saw.
    const mode = dropIndicator?.overId === overId ? dropIndicator.mode : 'after'
    const shouldNest = mode === 'inside'
    const droppingBefore = mode === 'before'
    let targetParent = overNode.parent_id

    // Compute new position as midpoint of over-row and its neighbour
    // on the appropriate side of the drop.
    const siblings = (state.childrenByParent.get(targetParent ?? ROOT_KEY) ?? [])
      .map((id) => state.nodes.get(id))
      .filter((x): x is WorkspaceNode => !!x)
    const overSibIdx = siblings.findIndex((s) => s.id === overId)
    let newPos: number
    if (droppingBefore) {
      const prev = siblings[overSibIdx - 1]
      newPos = prev ? (prev.position + overNode.position) / 2 : overNode.position - 1
    } else {
      const next = siblings[overSibIdx + 1]
      newPos = next ? (overNode.position + next.position) / 2 : overNode.position + 1
    }

    if (shouldNest) {
      if (isVisibleDescendant(visibleRows, activeId, overId)) {
        toast.error('Cannot move a note inside its own child')
        return
      }
      targetParent = overId
      let children = state.childrenByParent.get(targetParent)
        ?.map((id) => state.nodes.get(id))
        .filter((x): x is WorkspaceNode => !!x)
      if (!children) {
        try {
          children = await loadChildren(targetParent)
        } catch (err) {
          toast.error('Could not load children', {
            description: err instanceof Error ? err.message : String(err),
          })
          return
        }
      }
      const positions = children
        .map((child) => child.position)
        .filter((pos) => Number.isFinite(pos))
      newPos = positions.length > 0 ? Math.max(...positions) + 1 : 0
    }

    try {
      const res = await commands.moveNode(activeId, targetParent, newPos)
      if (res.status !== 'ok') {
        toast.error('Move failed', { description: res.error })
        return
      }
      dispatch({ type: 'UPSERT_NODE', node: res.data })
      await refreshParent(sourceParent)
      await refreshParent(targetParent)
      if (shouldNest && targetParent) {
        dispatch({ type: 'EXPAND_NODE', id: targetParent })
      }
    } catch (err) {
      toast.error('Move failed', {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const rows = useMemo(() => flattenVisible(state), [state])
  const dragRow = dragState ? rows.find((row) => row.id === dragState.id) ?? null : null
  const dragNode = dragState ? state.nodes.get(dragState.id) ?? null : null

  const handleRowClick = useCallback(
    (row: FlatRow, event: React.MouseEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (next.has(row.id)) next.delete(row.id)
          else next.add(row.id)
          return next
        })
        setSelectionAnchorId(row.id)
      } else if (event.shiftKey && selectionAnchorId) {
        const anchorIdx = rows.findIndex((r) => r.id === selectionAnchorId)
        const clickIdx = rows.findIndex((r) => r.id === row.id)
        if (anchorIdx !== -1 && clickIdx !== -1) {
          const [from, to] = anchorIdx < clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx]
          setSelectedIds(new Set(rows.slice(from, to + 1).map((r) => r.id)))
        }
      } else {
        setSelectedIds(new Set())
        setSelectionAnchorId(row.id)
        if (row.hasChildren) void handleToggle(row.id)
        onSelect(row.id)
      }
    },
    [rows, selectionAnchorId, handleToggle, onSelect],
  )

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
          placeholder="Filter notes..."
          className="notes-tree-search"
        />
        <div className="notes-tree-header__actions" aria-label="Note actions">
          <button
            className="notes-tree-header__btn"
            onClick={() => void onCreateRoot()}
            title="New document (⌘N)"
          >
            <Plus size={14} /> Note
          </button>
          <button
            className="notes-tree-header__btn"
            onClick={() => void onCreateFolder()}
            title="New folder"
          >
            <FolderPlus size={14} /> Folder
          </button>
          <button
            type="button"
            className="notes-tree-header__btn notes-tree-header__btn--icon"
            title="Refresh notes"
            aria-label="Refresh notes"
            onClick={() => void loadRoots()}
          >
            <RefreshCw size={14} />
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
            No notes yet. Click &quot;Note&quot; to create one.
          </div>
        )}
        <DndContext
          sensors={sensors}
          collisionDetection={treeCollisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={rows.map((r) => r.id)}
            strategy={noopSortingStrategy}
          >
            {rows.map((row) => {
              const node = state.nodes.get(row.id)
              if (!node) return null
              const ind = dropIndicator?.overId === row.id ? dropIndicator : null
              const lineStyle = { marginLeft: `calc(${row.depth} * 20px + 8px)` }
              return (
                <Fragment key={row.id}>
                  {ind?.mode === 'before' && <div className="tree-drop-line" style={lineStyle} />}
                  <SortableRow
                    row={row}
                    node={node}
                    isActive={row.id === activeNodeId}
                    isSelected={selectedIds.has(row.id)}
                    isDropTarget={ind?.mode === 'inside'}
                    isExpanded={state.expanded.has(row.id)}
                    onToggle={(id) => void handleToggle(id)}
                    onRowClick={handleRowClick}
                    onOpenContextMenu={openContextMenu}
                  />
                  {ind?.mode === 'after' && <div className="tree-drop-line" style={lineStyle} />}
                </Fragment>
              )
            })}
          </SortableContext>
          {typeof document !== 'undefined' &&
            createPortal(
              <DragOverlay dropAnimation={null}>
                {dragState && dragRow && dragNode ? (
                  <div
                    style={{
                      width: dragState.width,
                      height: dragState.height,
                    }}
                  >
                    <div className="tree-row tree-row--active tree-row--drag-preview">
                      {dragRow.depth > 0 && (
                        <span
                          aria-hidden="true"
                          className="tree-row__branch"
                          style={{
                            ['--tree-depth' as '--tree-depth']: dragRow.depth,
                            ['--branch-top' as '--branch-top']: dragRow.isFirstSibling ? '50%' : '0%',
                            ['--branch-bottom' as '--branch-bottom']: dragRow.isLastSibling ? '50%' : '0%',
                          } as React.CSSProperties}
                        />
                      )}
                      {dragRow.hasChildren ? (
                        <span
                          className={`tree-row__caret ${state.expanded.has(dragRow.id) ? 'tree-row__caret--open' : ''}`}
                        >
                          <ChevronRight size={12} />
                        </span>
                      ) : (
                        <span className="tree-row__caret" />
                      )}
                      <span className="tree-row__icon">{dragNode.icon || <FileText size={12} />}</span>
                      <span className="tree-row__label">{dragNode.name}</span>
                    </div>
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )}
        </DndContext>
      </div>

      <button
        className="notes-trash-toggle"
        onClick={() => setTrashOpen((o) => !o)}
        title="Trash"
      >
        <Trash2 size={12} />
        <span className="notes-trash-toggle__label">Trash</span>
        {trashedNodes.length > 0 && (
          <span className="notes-trash-toggle__badge">{trashedNodes.length}</span>
        )}
        <ChevronRight
          size={11}
          style={{ transform: trashOpen ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
        />
      </button>

      {trashOpen && (
        <div className="notes-trash-panel">
          {trashLoading && (
            <div className="notes-backlinks__empty" style={{ fontSize: 12 }}>Loading…</div>
          )}
          {!trashLoading && trashedNodes.length === 0 && (
            <div className="notes-backlinks__empty" style={{ fontSize: 12 }}>Trash is empty</div>
          )}
          {trashedNodes.map((node) => {
            const TrashIcon = node.node_type === 'database' ? Database
              : node.node_type === 'row' ? Rows3
              : FileText
            return (
            <div key={node.id} className="notes-trash-item">
              <span className="notes-trash-item__icon"><TrashIcon size={11} /></span>
              <span className="notes-trash-item__name" title={node.name}>{node.name}</span>
              <span className="notes-trash-item__actions">
                <button
                  className="notes-trash-item__btn"
                  title="Restore"
                  onClick={() => void handleRestoreNode(node.id)}
                >
                  <RotateCcw size={11} />
                </button>
                <button
                  className="notes-trash-item__btn notes-trash-item__btn--danger"
                  title="Delete permanently"
                  onClick={() => void handlePermDelete(node.id)}
                >
                  <X size={11} />
                </button>
              </span>
            </div>
            )
          })}
          {!trashLoading && trashedNodes.length > 0 && (
            <div className="notes-trash-footer">
              <button
                className="notes-trash-footer__empty-btn"
                onClick={() => void handleEmptyTrash()}
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      {menu && (() => {
        const target = state.nodes.get(menu.targetId)
        if (!target) return null
        const isBulkTarget = selectedIds.size > 1 && selectedIds.has(menu.targetId)
        const bulkIds = isBulkTarget
          ? filterNestedSelection(Array.from(selectedIds), state.nodes)
          : []
        return (
          <HerOSMenu
            anchor={menu.anchor}
            onDismiss={() => setMenu(null)}
            items={isBulkTarget ? [
              {
                id: 'delete-bulk',
                label: `Delete ${bulkIds.length} item${bulkIds.length !== 1 ? 's' : ''}`,
                danger: true,
                onSelect: () => void handleBulkDelete(),
              },
            ] : [
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
                onSelect: () => void handleCreateChildInTree(menu.targetId),
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
