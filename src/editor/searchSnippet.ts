import type { ReactNode } from 'react'
import { createElement } from 'react'

const MARK_RE = /<mark>(.*?)<\/mark>/gs

/**
 * Render an FTS5 snippet (with `<mark>...</mark>` marker tokens) as a React
 * node tree. Plain text and unmatched HTML stay as text — never injected
 * as HTML — preserving the spec's no-XSS guarantee (M4 of W2.5 review).
 *
 * @param snippet  Raw snippet from `snippet(workspace_fts, ..., '<mark>', '</mark>', ...)`.
 * @param hitClass  CSS class name applied to each `<mark>` run (e.g. `'search-snippet__hit'`).
 */
export function renderSnippet(snippet: string, hitClass: string): ReactNode[] {
  if (!snippet) return []

  const nodes: ReactNode[] = []
  const matches = Array.from(snippet.matchAll(MARK_RE))
  let lastIdx = 0
  let key = 0

  for (const match of matches) {
    const start = match.index ?? 0
    if (start > lastIdx) {
      nodes.push(createElement('span', { key: key++ }, snippet.slice(lastIdx, start)))
    }
    nodes.push(
      createElement('span', { key: key++, className: hitClass }, match[1]),
    )
    lastIdx = start + match[0].length
  }

  if (lastIdx < snippet.length) {
    nodes.push(createElement('span', { key: key++ }, snippet.slice(lastIdx)))
  }

  return nodes
}
