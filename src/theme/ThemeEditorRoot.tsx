/**
 * ThemeEditorRoot — standalone root for the theme editor modal + its global
 * hotkey. Mounted as a **sibling** of `<App />` inside `<ThemeProvider>`.
 *
 * Rationale: if the main application tree crashes (e.g. an unrecovered Tauri
 * IPC error, a missing permission, a broken onboarding flow), the user must
 * still be able to open Settings → Appearance to revert a bad theme. Placing
 * the editor inside `<App />` couples its availability to the app's render
 * health — exactly the situation where users most need theme rescue.
 *
 * This component renders nothing visible until the hotkey opens the modal.
 */

import { ThemeEditorModal } from './ThemeEditorPanel'
import { useThemeEditorHotkey } from './useThemeEditorHotkey'

export function ThemeEditorRoot() {
  const { open, setOpen } = useThemeEditorHotkey()
  return <ThemeEditorModal open={open} onClose={() => setOpen(false)} />
}
