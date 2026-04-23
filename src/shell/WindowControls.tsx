/**
 * Platform-aware window controls — renders macOS traffic-light dots on
 * macOS, Windows/Linux chevron buttons elsewhere. Required after
 * `decorations(false)` went global on the main Tauri window
 * (src-tauri/src/lib.rs) because users otherwise have no way to
 * minimize / maximize / close.
 *
 * Place anywhere inside a `data-tauri-drag-region` parent — these controls
 * are absolutely positioned or inline; they stop the drag-region bubbling
 * via pointer events so clicks activate instead of dragging the window.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { platform as getPlatform } from '@tauri-apps/plugin-os'
import { Minus, Square, X } from 'lucide-react'

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

export interface WindowControlsProps {
  /** Align to start or end of its flex container. Default 'end'. */
  align?: 'start' | 'end'
  /** Show on all platforms even if a native look would imply otherwise. */
  forceShow?: boolean
  className?: string
  style?: CSSProperties
}

export function WindowControls({
  align = 'end',
  forceShow = false,
  className,
  style,
}: WindowControlsProps) {
  const plat = useMemo(detectPlatform, [])
  const [maximized, setMaximized] = useState(false)
  const [hovered, setHovered] = useState(false)

  // Track maximized state to swap the Windows maximize icon if needed.
  useEffect(() => {
    let cancelled = false
    const win = (() => {
      try {
        return getCurrentWindow()
      } catch {
        return null
      }
    })()
    if (!win) return

    void win.isMaximized().then((v) => {
      if (!cancelled) setMaximized(v)
    })
    const unlisten = win.onResized(() => {
      void win.isMaximized().then((v) => {
        if (!cancelled) setMaximized(v)
      })
    })
    return () => {
      cancelled = true
      void unlisten.then((fn) => fn())
    }
  }, [])

  const call = (fn: 'minimize' | 'toggleMaximize' | 'close') => {
    try {
      const win = getCurrentWindow()
      void win[fn]()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[WindowControls] Tauri window call failed', err)
    }
  }

  const containerStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    marginLeft: align === 'end' ? 'auto' : undefined,
    // Block drag-region bubbling so clicks land on the buttons.
    // `no-drag` is Tauri's convention but the data-attribute is the
    // reliable one.
    WebkitAppRegion: 'no-drag',
    ...style,
  } as CSSProperties

  if (plat === 'macos') {
    return (
      <div
        className={className}
        style={{ ...containerStyle, gap: 8, padding: '0 12px' }}
        data-tauri-drag-region={false}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label="Window controls"
      >
        <MacDot color="close" hovered={hovered} onClick={() => call('close')} />
        <MacDot color="minimize" hovered={hovered} onClick={() => call('minimize')} />
        <MacDot
          color="maximize"
          hovered={hovered}
          onClick={() => call('toggleMaximize')}
        />
      </div>
    )
  }

  if (plat === 'windows' || plat === 'linux' || forceShow) {
    return (
      <div
        className={className}
        style={{ ...containerStyle, gap: 0 }}
        data-tauri-drag-region={false}
        aria-label="Window controls"
      >
        <WinButton ariaLabel="Minimize" onClick={() => call('minimize')}>
          <Minus size={12} strokeWidth={1.8} aria-hidden />
        </WinButton>
        <WinButton
          ariaLabel={maximized ? 'Restore' : 'Maximize'}
          onClick={() => call('toggleMaximize')}
        >
          <Square size={10} strokeWidth={1.8} aria-hidden />
        </WinButton>
        <WinButton ariaLabel="Close" onClick={() => call('close')} danger>
          <X size={12} strokeWidth={1.8} aria-hidden />
        </WinButton>
      </div>
    )
  }

  return null
}

// ─── macOS traffic-light dot ──────────────────────────────────────────

type DotColor = 'close' | 'minimize' | 'maximize'

const MAC_DOT_BG: Record<DotColor, string> = {
  close: '#ff5f57',
  minimize: '#febc2e',
  maximize: '#28c840',
}

function MacDot({
  color,
  hovered,
  onClick,
}: {
  color: DotColor
  hovered: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        color === 'close' ? 'Close' : color === 'minimize' ? 'Minimize' : 'Maximize'
      }
      style={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        background: hovered
          ? MAC_DOT_BG[color]
          : 'color-mix(in srgb, var(--on-surface) 20%, transparent)',
        border: '0.5px solid color-mix(in srgb, black 20%, transparent)',
        padding: 0,
        cursor: 'pointer',
        transition:
          'background calc(120ms * var(--duration-scale, 1)) cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    />
  )
}

// ─── Windows/Linux chevron button ─────────────────────────────────────

function WinButton({
  children,
  onClick,
  ariaLabel,
  danger = false,
}: {
  children: React.ReactNode
  onClick: () => void
  ariaLabel: string
  danger?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 42,
        height: 28,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: 4,
        background: hover
          ? danger
            ? 'var(--error, #ef4444)'
            : 'color-mix(in srgb, var(--on-surface) 8%, transparent)'
          : 'transparent',
        color: hover && danger ? '#fff' : 'var(--workspace-text-muted, currentColor)',
        cursor: 'pointer',
        transition:
          'background calc(120ms * var(--duration-scale, 1)) ease, color calc(120ms * var(--duration-scale, 1)) ease',
      }}
    >
      {children}
    </button>
  )
}
