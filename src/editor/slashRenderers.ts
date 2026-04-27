import type { Completion } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { SECTION_HEADER_TYPE } from './slashCompletion'
import { allSlashCommands } from './slashCommands'
import { svgForCommandId } from './slashIcons'

/** Look up the original SlashCommand by label so renderers can read
 *  shortcutHint without us having to thread the SlashCommand through
 *  the Completion (the CM6 schema only carries label/detail/type). */
const COMMANDS_BY_LABEL = new Map(allSlashCommands.map((c) => [c.label, c]))

const idForCompletion = (c: Completion): string =>
  COMMANDS_BY_LABEL.get(c.label)?.id ?? ''

const isSection = (c: Completion) => c.type === SECTION_HEADER_TYPE

/** Renders the leading icon cell. Empty for section headers. */
export function renderSlashIcon(
  completion: Completion,
  _state: unknown,
  _view: EditorView,
): HTMLElement {
  const el = document.createElement('div')
  el.className = 'cm-md-slash-icon'
  if (isSection(completion)) {
    el.classList.add('cm-md-slash-icon--empty')
    return el
  }
  const svg = svgForCommandId(idForCompletion(completion))
  if (svg) el.appendChild(svg)
  return el
}

/** Renders the right-aligned shortcut chip. Empty for section headers
 *  and for commands without `shortcutHint`. */
export function renderSlashShortcut(
  completion: Completion,
  _state: unknown,
  _view: EditorView,
): HTMLElement {
  const el = document.createElement('kbd')
  el.className = 'cm-md-slash-shortcut'
  if (isSection(completion)) {
    el.classList.add('cm-md-slash-shortcut--empty')
    return el
  }
  const cmd = COMMANDS_BY_LABEL.get(completion.label)
  if (cmd?.shortcutHint) {
    el.textContent = cmd.shortcutHint
  } else {
    el.classList.add('cm-md-slash-shortcut--empty')
  }
  return el
}

/** Renders the left accent bar for the currently selected (real-command)
 *  row. Visibility is controlled by the `[aria-selected]` parent in CSS. */
export function renderSlashAccent(
  completion: Completion,
  _state: unknown,
  _view: EditorView,
): HTMLElement {
  const el = document.createElement('div')
  el.className = 'cm-md-slash-accent'
  if (isSection(completion)) el.classList.add('cm-md-slash-accent--empty')
  return el
}
