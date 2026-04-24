import type { SlashCommand } from '../slashCommands'
import { commands } from '../../bindings'
import { toast } from 'sonner'

export const todayCommand: SlashCommand = {
  id: 'today',
  label: 'Link to today',
  aliases: ['today', 'daily'],
  description: "Insert a wikilink to today's daily note",
  category: 'handy',
  run: (view, from, to) => {
    // Replace /today with a placeholder while we resolve.
    const placeholder = '[today](node://…)'
    view.dispatch({
      changes: { from, to, insert: placeholder },
      selection: { anchor: from + placeholder.length },
    })
    void (async () => {
      const iso = new Date().toISOString().slice(0, 10)
      try {
        const res = await commands.getOrCreateDailyNote(iso)
        if (res.status !== 'ok') {
          toast.error("Couldn't resolve today's daily note", { description: res.error })
          return
        }
        const insert = `[${res.data.name}](node://${res.data.id})`
        const doc = view.state.doc.toString()
        const idx = doc.indexOf(placeholder)
        if (idx === -1) return
        view.dispatch({
          changes: { from: idx, to: idx + placeholder.length, insert },
        })
      } catch (e) {
        toast.error("Couldn't resolve today's daily note", {
          description: e instanceof Error ? e.message : String(e),
        })
      }
    })()
  },
}
