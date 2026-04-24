import type { SlashCommand } from '../slashCommands'

export const linkCommand: SlashCommand = {
  id: 'link',
  label: 'Wikilink',
  aliases: ['link', 'wiki'],
  description: 'Start a [[wikilink — autocomplete fills the rest',
  category: 'handy',
  run: (view, from, to) => {
    const insert = '[['
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
    })
  },
}
