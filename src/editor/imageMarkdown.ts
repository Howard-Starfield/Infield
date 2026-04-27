export interface ParsedImage {
  alt: string
  path: string
  width: number | null
  height: number | null
}

/**
 * Parse a markdown image expression into its parts. Accepts the canonical
 * `![alt](path)` form plus the Obsidian dimension extensions:
 *   - `![alt|400](path)` — width only
 *   - `![alt|400x300](path)` — width + height
 *
 * Returns null for any malformed input. The widget caller falls back to
 * default rendering when null.
 */
export function parseImageMarkdown(source: string): ParsedImage | null {
  const m = source.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
  if (!m) return null
  const altRaw = m[1]
  const path = m[2].trim()

  const pipeIdx = altRaw.lastIndexOf('|')
  if (pipeIdx === -1) {
    return { alt: altRaw, path, width: null, height: null }
  }

  const alt = altRaw.slice(0, pipeIdx)
  const sizePart = altRaw.slice(pipeIdx + 1).trim()
  const sizeMatch = sizePart.match(/^(\d+)(?:x(\d+))?$/)
  if (!sizeMatch) {
    return { alt: altRaw, path, width: null, height: null }
  }

  const width = parseInt(sizeMatch[1], 10)
  const height = sizeMatch[2] != null ? parseInt(sizeMatch[2], 10) : null
  return { alt, path, width, height }
}
