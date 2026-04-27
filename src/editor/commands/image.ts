import type { SlashCommand } from '../slashCommands'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { insertImage } from '../imageInsert'
import { nodeIdFacet } from '../nodeIdFacet'
import { toast } from 'sonner'

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

const mimeFromPath = (path: string): string | null => {
  const dotIdx = path.lastIndexOf('.')
  if (dotIdx === -1) return null
  const ext = path.slice(dotIdx + 1).toLowerCase()
  return EXT_TO_MIME[ext] ?? null
}

const basename = (path: string): string => {
  const sepIdx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return sepIdx === -1 ? path : path.slice(sepIdx + 1)
}

export const imageCommand: SlashCommand = {
  id: 'image',
  label: 'Image',
  aliases: ['image', 'img', 'picture'],
  description: 'Insert an image from your computer',
  category: 'handy',
  run: async (view, from, to) => {
    // Remove the `/image` trigger text first.
    view.dispatch({ changes: { from, to, insert: '' } })

    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'Image',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'],
        },
      ],
    })
    // With `multiple: false`, plugin-dialog's open() returns `string | null`.
    if (!selected) return // user cancelled
    const path: string = selected

    const mime = mimeFromPath(path)
    if (!mime) {
      toast.error('Unsupported image type')
      return
    }

    let bytes: Uint8Array
    try {
      bytes = await readFile(path)
    } catch (err) {
      toast.error('Could not read file', { description: String(err) })
      return
    }

    const nodeId = view.state.facet(nodeIdFacet)
    await insertImage(
      { view, nodeId, insertAt: from },
      bytes,
      mime,
      basename(path),
    )
  },
}
