import { describe, it, expect, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'
import { buildLivePreviewDecorations } from '../livePreview'
import { TaskCheckboxWidget, DividerWidget, ImageWidget, PendingImageWidget } from '../livePreviewWidgets'

// convertFileSrc requires window.__TAURI_INTERNALS__ which is absent in jsdom.
// Mock the module so widget-type tests can run without a Tauri runtime.
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}))

const mkState = (doc: string, caretPos: number) =>
  EditorState.create({
    doc,
    selection: { anchor: caretPos },
    extensions: [markdown({ base: markdownLanguage, extensions: [GFM] })],
  })

const collectMarks = (
  state: EditorState,
): Array<{ from: number; to: number; class: string }> => {
  const set = buildLivePreviewDecorations(state)
  const out: Array<{ from: number; to: number; class: string }> = []
  set.between(0, state.doc.length, (from, to, value) => {
    const cls = (value.spec as { class?: string }).class ?? ''
    out.push({ from, to, class: cls })
  })
  return out
}

const collectReplaces = (
  state: EditorState,
): Array<{ from: number; to: number; widget: unknown }> => {
  const set = buildLivePreviewDecorations(state)
  const out: Array<{ from: number; to: number; widget: unknown }> = []
  set.between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { widget?: unknown }
    if (spec.widget) out.push({ from, to, widget: spec.widget })
  })
  return out
}

describe('Live Preview: inline marks + caret-line model', () => {
  it('hides ** markers when caret is on a different line', () => {
    const doc = '**bold**\nplain'
    // Caret on line 2 (anchor at 'p' index 9).
    const marks = collectMarks(mkState(doc, 9))
    const hidden = marks.filter((m) => m.class === 'cm-md-hidden')
    expect(hidden.length).toBe(2) // open ** and close **
  })

  it('shows ** markers (cm-md-marker) when caret is on that line', () => {
    const doc = '**bold**'
    const marks = collectMarks(mkState(doc, 4)) // caret inside bold
    const visible = marks.filter((m) => m.class === 'cm-md-marker')
    expect(visible.length).toBe(2)
    const hidden = marks.filter((m) => m.class === 'cm-md-hidden')
    expect(hidden.length).toBe(0)
  })

  it('emits cm-md-bold on inner content of StrongEmphasis', () => {
    const doc = '**bold**\nplain'
    const marks = collectMarks(mkState(doc, 9))
    const bold = marks.find((m) => m.class === 'cm-md-bold')
    expect(bold).toBeDefined()
    expect(bold!.from).toBe(2)
    expect(bold!.to).toBe(6)
  })

  it('handles Emphasis (italic) markers of length 1', () => {
    const doc = '*x*\nz'
    const marks = collectMarks(mkState(doc, 4)) // caret on line 2
    const hidden = marks.filter((m) => m.class === 'cm-md-hidden')
    expect(hidden.length).toBe(2)
    const italic = marks.find((m) => m.class === 'cm-md-italic')
    expect(italic).toBeDefined()
  })

  it('handles GFM Strikethrough', () => {
    const doc = '~~gone~~\nx'
    const marks = collectMarks(mkState(doc, 9)) // caret on line 2
    const strike = marks.find((m) => m.class === 'cm-md-strike')
    expect(strike).toBeDefined()
    const hidden = marks.filter((m) => m.class === 'cm-md-hidden')
    expect(hidden.length).toBe(2)
  })

  it('treats every line spanned by a non-empty selection as caret-line', () => {
    const doc = '**a**\n**b**\nz'
    const state = EditorState.create({
      doc,
      // Selection from inside line 1 to inside line 2.
      selection: { anchor: 2, head: 9 },
      extensions: [markdown({ base: markdownLanguage, extensions: [GFM] })],
    })
    const set = buildLivePreviewDecorations(state)
    const marks: string[] = []
    set.between(0, doc.length, (_f, _t, value) => {
      marks.push((value.spec as { class?: string }).class ?? '')
    })
    // Both lines 1 and 2 should have markers VISIBLE (cm-md-marker).
    const visibleCount = marks.filter((c) => c === 'cm-md-marker').length
    expect(visibleCount).toBe(4) // 2 markers × 2 lines
    const hiddenCount = marks.filter((c) => c === 'cm-md-hidden').length
    expect(hiddenCount).toBe(0)
  })

  it('emits cm-md-h1 line decoration for ATXHeading1', () => {
    const doc = '# Hello\nx'
    const marks = collectMarks(mkState(doc, 9)) // caret on line 2
    const h1 = marks.find((m) => m.class === 'cm-md-h1')
    expect(h1).toBeDefined()
  })

  it('hides "# " markers off-caret-line, shows on', () => {
    const docOff = '# Hello\nx'
    const off = collectMarks(mkState(docOff, 9))
    expect(off.filter((m) => m.class === 'cm-md-hidden').length).toBe(1)

    const docOn = '# Hello'
    const on = collectMarks(mkState(docOn, 4))
    expect(on.filter((m) => m.class === 'cm-md-marker').length).toBe(1)
    expect(on.filter((m) => m.class === 'cm-md-hidden').length).toBe(0)
  })

  it('emits cm-md-h2 / h3 / h4 / h5 / h6 line decorations', () => {
    const cases: Array<[string, string]> = [
      ['## a\nz', 'cm-md-h2'],
      ['### a\nz', 'cm-md-h3'],
      ['#### a\nz', 'cm-md-h4'],
      ['##### a\nz', 'cm-md-h5'],
      ['###### a\nz', 'cm-md-h6'],
    ]
    for (const [doc, cls] of cases) {
      // Caret at end (line 2) so heading line is off-caret.
      const marks = collectMarks(mkState(doc, doc.length))
      expect(marks.find((m) => m.class === cls)).toBeDefined()
    }
  })

  it('emits cm-md-blockquote line decoration and hides "> " marker off-line', () => {
    const doc = '> a quote\nx'
    const marks = collectMarks(mkState(doc, 11)) // caret on line 2
    expect(marks.find((m) => m.class === 'cm-md-blockquote')).toBeDefined()
    expect(marks.filter((m) => m.class === 'cm-md-hidden').length).toBeGreaterThanOrEqual(1)
  })

  it('marks the URL portion of a markdown link as hidden off-caret-line', () => {
    // [text](https://x) — the `(https://x)` part should hide; `[` and `]` hide too.
    const doc = '[text](https://x)\nz'
    const marks = collectMarks(mkState(doc, 19)) // caret on line 2
    expect(marks.find((m) => m.class === 'cm-md-link')).toBeDefined()
    // 3 hidden ranges minimum: `[`, `]`, `(https://x)` collapsed.
    expect(marks.filter((m) => m.class === 'cm-md-hidden').length).toBeGreaterThanOrEqual(2)
  })

  it('emits cm-md-bullet for the leading "- " of a BulletList ListItem', () => {
    const doc = '- one\n- two\nz'
    const marks = collectMarks(mkState(doc, 13)) // caret on line 3
    const bullets = marks.filter((m) => m.class === 'cm-md-bullet')
    expect(bullets.length).toBe(2)
  })

  it('emits a Decoration.replace for `[ ]` task with TaskCheckboxWidget', () => {
    const doc = '- [ ] do thing\nz'
    const set = buildLivePreviewDecorations(mkState(doc, 16)) // caret on line 2
    let found: { from: number; to: number; widgetCtor?: string } | null = null
    set.between(0, doc.length, (from, to, value) => {
      const spec = value.spec as { widget?: { constructor: { name: string } } }
      if (spec.widget) {
        found = {
          from,
          to,
          widgetCtor: spec.widget.constructor.name,
        }
      }
    })
    expect(found).not.toBeNull()
    expect(found!.widgetCtor).toBe('TaskCheckboxWidget')
    // The replaced range is the `[ ]` substring within the line.
    expect(doc.slice(found!.from, found!.to)).toBe('[ ]')
  })

  it('emits checked widget for `[x]` task', () => {
    const doc = '- [x] done\nz'
    const set = buildLivePreviewDecorations(mkState(doc, 12))
    let widget: TaskCheckboxWidget | null = null
    set.between(0, doc.length, (_f, _t, value) => {
      const spec = value.spec as { widget?: TaskCheckboxWidget }
      if (spec.widget instanceof TaskCheckboxWidget) widget = spec.widget
    })
    expect(widget).not.toBeNull()
    expect(widget!.checked).toBe(true)
  })

  it('task widget renders even when caret is ON the task line (per spec §Edge case #5)', () => {
    const doc = '- [ ] active'
    const set = buildLivePreviewDecorations(mkState(doc, 8))
    let foundWidget = false
    set.between(0, doc.length, (_f, _t, value) => {
      if ((value.spec as { widget?: unknown }).widget) foundWidget = true
    })
    expect(foundWidget).toBe(true)
  })

  it('emits Decoration.replace with DividerWidget for `---` off-caret-line', () => {
    const doc = '---\nz'
    const set = buildLivePreviewDecorations(mkState(doc, 5)) // caret on line 2
    let widget: DividerWidget | null = null
    set.between(0, doc.length, (_f, _t, value) => {
      const spec = value.spec as { widget?: { constructor: { name: string } } }
      if (spec.widget && spec.widget.constructor.name === 'DividerWidget') {
        widget = spec.widget as DividerWidget
      }
    })
    expect(widget).not.toBeNull()
  })

  it('divider source visible (no widget) when caret IS on `---` line', () => {
    const doc = '---'
    const set = buildLivePreviewDecorations(mkState(doc, 1))
    let widget: DividerWidget | null = null
    set.between(0, doc.length, (_f, _t, value) => {
      const spec = value.spec as { widget?: { constructor: { name: string } } }
      if (spec.widget && spec.widget.constructor.name === 'DividerWidget') {
        widget = spec.widget as DividerWidget
      }
    })
    expect(widget).toBeNull()
  })

  it('emits no inline decorations inside a FencedCode block', () => {
    // **bold** inside a code fence is not bold — it's literal source.
    const doc = '```\n**not bold**\n```\nz'
    const marks = collectMarks(mkState(doc, doc.length))
    expect(marks.find((m) => m.class === 'cm-md-bold')).toBeUndefined()
    // Also no hide/show of the ** markers — they're literal text.
    expect(marks.filter((m) => m.class === 'cm-md-hidden').length).toBe(0)
  })

  it('FencedCode block gets cm-md-code-block line decoration', () => {
    const doc = '```\nconst x = 1\n```\nz'
    const marks = collectMarks(mkState(doc, doc.length))
    expect(marks.find((m) => m.class === 'cm-md-code-block')).toBeDefined()
  })

  // IME guard: covered by manual checklist (spec §Edge case #3). jsdom
  // cannot reliably reproduce a composition because it doesn't emit
  // compositionstart / compositionend. The guard logic is reviewed via
  // code inspection: the plugin's update() must early-return when
  // `update.view.composing` is true.

  it('decoration build under 50ms on a 5000-line synthetic doc', () => {
    // Generate a doc with mixed block types: 5000 lines, ~1/7 each of
    // headings, blockquotes, tasks, plus inline emphasis everywhere.
    const lines: string[] = []
    for (let i = 0; i < 5000; i++) {
      const r = i % 7
      if (r === 0) lines.push(`# Section ${i}`)
      else if (r === 1) lines.push(`## Sub ${i}`)
      else if (r === 2) lines.push(`> a quote line ${i}`)
      else if (r === 3) lines.push(`- [ ] task ${i}`)
      else lines.push(`some **bold** and *italic* and \`code\` ${i}`)
    }
    const doc = lines.join('\n')
    const state = mkState(doc, 0)
    const start = performance.now()
    const set = buildLivePreviewDecorations(state)
    const elapsed = performance.now() - start
    // 50ms is a generous CI ceiling (jsdom + cold cache). Spec target
    // on a real machine is <10ms; raise to 100ms only if CI flakes
    // and file a follow-up to investigate.
    expect(elapsed).toBeLessThan(50)
    // Sanity: decoration set should be non-empty.
    let count = 0
    set.between(0, doc.length, () => {
      count++
    })
    expect(count).toBeGreaterThan(500)
  })
})

describe('Live Preview: Image widgets', () => {
  it('replaces a markdown image with ImageWidget when caret is off-line', () => {
    const doc = '![cat](attachments/2026/04/cat.png)\nplain'
    const state = mkState(doc, doc.length)
    const replaces = collectReplaces(state)
    const found = replaces.find((r) => r.widget instanceof ImageWidget)
    expect(found).toBeDefined()
    expect(found!.from).toBe(0)
    expect(found!.to).toBe('![cat](attachments/2026/04/cat.png)'.length)
  })

  it('shows source (no widget) when caret is on the image line', () => {
    const doc = '![cat](attachments/cat.png)'
    const state = mkState(doc, 5)
    const replaces = collectReplaces(state)
    const found = replaces.find((r) => r.widget instanceof ImageWidget)
    expect(found).toBeUndefined()
  })

  it('replaces a pending:// link with PendingImageWidget', () => {
    const doc = '![Saving image…](pending://abc12345)\nplain'
    const state = mkState(doc, doc.length)
    const replaces = collectReplaces(state)
    const pending = replaces.find((r) => r.widget instanceof PendingImageWidget)
    expect(pending).toBeDefined()
  })
})

describe('Live Preview: image read tolerance', () => {
  it('renders <img> HTML tag as ImageWidget', () => {
    const doc = '<img src="attachments/foo.png" alt="cat" width="200">\nplain'
    const state = mkState(doc, doc.length)
    const replaces = collectReplaces(state)
    const found = replaces.find((r) => r.widget instanceof ImageWidget)
    expect(found).toBeDefined()
  })

  it('renders Obsidian wikilink-image ![[foo.png]] as ImageWidget', () => {
    const doc = '![[attachments/foo.png]]\nplain'
    const state = mkState(doc, doc.length)
    const replaces = collectReplaces(state)
    const found = replaces.find((r) => r.widget instanceof ImageWidget)
    expect(found).toBeDefined()
  })
})
