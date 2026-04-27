import { describe, it, expect, beforeAll } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  autocompletion,
  startCompletion,
  completionStatus,
} from '@codemirror/autocomplete'
import { slashCompletionSource } from '../slashCompletion'
import { allSlashCommands } from '../slashCommands'
import {
  renderSlashAccent,
  renderSlashIcon,
  renderSlashShortcut,
} from '../slashRenderers'

describe('slash menu rendered DOM', () => {
  let host: HTMLDivElement
  let view: EditorView

  beforeAll(async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    const state = EditorState.create({
      doc: '/',
      selection: { anchor: 1 },
      extensions: [
        autocompletion({
          override: [slashCompletionSource(allSlashCommands)],
          activateOnTyping: true,
          addToOptions: [
            { render: renderSlashAccent, position: 0 },
            { render: renderSlashIcon, position: 10 },
            { render: renderSlashShortcut, position: 40 },
          ],
          optionClass: (c) =>
            c.type === '__section_header'
              ? 'cm-md-slash-section'
              : 'cm-md-slash-row',
        }),
      ],
    })
    view = new EditorView({ state, parent: host })
    startCompletion(view)
    // Give CM6 a microtask tick to materialise the tooltip.
    await new Promise((r) => setTimeout(r, 50))
  })

  it('opens with status "active"', () => {
    expect(completionStatus(view.state)).toBe('active')
  })

  it('renders three section headers in order', () => {
    const headers = document.querySelectorAll('li.cm-md-slash-section')
    const labels = Array.from(headers).map((h) => h.textContent?.trim())
    expect(labels).toEqual(['Basic blocks', 'Code', 'Handy'])
  })

  it('renders an icon slot for every command row', () => {
    const rows = document.querySelectorAll('li.cm-md-slash-row')
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((row) => {
      const icon = row.querySelector('.cm-md-slash-icon')
      expect(icon).not.toBeNull()
    })
  })

  it('renders a non-empty shortcut chip for h1/h2/h3 only', () => {
    const allRows = document.querySelectorAll('li.cm-md-slash-row')
    let withChip = 0
    allRows.forEach((row) => {
      const chip = row.querySelector('.cm-md-slash-shortcut')
      const isEmpty =
        !chip || chip.classList.contains('cm-md-slash-shortcut--empty')
      if (!isEmpty) withChip++
    })
    expect(withChip).toBe(3)
  })

  it('snapshot of the popup DOM (excluding pos-dependent attrs)', () => {
    const tooltip = document.querySelector('.cm-tooltip-autocomplete')
    expect(tooltip).not.toBeNull()
    // Strip CM6's inline positioning + ids to keep snapshots stable across runs.
    const clone = tooltip!.cloneNode(true) as HTMLElement
    clone.querySelectorAll<HTMLElement>('*').forEach((el) => {
      el.removeAttribute('style')
      el.removeAttribute('id')
    })
    expect(clone.outerHTML).toMatchSnapshot()
  })
})
