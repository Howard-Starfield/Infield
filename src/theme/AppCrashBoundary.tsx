/**
 * AppCrashBoundary — isolates the main `<App />` tree so an uncaught error
 * inside it doesn't unmount the sibling `<ThemeEditorRoot />` or other
 * recovery UI.
 *
 * Without this boundary, React 18 unmounts the entire root on any uncaught
 * render/commit error, including any sibling components meant specifically
 * to survive such errors (the theme editor is the user's way back to a
 * readable UI after they pick a bad color combo).
 *
 * Intentionally minimal:
 *   - No retry button (the user fixes the underlying issue externally or
 *     reverts the theme).
 *   - Renders a small diagnostic string so the window isn't fully blank.
 *   - Logs the full error + component stack to the console for debugging.
 *   - Uses inline styles + theme tokens so the fallback itself respects the
 *     user's theme (colors, fonts) — failing gracefully when the theme is
 *     the thing that's broken (tokens cascade fallbacks in the CSS).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class AppCrashBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep this verbose — a crashed app is a diagnostic emergency.
    // eslint-disable-next-line no-console
    console.error('[AppCrashBoundary] captured error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          style={{
            padding: 32,
            fontFamily:
              'var(--font-ui, Inter, system-ui, sans-serif)',
            color: 'var(--on-surface, #ffffff)',
            background: 'var(--heros-bg-foundation, #1a1a1a)',
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 16,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
            Infield hit an error and can't render the workspace.
          </h1>
          <p style={{ margin: 0, opacity: 0.75, maxWidth: 600, lineHeight: 1.5 }}>
            The details are in the developer console. Press{' '}
            <kbd
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                background:
                  'color-mix(in srgb, var(--on-surface, #ffffff) 10%, transparent)',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              Cmd/Ctrl + ,
            </kbd>{' '}
            to open Appearance settings — you can revert to the default theme
            or reset overrides there even while the main app is unavailable.
          </p>
          <details
            style={{
              maxWidth: 600,
              fontSize: 13,
              opacity: 0.6,
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            <summary style={{ cursor: 'pointer' }}>
              Technical details
            </summary>
            <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0 0' }}>
              {this.state.error.name}: {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
          </details>
        </div>
      )
    }
    return this.props.children
  }
}
