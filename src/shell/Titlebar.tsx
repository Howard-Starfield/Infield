import { useEffect, useState, type CSSProperties } from 'react'
import { platform as getPlatform } from '@tauri-apps/plugin-os'
import { Bell, RotateCw, Settings } from 'lucide-react'
import { WindowControls } from './WindowControls'

/**
 * Unified app titlebar — replaces the legacy TopBar / WorkspaceWindowChrome
 * split. One strip at the top of the shell providing:
 *   - drag region (Tauri decorations are off, so this is the only way to
 *     drag the window)
 *   - platform-aware window controls (macOS left, Windows/Linux right)
 *   - brand mark + fixed `VAULT · PERSONAL` indicator per mockup
 *   - utility icon cluster on the far end (refresh / notifications /
 *     settings) — clicks are announced via callbacks so the owner can
 *     route to the right surface.
 *
 * Per-page context (current note title, database breadcrumb, etc.) lives
 * inside the stage via `PageHeader`, not in the titlebar.
 */
export interface TitlebarProps {
  vaultLabel?: string
  onRefresh?: () => void
  onNotifications?: () => void
  onSettings?: () => void
}

type Platform = 'macos' | 'windows' | 'linux' | 'other'

function detectPlatform(): Platform {
  try {
    const p = getPlatform()
    if (p === 'macos') return 'macos'
    if (p === 'windows') return 'windows'
    if (p === 'linux') return 'linux'
    return 'other'
  } catch {
    return 'other'
  }
}

export function Titlebar({
  vaultLabel = 'PERSONAL',
  onRefresh,
  onNotifications,
  onSettings,
}: TitlebarProps) {
  const [plat, setPlat] = useState<Platform>('other')
  useEffect(() => {
    setPlat(detectPlatform())
  }, [])

  const controlsOnLeft = plat === 'macos'

  // Sovereign Glass window-chrome recipe (IRS kit `.window-chrome`):
  //   - charcoal glass (10,11,15 @ 75% with 32px blur 180% saturate)
  //   - 1px translucent bottom hairline
  //   - subtle brand-tinted underline shadow — the "amber lip" of the chrome
  const wrapStyle: CSSProperties = {
    position: 'relative',
    height: 'var(--shell-titlebar-height, 48px)',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    padding: '0 10px',
    flexShrink: 0,
    fontSize: 'calc(11px * var(--ui-scale, 1))',
    letterSpacing: '0.08em',
    color: 'var(--on-surface)',
    userSelect: 'none',
    background: 'rgba(10, 11, 15, 0.75)',
    backdropFilter: 'blur(32px) saturate(180%)',
    WebkitBackdropFilter: 'blur(32px) saturate(180%)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
    boxShadow: '0 1px 0 color-mix(in srgb, var(--heros-brand) 15%, transparent)',
  }

  return (
    <div
      data-tauri-drag-region
      style={wrapStyle}
      aria-label="App titlebar"
    >
      {controlsOnLeft ? <WindowControls align="start" /> : null}

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          paddingLeft: controlsOnLeft ? 8 : 4,
        }}
      >
        <span
          style={{
            fontWeight: 600,
            fontSize: 'calc(12px * var(--ui-scale, 1))',
            letterSpacing: '0.18em',
            color: 'var(--on-surface)',
          }}
        >
          INFIELD
        </span>
        <span
          style={{
            textTransform: 'uppercase',
            opacity: 0.62,
            letterSpacing: '0.14em',
          }}
        >
          VAULT · {vaultLabel}
        </span>
      </div>

      <div style={{ flex: 1 }} aria-hidden />

      <div
        data-tauri-drag-region={false}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          WebkitAppRegion: 'no-drag',
        } as CSSProperties}
      >
        <TitlebarIconButton
          icon={<RotateCw size={15} strokeWidth={1.6} aria-hidden />}
          ariaLabel="Refresh"
          onClick={onRefresh}
        />
        <TitlebarIconButton
          icon={<Bell size={15} strokeWidth={1.6} aria-hidden />}
          ariaLabel="Notifications"
          onClick={onNotifications}
        />
        <TitlebarIconButton
          icon={<Settings size={15} strokeWidth={1.6} aria-hidden />}
          ariaLabel="Settings"
          onClick={onSettings}
        />
        {!controlsOnLeft ? <WindowControls align="end" /> : null}
      </div>
    </div>
  )
}

interface TitlebarIconButtonProps {
  icon: React.ReactNode
  ariaLabel: string
  onClick?: () => void
}

function TitlebarIconButton({ icon, ariaLabel, onClick }: TitlebarIconButtonProps) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 28,
        height: 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        background: hover
          ? 'color-mix(in srgb, var(--on-surface) 10%, transparent)'
          : 'transparent',
        borderRadius: 'var(--radius-container)',
        color: 'var(--on-surface)',
        opacity: hover ? 1 : 0.72,
        cursor: 'pointer',
        transition:
          'background calc(140ms * var(--duration-scale, 1)) ease, opacity calc(140ms * var(--duration-scale, 1)) ease',
      }}
    >
      {icon}
    </button>
  )
}
