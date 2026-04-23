/**
 * Entry surfaces — shown before the main app shell on launch.
 *
 * Sequence (wired in src/App.tsx):
 *   LoadingScreen  → (onboarding, if needed) → LoginPage → App shell
 *
 * Built in Phase 2 of frontendplan.md.
 */

export { LoadingScreen } from './LoadingScreen'
export type { LoadingScreenProps } from './LoadingScreen'

export { LoginPage } from './LoginPage'
export type { LoginPageProps } from './LoginPage'

export { EntryProvider, useEntry } from './EntryContext'
export type { EntryStage, EntryState, EntryProviderProps } from './EntryContext'
