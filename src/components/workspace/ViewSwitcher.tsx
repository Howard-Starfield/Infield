import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useState } from 'react'
import { Table2, Kanban, CalendarDays, BarChart2, Plus, MoreHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { NodeView } from '../../types/workspace'

const VIEW_ICON: Record<string, LucideIcon> = {
  board:    Kanban,
  calendar: CalendarDays,
  grid:     Table2,
  chart:    BarChart2,
}

const TAB_STRIP_MIN_H = 40

interface Props {
  views: NodeView[]
  activeViewId: string | null
  onSelectView: (id: string) => void
  onAddView: (e: ReactMouseEvent) => void
  onContextMenu: (view: NodeView, e: ReactMouseEvent) => void
  renamingViewId: string | null
  onRenameCommit: (id: string, name: string) => void
}

export function ViewSwitcher({
  views,
  activeViewId,
  onSelectView,
  onAddView,
  onContextMenu,
  renamingViewId,
  onRenameCommit,
}: Props) {
  const [hoveredViewId, setHoveredViewId] = useState<string | null>(null)

  const addBtnStyle: CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 32, height: TAB_STRIP_MIN_H, flexShrink: 0,
    border: 'none', background: 'transparent',
    color: 'var(--workspace-text-muted)', cursor: 'pointer', padding: 0,
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      borderBottom: 'var(--workspace-hairline-inner)',
      background: 'transparent',
      padding: '0 12px',
      minHeight: TAB_STRIP_MIN_H,
    }}>

      <button
        type="button"
        onClick={onAddView}
        style={addBtnStyle}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--workspace-text)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--workspace-text-muted)' }}
        title="Add view"
      >
        <Plus size={14} strokeWidth={2} />
      </button>

      <div
        className="workspace-tab-strip"
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: TAB_STRIP_MIN_H,
          display: 'flex',
          alignItems: 'center',
          overflowX: 'auto',
          overflowY: 'hidden',
        }}
      >
        {views.map((view, index) => {
          const isActive = view.id === activeViewId
          const isRenaming = view.id === renamingViewId
          const accentColor = view.color ?? 'var(--workspace-accent)'
          const IconComp = VIEW_ICON[view.layout] ?? Table2
          const showPill = !isActive && hoveredViewId === view.id && !isRenaming

          return (
            <div
              key={view.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                position: 'relative',
                borderLeft: index === 0 ? 'none' : 'var(--workspace-hairline-inner)',
                paddingLeft: index === 0 ? 0 : 0,
              }}
            >
              <button
                type="button"
                onClick={() => !isRenaming && onSelectView(view.id)}
                onContextMenu={e => { e.preventDefault(); onContextMenu(view, e) }}
                onMouseEnter={() => { if (!isRenaming) setHoveredViewId(view.id) }}
                onMouseLeave={() => { setHoveredViewId(null) }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  margin: '0 2px',
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: 999,
                  background: isActive
                    ? 'color-mix(in srgb, var(--on-surface) 8%, transparent)'
                    : showPill
                      ? 'color-mix(in srgb, var(--on-surface) 4%, transparent)'
                      : 'transparent',
                  boxShadow: 'none',
                  color: isActive ? 'var(--workspace-text)' : 'var(--workspace-text-muted)',
                  fontSize: 13,
                  fontFamily: 'Inter, sans-serif',
                  fontWeight: isActive ? 600 : 500,
                  cursor: isRenaming ? 'default' : 'pointer',
                  whiteSpace: 'nowrap',
                  marginBottom: -1,
                  transition: 'background 120ms ease, color 120ms ease',
                }}
              >
                <IconComp size={14} strokeWidth={1.75} />

                {isRenaming ? (
                  <input
                    autoFocus
                    defaultValue={view.name}
                    onBlur={e => onRenameCommit(view.id, e.target.value || view.name)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') onRenameCommit(view.id, (e.target as HTMLInputElement).value || view.name)
                      if (e.key === 'Escape') onRenameCommit(view.id, view.name)
                    }}
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: 12, fontFamily: 'Inter, sans-serif',
                      border: '1px solid var(--workspace-border)', borderRadius: 6,
                      padding: '2px 6px', width: 88,
                      background: 'var(--workspace-panel)', color: 'var(--workspace-text)', outline: 'none',
                    }}
                  />
                ) : (
                  <span>{view.name}</span>
                )}

                {isActive && !isRenaming && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => { e.stopPropagation(); onContextMenu(view, e) }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 18, height: 18, marginLeft: 2, flexShrink: 0,
                      border: 'none', background: 'transparent', borderRadius: 999,
                      cursor: 'pointer', color: 'var(--workspace-text-soft)', padding: 0,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--workspace-tree-hover)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    title="View options"
                  >
                    <MoreHorizontal size={12} />
                  </span>
                )}
              </button>

              {isActive && (
                <div style={{
                  position: 'absolute',
                  bottom: -1,
                  left: 10,
                  right: 10,
                  height: 2,
                  borderRadius: '2px 2px 0 0',
                  background: accentColor,
                  boxShadow: `0 0 10px color-mix(in srgb, ${accentColor} 50%, transparent)`,
                  pointerEvents: 'none',
                }} />
              )}
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={onAddView}
        style={addBtnStyle}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--workspace-text)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--workspace-text-muted)' }}
        title="Add view"
      >
        <Plus size={14} strokeWidth={2} />
      </button>
    </div>
  )
}
