import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { insertImage } from './imageInsert'
import { nodeIdFacet } from './nodeIdFacet'

/**
 * Returns true if the doc position lies inside a fenced code block. We
 * fall through to default text paste in that case so users can paste
 * literal `![](...)` source into code samples without us swallowing it.
 */
function isInsideCodeBlock(view: EditorView, pos: number): boolean {
  const tree = syntaxTree(view.state)
  let node: SyntaxNode | null = tree.resolveInner(pos, 1)
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true
    node = node.parent
  }
  return false
}

async function handleImageFile(
  view: EditorView,
  file: File,
  insertAt: number,
  preferredName: string | null,
): Promise<void> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const nodeId = view.state.facet(nodeIdFacet)
  await insertImage(
    { view, nodeId, insertAt },
    bytes,
    file.type,
    preferredName,
  )
}

/**
 * EditorView extension that intercepts clipboard image bytes and dropped
 * image files, routing them through the imageInsert pipeline.
 *
 * - Paste: image clipboard items win over coexisting text payloads
 *   (screenshot tools commonly put both PNG bytes and a path string on the
 *   clipboard).
 * - Drop: image files trigger insert at the drop position; non-image drops
 *   fall through to CM6's default handler.
 */
export const imagePastePlugin = EditorView.domEventHandlers({
  paste(e, view) {
    const items = e.clipboardData?.items
    if (!items) return false
    if (isInsideCodeBlock(view, view.state.selection.main.head)) return false

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const file = it.getAsFile()
        if (!file) continue
        e.preventDefault()
        const insertAt = view.state.selection.main.head
        void handleImageFile(view, file, insertAt, null)
        return true
      }
    }
    return false
  },

  drop(e, view) {
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return false
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith('image/'),
    )
    if (imageFiles.length === 0) return false

    e.preventDefault()
    e.stopPropagation()

    const insertAt =
      view.posAtCoords({ x: e.clientX, y: e.clientY }) ??
      view.state.selection.main.head

    if (isInsideCodeBlock(view, insertAt)) return false

    void (async () => {
      let cursor = insertAt
      for (const file of imageFiles) {
        await handleImageFile(view, file, cursor, file.name)
        cursor = view.state.selection.main.head
      }
    })()
    return true
  },
})
