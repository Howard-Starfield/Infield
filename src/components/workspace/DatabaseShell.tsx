import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, Plus, Search, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import { DatabaseHeader } from './DatabaseHeader'
import { ViewSwitcher } from './ViewSwitcher'
import { BoardView } from './BoardView'
import { CalendarView } from './CalendarView'
import { GridView, type GridViewHandle } from './GridView'
import { ChartView } from './ChartView'
import { AddViewPopover } from './AddViewPopover'
import { ViewTabContextMenu } from './ViewTabContextMenu'
import type { WorkspaceNode, NodeView } from '../../types/workspace'

interface Props {
  node: WorkspaceNode
  /** When the DB is opened outside workspace `activeNode` (e.g. DatabaseContainer), call after schema mutations so `node` stays in sync. */
  onSchemaUpdated?: () => void
}

export function DatabaseShell({ node, onSchemaUpdated }: Props) {
  const {
    views, loadViews, createView, updateView, deleteView, createNode,
    activeNodeChildren,
  } = useWorkspaceStore()

  /** Local copy refreshed after schema mutations (workspace layout does not pass `onSchemaUpdated`). */
  const [schemaNode, setSchemaNode] = useState(node)
  useEffect(() => {
    setSchemaNode(node)
  }, [node])

  const refreshSchemaNode = useCallback(async () => {
    const updated = await invoke<WorkspaceNode | null>('get_node', { id: node.id })
    if (updated) setSchemaNode(updated)
  }, [node.id])

  const handleSchemaUpdated = useCallback(() => {
    void refreshSchemaNode()
    onSchemaUpdated?.()
  }, [refreshSchemaNode, onSchemaUpdated])

  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [showAddView, setShowAddView] = useState(false)
  const [addViewAnchor, setAddViewAnchor] = useState<DOMRect | null>(null)
  const [contextMenu, setContextMenu] = useState<{ view: NodeView; anchorRect: DOMRect } | null>(null)
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null)

  // Cover — only rendered when properties.cover is set
  const coverUrl: string | null = useMemo(() => {
    try {
      const props = JSON.parse(schemaNode.properties || '{}')
      return (props.cover as string) || null
    } catch {
      return null
    }
  }, [schemaNode.properties])

  // Load views on mount
  useEffect(() => {
    loadViews(node.id).then(async () => {
      const current = useWorkspaceStore.getState().views
      if (current.length === 0) {
        const defaultView = await createView(node.id, 'Grid', 'grid')
        setActiveViewId(defaultView.id)
      } else {
        setActiveViewId(current[0].id)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  const activeView = views.find(v => v.id === activeViewId)
  const activeFilterCount = useMemo(() => {
    if (!activeView?.filters) return 0
    try {
      const parsed = JSON.parse(activeView.filters) as unknown[]
      return Array.isArray(parsed) ? parsed.length : 0
    } catch {
      return 0
    }
  }, [activeView?.filters])
  const activeSortCount = useMemo(() => {
    if (!activeView?.sorts) return 0
    try {
      const parsed = JSON.parse(activeView.sorts) as unknown[]
      return Array.isArray(parsed) ? parsed.length : 0
    } catch {
      return 0
    }
  }, [activeView?.sorts])

  const filteredRows = useMemo(
    () => activeNodeChildren.filter(r => r.node_type === 'row'),
    [activeNodeChildren],
  )

  const gridViewRef = useRef<GridViewHandle | null>(null)

  const selectViewId = useCallback((id: string | null) => {
    gridViewRef.current?.flushPendingCellEdit()
    setActiveViewId(id)
  }, [])

  const handleSelectView = useCallback((id: string) => { selectViewId(id) }, [selectViewId])
  const handleAddViewClick = useCallback((e: React.MouseEvent) => {
    setAddViewAnchor((e.currentTarget as HTMLElement).getBoundingClientRect())
    setShowAddView(true)
  }, [])
  const handleAddView = useCallback(async (layout: NodeView['layout']) => {
    const name = layout.charAt(0).toUpperCase() + layout.slice(1)
    const view = await createView(node.id, name, layout)
    selectViewId(view.id)
  }, [node.id, createView, selectViewId])
  const handleContextMenu = useCallback((view: NodeView, e: React.MouseEvent) => {
    const t = e.currentTarget as HTMLElement
    const anchorEl = t.closest('button') ?? t
    setContextMenu({ view, anchorRect: anchorEl.getBoundingClientRect() })
  }, [])
  const handleRename = useCallback((id: string) => { setRenamingViewId(id) }, [])
  const handleRenameCommit = useCallback(async (id: string, name: string) => {
    setRenamingViewId(null)
    const view = useWorkspaceStore.getState().views.find(v => v.id === id)
    if (!view || view.name === name) return
    await updateView(id, name, view.color, view.filters, view.sorts, view.view_options)
  }, [updateView])
  const handleDuplicate = useCallback(async (id: string) => {
    const view = useWorkspaceStore.getState().views.find(v => v.id === id)
    if (!view) return
    const copy = await createView(node.id, `${view.name} (copy)`, view.layout)
    selectViewId(copy.id)
  }, [node.id, createView, selectViewId])
  const handleColor = useCallback(async (id: string, color: string | null) => {
    const view = useWorkspaceStore.getState().views.find(v => v.id === id)
    if (!view) return
    await updateView(id, view.name, color, view.filters, view.sorts, view.view_options)
  }, [updateView])
  const handleDelete = useCallback(async (id: string) => {
    await deleteView(id)
    if (activeViewId === id) {
      const remaining = useWorkspaceStore.getState().views
      selectViewId(remaining[0]?.id ?? null)
    }
  }, [activeViewId, deleteView, selectViewId])
  const handleCreateRow = useCallback(async () => {
    await createNode(node.id, 'row', 'Untitled')
    await useWorkspaceStore.getState().loadNodeChildren(node.id)
  }, [createNode, node.id])

  const showGridLayout = !activeView || activeView.layout === 'grid'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', background: 'transparent', padding: '16px 20px 24px', gap: 12 }}>

      {coverUrl && (
        <div
          style={{
            height: 120,
            flexShrink: 0,
            background: coverUrl.startsWith('linear-gradient') || coverUrl.startsWith('#')
              ? coverUrl
              : `url(${coverUrl}) center / cover no-repeat`,
            position: 'relative',
          }}
        />
      )}

      <DatabaseHeader node={schemaNode} />

      {showAddView && addViewAnchor && (
        <AddViewPopover
          onAdd={handleAddView}
          onClose={() => setShowAddView(false)}
          anchorRect={addViewAnchor}
        />
      )}
      {contextMenu && (
        <ViewTabContextMenu
          view={contextMenu.view}
          anchorRect={contextMenu.anchorRect}
          onClose={() => setContextMenu(null)}
          onRename={handleRename}
          onDuplicate={handleDuplicate}
          onColor={handleColor}
          onDelete={handleDelete}
        />
      )}

      <div className="workspace-paper-surface" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, paddingTop: 2 }}>
        <ViewSwitcher
          views={views}
          activeViewId={activeViewId}
          onSelectView={handleSelectView}
          onAddView={handleAddViewClick}
          onContextMenu={handleContextMenu}
          renamingViewId={renamingViewId}
          onRenameCommit={handleRenameCommit}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 22px',
            borderBottom: 'var(--workspace-hairline-inner)',
            background: 'color-mix(in srgb, black 8%, transparent)',
            flexShrink: 0,
          }}
        >
          <ToolbarButton icon={<Search size={13} strokeWidth={1.8} />} />
          <ToolbarButton icon={<SlidersHorizontal size={13} strokeWidth={1.8} />} label="Filter" count={activeFilterCount} />
          <ToolbarButton icon={<ArrowUpDown size={13} strokeWidth={1.8} />} label="Sort" count={activeSortCount} />
          <ToolbarButton icon={<Sparkles size={13} strokeWidth={1.8} />} label="AI" accent />
          <div style={{ flex: 1 }} />
          <div
            style={{
              fontSize: 'calc(11px * var(--ui-scale, 1))',
              color: 'var(--workspace-text-soft)',
              fontVariantNumeric: 'tabular-nums',
              marginRight: 8,
            }}
          >
            {filteredRows.length} items
          </div>
          <button
            type="button"
            onClick={() => void handleCreateRow()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 28,
              padding: '0 14px',
              border: 'none',
              borderRadius: 10,
              // HerOS "bright" primary: cream-on-terracotta-tinted
              background: 'color-mix(in srgb, var(--on-surface) 95%, transparent)',
              color: 'color-mix(in srgb, var(--heros-bg-foundation) 85%, black 40%)',
              fontSize: 'calc(12px * var(--ui-scale, 1))',
              fontWeight: 600,
              letterSpacing: '0.02em',
              boxShadow:
                '0 8px 24px color-mix(in srgb, black 18%, transparent), inset 0 1px 0 color-mix(in srgb, white 60%, transparent)',
              cursor: 'pointer',
              transition: 'transform calc(150ms * var(--duration-scale, 1)) cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
            onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(1px)' }}
            onMouseUp={(e) => { e.currentTarget.style.transform = '' }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = '' }}
          >
            <Plus size={13} strokeWidth={2} />
            New
          </button>
        </div>
        {activeView?.layout === 'board' && activeView && (
          <BoardView
            databaseId={node.id}
            databaseNode={schemaNode}
            activeView={activeView}
            onSchemaUpdated={handleSchemaUpdated}
          />
        )}
        {showGridLayout && (
          <GridView
            ref={gridViewRef}
            databaseId={node.id}
            viewId={activeViewId ?? ''}
            filteredRows={filteredRows}
          />
        )}
        {activeView?.layout === 'calendar' && (
          <CalendarView
            databaseNode={schemaNode}
            viewId={activeViewId ?? ''}
            filteredRows={filteredRows}
            activeView={activeView}
          />
        )}
        {activeView?.layout === 'chart' && (
          <ChartView
            databaseNode={schemaNode}
            viewId={activeViewId ?? ''}
            filteredRows={filteredRows}
            activeView={activeView}
          />
        )}
      </div>
    </div>
  )
}

function ToolbarButton({
  icon,
  label,
  count,
  accent = false,
}: {
  icon: React.ReactNode
  label?: string
  count?: number
  accent?: boolean
}) {
  return (
    <button
      type="button"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 26,
        padding: label ? '0 10px' : '0 8px',
        border: 'none',
        borderRadius: 7,
        background: 'transparent',
        color: accent ? 'var(--workspace-accent)' : 'var(--workspace-text-muted)',
        fontSize: 12.5,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      {icon}
      {label ? <span>{label}</span> : null}
      {typeof count === 'number' && count > 0 ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 16,
            height: 16,
            borderRadius: 999,
            padding: '0 5px',
            background: 'var(--workspace-accent-soft)',
            color: 'var(--workspace-accent)',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}
