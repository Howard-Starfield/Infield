import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { SlashCommand, SlashCategory } from './slashCommands'

const matchesQuery = (cmd: SlashCommand, query: string): boolean => {
  if (query.length === 0) return true
  const haystack = [cmd.id, cmd.label.toLowerCase(), ...(cmd.aliases ?? [])]
  return haystack.some((h) => h.toLowerCase().startsWith(query))
}

const SECTION_ORDER: ReadonlyArray<{ category: SlashCategory; label: string }> = [
  { category: 'block', label: 'Basic blocks' },
  { category: 'code', label: 'Code' },
  { category: 'handy', label: 'Handy' },
]

/** Sentinel `type` used by Completion entries that are visual section
 *  headers — non-selectable, no-op apply. The renderer in
 *  slashRenderers.ts detects this string and emits empty icon/shortcut
 *  cells; the section row's CSS makes it pointer-events:none. */
export const SECTION_HEADER_TYPE = '__section_header'

const headerCompletion = (label: string): Completion => ({
  label,
  type: SECTION_HEADER_TYPE,
  // No-op apply — kept defined so accidental keyboard activation
  // (Enter while a header happens to be focused) does nothing.
  apply: () => {},
  boost: 0,
})

export const slashCompletionSource =
  (commands: SlashCommand[]) =>
  (ctx: CompletionContext): CompletionResult | null => {
    const match = ctx.matchBefore(/\/[\w#]*/)
    if (!match) return null
    if (match.from === match.to && !ctx.explicit) return null

    const line = ctx.state.doc.lineAt(match.from)
    const beforeSlash = ctx.state.sliceDoc(line.from, match.from)
    if (beforeSlash.trim().length > 0) return null

    const query = ctx.state.sliceDoc(match.from + 1, match.to).toLowerCase()

    const buckets = new Map<SlashCategory, Completion[]>()
    for (const cmd of commands) {
      if (!matchesQuery(cmd, query)) continue
      const opt: Completion = {
        label: cmd.label,
        detail: cmd.description,
        type: cmd.category,
        boost: cmd.boost ?? 0,
        apply: (view, _completion, from, to) => cmd.run(view, from, to),
      }
      const list = buckets.get(cmd.category) ?? []
      list.push(opt)
      buckets.set(cmd.category, list)
    }

    const options: Completion[] = []
    for (const { category, label } of SECTION_ORDER) {
      const list = buckets.get(category)
      if (!list || list.length === 0) continue
      options.push(headerCompletion(label))
      options.push(...list)
    }

    return { from: match.from, to: match.to, options, filter: false }
  }
