import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'

export type SaveFn = (body: string) => Promise<void>

export interface DebouncedSaver {
  schedule: (body: string) => void
  flush: () => Promise<void>
  cancel: () => void
}

/**
 * Create a debounced save controller. `schedule(body)` queues a save
 * for `delayMs` later, coalescing rapid updates into a single call with
 * the most recent body. `flush()` fires the pending save immediately.
 * `cancel()` discards it.
 */
export function createDebouncedSaver(
  onSave: SaveFn,
  delayMs: number,
): DebouncedSaver {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: string | null = null

  const fire = async () => {
    if (pending === null) return
    const body = pending
    pending = null
    timer = null
    await onSave(body)
  }

  return {
    schedule(body: string) {
      pending = body
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => void fire(), delayMs)
    },
    async flush() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      await fire()
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    },
  }
}

/**
 * CM6 ViewPlugin that invokes `onDirtyChange(true)` whenever the user
 * mutates the doc, and calls `schedule(body)` on the shared saver.
 * The plugin itself is stateless — the saver's lifetime is owned by
 * the React MarkdownEditor component so it survives view rebuilds
 * across node switches.
 */
export function autosavePlugin(
  saver: DebouncedSaver,
  onDirtyChange: (dirty: boolean) => void,
) {
  return ViewPlugin.fromClass(
    class {
      update(u: ViewUpdate) {
        if (!u.docChanged) return
        // Only user-initiated edits count as dirty (not programmatic
        // replace-body dispatches during node load).
        const userEdit = u.transactions.some(
          (tr) => tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move'),
        )
        if (!userEdit) return
        onDirtyChange(true)
        saver.schedule(u.state.doc.toString())
      }
    },
  )
}
