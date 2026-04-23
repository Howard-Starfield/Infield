/**
 * AppCrashBoundary — isolates the main `<App />` tree so an uncaught error
 * inside it doesn't unmount sibling recovery UI.
 *
 * Without this boundary, React unmounts the entire root on any uncaught
 * render/commit error. Keeping it as a sibling-friendly boundary preserves
 * the option to mount diagnostic surfaces alongside `<App />`.
 *
 * Intentionally minimal:
 *   - No retry button (user fixes underlying issue or reverts state).
 *   - Renders a small diagnostic string so the window isn't fully blank.
 *   - Logs the full error + component stack to the console for debugging.
 *   - Uses inline styles + CSS tokens so the fallback respects current
 *     theming when available, falling back to literal colors otherwise.
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
            color: 'var(--heros-text-premium, #ffffff)',
            background: 'var(--heros-bg-foundation, #0a0b0f)',
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
            The details are in the developer console. Restart the app to recover.
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
