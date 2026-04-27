import type { EditorView } from '@codemirror/view'
import { commands } from '../bindings'
import { toast } from 'sonner'

export interface ImageInsertContext {
  view: EditorView
  nodeId: string
  /** Doc offset where the placeholder line should be inserted. */
  insertAt: number
}

const PLACEHOLDER_PREFIX = '\n![Saving image…](pending://'
const PLACEHOLDER_SUFFIX = ')\n'

const newTempId = (): string =>
  crypto.randomUUID().replace(/-/g, '').slice(0, 8)

/**
 * Insert an image at `ctx.insertAt`. Three vectors share this code:
 *   - Paste plugin (preferredName = null → empty alt)
 *   - Drop plugin (preferredName = file.name → display_name alt)
 *   - Slash command (preferredName = picked file basename → display_name alt)
 *
 * Sequence: placeholder line → await Rust write → swap to real path or
 * remove on failure. Autosave is paused for the doc while `pending://` is
 * present (see autosavePlugin guard in Task 16), so the placeholder bytes
 * never reach disk.
 */
export async function insertImage(
  ctx: ImageInsertContext,
  bytes: Uint8Array,
  mime: string,
  preferredName: string | null,
): Promise<void> {
  const tempId = newTempId()
  const placeholder = `${PLACEHOLDER_PREFIX}${tempId}${PLACEHOLDER_SUFFIX}`

  ctx.view.dispatch({
    changes: { from: ctx.insertAt, insert: placeholder },
    userEvent: 'input.imageinsert',
  })

  const res = await commands.saveAttachment({
    source_node_id: ctx.nodeId,
    bytes: Array.from(bytes),
    mime,
    preferred_name: preferredName,
  })

  // Find the placeholder by tempId — it may have moved if the user kept typing.
  const docText = ctx.view.state.doc.toString()
  const needle = `pending://${tempId}`
  const idx = docText.indexOf(needle)
  if (idx === -1) {
    if (res.status === 'error') {
      toast.error('Image save failed', { description: res.error })
    }
    return
  }
  // Locate the surrounding line.
  const lineStart = docText.lastIndexOf('\n', idx) + 1
  const lineEnd = docText.indexOf('\n', idx)
  const trueEnd = lineEnd === -1 ? docText.length : lineEnd + 1

  if (res.status === 'error') {
    ctx.view.dispatch({
      changes: { from: lineStart - 1, to: trueEnd, insert: '' },
      userEvent: 'input.imageinsert',
    })
    toast.error('Image save failed', { description: res.error })
    return
  }

  const alt = preferredName === null ? '' : res.data.display_name
  const real = `![${alt}](${res.data.vault_rel_path})`

  ctx.view.dispatch({
    changes: {
      from: lineStart,
      to: lineEnd === -1 ? docText.length : lineEnd,
      insert: real,
    },
    userEvent: 'input.imageinsert',
  })
}
