/**
 * Global hotkey — `Cmd/Ctrl + ,` (macOS Settings convention) opens the
 * Theme Editor modal. Mounted once in `App`; returns `{open, setOpen}` for
 * the caller to conditionally render `<ThemeEditorModal>`.
 *
 * Edge cases:
 *   - The handler checks the active element is not a contentEditable / input
 *     target, so `,` during autosave-debounce typing doesn't steal focus.
 *   - Preventing default on Cmd+, so it doesn't scroll or trigger browser
 *     search.
 *   - Cleans up the listener on unmount (StrictMode double-mount safe).
 */

import { useCallback, useEffect, useState } from 'react'

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function useThemeEditorHotkey(): {
  open: boolean
  setOpen: (next: boolean) => void
} {
  const [open, setOpen] = useState(false)

  const handler = useCallback((e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (!mod) return
    if (e.key !== ',') return
    // Don't steal `,` while the user is typing a comma in a field.
    if (isTypingTarget(e.target)) return
    e.preventDefault()
    setOpen((prev) => !prev)
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handler])

  return { open, setOpen }
}
