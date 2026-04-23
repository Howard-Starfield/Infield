import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  arrow,
  flip,
  offset,
  shift,
  useFloating,
  useHover,
  useInteractions,
  useTransitionStyles,
  useDismiss,
  useRole,
  useFocus,
  FloatingPortal,
} from '@floating-ui/react'
import {
  Database,
  Download,
  FileText,
  Home,
  Info,
  Mic,
  Search,
  Star,
  Trash2,
} from 'lucide-react'
import type { AppTab } from '../App'

/**
 * Left glass icon rail. Six primary nav destinations plus help (top),
 * favorites + trash + profile (bottom). Consumes theme tokens only (Rule 12).
 *
 * Tooltips use `@floating-ui/react` — collision-aware, reduced-motion aware
 * via `useTransitionStyles`. Every button announces an `aria-label` so the
 * rail is screen-reader usable even with tooltips suppressed.
 *
 * Accessibility: the `<nav>` owns `aria-label="Primary"`; each destination
 * button carries `aria-current="page"` when active.
 */
export interface IconRailProps {
  activeTab: AppTab
  onNavigate: (tab: AppTab) => void
  /** Optional avatar initials for the profile button (defaults to "AR"). */
  profileInitials?: string
  onOpenProfile?: () => void
  onOpenTrash?: () => void
  onOpenFavorites?: () => void
}

interface RailItem {
  tab: AppTab | 'favorites' | 'trash' | 'profile'
  label: string
  icon: ReactNode
}

const NAV_ITEMS: Array<{
  tab: AppTab
  label: string
  icon: ReactNode
}> = [
  { tab: 'home', label: 'Home', icon: <Home size={17} strokeWidth={1.7} aria-hidden /> },
  { tab: 'search', label: 'Search', icon: <Search size={17} strokeWidth={1.7} aria-hidden /> },
  { tab: 'import', label: 'Import', icon: <Download size={17} strokeWidth={1.7} aria-hidden /> },
  { tab: 'audio', label: 'Audio', icon: <Mic size={17} strokeWidth={1.7} aria-hidden /> },
  { tab: 'notes', label: 'Notes', icon: <FileText size={17} strokeWidth={1.7} aria-hidden /> },
  { tab: 'databases', label: 'Databases', icon: <Database size={17} strokeWidth={1.7} aria-hidden /> },
]

export function IconRail({
  activeTab,
  onNavigate,
  profileInitials = 'AR',
  onOpenProfile,
  onOpenTrash,
  onOpenFavorites,
}: IconRailProps) {
  return (
    <nav
      aria-label="Primary"
      style={{
        width: 'var(--shell-rail-width, 56px)',
        flexShrink: 0,
        padding: '8px 6px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 6,
        // Sovereign Glass rail pill — translucent white glass over the
        // charcoal atmosphere, mirrored from IRS `.icon-rail`.
        background: 'rgba(255, 255, 255, 0.03)',
        backdropFilter: 'blur(24px) saturate(160%)',
        WebkitBackdropFilter: 'blur(24px) saturate(160%)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        borderRadius: 20,
        position: 'relative',
      }}
    >
      <RailIconButton
        tooltip="Help"
        ariaLabel="Help"
        icon={<Info size={16} strokeWidth={1.7} aria-hidden />}
        onClick={() => onNavigate('help')}
        active={activeTab === 'help'}
      />

      <div style={{ height: 6 }} aria-hidden />

      {NAV_ITEMS.map((item) => (
        <RailIconButton
          key={item.tab}
          tooltip={item.label}
          ariaLabel={item.label}
          icon={item.icon}
          onClick={() => onNavigate(item.tab)}
          active={activeTab === item.tab}
        />
      ))}

      <div style={{ flex: 1 }} aria-hidden />

      <RailIconButton
        tooltip="Favorites"
        ariaLabel="Favorites"
        icon={<Star size={17} strokeWidth={1.7} aria-hidden />}
        onClick={onOpenFavorites}
      />
      <RailIconButton
        tooltip="Trash"
        ariaLabel="Trash"
        icon={<Trash2 size={17} strokeWidth={1.7} aria-hidden />}
        onClick={onOpenTrash}
      />

      <div style={{ height: 4 }} aria-hidden />

      <RailAvatarButton
        initials={profileInitials}
        onClick={onOpenProfile}
      />
    </nav>
  )
}

// ─── Rail buttons ─────────────────────────────────────────────────────

interface RailIconButtonProps {
  tooltip: string
  ariaLabel: string
  icon: ReactNode
  onClick?: () => void
  active?: boolean
}

function RailIconButton({
  tooltip,
  ariaLabel,
  icon,
  onClick,
  active = false,
}: RailIconButtonProps) {
  const { refs, floatingStyles, context } = useFloatingTooltip()
  const hover = useHover(context, { delay: { open: 350, close: 60 }, move: false })
  const focus = useFocus(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'tooltip' })
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    focus,
    dismiss,
    role,
  ])
  const { isMounted, styles: tStyles } = useTransitionStyles(context, {
    duration: 140,
    initial: { opacity: 0, transform: 'translateX(-4px)' },
  })
  const [hovered, setHovered] = useState(false)

  // Rail button mirrors IRS `.rail-btn` + `.rail-icon-wrapper`:
  //   - outer button stays transparent; hover background lives on the
  //     icon wrapper, which gets brand-tinted when active
  //   - active state renders a 3px brand stripe to the left via the
  //     `::before`-equivalent span below, with the brand glow
  const wrapperStyle: CSSProperties = {
    width: 44,
    height: 40,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: active
      ? '1px solid color-mix(in srgb, var(--heros-brand) 25%, transparent)'
      : '1px solid transparent',
    borderRadius: 12,
    background: active
      ? 'color-mix(in srgb, var(--heros-brand) 12%, transparent)'
      : hovered
        ? 'var(--heros-glass-black, rgba(10, 11, 15, 0.82))'
        : 'transparent',
    boxShadow: active
      ? '0 0 15px color-mix(in srgb, var(--heros-brand) 15%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
      : 'none',
    transition:
      'background calc(240ms * var(--duration-scale, 1)) ease, border-color calc(240ms * var(--duration-scale, 1)) ease, box-shadow calc(240ms * var(--duration-scale, 1)) ease',
  }
  const buttonStyle: CSSProperties = {
    width: 44,
    height: 40,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    padding: 0,
    borderRadius: 12,
    background: 'transparent',
    color: active ? '#fff' : 'var(--on-surface)',
    opacity: active ? 1 : hovered ? 0.95 : 0.7,
    cursor: 'pointer',
    position: 'relative',
  }

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={ariaLabel}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={buttonStyle}
        {...getReferenceProps()}
      >
        {active ? (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: -6,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 3,
              height: 18,
              background: 'var(--heros-brand)',
              borderRadius: '0 4px 4px 0',
              boxShadow: '0 0 12px var(--heros-brand)',
              zIndex: 2,
            }}
          />
        ) : null}
        <span style={wrapperStyle}>{icon}</span>
      </button>
      {isMounted ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, zIndex: 9999 }}
            {...getFloatingProps()}
          >
            <div style={{ ...tStyles, ...TOOLTIP_SURFACE }}>{tooltip}</div>
          </div>
        </FloatingPortal>
      ) : null}
    </>
  )
}

function RailAvatarButton({
  initials,
  onClick,
}: {
  initials: string
  onClick?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      aria-label="Profile"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        background: 'color-mix(in srgb, var(--on-surface) 14%, transparent)',
        color: 'var(--on-surface)',
        fontSize: 'calc(11px * var(--ui-scale, 1))',
        fontWeight: 600,
        letterSpacing: '0.04em',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: hovered ? 'var(--workspace-rim-light)' : 'none',
        transition: 'box-shadow calc(160ms * var(--duration-scale, 1)) ease',
      }}
    >
      {initials.toUpperCase()}
    </button>
  )
}

// ─── Floating-UI tooltip scaffolding ─────────────────────────────────

function useFloatingTooltip() {
  const [open, setOpen] = useState(false)
  const floating = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'right',
    middleware: [offset(10), flip({ fallbackAxisSideDirection: 'start' }), shift({ padding: 6 }), arrow({ element: { current: null } })],
  })
  return floating
}

const TOOLTIP_SURFACE: CSSProperties = {
  padding: '5px 10px',
  borderRadius: 'var(--radius-container)',
  background: 'color-mix(in srgb, var(--on-surface) 92%, transparent)',
  color: 'var(--surface-container, #fff)',
  fontSize: 'calc(11px * var(--ui-scale, 1))',
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
  boxShadow: 'var(--workspace-shadow-soft, 0 2px 8px rgba(0,0,0,0.2))',
  pointerEvents: 'none',
}
