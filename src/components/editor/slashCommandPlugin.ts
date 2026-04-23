import {
  createActiveEditorSubscription$,
  realmPlugin,
} from "@mdxeditor/editor"
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list"
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode"
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text"
import { $findMatchingParent, mergeRegister } from "@lexical/utils"
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
} from "lexical"
import { $setBlocksType } from "@lexical/selection"

export const SLASH_MENU_OPEN = "handy-mdx-slash-open"
export const SLASH_MENU_UPDATE = "handy-mdx-slash-update"
export const SLASH_MENU_CLOSE = "handy-mdx-slash-close"
export const SLASH_MENU_PICK = "handy-mdx-slash-pick"
export const SLASH_MENU_SET_INDEX = "handy-mdx-slash-set-index"

export type SlashMenuItem = {
  id: string
  label: string
  hint?: string
  keywords: string[]
}

const MENU_ITEMS: SlashMenuItem[] = [
  {
    id: "bullet",
    label: "Bullet list",
    hint: "Unordered list",
    keywords: ["bullet", "unordered", "ul", "list"],
  },
  {
    id: "number",
    label: "Numbered list",
    hint: "Ordered list",
    keywords: ["number", "ordered", "ol", "list"],
  },
  {
    id: "check",
    label: "Checklist",
    hint: "Task list",
    keywords: ["check", "task", "todo", "checkbox"],
  },
  {
    id: "divider",
    label: "Divider",
    hint: "Horizontal rule",
    keywords: ["divider", "hr", "horizontal", "rule", "---"],
  },
  {
    id: "h1",
    label: "Heading 1",
    keywords: ["h1", "heading", "title"],
  },
  {
    id: "h2",
    label: "Heading 2",
    keywords: ["h2", "heading", "subtitle"],
  },
  {
    id: "h3",
    label: "Heading 3",
    keywords: ["h3", "heading"],
  },
  {
    id: "quote",
    label: "Quote",
    keywords: ["quote", "blockquote", "citation"],
  },
]

type SlashCtx = {
  editor: LexicalEditor
  textNodeKey: string
  slashOffset: number
  endOffset: number
  query: string
  selectedIndex: number
  filtered: SlashMenuItem[]
}

let slashCtx: SlashCtx | null = null
let keyListener: ((e: KeyboardEvent) => void) | null = null

function clearSlashMenuState() {
  slashCtx = null
  if (keyListener) {
    window.removeEventListener("keydown", keyListener, true)
    keyListener = null
  }
}

function dispatchClose() {
  window.dispatchEvent(new CustomEvent(SLASH_MENU_CLOSE))
}

function filterItems(query: string): SlashMenuItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return MENU_ITEMS
  return MENU_ITEMS.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.keywords.some((k) => k.includes(q) || q.includes(k)),
  )
}

function emitOpen(rect: DOMRect, ctx: SlashCtx) {
  window.dispatchEvent(
    new CustomEvent(SLASH_MENU_OPEN, {
      detail: {
        top: rect.bottom + 4,
        left: rect.left,
        query: ctx.query,
        items: ctx.filtered,
        selectedIndex: ctx.selectedIndex,
      },
    }),
  )
}

function emitUpdate() {
  if (!slashCtx) return
  window.dispatchEvent(
    new CustomEvent(SLASH_MENU_UPDATE, {
      detail: {
        query: slashCtx.query,
        items: slashCtx.filtered,
        selectedIndex: slashCtx.selectedIndex,
      },
    }),
  )
}

/** `/` must be at line start or after whitespace within this text node. */
function parseSlashInLine(beforeCursor: string): { slashIndex: number; query: string } | null {
  const slashIndex = beforeCursor.lastIndexOf("/")
  if (slashIndex < 0) return null
  if (slashIndex > 0) {
    const prev = beforeCursor[slashIndex - 1]
    if (!/[\s\n]/.test(prev)) return null
  }
  const query = beforeCursor.slice(slashIndex + 1)
  if (/[\s\n]/.test(query)) return null
  return { slashIndex, query }
}

function inCodeBlock(anchorNode: LexicalNode): boolean {
  return $findMatchingParent(anchorNode, (p) => p.getType() === "codeblock") != null
}

function readSlashFromEditor(
  editor: LexicalEditor,
  prevCtx: SlashCtx | null,
): SlashCtx | null {
  let out: SlashCtx | null = null
  editor.getEditorState().read(() => {
    const sel = $getSelection()
    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return
    const anchor = sel.anchor
    const node = anchor.getNode()
    if (!$isTextNode(node)) return
    if (inCodeBlock(anchor.getNode())) return

    const text = node.getTextContent()
    const off = anchor.offset
    const before = text.slice(0, off)
    const parsed = parseSlashInLine(before)
    if (!parsed) return

    const filtered = filterItems(parsed.query)
    if (filtered.length === 0) return

    const preserveIndex =
      prevCtx &&
      prevCtx.editor === editor &&
      prevCtx.textNodeKey === node.getKey() &&
      prevCtx.slashOffset === parsed.slashIndex &&
      prevCtx.query === parsed.query

    const selectedIndex = preserveIndex
      ? Math.min(prevCtx!.selectedIndex, filtered.length - 1)
      : 0

    out = {
      editor,
      textNodeKey: node.getKey(),
      slashOffset: parsed.slashIndex,
      endOffset: off,
      query: parsed.query,
      selectedIndex,
      filtered,
    }
  })
  return out
}

function applySlashCommand(ctx: SlashCtx, item: SlashMenuItem) {
  const { editor } = ctx
  editor.update(() => {
    const node = $getNodeByKey(ctx.textNodeKey)
    if ($isTextNode(node)) {
      const len = ctx.endOffset - ctx.slashOffset
      if (len > 0) {
        node.spliceText(ctx.slashOffset, len, "", true)
      }
    }

    switch (item.id) {
      case "bullet":
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
        break
      case "number":
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
        break
      case "check":
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined)
        break
      case "divider":
        editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined)
        break
      case "h1":
      case "h2":
      case "h3": {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) {
          const tag = item.id as "h1" | "h2" | "h3"
          $setBlocksType(sel, () => $createHeadingNode(tag))
        }
        break
      }
      case "quote": {
        const sel = $getSelection()
        if ($isRangeSelection(sel)) {
          $setBlocksType(sel, () => $createQuoteNode())
        }
        break
      }
      default:
        break
    }
  })
}

function attachKeyListener() {
  if (keyListener) return
  keyListener = (e: KeyboardEvent) => {
    if (!slashCtx) return
    const { filtered } = slashCtx
    if (filtered.length === 0) {
      dispatchClose()
      return
    }
    if (e.key === "Escape") {
      e.preventDefault()
      e.stopPropagation()
      dispatchClose()
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      e.stopPropagation()
      slashCtx.selectedIndex = Math.min(
        slashCtx.selectedIndex + 1,
        filtered.length - 1,
      )
      emitUpdate()
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      e.stopPropagation()
      slashCtx.selectedIndex = Math.max(slashCtx.selectedIndex - 1, 0)
      emitUpdate()
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      e.stopPropagation()
      const item = filtered[slashCtx.selectedIndex]
      if (item) {
        const ctx = slashCtx
        dispatchClose()
        applySlashCommand(ctx, item)
      }
      return
    }
  }
  window.addEventListener("keydown", keyListener, true)
}

function positionFromEditor(editor: LexicalEditor): DOMRect | null {
  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0).getBoundingClientRect()
    if (r.width || r.height) return r
  }
  const root = editor.getRootElement()
  if (root) return root.getBoundingClientRect()
  return null
}

function onSlashPick(ev: Event) {
  const ce = ev as CustomEvent<{ id: string }>
  const id = ce.detail?.id
  if (!slashCtx || !id) return
  const item = slashCtx.filtered.find((i) => i.id === id)
  if (!item) return
  const ctx = slashCtx
  dispatchClose()
  applySlashCommand(ctx, item)
}

let slashPickListenerInstalled = false
let slashCloseListenerInstalled = false
let slashSetIndexInstalled = false

function onSlashSetIndex(ev: Event) {
  const ce = ev as CustomEvent<{ index: number }>
  const i = ce.detail?.index
  if (slashCtx == null || typeof i !== "number") return
  slashCtx.selectedIndex = Math.max(
    0,
    Math.min(i, slashCtx.filtered.length - 1),
  )
  emitUpdate()
}

export const slashCommandPlugin = realmPlugin({
  init(realm) {
    if (typeof window !== "undefined" && !slashPickListenerInstalled) {
      slashPickListenerInstalled = true
      window.addEventListener(SLASH_MENU_PICK, onSlashPick)
    }
    if (typeof window !== "undefined" && !slashCloseListenerInstalled) {
      slashCloseListenerInstalled = true
      window.addEventListener(SLASH_MENU_CLOSE, () => {
        clearSlashMenuState()
      })
    }
    if (typeof window !== "undefined" && !slashSetIndexInstalled) {
      slashSetIndexInstalled = true
      window.addEventListener(SLASH_MENU_SET_INDEX, onSlashSetIndex)
    }

    realm.pub(
      createActiveEditorSubscription$,
      (editor: LexicalEditor) => {
        return mergeRegister(
          editor.registerUpdateListener(() => {
            const next = readSlashFromEditor(editor, slashCtx)
            const rect = positionFromEditor(editor)

            if (!next || !rect) {
              if (slashCtx?.editor === editor) {
                dispatchClose()
              }
              return
            }

            const prev = slashCtx
            const unchanged =
              prev &&
              prev.editor === editor &&
              prev.textNodeKey === next.textNodeKey &&
              prev.slashOffset === next.slashOffset &&
              prev.endOffset === next.endOffset &&
              prev.query === next.query &&
              prev.selectedIndex === next.selectedIndex

            if (unchanged) {
              return
            }

            const sameSlashTrigger =
              prev &&
              prev.editor === editor &&
              prev.textNodeKey === next.textNodeKey &&
              prev.slashOffset === next.slashOffset

            slashCtx = next
            attachKeyListener()

            if (sameSlashTrigger) {
              emitUpdate()
            } else {
              emitOpen(rect, slashCtx)
            }
          }),
        )
      },
    )
  },
})
