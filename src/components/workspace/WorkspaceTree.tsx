import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import {
  DndContext,
  DragEndEvent,
  DragOverEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { snapCenterToCursor } from '@dnd-kit/modifiers'
import { useWorkspaceStore } from '../../stores/workspaceStore'
import type { NodeView, WorkspaceNode } from '../../types/workspace'
import { toast } from 'sonner'
import { MoreHorizontal, Star, Trash2, Copy, FilePlus, ChevronRight, ChevronLeft, RotateCcw, Clock, CalendarDays, Database, FolderOpenDot, FolderPlus, Kanban, NotebookText, Search, Mic, AudioLines, Table2 } from 'lucide-react'
import {
  MIC_TRANSCRIBE_FOLDER_NAME,
  SYSTEM_AUDIO_FOLDER_NAME,
} from '@/lib/workspaceTranscriptionFolders'
import {
  WORKSPACE_NODE_ID_ATTR,
  WORKSPACE_NODE_TYPE_ATTR,
  WORKSPACE_ROW_PARENT_ATTR,
} from './board/workspaceDropDataAttrs'
import {
  WorkspaceMenuDivider,
  WorkspaceMenuItem,
  WorkspaceMenuSurface,
} from '@/components/workspace/chrome/workspaceMenuChrome'
import {
  WorkspaceFloatingPortal,
  fitRectInViewport,
  placeMenuAtPointer,
  workspaceFloatingBackdropZ,
  workspaceFloatingZ,
} from '@/lib/workspaceFloatingLayer'
import { AppSidebarChrome } from '@/components/AppSidebarChrome'
import { useWorkspaceRecents } from '@/hooks/useWorkspaceRecents'
import { emitWorkspaceTabOpen } from '@/lib/workspaceTabs'

const ROOT_KEY = '__root__'

/** First tab when creating a database from the tree + button. */
type NewDatabasePrimaryTab = 'board' | 'grid' | 'calendar'

const NEW_DATABASE_VIEW_DEFS: { layout: NodeView['layout'] }[] = [
  { layout: 'board' },
  { layout: 'grid' },
  { layout: 'calendar' },
]

function orderedViewsForNewDatabase(primary: NewDatabasePrimaryTab) {
  const first = NEW_DATABASE_VIEW_DEFS.find((v) => v.layout === primary) ?? NEW_DATABASE_VIEW_DEFS[0]
  const rest = NEW_DATABASE_VIEW_DEFS.filter((v) => v.layout !== first.layout)
  return [first, ...rest]
}

/** True if `nodeId` is the dragged node or a descendant of it (invalid nest target into self/subtree). */
async function isDragTargetInsideDraggedSubtree(draggedId: string, targetNodeId: string): Promise<boolean> {
  if (targetNodeId === draggedId) return true
  let cur: string | null = targetNodeId
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const node: WorkspaceNode | null = await invoke<WorkspaceNode | null>('get_node', { id: cur })
    if (!node?.parent_id) return false
    if (node.parent_id === draggedId) return true
    cur = node.parent_id
  }
  return false
}

type TreeDragOverState =
  | { kind: 'sibling'; nodeId: string; half: 'top' | 'bottom' }
  | { kind: 'nest'; nodeId: string }
  | { kind: 'rootTail' }

/** Note = NotebookText; container document = FolderOpenDot (like Spaces); database = Database. Custom emoji overrides. */
const TREE_ICON_STROKE = 1.5

function WorkspaceTreeNodeIcon({
  node,
  childCount,
  size = 13,
}: {
  node: WorkspaceNode
  childCount: number
  size?: number
}) {
  const iconTrim = (node.icon ?? '').trim()

  // Root folders created by Rust `ensure_transcription_folder` (name is stable; icon may be 📁 or empty).
  if (node.node_type === 'document' && !node.parent_id) {
    if (node.name === MIC_TRANSCRIBE_FOLDER_NAME) {
      return <Mic size={size} strokeWidth={TREE_ICON_STROKE} aria-hidden />
    }
    if (node.name === SYSTEM_AUDIO_FOLDER_NAME) {
      return <AudioLines size={size} strokeWidth={TREE_ICON_STROKE} aria-hidden />
    }
  }

  // Auto-created mirror / session documents (legacy emoji persisted in DB).
  if (iconTrim === '🎙️') {
    return <Mic size={size} strokeWidth={TREE_ICON_STROKE} aria-hidden />
  }
  if (iconTrim === '🎧') {
    return <AudioLines size={size} strokeWidth={TREE_ICON_STROKE} aria-hidden />
  }
  // Daily notes persist 📅 in SQLite; treat as Lucide so we don't render platform emoji.
  if (iconTrim === '📅') {
    return <CalendarDays size={size} strokeWidth={TREE_ICON_STROKE} aria-hidden />
  }

  const hasCustomIcon = iconTrim && !['📄', '🗂', '📁'].includes(iconTrim)
  if (hasCustomIcon) return <>{node.icon}</>

  if (node.node_type === 'database') {
    return <Database size={size} strokeWidth={TREE_ICON_STROKE} aria-hidden />
  }

  if (node.node_type === 'document') {
    let isDaily = false
    try {
      const p = JSON.parse(node.properties || '{}')
      isDaily = Boolean(p.daily_date)
    } catch { /* ignore */ }
    if (isDaily && childCount === 0) {
      return <CalendarDays size={size} strokeWidth={TREE_ICON_STROKE} aria-hidden />
    }
    if (childCount > 0) {
      return <FolderOpenDot size={size} strokeWidth={TREE_ICON_STROKE} aria-hidden />
    }
    return <NotebookText size={size} strokeWidth={TREE_ICON_STROKE} aria-hidden />
  }

  return <NotebookText size={size} strokeWidth={TREE_ICON_STROKE} aria-hidden />
}

function cacheKeyForParent(parentId: string | null): string {
  return parentId ?? ROOT_KEY
}

/** IDs to pass to `delete_node` so each subtree is deleted once (avoids re-deleting cascaded children). */
function deletionRootsFromSelection(
  ids: Set<string>,
  findNode: (id: string) => WorkspaceNode | undefined,
): string[] {
  const roots: string[] = []
  for (const id of ids) {
    const n = findNode(id)
    if (!n) continue
    const pid = n.parent_id
    if (!pid || !ids.has(pid)) roots.push(id)
  }
  return roots
}

// ─── Context Menu ───────────────────────────────────────────────────────────────

interface ContextMenuState {
  node: WorkspaceNode
  x: number
  y: number
}

function ContextMenu({
  state,
  onClose,
  onAction,
  selectedIds,
}: {
  state: ContextMenuState
  onClose: () => void
  onAction: (action: string, node: WorkspaceNode) => void
  selectedIds: Set<string>
}) {
  const menuRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  const isDoc = state.node.node_type === 'document'
  const bulkDelete =
    selectedIds.size > 1 && selectedIds.has(state.node.id)

  const estimateMenuWidth = 260
  const estimateMenuHeight = useMemo(() => {
    const itemRows = 6 + (isDoc ? 1 : 0)
    return 8 + itemRows * 34 + 12
  }, [isDoc])

  const [pos, setPos] = useState(() =>
    placeMenuAtPointer(state.x, state.y, {
      menuWidth: estimateMenuWidth,
      menuHeight: estimateMenuHeight,
    }),
  )

  useLayoutEffect(() => {
    const initial = placeMenuAtPointer(state.x, state.y, {
      menuWidth: estimateMenuWidth,
      menuHeight: estimateMenuHeight,
    })
    setPos(initial)
    const id = requestAnimationFrame(() => {
      const el = menuRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setPos(
        fitRectInViewport({
          top: initial.top,
          left: initial.left,
          width: r.width,
          height: r.height,
        }),
      )
    })
    return () => cancelAnimationFrame(id)
  }, [
    state.x,
    state.y,
    state.node.id,
    isDoc,
    bulkDelete,
    estimateMenuHeight,
    estimateMenuWidth,
  ])

  const surfaceStyle: React.CSSProperties = {
    position: 'fixed',
    top: pos.top,
    left: pos.left,
    zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
    padding: '4px 0',
    minWidth: 160,
  }

  return (
    <WorkspaceFloatingPortal>
      <div
        role="presentation"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: Number.parseInt(workspaceFloatingBackdropZ(), 10) || 12000,
          background: 'transparent',
        }}
        onMouseDown={onClose}
      />
      <WorkspaceMenuSurface
        ref={menuRef}
        role="menu"
        style={surfaceStyle}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <WorkspaceMenuItem
          onMouseDown={(e) => {
            e.preventDefault()
            onAction('open', state.node)
            onClose()
          }}
        >
          <span style={{ opacity: 0.6, fontSize: 11 }}>→</span>
          {t('tree.contextOpen')}
        </WorkspaceMenuItem>
        <WorkspaceMenuItem
          onMouseDown={(e) => {
            e.preventDefault()
            onAction('open_in_tab', state.node)
            onClose()
          }}
        >
          <span style={{ opacity: 0.7, fontSize: 11 }}>↗</span>
          {t('tree.contextOpenInTab', { defaultValue: 'Open in tab' })}
        </WorkspaceMenuItem>
        <WorkspaceMenuItem
          onMouseDown={(e) => {
            e.preventDefault()
            onAction('add_child', state.node)
            onClose()
          }}
        >
          <FilePlus size={12} />
          {t('tree.contextAddChild')}
        </WorkspaceMenuItem>
        <WorkspaceMenuItem
          onMouseDown={(e) => {
            e.preventDefault()
            onAction('rename', state.node)
            onClose()
          }}
        >
          <span style={{ opacity: 0.6, fontSize: 11, fontFamily: 'sans-serif' }}>✎</span>
          {t('tree.contextRename')}
        </WorkspaceMenuItem>
        {isDoc && (
          <WorkspaceMenuItem
            onMouseDown={(e) => {
              e.preventDefault()
              onAction('duplicate', state.node)
              onClose()
            }}
          >
            <Copy size={12} />
            {t('tree.contextDuplicate')}
          </WorkspaceMenuItem>
        )}
        <WorkspaceMenuItem
          onMouseDown={(e) => {
            e.preventDefault()
            onAction('favorite', state.node)
            onClose()
          }}
        >
          <Star size={12} />
          {t('tree.contextFavorite')}
        </WorkspaceMenuItem>
        <WorkspaceMenuDivider />
        <WorkspaceMenuItem
          danger
          onMouseDown={(e) => {
            e.preventDefault()
            onAction('delete', state.node)
            onClose()
          }}
        >
          <Trash2 size={12} />
          {bulkDelete
            ? t('tree.contextDeleteMany', {
                count: selectedIds.size,
                defaultValue: 'Delete {{count}} pages',
              })
            : t('tree.contextDelete')}
        </WorkspaceMenuItem>
      </WorkspaceMenuSurface>
    </WorkspaceFloatingPortal>
  )
}

// ─── TreeNode ─────────────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: WorkspaceNode
  depth: number
  staggerIndex: number
  onSelect: (node: WorkspaceNode, event: ReactMouseEvent<HTMLDivElement>) => void
  onToggle: (node: WorkspaceNode) => void
  expandedIds: Set<string>
  activeNodeId: string | null
  dragOverState: TreeDragOverState | null
  dragActiveId: string | null
  // Rename
  renamingId: string | null
  renamingValue: string
  onStartRename: (node: WorkspaceNode) => void
  onRenameChange: (value: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  // Context menu
  contextMenu: ContextMenuState | null
  onContextMenu: (node: WorkspaceNode, x: number, y: number) => void
  onContextMenuClose: () => void
  getChildren: (parentId: string) => WorkspaceNode[]
  onAddRow?: (db: WorkspaceNode) => void
  onQuickAddDocument?: (node: WorkspaceNode) => void
  onQuickAddDatabase?: (node: WorkspaceNode) => void
  /** Root row in the pinned “folders with children” strip (slightly taller hit target). */
  pinnedStrip?: boolean
  /** Multiselect (Shift+range); includes active page when in a range. */
  selectedIds: Set<string>
}

function TreeNode({
  node, depth, staggerIndex, onSelect, onToggle, expandedIds,
  activeNodeId, dragOverState, dragActiveId,
  renamingId, renamingValue, onStartRename, onRenameChange, onRenameCommit, onRenameCancel,
  contextMenu, onContextMenu, onContextMenuClose, getChildren, onAddRow,
  onQuickAddDocument, onQuickAddDatabase, pinnedStrip, selectedIds,
}: TreeNodeProps) {
  const { t } = useTranslation()
  const [hovered, setHovered] = useState(false)
  const isExpanded = expandedIds.has(node.id)
  const isDatabase = node.node_type === 'database'
  const isRow = node.node_type === 'row'
  const childCount = getChildren(node.id).length
  const showBranchChevron = node.node_type === 'document'
  const isDraggable = !isRow
  const isRenaming = renamingId === node.id

  const dropId = `drop-${node.id}`
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.id,
    disabled: !isDraggable,
    data: { workspaceTree: true },
  })
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropId,
    disabled: !isDraggable,
    data: {
      workspaceDrop: true,
      targetNodeId: node.id,
      parentId: node.parent_id,
      position: node.position,
    },
  })
  const setCombinedRef = (el: HTMLElement | null) => {
    setDragRef(el)
    setDropRef(el)
  }

  const isNestDropTarget =
    dragOverState?.kind === 'nest' &&
    dragOverState.nodeId === dropId &&
    node.node_type === 'document'
  const dropHalf =
    dragOverState?.kind === 'sibling' && dragOverState.nodeId === dropId ? dragOverState.half : null
  const showDropTarget = Boolean(
    isOver && dragActiveId && dragActiveId !== node.id && isDraggable && !isNestDropTarget,
  )
  const isActive = activeNodeId === node.id
  const isSelected = selectedIds.has(node.id)
  const isContainerDocument = node.node_type === 'document' && childCount > 0
  const isRootCollection = Boolean(pinnedStrip && isContainerDocument && !node.parent_id)

  const rowHeight = pinnedStrip ? 34 : 28
  const dropLineHeight = 2

  // Row background priority:
  //   1. Drop indicators (nest / sibling) → accent — functional signal
  //   2. Multi-selected OR active (current page) → neutral ink-11% + rim
  //   3. Root-collection container → subtle surface tint
  //   4. Hover → tree-hover
  //   5. Otherwise transparent
  // Mockup uses neutral translucent white (not brand accent) for focused
  // rows so the sidebar doesn't read as a constant alert. Accent color is
  // reserved for the drop-line / nest outline (see outline property below).
  const isFocused = isActive || isSelected
  const rowBg = isNestDropTarget
    ? 'var(--workspace-accent-soft)'
    : showDropTarget
      ? 'var(--workspace-accent-soft)'
      : isFocused
        ? 'var(--tree-node-active-bg)'
        : isRootCollection
          ? 'color-mix(in srgb, var(--surface-1) 88%, transparent)'
        : hovered
          ? 'var(--tree-node-hover-bg)'
          : 'transparent'

  const rowBorder = isRootCollection
    ? '1px solid color-mix(in srgb, var(--workspace-border) 78%, var(--tree-node-active-bg))'
    : '1px solid transparent'

  return (
    <div
      className="workspace-tree-node-stagger"
      style={{ animationDelay: `${Math.min(staggerIndex, 12) * 18}ms` }}
      data-pinned-strip={pinnedStrip ? 'true' : undefined}
    >
      {dropHalf === 'top' && (
        <div style={{
          position: 'relative',
          height: dropLineHeight,
          background: 'var(--workspace-accent)',
          marginLeft: depth * 16 + 8,
          marginRight: 8,
          borderRadius: 1,
          zIndex: 2,
          pointerEvents: 'none',
        }} />
      )}

      <div
        ref={setCombinedRef}
        data-node-id={dropId}
        {...{
          [WORKSPACE_NODE_ID_ATTR]: node.id,
          [WORKSPACE_NODE_TYPE_ATTR]: node.node_type,
          ...(isRow && node.parent_id ? { [WORKSPACE_ROW_PARENT_ATTR]: node.parent_id } : {}),
        }}
        {...attributes}
        {...(isDraggable ? listeners : {})}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={(e) => {
          if (isRenaming) return
          onSelect(node, e)
        }}
        onContextMenu={e => {
          e.preventDefault()
          onContextMenu(node, e.clientX, e.clientY)
        }}
        style={{
          position: 'relative',
          height: rowHeight,
          paddingLeft: 8 + depth * 16,
          paddingRight: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: isRow ? 'pointer' : isDragging ? 'grabbing' : 'grab',
          borderRadius: isRootCollection ? 10 : 8,
          border: rowBorder,
          userSelect: 'none',
          background: rowBg,
          outline: isNestDropTarget
            ? '2px solid var(--workspace-accent-strong)'
            : showDropTarget
              ? '1px solid var(--workspace-accent-strong)'
              : 'none',
          color: isFocused ? 'var(--workspace-accent)' : 'var(--workspace-text)',
          fontWeight: isRootCollection ? 600 : isActive ? 600 : isSelected ? 500 : 400,
          fontSize: isRootCollection ? 12.8 : 12.5,
          // Rim-light on focused rows picks up the mockup's glass-edge feel.
          // Root-collection containers keep their tiny drop shadow when not
          // hovered; when they're also focused, the rim wins.
          boxShadow: isFocused
            ? 'var(--tree-node-active-rim)'
            : isRootCollection && !hovered
              ? 'var(--shadow-xs)'
              : 'none',
          transition: 'background 80ms, color 80ms, outline 80ms, box-shadow 80ms',
          opacity: isDragging ? 0.4 : 1,
        }}
      >
        {showBranchChevron ? (
          <button
            type="button"
            aria-label={
              childCount > 0
                ? (isExpanded
                  ? t('tree.collapseChildren', { defaultValue: 'Collapse nested notes' })
                  : t('tree.expandChildren', { defaultValue: 'Expand nested notes' }))
                : t('tree.noChildren', { defaultValue: 'No nested notes' })
            }
            disabled={childCount === 0}
            onClick={(e) => {
              e.stopPropagation()
              if (childCount > 0) {
                void onToggle(node)
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 16,
              height: 16,
              padding: 0,
              border: 'none',
              background: 'transparent',
              cursor: childCount > 0 ? 'pointer' : 'default',
              flexShrink: 0,
              color: childCount > 0 ? 'var(--workspace-text-soft)' : 'transparent',
            }}
          >
            <ChevronRight
              size={11}
              aria-hidden
              style={{
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 150ms ease',
              }}
            />
          </button>
        ) : (
          <span style={{ width: 16, flexShrink: 0 }} />
        )}

        <span style={{
          flexShrink: 0,
          color: isActive || isSelected ? 'var(--workspace-accent)' : 'var(--workspace-text-soft)',
          display: 'flex',
          alignItems: 'center',
          fontSize: 13,
          lineHeight: 1,
          userSelect: 'none',
        }}>
          <WorkspaceTreeNodeIcon node={node} childCount={childCount} size={13} />
        </span>

        {isRenaming ? (
          <input
            autoFocus
            value={renamingValue}
            onChange={e => onRenameChange(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={e => {
              if (e.key === 'Enter') onRenameCommit()
              if (e.key === 'Escape') onRenameCancel()
              e.stopPropagation()
            }}
            onClick={e => e.stopPropagation()}
            style={{
              flex: 1, fontSize: 12, fontFamily: 'Space Grotesk, sans-serif',
              border: '1px solid var(--workspace-accent)', borderRadius: 3,
              padding: '1px 4px', outline: 'none',
              background: 'var(--workspace-panel)', color: 'var(--workspace-text)',
            }}
          />
        ) : (
          <span style={{
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: 'Space Grotesk, sans-serif',
          }}>
            {node.name || 'Untitled'}
          </span>
        )}

        {isDatabase && !isRenaming && (
          <span
            aria-hidden="true"
            style={{
              flexShrink: 0,
              fontFamily: 'var(--font-mono)',
              fontSize: 8.5,
              fontWeight: 700,
              letterSpacing: '0.08em',
              padding: '1px 4px',
              borderRadius: 4,
              background: 'var(--tree-badge-bg)',
              color: 'var(--tree-badge-fg)',
            }}
          >
            DB
          </span>
        )}

        {isContainerDocument && !isRenaming && (
          <span
            style={{
              flexShrink: 0,
              padding: isRootCollection ? '2px 8px' : '1px 6px',
              borderRadius: 999,
              background: isRootCollection ? 'var(--selected-bg)' : 'color-mix(in srgb, var(--workspace-border) 44%, transparent)',
              color: isRootCollection ? 'var(--workspace-accent)' : 'var(--workspace-text-muted)',
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '.02em',
            }}
          >
            {childCount} {childCount === 1 ? 'note' : 'notes'}
          </span>
        )}

        {hovered && !isRow && !isRenaming && (
          <div
            style={{ display: 'flex', gap: 1, flexShrink: 0, marginLeft: 2 }}
            onPointerDown={e => e.stopPropagation()}
          >
            {node.node_type === 'document' && onQuickAddDocument && (
              <>
                <button
                  type="button"
                  title={t('tree.contextAddChild')}
                  onClick={e => { e.stopPropagation(); onQuickAddDocument(node) }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 18, height: 18, background: 'none', border: 'none',
                    borderRadius: 3, cursor: 'pointer', color: 'var(--workspace-text-muted)', padding: 0,
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = 'var(--workspace-tree-hover-strong)'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--workspace-text)'
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = 'none'
                    ;(e.currentTarget as HTMLElement).style.color = 'var(--workspace-text-muted)'
                  }}
                >
                  <FilePlus size={12} />
                </button>
                {onQuickAddDatabase && (
                  <button
                    type="button"
                    title={t('tree.newDatabase', { defaultValue: 'New database' })}
                    onClick={e => { e.stopPropagation(); onQuickAddDatabase(node) }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 18, height: 18, background: 'none', border: 'none',
                      borderRadius: 3, cursor: 'pointer', color: 'var(--workspace-text-muted)', padding: 0,
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLElement).style.background = 'var(--workspace-tree-hover-strong)'
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--workspace-text)'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLElement).style.background = 'none'
                      ;(e.currentTarget as HTMLElement).style.color = 'var(--workspace-text-muted)'
                    }}
                  >
                    <Database size={12} />
                  </button>
                )}
              </>
            )}
            {isDatabase && onAddRow && (
              <button
                type="button"
                title={t('tree.addRow')}
                onClick={e => { e.stopPropagation(); onAddRow(node) }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, background: 'none', border: 'none',
                  borderRadius: 3, cursor: 'pointer', color: 'var(--workspace-text-muted)', padding: 0,
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--workspace-tree-hover-strong)'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--workspace-text)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = 'none'
                  ;(e.currentTarget as HTMLElement).style.color = 'var(--workspace-text-muted)'
                }}
              >
                <FilePlus size={12} />
              </button>
            )}
            <button
              type="button"
              title="More options"
              onClick={e => {
                e.stopPropagation()
                e.preventDefault()
                onContextMenu(node, e.clientX, e.clientY)
              }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, border: 'none',
                borderRadius: 3, cursor: 'pointer', padding: 0,
                background: 'none',
                color: 'var(--workspace-text-muted)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = 'var(--workspace-tree-hover-strong)'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--workspace-text)'
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = 'none'
                ;(e.currentTarget as HTMLElement).style.color = 'var(--workspace-text-muted)'
              }}
            >
              <MoreHorizontal size={11} />
            </button>
          </div>
        )}
      </div>

      {dropHalf === 'bottom' && (
        <div style={{
          position: 'relative',
          height: dropLineHeight,
          background: 'var(--workspace-accent)',
          marginLeft: depth * 16 + 8,
          marginRight: 8,
          borderRadius: 1,
          zIndex: 2,
          pointerEvents: 'none',
        }} />
      )}

      {isExpanded && showBranchChevron && (
        <NodeChildren
          childrenNodes={getChildren(node.id)}
          depth={depth + 1}
          onSelect={onSelect}
          onToggle={onToggle}
          expandedIds={expandedIds}
          onAddRow={onAddRow}
          activeNodeId={activeNodeId}
          dragOverState={dragOverState}
          dragActiveId={dragActiveId}
          renamingId={renamingId}
          renamingValue={renamingValue}
          onStartRename={onStartRename}
          onRenameChange={onRenameChange}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          contextMenu={contextMenu}
          onContextMenu={onContextMenu}
          onContextMenuClose={onContextMenuClose}
          getChildren={getChildren}
          onQuickAddDocument={onQuickAddDocument}
          onQuickAddDatabase={onQuickAddDatabase}
          selectedIds={selectedIds}
        />
      )}
    </div>
  )
}

// ─── NodeChildren ─────────────────────────────────────────────────────────────

interface NodeChildrenProps {
  childrenNodes: WorkspaceNode[]
  depth: number
  onSelect: (n: WorkspaceNode, event: ReactMouseEvent<HTMLDivElement>) => void
  onToggle: (n: WorkspaceNode) => void
  expandedIds: Set<string>
  onAddRow?: (db: WorkspaceNode) => void
  getChildren: (parentId: string) => WorkspaceNode[]
  activeNodeId: string | null
  dragOverState: TreeDragOverState | null
  dragActiveId: string | null
  // Rename
  renamingId: string | null
  renamingValue: string
  onStartRename: (node: WorkspaceNode) => void
  onRenameChange: (value: string) => void
  onRenameCommit: () => void
  onRenameCancel: () => void
  // Context menu
  contextMenu: ContextMenuState | null
  onContextMenu: (node: WorkspaceNode, x: number, y: number) => void
  onContextMenuClose: () => void
  onQuickAddDocument?: (node: WorkspaceNode) => void
  onQuickAddDatabase?: (node: WorkspaceNode) => void
  selectedIds: Set<string>
}

function NodeChildren({
  childrenNodes, depth, onSelect, onToggle, expandedIds, onAddRow, getChildren,
  activeNodeId, dragOverState, dragActiveId,
  renamingId, renamingValue, onStartRename, onRenameChange, onRenameCommit, onRenameCancel,
  contextMenu, onContextMenu, onContextMenuClose,
  onQuickAddDocument, onQuickAddDatabase, selectedIds,
}: NodeChildrenProps) {
  const children = childrenNodes

  return (
    <>
      {children.map((child, i) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth}
          staggerIndex={i}
          onSelect={onSelect}
          onToggle={onToggle}
          expandedIds={expandedIds}
          getChildren={getChildren}
          onAddRow={onAddRow}
          activeNodeId={activeNodeId}
          dragOverState={dragOverState}
          dragActiveId={dragActiveId}
          renamingId={renamingId}
          renamingValue={renamingValue}
          onStartRename={onStartRename}
          onRenameChange={onRenameChange}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          contextMenu={contextMenu}
          onContextMenu={onContextMenu}
          onContextMenuClose={onContextMenuClose}
          onQuickAddDocument={onQuickAddDocument}
          onQuickAddDatabase={onQuickAddDatabase}
          selectedIds={selectedIds}
        />
      ))}
    </>
  )
}

/** Drop zone below root list: release here to move an item to workspace root (unnest). */
function WorkspaceRootTailDrop({ showLine }: { showLine: boolean }) {
  const { setNodeRef } = useDroppable({
    id: 'workspace-root-tail',
    data: { workspaceRootTail: true },
  })
  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: 28,
        marginTop: 4,
        marginBottom: 4,
        position: 'relative',
        flexShrink: 0,
      }}
    >
      {showLine && (
        <div
          style={{
            position: 'absolute',
            left: 8,
            right: 8,
            top: '50%',
            height: 2,
            marginTop: -1,
            background: 'var(--workspace-accent)',
            borderRadius: 1,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  )
}

// ─── WorkspaceTree ─────────────────────────────────────────────────────────────

export interface WorkspaceTreeProps {
  onOpenSettings?: () => void
  onOpenHelp?: () => void
  settingsTabActive?: boolean
  helpTabActive?: boolean
}

export function WorkspaceTree({
  onOpenSettings,
  onOpenHelp,
  settingsTabActive,
  helpTabActive,
}: WorkspaceTreeProps = {}) {
  const { t } = useTranslation()
  const {
    navigateTo,
    loadRootNodes,
    createNode,
    deleteNode,
    updateNode,
    loadTrashNodes,
    restoreNode,
    permanentDeleteNode,
    emptyTrash,
    setActiveNode,
    loadViews,
    createView,
    addField,
  } = useWorkspaceStore()
  const [childCache, setChildCache] = useState<Map<string, WorkspaceNode[]>>(new Map())
  const childCacheRef = useRef(childCache)
  childCacheRef.current = childCache
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [dragActiveId, setDragActiveId] = useState<UniqueIdentifier | null>(null)
  const [dragOverState, setDragOverState] = useState<TreeDragOverState | null>(null)
  const dragOverStateRef = useRef<TreeDragOverState | null>(null)
  dragOverStateRef.current = dragOverState
  /** Node type of the dragged tree node (for nest-into-document detection). */
  const dragKindRef = useRef<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renamingValue, setRenamingValue] = useState('')
  const [favorites, setFavorites] = useState<WorkspaceNode[]>([])
  const { recents } = useWorkspaceRecents()
  const trashNodes = useWorkspaceStore(s => s.trashNodes)
  const activeNodeId = useWorkspaceStore(s => s.activeNode?.id) ?? null
  /** Last non–Shift-click row for Shift+range selection (matches file-explorer behavior). */
  const selectionAnchorRef = useRef<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const id = useWorkspaceStore.getState().activeNode?.id
    return id ? new Set([id]) : new Set()
  })
  const todayStr = new Date().toISOString().split('T')[0]
  const [dailyNoteDate, setDailyNoteDate] = useState(todayStr)
  const [createDbMenuOpen, setCreateDbMenuOpen] = useState(false)
  const [createDbMenuAnchor, setCreateDbMenuAnchor] = useState<DOMRect | null>(null)
  const createDbMenuBtnRef = useRef<HTMLButtonElement>(null)
  const createDbMenuPanelRef = useRef<HTMLDivElement>(null)

  const refetchParent = useCallback(async (parentId: string | null) => {
    try {
      const key = cacheKeyForParent(parentId)
      const kids = parentId === null
        ? await invoke<WorkspaceNode[]>('get_root_nodes')
        : await invoke<WorkspaceNode[]>('get_node_children', { parentId })
      setChildCache(prev => new Map(prev).set(key, kids))
    } catch { /* non-critical */ }
  }, [])

  const findNodeInCache = useCallback((id: string): WorkspaceNode | undefined => {
    for (const list of childCache.values()) {
      const hit = list.find(n => n.id === id)
      if (hit) return hit
    }
    return undefined
  }, [childCache])

  const getChildren = useCallback((parentId: string) => childCache.get(parentId) ?? [], [childCache])

  /** Sidebar only: hide `row` nodes (rows live in DatabaseShell, not the folder tree). */
  const getTreeChildren = useCallback(
    (parentId: string) => getChildren(parentId).filter(c => c.node_type !== 'row'),
    [getChildren],
  )

  const workspaceTreeRevision = useWorkspaceStore(s => s.workspaceTreeRevision)
  const prevTreeRevisionRef = useRef(0)

  useEffect(() => {
    if (workspaceTreeRevision === 0) {
      prevTreeRevisionRef.current = 0
      return
    }
    if (prevTreeRevisionRef.current === workspaceTreeRevision) return
    prevTreeRevisionRef.current = workspaceTreeRevision

    void (async () => {
      await refetchParent(null)
      const extraKeys = [...childCacheRef.current.keys()].filter(k => k !== ROOT_KEY)
      for (const pid of extraKeys) {
        await refetchParent(pid)
      }
    })()
  }, [workspaceTreeRevision, refetchParent])

  useEffect(() => {
    void loadRootNodes()
    void refetchParent(null)
    void loadFavorites()
    void loadTrashNodes()
  }, [loadRootNodes, loadTrashNodes, refetchParent])

  // Expand ancestors so the active page (including a row inside a database) is visible without extra clicks.
  useEffect(() => {
    if (!activeNodeId) return
    let cancelled = false
    void (async () => {
      const toExpand: string[] = []
      const start = await invoke<WorkspaceNode | null>('get_node', { id: activeNodeId })
      let pid: string | null | undefined = start?.parent_id
      while (pid && !cancelled) {
        toExpand.push(pid)
        const p = await invoke<WorkspaceNode | null>('get_node', { id: pid })
        pid = p?.parent_id ?? null
      }
      if (cancelled || toExpand.length === 0) return
      setExpandedIds(prev => new Set([...prev, ...toExpand]))
    })()
    return () => { cancelled = true }
  }, [activeNodeId])

  /** Clear multiselect when the open page changes outside this range (e.g. wikilink, Home). */
  useEffect(() => {
    if (!activeNodeId) {
      setSelectedIds(new Set())
      selectionAnchorRef.current = null
      return
    }
    setSelectedIds((prev) => {
      if (prev.has(activeNodeId) && prev.size > 1) return prev
      if (prev.size === 1 && prev.has(activeNodeId)) return prev
      selectionAnchorRef.current = activeNodeId
      return new Set([activeNodeId])
    })
  }, [activeNodeId])

  const loadFavorites = async () => {
    try {
      const favJson = await invoke<string | null>('get_user_preference', { key: 'favorites' })
      const favoriteIds: string[] = favJson ? JSON.parse(favJson) : []
      const nodes: WorkspaceNode[] = []
      for (const id of favoriteIds) {
        const node = await invoke<WorkspaceNode | null>('get_node', { id })
        if (node && !node.deleted_at) nodes.push(node)
      }
      setFavorites(nodes)
    } catch { /* non-critical */ }
  }

  const navigateToDailyNote = async (date: string) => {
    try {
      const node = await invoke<WorkspaceNode>('get_or_create_daily_note', { date })
      void navigateTo(node.id, { source: 'daily_note' })
    } catch { /* non-critical */ }
  }

  const handleDailyNotePrev = () => {
    const prev = new Date(dailyNoteDate)
    prev.setDate(prev.getDate() - 1)
    const dateStr = prev.toISOString().split('T')[0]
    setDailyNoteDate(dateStr)
    void navigateToDailyNote(dateStr)
  }

  const handleDailyNoteNext = () => {
    const next = new Date(dailyNoteDate)
    next.setDate(next.getDate() + 1)
    const dateStr = next.toISOString().split('T')[0]
    if (dateStr <= todayStr) {
      setDailyNoteDate(dateStr)
      void navigateToDailyNote(dateStr)
    }
  }

  const handleDailyNoteToday = () => {
    setDailyNoteDate(todayStr)
    void navigateToDailyNote(todayStr)
  }

  const handleToggleFavorite = async (nodeId: string) => {
    try {
      const favJson = await invoke<string | null>('get_user_preference', { key: 'favorites' })
      let favoriteIds: string[] = favJson ? JSON.parse(favJson) : []
      if (favoriteIds.includes(nodeId)) {
        favoriteIds = favoriteIds.filter(id => id !== nodeId)
      } else {
        favoriteIds.push(nodeId)
      }
      await invoke('set_user_preference', { key: 'favorites', value: JSON.stringify(favoriteIds) })
      await loadFavorites()
    } catch { /* non-critical */ }
  }

  const handleCreateDocument = useCallback(async () => {
    const node = await createNode(null, 'document', 'Untitled')
    await refetchParent(null)
    void navigateTo(node.id)
  }, [createNode, navigateTo, refetchParent])

  const handleCreateDatabaseWithPrimaryTab = useCallback(
    async (primary: NewDatabasePrimaryTab) => {
      setCreateDbMenuOpen(false)
      setCreateDbMenuAnchor(null)
      try {
        const title = t('tree.newDatabase', { defaultValue: 'Untitled' })
        const db = await createNode(null, 'database', title)
        await loadViews(db.id)
        const viewLabel = (layout: NodeView['layout']) => {
          if (layout === 'board') return t('tree.newDbBoard', { defaultValue: 'Board' })
          if (layout === 'grid') return t('tree.newDbTable', { defaultValue: 'Table' })
          return t('tree.newDbCalendar', { defaultValue: 'Calendar' })
        }
        for (const { layout } of orderedViewsForNewDatabase(primary)) {
          await createView(db.id, viewLabel(layout), layout)
        }
        // Default DB schema has no date column; calendar view would be empty until user adds one.
        if (primary === 'calendar') {
          await addField(
            db.id,
            t('tree.calendarDefaultStartField', { defaultValue: 'Start' }),
            'date_time',
          )
          await addField(db.id, t('tree.calendarDefaultEndField', { defaultValue: 'End' }), 'date_time')
        }
        await refetchParent(null)
        void navigateTo(db.id)
      } catch (e) {
        toast.error(String(e))
      }
    },
    [addField, createNode, createView, loadViews, navigateTo, refetchParent, t],
  )

  const toggleCreateDbMenu = useCallback(() => {
    setCreateDbMenuOpen((open) => {
      const next = !open
      if (next) {
        const el = createDbMenuBtnRef.current
        setCreateDbMenuAnchor(el ? el.getBoundingClientRect() : null)
      } else {
        setCreateDbMenuAnchor(null)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!createDbMenuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setCreateDbMenuOpen(false)
        setCreateDbMenuAnchor(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createDbMenuOpen])

  useEffect(() => {
    if (!createDbMenuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (createDbMenuBtnRef.current?.contains(t)) return
      if (createDbMenuPanelRef.current?.contains(t)) return
      setCreateDbMenuOpen(false)
      setCreateDbMenuAnchor(null)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => window.removeEventListener('pointerdown', onPointerDown, true)
  }, [createDbMenuOpen])

  /** Create a document-container collection at the root with one starter note nested inside. */
  const handleCreateCollection = useCallback(async () => {
    const folder = await createNode(null, 'document', t('tree.newCollection', { defaultValue: 'New collection' }))
    const note = await createNode(folder.id, 'document', t('tree.newNestedNote', { defaultValue: 'Untitled' }))
    await refetchParent(null)
    await refetchParent(folder.id)
    setExpandedIds(prev => new Set([...prev, folder.id]))
    void navigateTo(note.id)
  }, [createNode, navigateTo, refetchParent, t])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        void handleCreateDocument()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleCreateDocument])

  const handleToggle = async (node: WorkspaceNode) => {
    if (expandedIds.has(node.id)) {
      setExpandedIds(prev => {
        const next = new Set(prev)
        next.delete(node.id)
        return next
      })
    } else {
      setExpandedIds(prev => new Set([...prev, node.id]))
      if (!childCache.has(node.id)) {
        try {
          const kids = await invoke<WorkspaceNode[]>('get_node_children', { parentId: node.id })
          setChildCache(prev => new Map(prev).set(node.id, kids))
        } catch { /* non-critical */ }
      }
    }
  }

  const handleAddRow = useCallback(async (db: WorkspaceNode) => {
    const row = await createNode(db.id, 'row', 'Untitled')
    setActiveNode(row)
    await refetchParent(db.id)
  }, [createNode, setActiveNode, refetchParent])

  const handleQuickAddDocument = useCallback(async (node: WorkspaceNode) => {
    await createNode(node.id, 'document', 'Untitled')
    await refetchParent(node.id)
    setExpandedIds(prev => new Set([...prev, node.id]))
  }, [createNode, refetchParent])

  const handleQuickAddDatabase = useCallback(async (node: WorkspaceNode) => {
    await createNode(node.id, 'database', 'Untitled')
    await refetchParent(node.id)
    setExpandedIds(prev => new Set([...prev, node.id]))
  }, [createNode, refetchParent])

  const handleContextAction = useCallback(
    async (action: string, node: WorkspaceNode) => {
      switch (action) {
        case 'open':
          void navigateTo(node.id)
          break
        case 'open_in_tab':
          emitWorkspaceTabOpen(node)
          void navigateTo(node.id)
          break
        case 'add_child':
          {
            const child = await createNode(
              node.id,
              'document',
              t('tree.newNestedNote', { defaultValue: 'Untitled' }),
            )
            emitWorkspaceTabOpen(child)
            void navigateTo(child.id)
          }
          await refetchParent(node.id)
          break
        case 'rename':
          setRenamingId(node.id)
          setRenamingValue(node.name)
          break
        case 'duplicate':
          await createNode(node.parent_id, 'document', node.name + ' (Copy)')
          await refetchParent(node.parent_id)
          break
        case 'favorite': {
          await handleToggleFavorite(node.id)
          break
        }
        case 'delete': {
          const useBulk = selectedIds.size > 1 && selectedIds.has(node.id)
          if (useBulk) {
            const roots = deletionRootsFromSelection(selectedIds, findNodeInCache)
            if (roots.length === 0) break
            if (
              !window.confirm(
                t('tree.confirmDeleteMany', {
                  count: selectedIds.size,
                  defaultValue:
                    'Delete {{count}} selected pages? They will move to trash. Folders include their child pages.',
                }),
              )
            ) {
              break
            }
            const activeBefore = useWorkspaceStore.getState().activeNode?.id ?? null
            try {
              for (const id of roots) {
                await invoke('delete_node', { id })
              }
              const st = useWorkspaceStore.getState()
              st.bumpWorkspaceTreeRevision()
              await st.loadTrashNodes()
              st.bumpRecentsRevision()
              if (activeBefore) {
                const check = await invoke<WorkspaceNode | null>('get_node', { id: activeBefore })
                if (!check || check.deleted_at != null) {
                  st.setActiveNode(null)
                }
              }
              setSelectedIds(new Set())
              selectionAnchorRef.current = null
              await refetchParent(null)
            } catch (e) {
              toast.error(String(e))
            }
            break
          }
          const parentId = node.parent_id
          await deleteNode(node.id)
          await refetchParent(parentId)
          const activeAfter = useWorkspaceStore.getState().activeNode?.id ?? null
          setSelectedIds(activeAfter ? new Set([activeAfter]) : new Set())
          selectionAnchorRef.current = activeAfter
          break
        }
      }
    },
    [
      createNode,
      deleteNode,
      findNodeInCache,
      handleToggleFavorite,
      navigateTo,
      refetchParent,
      selectedIds,
      setRenamingId,
      setRenamingValue,
      t,
    ],
  )

  const handleRenameCommit = async () => {
    if (!renamingId) return
    const node = await invoke<WorkspaceNode | null>('get_node', { id: renamingId })
    if (node) {
      const newName = renamingValue.trim() || 'Untitled'
      await updateNode(node.id, newName, node.icon, node.properties, node.body)
      await refetchParent(node.parent_id)
    }
    setRenamingId(null)
    setRenamingValue('')
  }

  const handleRenameCancel = () => {
    setRenamingId(null)
    setRenamingValue('')
  }

  const performSiblingInsert = useCallback(async (
    dragNodeId: string,
    targetNode: WorkspaceNode,
    dragOverPosition: 'before' | 'after',
  ) => {
    const dragNode = findNodeInCache(dragNodeId)
    if (!dragNode) return

    const prevParentId = dragNode.parent_id
    const newParentId = targetNode.parent_id
    const key = cacheKeyForParent(newParentId)
    const bucket = childCache.get(key) ?? []
    const siblings = bucket.filter(n => n.parent_id === newParentId && n.id !== dragNodeId)
    const targetIdx = siblings.findIndex(n => n.id === targetNode.id)
    if (targetIdx === -1) return

    let newPosition: number
    if (dragOverPosition === 'before') {
      const prev = siblings[targetIdx - 1]
      newPosition = prev ? (prev.position + targetNode.position) / 2 : targetNode.position - 1
    } else {
      const next = siblings[targetIdx + 1]
      newPosition = next ? (targetNode.position + next.position) / 2 : targetNode.position + 1
    }

    const MIN_GAP = 1e-9
    if (newPosition - Math.floor(newPosition) < MIN_GAP || 1 - (newPosition - Math.floor(newPosition)) < MIN_GAP) {
      const sorted = [...siblings].sort((a, b) => a.position - b.position)
      for (let i = 0; i < sorted.length; i++) {
        await invoke('move_node', { id: sorted[i].id, parentId: newParentId, position: i * 1.0 })
      }
      await invoke('move_node', { id: dragNodeId, parentId: newParentId, position: newPosition })
    } else {
      await invoke('move_node', { id: dragNodeId, parentId: newParentId, position: newPosition })
    }

    await refetchParent(newParentId)
    if (prevParentId !== newParentId) await refetchParent(prevParentId)
    useWorkspaceStore.getState().bumpWorkspaceTreeRevision()
  }, [findNodeInCache, childCache, refetchParent])

  const handleKitDragOver = useCallback((event: DragOverEvent) => {
    if (!event.over) {
      setDragOverState(null)
      return
    }
    if (event.over.data.current?.workspaceRootTail) {
      setDragOverState({ kind: 'rootTail' })
      return
    }
    const overId = String(event.over.id)
    if (!event.over.data.current?.workspaceDrop) {
      setDragOverState(null)
      return
    }
    const el = document.querySelector<HTMLElement>(`[data-node-id="${overId}"]`)
    if (!el) {
      setDragOverState(null)
      return
    }
    const rect = el.getBoundingClientRect()
    const pointer = event.activatorEvent as PointerEvent
    const currentY = pointer.clientY + event.delta.y
    const relY = (currentY - rect.top) / Math.max(rect.height, 1)

    const targetNodeId = event.over.data.current?.targetNodeId as string | undefined
    const targetNode = targetNodeId ? findNodeInCache(targetNodeId) : undefined
    const dk = dragKindRef.current
    const nestZone = dk === 'database' && targetNode?.node_type === 'document'

    if (nestZone && relY >= 0.33 && relY <= 0.67) {
      setDragOverState({ kind: 'nest', nodeId: overId })
      return
    }

    const half: 'top' | 'bottom' = relY < 0.5 ? 'top' : 'bottom'
    setDragOverState({ kind: 'sibling', nodeId: overId, half })
  }, [findNodeInCache])

  const handleKitDragEnd = useCallback(async (event: DragEndEvent) => {
    const captured = dragOverStateRef.current
    setDragActiveId(null)
    setDragOverState(null)
    dragKindRef.current = null

    const { active, over } = event
    if (!over || active.id === over.id) return

    const effId = String(active.id)
    const dragNode = findNodeInCache(effId)
    if (!dragNode) return

    if (captured?.kind === 'rootTail' && over.data.current?.workspaceRootTail) {
      try {
        const roots = childCache.get(ROOT_KEY) ?? []
        const topLevel = roots.filter(n => n.parent_id === null)
        const maxPos = topLevel.length ? Math.max(...topLevel.map(r => r.position)) : -1
        const prevParent = dragNode.parent_id
        await invoke('move_node', { id: effId, parentId: null, position: maxPos + 1 })
        await refetchParent(null)
        await refetchParent(prevParent)
        useWorkspaceStore.getState().bumpWorkspaceTreeRevision()
      } catch (e) {
        toast.error(String(e))
      }
      return
    }

    const targetNodeId = over.data.current?.targetNodeId as string | undefined
    if (!targetNodeId || !over.data.current?.workspaceDrop) return
    const targetNode = findNodeInCache(targetNodeId)
    if (!targetNode || !captured) return

    if (captured.kind === 'nest') {
      if (String(over.id) !== captured.nodeId) return
      if (targetNode.node_type !== 'document') return
      try {
        if (await isDragTargetInsideDraggedSubtree(effId, targetNode.id)) {
          toast.error(t('tree.invalidNestTarget', { defaultValue: 'Cannot move into that page.' }))
          return
        }
        const kids = await invoke<WorkspaceNode[]>('get_node_children', { parentId: targetNode.id })
        const maxPos = kids.length ? Math.max(...kids.map(c => c.position)) : -1
        const prevParent = dragNode.parent_id
        await invoke('move_node', { id: effId, parentId: targetNode.id, position: maxPos + 1 })
        await refetchParent(targetNode.id)
        await refetchParent(prevParent)
        useWorkspaceStore.getState().bumpWorkspaceTreeRevision()
      } catch (e) {
        toast.error(String(e))
      }
      return
    }

    if (captured.kind === 'sibling') {
      if (captured.nodeId !== String(over.id)) return
      const dragOverPosition: 'before' | 'after' = captured.half === 'top' ? 'before' : 'after'
      try {
        await performSiblingInsert(effId, targetNode, dragOverPosition)
      } catch (e) {
        toast.error(String(e))
      }
    }
  }, [findNodeInCache, performSiblingInsert, childCache, refetchParent, t])

  const roots = childCache.get(ROOT_KEY) ?? []
  const { branchRoots, otherRoots } = useMemo(() => {
    const r = childCache.get(ROOT_KEY) ?? []
    const branch: WorkspaceNode[] = []
    const other: WorkspaceNode[] = []
    for (const n of r) {
      if (n.node_type === 'document' && getTreeChildren(n.id).length > 0) {
        branch.push(n)
      } else {
        other.push(n)
      }
    }
    return { branchRoots: branch, otherRoots: other }
  }, [childCache, getTreeChildren])
  /** DFS order of visible tree rows (pinned folders first, then “All pages”), for Shift+range select. */
  const visibleOrderedNodeIds = useMemo(() => {
    const out: string[] = []
    const walk = (nodes: WorkspaceNode[]) => {
      const sorted = [...nodes].sort((a, b) => a.position - b.position)
      for (const n of sorted) {
        out.push(n.id)
        if (n.node_type === 'document' && expandedIds.has(n.id)) {
          const kids = getTreeChildren(n.id)
          if (kids.length) walk(kids)
        }
      }
    }
    walk(branchRoots)
    walk(otherRoots)
    return out
  }, [branchRoots, otherRoots, expandedIds, getTreeChildren])

  const handleTreeSelect = useCallback(
    (node: WorkspaceNode, e: ReactMouseEvent<HTMLDivElement>) => {
      const order = visibleOrderedNodeIds
      if (e.shiftKey) {
        const anchor = selectionAnchorRef.current
        const iAnchor = anchor ? order.indexOf(anchor) : -1
        const iClick = order.indexOf(node.id)
        let next: Set<string>
        if (iAnchor === -1 || iClick === -1) {
          next = new Set([node.id])
        } else {
          const lo = Math.min(iAnchor, iClick)
          const hi = Math.max(iAnchor, iClick)
          next = new Set(order.slice(lo, hi + 1))
        }
        setSelectedIds(next)
        void navigateTo(node.id)
        return
      }
      selectionAnchorRef.current = node.id
      setSelectedIds(new Set([node.id]))
      void navigateTo(node.id)
    },
    [visibleOrderedNodeIds, navigateTo],
  )

  const rootDocumentPrefetchKey = roots.map(n => `${n.id}:${n.node_type}`).join('|')

  // Load first-level children for each root document so notes with databases get childCount > 0 and show a chevron.
  useEffect(() => {
    if (roots.length === 0) return
    const docs = roots.filter(n => n.node_type === 'document')
    if (docs.length === 0) return
    void (async () => {
      await Promise.all(docs.map(d => refetchParent(d.id)))
    })()
  }, [rootDocumentPrefetchKey, refetchParent, roots.length])

  const handleRestoreTrash = useCallback(async (id: string) => {
    await restoreNode(id)
    void loadTrashNodes()
    await refetchParent(null)
  }, [restoreNode, loadTrashNodes, refetchParent])

  const handlePermanentDelete = useCallback(async (node: WorkspaceNode) => {
    if (window.confirm(t('tree.confirmPermanentDelete', { name: node.name }))) {
      await permanentDeleteNode(node.id)
      void loadTrashNodes()
      await refetchParent(null)
    }
  }, [permanentDeleteNode, loadTrashNodes, refetchParent, t])

  const handleEmptyTrash = useCallback(async () => {
    if (trashNodes.length === 0) return
    if (!window.confirm(t('tree.confirmEmptyTrash'))) return
    try {
      await emptyTrash()
      void loadTrashNodes()
      await refetchParent(null)
    } catch {
      toast.error('Could not empty trash')
    }
  }, [emptyTrash, loadTrashNodes, refetchParent, trashNodes.length, t])

  // ── Bottom panel state (daily / favorites / recents / trash) ─────────────────
  type BottomPanel = 'daily' | 'favorites' | 'recents' | 'trash' | null
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>(null)
  const togglePanel = (p: BottomPanel) => setBottomPanel(v => v === p ? null : p)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Context menu portal */}
      {contextMenu && (
        <ContextMenu
          key={`ctx-${contextMenu.node.id}-${contextMenu.x}-${contextMenu.y}`}
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onAction={handleContextAction}
          selectedIds={selectedIds}
        />
      )}

      {/* ─── Toolbar: search + new (no duplicate Knowledge Workspace label — main rail branding lives on Home / other tabs) ───────── */}
      <div
        role="toolbar"
        aria-label={t('sidebar.workspaceLabel')}
        style={{
          height: 40,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px 0 10px',
          gap: 8,
          borderBottom: '1px solid var(--workspace-border)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.4), rgba(255,255,255,0)), transparent',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontFamily: 'Inter, sans-serif',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '.12em',
            color: 'var(--workspace-text-soft)',
            userSelect: 'none',
          }}
        >
          Workspace
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <button
            type="button"
            onClick={() => toast.message(t('tree.searchComingSoon', { defaultValue: 'Search coming soon' }))}
            title={t('tree.search', { defaultValue: 'Search' })}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, background: 'none', border: 'none',
              borderRadius: 999, cursor: 'pointer', color: 'var(--workspace-text-muted)', padding: 0,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = 'var(--workspace-tree-hover)'
              ;(e.currentTarget as HTMLElement).style.color = 'var(--workspace-text)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'none'
              ;(e.currentTarget as HTMLElement).style.color = 'var(--workspace-text-muted)'
            }}
          >
            <Search size={14} />
          </button>
          <button
            type="button"
            onClick={() => void handleCreateCollection()}
            title={t('tree.newWorkspaceCollection', { defaultValue: 'New collection' })}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, background: 'none', border: 'none',
              borderRadius: 999, cursor: 'pointer', color: 'var(--workspace-text-muted)', padding: 0,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = 'var(--workspace-tree-hover)'
              ;(e.currentTarget as HTMLElement).style.color = 'var(--workspace-text)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = 'none'
              ;(e.currentTarget as HTMLElement).style.color = 'var(--workspace-text-muted)'
            }}
          >
            <FolderPlus size={14} />
          </button>
          <button
            ref={createDbMenuBtnRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={createDbMenuOpen}
            onClick={() => toggleCreateDbMenu()}
            title={t('tree.newPlusMenuTitle', {
              defaultValue: 'New note or database — board, table, calendar',
            })}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, background: 'var(--workspace-accent)', border: 'none',
              borderRadius: 999, cursor: 'pointer', color: '#fff', padding: 0, fontSize: 16,
              fontWeight: 700, lineHeight: 1,
            }}
          >
            +
          </button>
        </div>
      </div>

      {createDbMenuOpen && createDbMenuAnchor && typeof document !== 'undefined'
        ? createPortal(
            (() => {
              const CREATE_MENU_MIN_W = 200
              const margin = 8
              const gap = 6
              // Open to the right: align panel left with button left (clamp if it would overflow viewport).
              let left = createDbMenuAnchor.left
              if (left + CREATE_MENU_MIN_W > window.innerWidth - margin) {
                left = window.innerWidth - margin - CREATE_MENU_MIN_W
              }
              left = Math.max(margin, left)
              const top = createDbMenuAnchor.bottom + gap
              return (
            <WorkspaceMenuSurface
              ref={createDbMenuPanelRef}
              role="menu"
              aria-label={t('tree.newPlusMenuAria', {
                defaultValue: 'New note or database',
              })}
              style={{
                position: 'fixed',
                zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
                top,
                left,
                minWidth: CREATE_MENU_MIN_W,
                padding: 4,
                boxShadow: 'var(--workspace-shadow)',
              }}
            >
              <WorkspaceMenuItem
                type="button"
                onClick={() => {
                  setCreateDbMenuOpen(false)
                  setCreateDbMenuAnchor(null)
                  void handleCreateCollection()
                }}
              >
                <FolderPlus size={14} strokeWidth={1.75} style={{ flexShrink: 0, color: 'var(--workspace-text-muted)' }} />
                <span>{t('tree.newCollection', { defaultValue: 'Collection' })}</span>
              </WorkspaceMenuItem>
              <WorkspaceMenuDivider />
              <WorkspaceMenuItem
                type="button"
                onClick={() => {
                  setCreateDbMenuOpen(false)
                  setCreateDbMenuAnchor(null)
                  void handleCreateDocument()
                }}
              >
                <NotebookText size={14} strokeWidth={1.75} style={{ flexShrink: 0, color: 'var(--workspace-text-muted)' }} />
                <span>{t('tree.newNote', { defaultValue: 'Note' })}</span>
              </WorkspaceMenuItem>
              <WorkspaceMenuDivider />
              {(
                [
                  ['board', 'tree.newDbBoard', Kanban] as const,
                  ['grid', 'tree.newDbTable', Table2] as const,
                  ['calendar', 'tree.newDbCalendar', CalendarDays] as const,
                ] as const
              ).map(([tab, i18nKey, Icon]) => (
                <WorkspaceMenuItem
                  key={tab}
                  type="button"
                  onClick={() => void handleCreateDatabaseWithPrimaryTab(tab)}
                >
                  <Icon size={14} strokeWidth={1.75} style={{ flexShrink: 0, color: 'var(--workspace-text-muted)' }} />
                  <span>
                    {t(i18nKey, {
                      defaultValue: tab === 'board' ? 'Board' : tab === 'grid' ? 'Table' : 'Calendar',
                    })}
                  </span>
                </WorkspaceMenuItem>
              ))}
            </WorkspaceMenuSurface>
              )
            })(),
            document.body,
          )
        : null}

      {/* ─── Document tree (scrollable) + dnd-kit ────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <DndContext
          sensors={sensors}
          onDragStart={e => {
            const id = String(e.active.id)
            setDragActiveId(id)
            const n = findNodeInCache(id)
            dragKindRef.current = n?.node_type ?? null
          }}
          onDragOver={handleKitDragOver}
          onDragEnd={e => { void handleKitDragEnd(e) }}
          onDragCancel={() => {
            setDragActiveId(null)
            setDragOverState(null)
            dragKindRef.current = null
          }}
        >
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 6px', minHeight: 0 }}>
          {roots.length === 0 && (
            <div style={{
              padding: '24px 8px', textAlign: 'center',
              color: 'var(--workspace-text-muted)', fontSize: 12,
              fontStyle: 'italic', fontFamily: 'Space Grotesk, sans-serif',
              lineHeight: 1.6,
            }}>
              {t('tree.noPages', { defaultValue: 'No pages yet.' })}{' '}
              <span style={{ opacity: 0.6, fontSize: 11 }}>
                {t('tree.noPagesHint', {
                  defaultValue: 'Use + for a note or database, or Ctrl+N for a blank page.',
                })}
              </span>
            </div>
          )}

          {branchRoots.length > 0 && (
            <div role="region" aria-label={t('tree.workspacePinnedCollections', { defaultValue: 'Collections' })}>
              <div
                className="workspace-eyebrow"
                style={{
                  margin: '2px 6px 6px',
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--workspace-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                  userSelect: 'none',
                }}
              >
                {t('tree.workspacePinnedCollections', { defaultValue: 'Collections' })}
              </div>
              {branchRoots.map((node, i) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  staggerIndex={i}
                  pinnedStrip
                  onSelect={handleTreeSelect}
                  onToggle={n => { void handleToggle(n) }}
                  expandedIds={expandedIds}
                  getChildren={getTreeChildren}
                  onAddRow={handleAddRow}
                  selectedIds={selectedIds}
                  activeNodeId={activeNodeId}
                  dragOverState={dragOverState}
                  dragActiveId={dragActiveId ? String(dragActiveId) : null}
                  renamingId={renamingId}
                  renamingValue={renamingValue}
                  onStartRename={node => { setRenamingId(node.id); setRenamingValue(node.name) }}
                  onRenameChange={setRenamingValue}
                  onRenameCommit={() => { void handleRenameCommit() }}
                  onRenameCancel={handleRenameCancel}
                  contextMenu={contextMenu}
                  onContextMenu={(node, x, y) => setContextMenu({ node, x, y })}
                  onContextMenuClose={() => setContextMenu(null)}
                  onQuickAddDocument={handleQuickAddDocument}
                  onQuickAddDatabase={handleQuickAddDatabase}
                />
              ))}
            </div>
          )}

          {branchRoots.length > 0 && otherRoots.length > 0 && (
            <>
              <div
                style={{ borderTop: '1px solid var(--workspace-border)', margin: '6px 0 8px' }}
                aria-hidden
              />
              <div
                className="workspace-eyebrow"
                style={{
                  margin: '0 6px 6px',
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--workspace-text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                  userSelect: 'none',
                }}
              >
                {t('tree.workspaceAllPages')}
              </div>
            </>
          )}

          {otherRoots.map((node, i) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              staggerIndex={branchRoots.length + i}
              onSelect={handleTreeSelect}
              onToggle={n => { void handleToggle(n) }}
              expandedIds={expandedIds}
              getChildren={getTreeChildren}
              onAddRow={handleAddRow}
              selectedIds={selectedIds}
              activeNodeId={activeNodeId}
              dragOverState={dragOverState}
              dragActiveId={dragActiveId ? String(dragActiveId) : null}
              renamingId={renamingId}
              renamingValue={renamingValue}
              onStartRename={node => { setRenamingId(node.id); setRenamingValue(node.name) }}
              onRenameChange={setRenamingValue}
              onRenameCommit={() => { void handleRenameCommit() }}
              onRenameCancel={handleRenameCancel}
              contextMenu={contextMenu}
              onContextMenu={(node, x, y) => setContextMenu({ node, x, y })}
              onContextMenuClose={() => setContextMenu(null)}
              onQuickAddDocument={handleQuickAddDocument}
              onQuickAddDatabase={handleQuickAddDatabase}
            />
          ))}
          <WorkspaceRootTailDrop showLine={dragOverState?.kind === 'rootTail'} />
        </div>

        <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
          {dragActiveId
            ? (() => {
                const n = findNodeInCache(String(dragActiveId))
                if (!n || n.node_type === 'row') return null
                const overlayChildCount = getTreeChildren(n.id).length
                return (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12.5,
                    padding: '3px 10px',
                    background: 'var(--workspace-panel)',
                    border: '1px solid var(--workspace-border-strong)',
                    borderRadius: 4,
                    boxShadow: 'var(--workspace-shadow-soft)',
                    color: 'var(--workspace-text)',
                    opacity: 0.92,
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                  }}>
                    <span style={{ color: 'var(--workspace-text-soft)', display: 'flex', alignItems: 'center' }}>
                      <WorkspaceTreeNodeIcon node={n} childCount={overlayChildCount} size={13} />
                    </span>
                    {n.name || 'Untitled'}
                  </div>
                )
              })()
            : null}
        </DragOverlay>
          </div>
        </DndContext>
      </div>

      {/* ─── Bottom panel (expands upward) ───────────────────── */}
      {bottomPanel && (
        <div style={{
          borderTop: '1px solid var(--workspace-border)',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0)), var(--workspace-panel)',
          maxHeight: 220, overflowY: 'auto',
          padding: '10px 10px 6px',
        }}>
          {bottomPanel === 'daily' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <button type="button" onClick={handleDailyNotePrev} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: 'var(--workspace-text-muted)' }}>
                  <ChevronLeft size={12} />
                </button>
                <button
                  type="button"
                  onClick={handleDailyNoteToday}
                  title={t('tree.today')}
                  style={{
                    flex: 1,
                    background: 'var(--workspace-accent)',
                    border: 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#fff',
                    padding: '3px 6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                  }}
                >
                  <CalendarDays size={12} strokeWidth={2.25} aria-hidden style={{ flexShrink: 0 }} />
                  {t('tree.today')}
                </button>
                <button type="button" onClick={handleDailyNoteNext} disabled={dailyNoteDate >= todayStr} style={{ background: 'none', border: 'none', cursor: dailyNoteDate >= todayStr ? 'default' : 'pointer', padding: 2, display: 'flex', alignItems: 'center', color: dailyNoteDate >= todayStr ? 'var(--workspace-border)' : 'var(--workspace-text-muted)' }}>
                  <ChevronRight size={12} />
                </button>
              </div>
              <div style={{ fontSize: 10, textAlign: 'center', opacity: 0.5, fontFamily: 'Manrope, sans-serif', marginBottom: 4 }}>
                {new Date(dailyNoteDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
            </>
          )}

          {bottomPanel === 'favorites' && (
            favorites.length === 0
              ? <div style={{ fontSize: 11, opacity: 0.4, padding: '2px 4px' }}>No favorites yet</div>
              : favorites.map(node => (
                <div
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => { void navigateTo(node.id) }}
                  onKeyDown={e => { if (e.key === 'Enter') void navigateTo(node.id) }}
                  className="workspace-row-hover"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                >
                  <Star size={11} style={{ color: 'var(--workspace-accent)', flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
                </div>
              ))
          )}

          {bottomPanel === 'recents' && (
            recents.length === 0
              ? <div style={{ fontSize: 11, opacity: 0.4, padding: '2px 4px' }}>No recent pages</div>
              : recents.map(r => (
                <div
                  key={r.nodeId}
                  role="button"
                  tabIndex={0}
                  onClick={() => { void navigateTo(r.nodeId) }}
                  onKeyDown={e => { if (e.key === 'Enter') void navigateTo(r.nodeId) }}
                  className="workspace-row-hover"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                >
                  <Clock size={11} style={{ color: 'var(--workspace-text-muted)', flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                </div>
              ))
          )}

          {bottomPanel === 'trash' && (
            trashNodes.length === 0
              ? <div style={{ fontSize: 11, opacity: 0.4, padding: '2px 4px' }}>{t('tree.trashEmpty')}</div>
              : (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '2px 4px 6px' }}>
                    <button
                      type="button"
                      onClick={() => void handleEmptyTrash()}
                      style={{
                        fontSize: 11,
                        fontFamily: 'Space Grotesk, sans-serif',
                        padding: '4px 8px',
                        borderRadius: 4,
                        border: '1px solid var(--workspace-border)',
                        background: 'var(--workspace-pane-strong)',
                        color: '#b72301',
                        cursor: 'pointer',
                      }}
                    >
                      {t('tree.emptyTrash')}
                    </button>
                  </div>
                  {trashNodes.map(node => (
                    <div
                      key={node.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', borderRadius: 4, fontSize: 12 }}
                    >
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.6 }}>{node.name}</span>
                      <button type="button" onClick={() => void handleRestoreTrash(node.id)} title={t('tree.restore')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: 'var(--workspace-text-muted)' }}>
                        <RotateCcw size={10} />
                      </button>
                      <button type="button" onClick={() => void handlePermanentDelete(node)} title={t('tree.deleteForever')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: '#b72301' }}>
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </>
                )
          )}
        </div>
      )}

      <AppSidebarChrome
        variant="workspace"
        onOpenSettings={() => onOpenSettings?.()}
        onOpenHelp={() => onOpenHelp?.()}
        bottomPanel={bottomPanel}
        onTogglePanel={(key) => togglePanel(key)}
        favoritesCount={favorites.length}
        recentsCount={recents.length}
        trashCount={trashNodes.length}
        settingsActive={settingsTabActive}
        helpActive={helpTabActive}
      />
    </div>
  )
}
