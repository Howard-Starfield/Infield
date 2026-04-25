import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { SlashCommand } from './slashCommands'

const matchesQuery = (cmd: SlashCommand, query: string): boolean => {
  if (query.length === 0) return true
  const haystack = [cmd.id, cmd.label.toLowerCase(), ...(cmd.aliases ?? [])]
  return haystack.some((h) => h.toLowerCase().startsWith(query))
}

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
    const options: Completion[] = commands
      .filter((cmd) => matchesQuery(cmd, query))
      .map((cmd) => ({
        label: cmd.label,
        detail: cmd.description,
        type: cmd.category,
        boost: cmd.boost ?? 0,
        apply: (view, _completion, from, to) => cmd.run(view, from, to),
      }))

    return { from: match.from, to: match.to, options, filter: false }
  }
