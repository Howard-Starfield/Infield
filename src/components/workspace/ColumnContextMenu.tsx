import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from 'lucide-react'
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
  onRename: () => void
  onDelete: () => void
  onClose: () => void
  anchorRect: DOMRect
}

const MENU_W = 200
const MENU_H = 88

export function ColumnContextMenu({ onRename, onDelete, onClose, anchorRect }: Props) {
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
          minWidth: MENU_W,
          zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
          padding: 4,
          boxShadow: 'var(--workspace-shadow)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <WorkspaceMenuItem onClick={() => { onRename(); onClose() }}>
          <Pencil className="h-4 w-4 shrink-0" aria-hidden />
          {t('database.renameColumn')}
        </WorkspaceMenuItem>
        <WorkspaceMenuItem danger onClick={() => { onDelete(); onClose() }}>
          <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
          {t('database.deleteColumn')}
        </WorkspaceMenuItem>
      </WorkspaceMenuSurface>
    </WorkspaceFloatingPortal>
  )
}
