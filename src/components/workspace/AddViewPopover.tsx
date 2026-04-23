import { useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BarChart2, CalendarDays, Kanban, Table2 } from 'lucide-react'
import type { NodeView } from '../../types/workspace'
import {
  WorkspaceMenuItem,
  WorkspaceMenuSurface,
} from '@/components/workspace/chrome/workspaceMenuChrome'
import {
  WorkspaceFloatingPortal,
  placeBelowAnchor,
  workspaceFloatingBackdropZ,
  workspaceFloatingZ,
} from '@/lib/workspaceFloatingLayer'

const VIEW_TYPES: { layout: NodeView['layout']; Icon: LucideIcon; label: string }[] = [
  { layout: 'board', Icon: Kanban, label: 'Board' },
  { layout: 'calendar', Icon: CalendarDays, label: 'Calendar' },
  { layout: 'grid', Icon: Table2, label: 'Grid' },
  { layout: 'chart', Icon: BarChart2, label: 'Chart' },
]

const MENU_W = 200
const MENU_H = 360

interface Props {
  onAdd: (layout: NodeView['layout']) => void
  onClose: () => void
  anchorRect: DOMRect
}

export function AddViewPopover({ onAdd, onClose, anchorRect }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const { top, left } = placeBelowAnchor(anchorRect, { gap: 4, menuWidth: MENU_W, menuHeight: MENU_H })

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
        ref={ref}
        style={{
          position: 'fixed',
          top,
          left,
          zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
          padding: 8,
          minWidth: MENU_W,
          boxShadow: 'var(--workspace-shadow)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--workspace-text-soft)',
            padding: '4px 8px 8px',
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Add a view
        </div>
        {VIEW_TYPES.map(({ layout, Icon, label }) => (
          <WorkspaceMenuItem
            key={layout}
            onClick={() => { onAdd(layout); onClose() }}
          >
            <Icon size={14} strokeWidth={1.75} style={{ flexShrink: 0, color: 'var(--workspace-text-muted)' }} />
            <span>{label}</span>
          </WorkspaceMenuItem>
        ))}
      </WorkspaceMenuSurface>
    </WorkspaceFloatingPortal>
  )
}
