import type { EditorView } from '@codemirror/view'
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'

export type SlashCategory = 'block' | 'handy' | 'code'

export interface SlashCommand {
  id: string
  label: string
  aliases?: string[]
  description: string
  category: SlashCategory
  shortcutHint?: string
  boost?: number
  run: (view: EditorView, from: number, to: number) => void
}

const replaceAndMoveCaret = (
  view: EditorView,
  from: number,
  to: number,
  insert: string,
  caretOffset: number,
) => {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + caretOffset },
  })
}

export const tier1SlashCommands: SlashCommand[] = [
  {
    id: 'h1',
    label: 'Heading 1',
    aliases: ['h1', '#'],
    description: 'Large section heading',
    category: 'block',
    shortcutHint: '⌘1',
    run: (view, from, to) => replaceAndMoveCaret(view, from, to, '# ', 2),
  },
  {
    id: 'h2',
    label: 'Heading 2',
    aliases: ['h2', '##'],
    description: 'Medium section heading',
    category: 'block',
    shortcutHint: '⌘2',
    run: (view, from, to) => replaceAndMoveCaret(view, from, to, '## ', 3),
  },
  {
    id: 'h3',
    label: 'Heading 3',
    aliases: ['h3', '###'],
    description: 'Small section heading',
    category: 'block',
    shortcutHint: '⌘3',
    run: (view, from, to) => replaceAndMoveCaret(view, from, to, '### ', 4),
  },
  {
    id: 'ul',
    label: 'Bulleted list',
    aliases: ['ul', 'bullet', 'list'],
    description: 'Unordered list item',
    category: 'block',
    run: (view, from, to) => replaceAndMoveCaret(view, from, to, '- ', 2),
  },
  {
    id: 'ol',
    label: 'Numbered list',
    aliases: ['ol', 'number'],
    description: 'Ordered list item starting at 1',
    category: 'block',
    run: (view, from, to) => replaceAndMoveCaret(view, from, to, '1. ', 3),
  },
  {
    id: 'todo',
    label: 'To-do',
    aliases: ['todo', 'task', 'checkbox'],
    description: 'Task list checkbox',
    category: 'block',
    run: (view, from, to) => replaceAndMoveCaret(view, from, to, '- [ ] ', 6),
  },
  {
    id: 'quote',
    label: 'Quote',
    aliases: ['quote', 'blockquote'],
    description: 'Indented quote block',
    category: 'block',
    run: (view, from, to) => replaceAndMoveCaret(view, from, to, '> ', 2),
  },
  {
    id: 'divider',
    label: 'Divider',
    aliases: ['hr', 'divider', 'separator'],
    description: 'Horizontal rule',
    category: 'block',
    run: (view, from, to) => replaceAndMoveCaret(view, from, to, '---\n', 4),
  },
  {
    id: 'code',
    label: 'Code block',
    aliases: ['code', 'fence'],
    description: 'Fenced code block',
    category: 'code',
    run: (view, from, to) => {
      const insert = '```\n\n```\n'
      replaceAndMoveCaret(view, from, to, insert, 4)
    },
  },
  {
    id: 'table',
    label: 'Table',
    aliases: ['table', 'grid'],
    description: '2x2 markdown table',
    category: 'block',
    run: (view, from, to) => {
      const insert = '|     |     |\n| --- | --- |\n|     |     |\n'
      replaceAndMoveCaret(view, from, to, insert, 2)
    },
  },
]

const matchesQuery = (cmd: SlashCommand, query: string): boolean => {
  if (query.length === 0) return true
  const haystack = [cmd.id, cmd.label.toLowerCase(), ...(cmd.aliases ?? [])]
  return haystack.some((h) => h.toLowerCase().startsWith(query))
}

export const slashCompletionSource = (
  commands: SlashCommand[] = tier1SlashCommands,
) => (ctx: CompletionContext): CompletionResult | null => {
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
      detail: cmd.shortcutHint,
      info: cmd.description,
      type: cmd.category,
      boost: cmd.boost ?? 0,
      apply: (view, _completion, from, to) => cmd.run(view, from, to),
    }))

  return { from: match.from, to: match.to, options, filter: false }
}
