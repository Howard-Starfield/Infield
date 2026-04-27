import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'
import { EditorState, Facet, RangeSetBuilder } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode, Tree } from '@lezer/common'
import { TaskCheckboxWidget, DividerWidget, ImageWidget, PendingImageWidget } from './livePreviewWidgets'
import { parseImageMarkdown } from './imageMarkdown'
import { convertFileSrc } from '@tauri-apps/api/core'

/**
 * Facet supplying the absolute vault root path. The Image-widget decoration
 * uses this to resolve vault-relative image paths into absolute file paths
 * for Tauri's asset protocol. MarkdownEditor populates this when it builds
 * the editor extensions (Task 19).
 */
export const vaultRootFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
})

/**
 * Lezer node names emitted by @codemirror/lang-markdown + GFM whose
 * source range is [marker, content, marker]. The decoration builder
 * uses node.from + markerLen and node.to - markerLen to locate marker
 * spans; inner content gets `contentClass`.
 */
type InlineConstruct = {
  /** Lezer node name as produced by @lezer/markdown (with GFM extension). */
  node: string
  /** CSS class applied to the inner-content range. */
  contentClass: string
  /** First/last marker length in source bytes. e.g. `**` = 2. */
  markerLen: number
}

const INLINE_CONSTRUCTS: InlineConstruct[] = [
  { node: 'Emphasis', contentClass: 'cm-md-italic', markerLen: 1 },
  { node: 'StrongEmphasis', contentClass: 'cm-md-bold', markerLen: 2 },
  { node: 'Strikethrough', contentClass: 'cm-md-strike', markerLen: 2 },
  { node: 'InlineCode', contentClass: 'cm-md-code-inline', markerLen: 1 },
]

const HIDDEN_MARK = Decoration.mark({ class: 'cm-md-hidden' })
const VISIBLE_MARKER_MARK = Decoration.mark({ class: 'cm-md-marker' })

/** Caret-line set: every line number (1-based) that should keep markers
 *  visible. For a collapsed selection this is one line; for a non-empty
 *  selection it's every line spanned (per spec §Edge cases #2). */
function computeCaretLines(state: EditorState): Set<number> {
  const sel = state.selection.main
  const fromLine = state.doc.lineAt(sel.from).number
  const toLine = state.doc.lineAt(sel.to).number
  const out = new Set<number>()
  for (let n = fromLine; n <= toLine; n++) out.add(n)
  return out
}

function nodeOverlapsLines(
  node: { from: number; to: number },
  state: EditorState,
  lines: Set<number>,
): boolean {
  const fromLine = state.doc.lineAt(node.from).number
  const toLine = state.doc.lineAt(node.to).number
  for (let n = fromLine; n <= toLine; n++) {
    if (lines.has(n)) return true
  }
  return false
}

/** Build a fresh DecorationSet for the current state. Public so unit
 *  tests can call it without mounting a ViewPlugin. */
export function buildLivePreviewDecorations(
  state: EditorState,
): DecorationSet {
  const decos: Array<{ from: number; to: number; deco: Decoration }> = []
  const tree: Tree = syntaxTree(state)
  const caretLines = computeCaretLines(state)

  let inFencedCode = 0 // depth counter — survives nested code-blocks defensively

  tree.iterate({
    enter(node: SyntaxNode) {
      if (node.name === 'FencedCode') {
        inFencedCode++
        // Apply line class to every line spanned.
        let pos = node.from
        while (pos <= node.to) {
          const line = state.doc.lineAt(pos)
          decos.push({
            from: line.from,
            to: line.from,
            deco: Decoration.line({ class: 'cm-md-code-block' }),
          })
          if (line.to + 1 > node.to) break
          pos = line.to + 1
        }
        return
      }

      // Inside fenced code: suppress all markdown decorations.
      if (inFencedCode > 0) return

      const construct = INLINE_CONSTRUCTS.find((c) => c.node === node.name)
      if (construct) {
        const onCaretLine = nodeOverlapsLines(node, state, caretLines)
        const markStart = node.from
        const markEnd = node.from + construct.markerLen
        const closeStart = node.to - construct.markerLen
        const closeEnd = node.to

        if (markStart < markEnd) {
          decos.push({
            from: markStart,
            to: markEnd,
            deco: onCaretLine ? VISIBLE_MARKER_MARK : HIDDEN_MARK,
          })
        }
        if (markEnd < closeStart) {
          decos.push({
            from: markEnd,
            to: closeStart,
            deco: Decoration.mark({ class: construct.contentClass }),
          })
        }
        if (closeStart < closeEnd) {
          decos.push({
            from: closeStart,
            to: closeEnd,
            deco: onCaretLine ? VISIBLE_MARKER_MARK : HIDDEN_MARK,
          })
        }
        return
      }

      // ── Headings (ATXHeading1..6) ──────────────────────────────
      const headingMatch = node.name.match(/^ATXHeading(\d)$/)
      if (headingMatch) {
        const level = Number(headingMatch[1])
        const line = state.doc.lineAt(node.from)
        decos.push({
          from: line.from,
          to: line.from,
          deco: Decoration.line({ class: `cm-md-h${level}` }),
        })
        // Marker is `# ` (level + 1 chars including the trailing space).
        const onCaretLine = caretLines.has(line.number)
        const markEnd = node.from + level + 1
        if (node.from < markEnd) {
          decos.push({
            from: node.from,
            to: markEnd,
            deco: onCaretLine ? VISIBLE_MARKER_MARK : HIDDEN_MARK,
          })
        }
        return
      }

      // ── Blockquote ─────────────────────────────────────────────
      if (node.name === 'Blockquote') {
        // Apply line class to every line spanned by the blockquote.
        let pos = node.from
        while (pos <= node.to) {
          const line = state.doc.lineAt(pos)
          decos.push({
            from: line.from,
            to: line.from,
            deco: Decoration.line({ class: 'cm-md-blockquote' }),
          })
          // Find the leading "> " marker on this line and hide/show it.
          const text = state.doc.sliceString(line.from, line.to)
          const m = text.match(/^(\s*)(>+\s?)/)
          if (m) {
            const onCaretLine = caretLines.has(line.number)
            const fromIdx = line.from + m[1].length
            const toIdx = fromIdx + m[2].length
            const safeTo = Math.min(toIdx, line.to)
            if (fromIdx < safeTo) {
              decos.push({
                from: fromIdx,
                to: safeTo,
                deco: onCaretLine ? VISIBLE_MARKER_MARK : HIDDEN_MARK,
              })
            }
          }
          if (line.to + 1 > node.to) break
          pos = line.to + 1
        }
        return
      }

      // ── HTML <img> tag (read tolerance — we never emit this form) ───
      if (node.name === 'HTMLBlock' || node.name === 'HTMLTag') {
        // HTMLBlock may span the rest of the block; extract just the first line.
        const firstLine = state.doc.lineAt(node.from)
        const lineText = state.doc.sliceString(firstLine.from, firstLine.to).trim()
        const m = lineText.match(
          /^<img\s+[^>]*src=["']([^"']+)["'][^>]*?(?:alt=["']([^"']*)["'])?[^>]*?(?:width=["']?(\d+)["']?)?[^>]*\/?\s*>/i,
        )
        if (m) {
          // Check caret against the first line only (where the <img> tag lives),
          // not the full HTMLBlock span which may extend further.
          const onCaretLine = caretLines.has(firstLine.number)
          if (onCaretLine) return
          const path = m[1]
          const alt = m[2] ?? ''
          const width = m[3] ? parseInt(m[3], 10) : null
          const vaultRoot = state.facet(vaultRootFacet)
          const absPath = vaultRoot ? `${vaultRoot}/${path}` : path
          // Replace only the first-line span (the actual <img> tag).
          const tagEnd = firstLine.from + m.index! + m[0].length
          decos.push({
            from: firstLine.from,
            to: tagEnd,
            deco: Decoration.replace({
              widget: new ImageWidget(
                convertFileSrc(absPath),
                alt,
                width,
                null,
                firstLine.from,
                tagEnd,
                path,
              ),
            }),
          })
          return
        }
      }

      // ── Image: ![alt|w](path) ──────────────────────────────────
      if (node.name === 'Image') {
        const text = state.doc.sliceString(node.from, node.to)
        const parsed = parseImageMarkdown(text)
        if (!parsed) return
        const onCaretLine = nodeOverlapsLines(node, state, caretLines)
        if (onCaretLine) return  // editing mode — leave source visible

        if (parsed.path.startsWith('pending://')) {
          const tempId = parsed.path.slice('pending://'.length)
          decos.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({ widget: new PendingImageWidget(tempId) }),
          })
          return
        }

        const vaultRoot = state.facet(vaultRootFacet)
        const absPath = vaultRoot ? `${vaultRoot}/${parsed.path}` : parsed.path
        decos.push({
          from: node.from,
          to: node.to,
          deco: Decoration.replace({
            widget: new ImageWidget(
              convertFileSrc(absPath),
              parsed.alt,
              parsed.width,
              parsed.height,
              node.from,
              node.to,
              parsed.path,
            ),
          }),
        })
        return
      }

      // ── Link: [text](url) ──────────────────────────────────────
      if (node.name === 'Link') {
        const onCaretLine = nodeOverlapsLines(node, state, caretLines)
        const text = state.doc.sliceString(node.from, node.to)
        const labelStart = text.indexOf('[')
        const labelEnd = text.indexOf(']', labelStart + 1)
        const urlStart = text.indexOf('(', labelEnd + 1)
        const urlEnd = text.lastIndexOf(')')
        if (
          labelStart === 0 &&
          labelEnd > 0 &&
          urlStart === labelEnd + 1 &&
          urlEnd === text.length - 1
        ) {
          const absLabelStart = node.from + labelStart // [
          const absLabelEnd = node.from + labelEnd // ]
          const absUrlStart = node.from + urlStart // (
          const absUrlEnd = node.from + urlEnd + 1 // ) inclusive

          if (onCaretLine) {
            decos.push({ from: absLabelStart, to: absLabelStart + 1, deco: VISIBLE_MARKER_MARK })
            // Mark visible label as link-styled.
            decos.push({
              from: absLabelStart + 1,
              to: absLabelEnd,
              deco: Decoration.mark({ class: 'cm-md-link' }),
            })
            decos.push({ from: absLabelEnd, to: absLabelEnd + 1, deco: VISIBLE_MARKER_MARK })
            decos.push({ from: absUrlStart, to: absUrlEnd, deco: VISIBLE_MARKER_MARK })
          } else {
            decos.push({ from: absLabelStart, to: absLabelStart + 1, deco: HIDDEN_MARK })
            decos.push({
              from: absLabelStart + 1,
              to: absLabelEnd,
              deco: Decoration.mark({ class: 'cm-md-link' }),
            })
            decos.push({ from: absLabelEnd, to: absLabelEnd + 1, deco: HIDDEN_MARK })
            decos.push({ from: absUrlStart, to: absUrlEnd, deco: HIDDEN_MARK })
          }
        }
        return
      }

      // ── Bullet list marker ─────────────────────────────────────
      if (node.name === 'ListMark') {
        const text = state.doc.sliceString(node.from, node.to)
        // Only style "-" / "*" (unordered). Ordered "1." stays plain.
        if (text === '-' || text === '*') {
          decos.push({
            from: node.from,
            to: node.to,
            deco: Decoration.mark({ class: 'cm-md-bullet' }),
          })
        }
        return
      }

      // ── Task list item (GFM `- [ ]` / `- [x]`) ─────────────────
      // The Lezer GFM grammar emits a `Task` node whose first child is
      // a `TaskMarker` with text `[ ]` or `[x]`. Replace the marker
      // range with a TaskCheckboxWidget. ALWAYS rendered — see spec
      // §Edge case #5.
      if (node.name === 'Task') {
        let marker: { from: number; to: number } | null = null
        let cur = node.node.firstChild
        while (cur) {
          if (cur.name === 'TaskMarker') {
            marker = { from: cur.from, to: cur.to }
            break
          }
          cur = cur.nextSibling
        }
        if (marker) {
          const text = state.doc.sliceString(marker.from, marker.to)
          const checked = text === '[x]' || text === '[X]'
          decos.push({
            from: marker.from,
            to: marker.to,
            deco: Decoration.replace({
              widget: new TaskCheckboxWidget(checked, marker.from, marker.to),
            }),
          })
        }
        return
      }

      // ── Horizontal rule `---` ──────────────────────────────────
      if (node.name === 'HorizontalRule') {
        const line = state.doc.lineAt(node.from)
        const onCaretLine = caretLines.has(line.number)
        if (!onCaretLine) {
          decos.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({ widget: new DividerWidget() }),
          })
        }
        return
      }
    },
    leave(node: SyntaxNode) {
      if (node.name === 'FencedCode') inFencedCode--
    },
  })

  // ── Obsidian wikilink-image: ![[path.ext]] (read tolerance) ────
  // Lezer doesn't natively recognize this; flat-scan the doc text.
  const wikilinkImageRe =
    /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|avif|svg))\]\]/gi
  const docText = state.doc.toString()
  for (const m of docText.matchAll(wikilinkImageRe)) {
    const from = m.index ?? 0
    const to = from + m[0].length
    const fromLine = state.doc.lineAt(from).number
    const toLine = state.doc.lineAt(to).number
    let onCaretLine = false
    for (let n = fromLine; n <= toLine; n++) {
      if (caretLines.has(n)) { onCaretLine = true; break }
    }
    if (onCaretLine) continue
    const path = m[1]
    const vaultRoot = state.facet(vaultRootFacet)
    const absPath = vaultRoot ? `${vaultRoot}/${path}` : path
    decos.push({
      from,
      to,
      deco: Decoration.replace({
        widget: new ImageWidget(
          convertFileSrc(absPath),
          '',
          null,
          null,
          from,
          to,
          path,
        ),
      }),
    })
  }

  decos.sort((a, b) => a.from - b.from || a.to - b.to)
  const builder = new RangeSetBuilder<Decoration>()
  for (const d of decos) {
    builder.add(d.from, d.to, d.deco)
  }
  return builder.finish()
}

/** The exported ViewPlugin. Add to MarkdownEditor.tsx extensions array. */
export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildLivePreviewDecorations(view.state)
    }

    update(update: ViewUpdate) {
      // IME composition guard: while the user is composing (CJK input),
      // suppress decoration rebuilds. Composition produces a flurry of
      // input.type transactions; rebuilding decorations mid-flight
      // resets widget DOM and drops the in-progress character.
      if (update.view.composing) return

      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged
      ) {
        this.decorations = buildLivePreviewDecorations(update.state)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)
