/**
 * Fire a buddy-system activity event onto window. Listened by BuddyContext
 * (Task 10) which debounces and flushes via `record_activity_batch`.
 *
 * Event kinds + weights are documented in
 * docs/superpowers/specs/2026-04-26-buddy-system-design.md §4.4.
 */
export function emitBuddyEvent(kind: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(kind, { detail }));
}
