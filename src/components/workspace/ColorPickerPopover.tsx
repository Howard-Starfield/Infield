import { useTranslation } from 'react-i18next'
import type { SelectColor } from '@/stores/workspaceStore'
import { WorkspaceMenuSurface } from '@/components/workspace/chrome/workspaceMenuChrome'
import {
  WorkspaceFloatingPortal,
  placeBelowAnchor,
  workspaceFloatingBackdropZ,
  workspaceFloatingZ,
} from '@/lib/workspaceFloatingLayer'

const COLORS: { color: SelectColor; bg: string }[] = [
  { color: 'purple',     bg: 'bg-stone-600' },
  { color: 'pink',       bg: 'bg-rose-400'   },
  { color: 'light_pink', bg: 'bg-orange-200'   },
  { color: 'orange',     bg: 'bg-amber-500' },
  { color: 'yellow',     bg: 'bg-yellow-400' },
  { color: 'lime',       bg: 'bg-lime-500'   },
  { color: 'green',      bg: 'bg-emerald-600'  },
  { color: 'aqua',       bg: 'bg-teal-500'   },
]

const MENU_W = 176
const MENU_H = 140

interface Props {
  current: SelectColor
  onSelect: (color: SelectColor) => void
  onClose: () => void
  anchorRect: DOMRect
}

export function ColorPickerPopover({ current, onSelect, onClose, anchorRect }: Props) {
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
          width: MENU_W,
          zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
          padding: 8,
          boxShadow: 'var(--workspace-shadow)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p
          className="mb-2 px-1 text-xs uppercase tracking-wide"
          style={{ color: 'var(--workspace-text-muted)' }}
        >
          {t('database.colorPicker')}
        </p>
        <div className="flex gap-1.5 flex-wrap w-36">
          {COLORS.map(({ color, bg }) => (
            <button
              key={color}
              type="button"
              onClick={() => { onSelect(color); onClose() }}
              className={`w-6 h-6 rounded-full ${bg} transition-transform hover:scale-110 ${
                current === color ? 'ring-2 ring-offset-1 ring-[var(--workspace-accent)]' : ''
              }`}
            />
          ))}
        </div>
      </WorkspaceMenuSurface>
    </WorkspaceFloatingPortal>
  )
}
