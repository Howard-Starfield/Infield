import { useTranslation } from 'react-i18next'
import { Copy, Palette, Pencil, Trash2 } from 'lucide-react'
import type { NodeView } from '../../types/workspace'
import {
  WorkspaceMenuDivider,
  WorkspaceMenuItem,
  WorkspaceMenuSurface,
} from '@/components/workspace/chrome/workspaceMenuChrome'
import {
  WorkspaceFloatingPortal,
  placeBelowAnchor,
  workspaceFloatingBackdropZ,
  workspaceFloatingZ,
} from '@/lib/workspaceFloatingLayer'

const VIEW_COLORS = [
  '#9B59B6',
  '#E91E8C',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#06B6D4',
  '#3B82F6',
]

const MENU_W = 200
const MENU_H = 320

interface Props {
  view: NodeView
  anchorRect: DOMRect
  onClose: () => void
  onRename: (id: string) => void
  onDuplicate: (id: string) => void
  onColor: (id: string, color: string | null) => void
  onDelete: (id: string) => void
}

export function ViewTabContextMenu({
  view,
  anchorRect,
  onClose,
  onRename,
  onDuplicate,
  onColor,
  onDelete,
}: Props) {
  const { t } = useTranslation()
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
        style={{
          position: 'fixed',
          top,
          left,
          zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
          padding: 4,
          minWidth: MENU_W,
          maxWidth: 'min(100vw - 16px, 280px)',
          boxShadow: 'var(--workspace-shadow)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <WorkspaceMenuItem onClick={() => { onRename(view.id); onClose() }}>
          <Pencil size={14} className="shrink-0" aria-hidden />
          <span>{t('workspace.viewTab.rename', 'Rename')}</span>
        </WorkspaceMenuItem>
        <WorkspaceMenuItem onClick={() => { onDuplicate(view.id); onClose() }}>
          <Copy size={14} className="shrink-0" aria-hidden />
          <span>{t('workspace.viewTab.duplicate', 'Duplicate')}</span>
        </WorkspaceMenuItem>

        <div style={{ padding: '4px 10px 6px' }}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--workspace-text-soft)',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Palette size={14} className="shrink-0 opacity-80" aria-hidden />
            <span>{t('workspace.viewTab.color', 'Color')}</span>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {VIEW_COLORS.map(color => (
              <button
                key={color}
                type="button"
                onClick={() => { onColor(view.id, view.color === color ? null : color); onClose() }}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: color,
                  border: view.color === color ? '2px solid var(--workspace-text)' : '2px solid transparent',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'transform 100ms',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.15)' }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)' }}
              />
            ))}
          </div>
        </div>

        <WorkspaceMenuDivider />
        <WorkspaceMenuItem
          danger
          onClick={() => { onDelete(view.id); onClose() }}
        >
          <Trash2 size={14} className="shrink-0" aria-hidden />
          <span>{t('workspace.viewTab.delete', 'Delete')}</span>
        </WorkspaceMenuItem>
      </WorkspaceMenuSurface>
    </WorkspaceFloatingPortal>
  )
}
