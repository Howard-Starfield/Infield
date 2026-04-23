import { useRef } from 'react'
import { ArrowUp, Copy, Trash2, ArrowDown } from 'lucide-react'
import type { WorkspaceNode } from '../../types/workspace'
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

interface Props {
  row: WorkspaceNode
  anchorRect: DOMRect
  onClose: () => void
  onInsertAbove: (row: WorkspaceNode) => void
  onInsertBelow: (row: WorkspaceNode) => void
  onDuplicate: (row: WorkspaceNode) => void
  onDelete: (row: WorkspaceNode) => void
}

const MENU_W = 200
const MENU_H = 200

export function RowActionMenu({ row, anchorRect, onClose, onInsertAbove, onInsertBelow, onDuplicate, onDelete }: Props) {
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
          padding: 6,
          minWidth: MENU_W,
          boxShadow: 'var(--workspace-shadow)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {([
          { icon: <ArrowUp size={12} />, label: 'Insert row above', action: () => { onInsertAbove(row); onClose() }, danger: false as const },
          { icon: <ArrowDown size={12} />, label: 'Insert row below', action: () => { onInsertBelow(row); onClose() }, danger: false as const },
          { icon: <Copy size={12} />, label: 'Duplicate', action: () => { onDuplicate(row); onClose() }, danger: false as const },
          { icon: <Trash2 size={12} />, label: 'Delete', action: () => { onDelete(row); onClose() }, danger: true as const },
        ] as const).map(({ icon, label, action, danger }) => (
          <WorkspaceMenuItem key={label} danger={danger} onClick={action}>
            {icon}
            <span>{label}</span>
          </WorkspaceMenuItem>
        ))}
      </WorkspaceMenuSurface>
    </WorkspaceFloatingPortal>
  )
}
