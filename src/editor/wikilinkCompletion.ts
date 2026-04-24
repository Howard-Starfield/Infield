import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'

export interface WikilinkSearchResult {
  id: string
  name: string
  node_type: string
  icon: string
  parent_name: string | null
}

export type WikilinkSearchFn = (
  query: string,
  limit: number,
) => Promise<WikilinkSearchResult[]>

/**
 * CM6 autocomplete source for `[[` wikilinks.
 *
 * Triggers when the text immediately before the caret is `[[<query>` on
 * the current line, with <query> containing no `]`. Forwards the query
 * to `searchFn` (typically `commands.searchWorkspaceTitle`). On apply,
 * replaces the entire `[[<query>` span with `[title](node://<uuid>)`.
 */
export const wikilinkCompletionSource =
  (searchFn: WikilinkSearchFn) =>
  async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const match = ctx.matchBefore(/\[\[([^\]\n]*)$/)
    if (!match) return null

    const query = match.text.slice(2) // strip leading "[["
    const hits = await searchFn(query, 10).catch(() => [])

    const options: Completion[] = hits.map((h) => ({
      label: h.name,
      detail: h.icon || h.node_type,
      info: h.parent_name ? `in ${h.parent_name}` : undefined,
      type: 'wikilink',
      apply: (view: EditorView, _c: Completion, from: number, to: number) => {
        const insert = `[${h.name}](node://${h.id})`
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
        })
      },
    }))

    return {
      from: match.from,
      to: match.to,
      options,
      filter: false,
    }
  }
