//! Global hook used by `workspaceStore.navigateTo` / `goBack` to flush the
//! currently-focused document editor's pending autosave before the store
//! swaps `activeNode`. Prevents the "type fast, switch note, lose last chunk"
//! race. See CLAUDE.md Rule 5 (optimistic UI + reliable persistence).
//!
//! Exactly one editor can be registered at a time — the most recently mounted
//! DocumentEditor owns the slot. Unmount clears it.

type FlushFn = () => Promise<void> | void

let current: FlushFn | null = null

export function registerActiveEditorFlush(fn: FlushFn | null): void {
  current = fn
}

/** Await the active editor's pending save, if any. No-op when nothing registered. */
export async function flushActiveEditor(): Promise<void> {
  const fn = current
  if (!fn) return
  try {
    await fn()
  } catch {
    // Flush failure is surfaced by the editor's own error toast; swallow here so
    // navigation still proceeds.
  }
}
