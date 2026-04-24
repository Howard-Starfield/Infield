import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'

export interface NodeLinkRange {
  from: number
  to: number
  nodeId: string
}

const NODE_LINK_RE = /^node:\/\/([0-9a-fA-F-]+)$/

/**
 * Walk the markdown Lezer tree and find every URL node whose text
 * matches `node://<uuid>`. Exposed for tests; also used by the
 * decoration plugin.
 */
export function findNodeLinkRanges(state: EditorState): NodeLinkRange[] {
  const out: NodeLinkRange[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'URL') return
      const text = state.sliceDoc(node.from, node.to)
      const m = text.match(NODE_LINK_RE)
      if (m) out.push({ from: node.from, to: node.to, nodeId: m[1] })
    },
  })
  return out
}

export interface NodeLinkClickOpts {
  meta: boolean
}

/**
 * Mark decoration plugin: decorate every `node://<uuid>` URL span with
 * class `cm-node-link` + data-node-id. A view-level click handler
 * intercepts clicks on those spans and calls `onClick(nodeId, opts)`.
 *
 * `opts.meta` is `true` when the user held Cmd (macOS) or Ctrl during
 * the click — used by NotesView to route to a new tab vs. replace the
 * active tab.
 */
export function nodeLinkClickPlugin(
  onClick: (nodeId: string, opts: NodeLinkClickOpts) => void,
) {
  const build = (view: EditorView): DecorationSet => {
    const ranges = findNodeLinkRanges(view.state)
    return Decoration.set(
      ranges.map((r) =>
        Decoration.mark({
          class: 'cm-node-link',
          attributes: { 'data-node-id': r.nodeId },
        }).range(r.from, r.to),
      ),
      true,
    )
  }
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = build(u.view)
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        click(ev) {
          const target = ev.target as HTMLElement
          const el = target.closest('[data-node-id]') as HTMLElement | null
          if (!el) return
          ev.preventDefault()
          const id = el.dataset.nodeId!
          onClick(id, { meta: ev.metaKey || ev.ctrlKey })
        },
      },
    },
  )
}
