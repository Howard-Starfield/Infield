/**
 * Selection bubble: themed pill with B/I/U, list flyout, and overflow (⋯) panel.
 * Lives inside MDXEditor’s Lexical tree via realmPlugin so applyFormat$ / applyListType$ work.
 */
import {
  addBottomAreaChild$,
  applyFormat$,
  applyListType$,
  currentFormat$,
  editorInTable$,
  readOnly$,
  realmPlugin,
} from "@mdxeditor/editor"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { useCellValue, usePublisher } from "@mdxeditor/gurx"
import {
  AlignJustify,
  Code,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MoreHorizontal,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Undo2,
} from "lucide-react"
import {
  IS_BOLD,
  IS_HIGHLIGHT,
  IS_ITALIC,
  IS_UNDERLINE,
} from "@mdxeditor/editor"
import { type LexicalEditor, REDO_COMMAND, UNDO_COMMAND } from "lexical"
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { workspaceFloatingZ } from "@/lib/workspaceFloatingLayer"

type BubblePos = { top: number; left: number }

function selectionInsideEditor(editor: LexicalEditor): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  if (sel.isCollapsed) return false
  const root = editor.getRootElement()
  if (!root) return false
  const node = sel.anchorNode
  if (!node) return false
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  return !!(el && root.contains(el))
}

/**
 * Read the live selection rect. Returns null if the selection is collapsed or
 * its anchor rect is at/near the origin — both signal the DOM is not ready yet.
 * We deliberately do NOT update `pos` (state) from a null return; the bubble
 * keeps rendering at its last known good position until a confirmed selection
 * arrives. This prevents the bubble disappearing or jumping to (0,0) during
 * Lexical's internal re-selection after a format command.
 */
function bubblePosition(editor: LexicalEditor): BubblePos | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  if (sel.isCollapsed) return null
  const r = sel.getRangeAt(0).getBoundingClientRect()
  // A zero-width rect means the selection collapsed (caret, not a range) — the
  // DOM may not be ready yet after a format command. A left near 0 also signals
  // an unreliable anchor. In both cases we return null so the caller keeps the
  // bubble at its last confirmed position instead of jumping.
  if (r.width === 0 || r.left <= 2) return null

  const estW = 280
  // The bubble pill height (~36px) + gap (~8px) ≈ 44.  Use a fixed offset from
  // rect.top so the bubble always sits immediately above the selection.
  const BUBBLE_H = 44
  const top = Math.max(6, r.top - BUBBLE_H)
  // Horizontally center on the selection midpoint, clamped to viewport edges.
  const left = Math.min(
    window.innerWidth - estW - 8,
    Math.max(8, r.left + r.width / 2 - estW / 2),
  )
  return { top, left }
}

function bubbleZ() {
  return (Number.parseInt(workspaceFloatingZ(), 10) || 12001) + 4
}

function runLinkShortcut(editor: LexicalEditor) {
  const root = editor.getRootElement()
  const ce = root?.querySelector("[contenteditable=true]") as HTMLElement | null
  if (!ce) return
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform)
  ce.focus()
  ce.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      bubbles: true,
      cancelable: true,
      ctrlKey: !isMac,
      metaKey: isMac,
    }),
  )
}

type FormatName =
  | "bold"
  | "italic"
  | "underline"
  | "code"
  | "strikethrough"
  | "subscript"
  | "superscript"
  | "highlight"

function SelectionBubbleHost() {
  const { t } = useTranslation()
  const [editor] = useLexicalComposerContext()
  const readOnly = useCellValue(readOnly$)
  const inTable = useCellValue(editorInTable$)
  const currentFormat = useCellValue(currentFormat$)
  const applyFormat = usePublisher(applyFormat$)
  const applyListType = usePublisher(applyListType$)

  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<BubblePos | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [highlightOpen, setHighlightOpen] = useState(false)
  const rafRef = useRef<number | null>(null)
  const listHoverTimer = useRef<number | null>(null)
  const listLeaveTimer = useRef<number | null>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const moreBtnRef = useRef<HTMLButtonElement>(null)
  const [morePanelStyle, setMorePanelStyle] = useState<React.CSSProperties | null>(null)

  /**
   * Sync visibility (should bubble show?) and position (where?).
   *
   * Key insight — separating these two:
   * - `pos` only updates when we have a CONFIRMED non-collapsed selection rect.
   *   When `bubblePosition` returns null (transient: DOM not ready after a format
   *   command) we keep the last known `pos` — the bubble stays put instead of
   *   vanishing or jumping to (0,0).
   * - `visible` only goes false when the selection is definitely gone
   *   (collapsed, cursor moved outside editor, or readOnly).
   */
  const sync = useCallback(() => {
    if (readOnly) {
      setVisible(false)
      setPos(null)
      setListOpen(false)
      setMoreOpen(false)
      return
    }
    if (!selectionInsideEditor(editor)) {
      setVisible(false)
      setPos(null)
      setListOpen(false)
      setMoreOpen(false)
      return
    }
    const p = bubblePosition(editor)
    if (p) {
      setPos(p)
      setVisible(true)
    }
    // null return from bubblePosition means unreliable rect — keep showing at
    // last confirmed position so the bubble doesn't flash away during re-selection.
  }, [editor, readOnly])

  useEffect(() => {
    const onSel = () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        sync()
      })
    }
    document.addEventListener("selectionchange", onSel)
    return () => {
      document.removeEventListener("selectionchange", onSel)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [sync])

  useEffect(() => {
    if (!moreOpen) return
    const close = (e: MouseEvent) => {
      const pill = pillRef.current
      const t = e.target as Node
      if (pill?.contains(t)) return
      setMoreOpen(false)
    }
    document.addEventListener("mousedown", close, true)
    return () => document.removeEventListener("mousedown", close, true)
  }, [moreOpen])

  useLayoutEffect(() => {
    if (!moreOpen || !moreBtnRef.current) {
      setMorePanelStyle(null)
      return
    }
    const r = moreBtnRef.current.getBoundingClientRect()
    const maxW = Math.min(420, window.innerWidth - 16)
    setMorePanelStyle({
      position: "fixed",
      top: r.bottom + 6,
      left: r.left,
      maxWidth: maxW,
      zIndex: bubbleZ() + 2,
    })
  }, [moreOpen])

  const onFormat = useCallback(
    (name: FormatName) => {
      editor.focus()
      applyFormat(name)
      setMoreOpen(false)
    },
    [applyFormat, editor],
  )

  const onList = useCallback(
    (type: "bullet" | "number" | "check") => {
      editor.focus()
      applyListType(type)
      setListOpen(false)
    },
    [applyListType, editor],
  )

  const openListHover = useCallback(() => {
    if (inTable) return
    if (listLeaveTimer.current != null) {
      window.clearTimeout(listLeaveTimer.current)
      listLeaveTimer.current = null
    }
    if (listHoverTimer.current != null) window.clearTimeout(listHoverTimer.current)
    listHoverTimer.current = window.setTimeout(() => {
      listHoverTimer.current = null
      setListOpen(true)
    }, 80)
  }, [inTable])

  const closeListHover = useCallback(() => {
    if (listHoverTimer.current != null) {
      window.clearTimeout(listHoverTimer.current)
      listHoverTimer.current = null
    }
    if (listLeaveTimer.current != null) window.clearTimeout(listLeaveTimer.current)
    listLeaveTimer.current = window.setTimeout(() => {
      listLeaveTimer.current = null
      setListOpen(false)
    }, 160)
  }, [])

  const toggleListMenu = useCallback(() => {
    if (inTable) return
    setListOpen((o) => !o)
  }, [inTable])

  const openHighlightHover = useCallback(() => {
    if (listLeaveTimer.current != null) {
      window.clearTimeout(listLeaveTimer.current)
      listLeaveTimer.current = null
    }
    if (listHoverTimer.current != null) window.clearTimeout(listHoverTimer.current)
    listHoverTimer.current = window.setTimeout(() => {
      listHoverTimer.current = null
      setHighlightOpen(true)
    }, 80)
  }, [])

  const closeHighlightHover = useCallback(() => {
    if (listHoverTimer.current != null) {
      window.clearTimeout(listHoverTimer.current)
      listHoverTimer.current = null
    }
    if (listLeaveTimer.current != null) window.clearTimeout(listLeaveTimer.current)
    listLeaveTimer.current = window.setTimeout(() => {
      listLeaveTimer.current = null
      setHighlightOpen(false)
    }, 160)
  }, [])

  if (readOnly) return null

  if (!visible || !pos) return null

  const z = bubbleZ()

  const toolBtn = (
    label: string,
    children: React.ReactNode,
    onClick: () => void,
    active?: boolean,
  ) => (
    <button
      type="button"
      className={`mdx-selection-bubble__btn${active ? " mdx-selection-bubble__btn--on" : ""}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )

  return createPortal(
    <div
      ref={pillRef}
      className="mdx-selection-bubble"
      role="toolbar"
      aria-label={t("workspace.selectionBubbleLabel")}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: z,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="mdx-selection-bubble__pill">
        {toolBtn(
          t("workspace.selectionBubbleBold"),
          <span className="mdx-selection-bubble__letter">B</span>,
          () => onFormat("bold"),
          Boolean(currentFormat & IS_BOLD),
        )}
        <span className="mdx-selection-bubble__sep" aria-hidden />
        {toolBtn(
          t("workspace.selectionBubbleItalic"),
          <Italic size={15} strokeWidth={2} aria-hidden />,
          () => onFormat("italic"),
          Boolean(currentFormat & IS_ITALIC),
        )}
        <span className="mdx-selection-bubble__sep" aria-hidden />
        {toolBtn(
          t("workspace.selectionBubbleUnderline"),
          <span className="mdx-selection-bubble__letter mdx-selection-bubble__letter--u">U</span>,
          () => onFormat("underline"),
          Boolean(currentFormat & IS_UNDERLINE),
        )}
        <span className="mdx-selection-bubble__sep" aria-hidden />
        <div
          className="mdx-selection-bubble__list-anchor"
          onMouseEnter={openListHover}
          onMouseLeave={closeListHover}
        >
          <button
            type="button"
            className={`mdx-selection-bubble__btn${listOpen ? " mdx-selection-bubble__btn--on" : ""}`}
            aria-label={t("workspace.selectionBubbleLists")}
            title={t("workspace.selectionBubbleLists")}
            aria-expanded={listOpen}
            disabled={inTable}
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleListMenu}
          >
            <AlignJustify size={16} strokeWidth={2} aria-hidden />
          </button>
          {listOpen && !inTable ? (
            <div
              className="mdx-selection-bubble__list-flyout"
              style={{ zIndex: z + 1 }}
              onMouseEnter={openListHover}
              onMouseLeave={closeListHover}
              role="menu"
            >
              {toolBtn(
                t("workspace.selectionBubbleBullet"),
                <List size={16} strokeWidth={2} aria-hidden />,
                () => onList("bullet"),
              )}
              {toolBtn(
                t("workspace.selectionBubbleNumbered"),
                <ListOrdered size={16} strokeWidth={2} aria-hidden />,
                () => onList("number"),
              )}
              {toolBtn(
                t("workspace.selectionBubbleChecklist"),
                <ListChecks size={16} strokeWidth={2} aria-hidden />,
                () => onList("check"),
              )}
            </div>
          ) : null}
        </div>
        <span className="mdx-selection-bubble__sep" aria-hidden />
        <div
          className="mdx-selection-bubble__highlight-anchor"
          onMouseEnter={openHighlightHover}
          onMouseLeave={closeHighlightHover}
        >
          <button
            type="button"
            className={`mdx-selection-bubble__btn${highlightOpen ? " mdx-selection-bubble__btn--on" : ""}`}
            aria-label={t("workspace.selectionBubbleHighlight")}
            title={t("workspace.selectionBubbleHighlight")}
            aria-expanded={highlightOpen}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFormat("highlight")}
          >
            <Highlighter size={16} strokeWidth={2} aria-hidden />
          </button>
          {highlightOpen ? (
            <div
              className="mdx-selection-bubble__highlight-flyout"
              style={{ zIndex: z + 1 }}
              onMouseEnter={openHighlightHover}
              onMouseLeave={closeHighlightHover}
              role="menu"
            >
              {["#ff3232", "#ffa500", "#ffff00", "#32cd32", "#1e90ff", "#da70d6"].map(
                (color) => (
                  <button
                    key={color}
                    type="button"
                    className="mdx-selection-bubble__color-btn"
                    aria-label={t("workspace.selectionBubbleHighlightColor", { color })}
                    title={t("workspace.selectionBubbleHighlightColor", { color })}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      editor.focus()
                      applyFormat("highlight")
                      setHighlightOpen(false)
                    }}
                    style={{ background: color }}
                  />
                ),
              )}
            </div>
          ) : null}
        </div>
        <span className="mdx-selection-bubble__sep" aria-hidden />
        {toolBtn(
          t("workspace.selectionBubbleStrikethrough"),
          <Strikethrough size={16} strokeWidth={2} aria-hidden />,
          () => onFormat("strikethrough"),
        )}
        <span className="mdx-selection-bubble__sep" aria-hidden />
        <div className="mdx-selection-bubble__more-wrap">
          <button
            ref={moreBtnRef}
            type="button"
            className={`mdx-selection-bubble__btn${moreOpen ? " mdx-selection-bubble__btn--on" : ""}`}
            aria-label={t("workspace.selectionBubbleMore")}
            title={t("workspace.selectionBubbleMore")}
            aria-expanded={moreOpen}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMoreOpen((o) => !o)}
          >
            <MoreHorizontal size={17} strokeWidth={2} aria-hidden />
          </button>
          {moreOpen && morePanelStyle ? (
            <div
              className="mdx-selection-bubble__more-panel"
              style={morePanelStyle}
              role="menu"
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="mdx-selection-bubble__more-row">
                {toolBtn(t("workspace.selectionBubbleUndo"), <Undo2 size={16} strokeWidth={2} aria-hidden />, () => {
                  editor.focus()
                  editor.dispatchCommand(UNDO_COMMAND, undefined)
                  setMoreOpen(false)
                })}
                {toolBtn(t("workspace.selectionBubbleRedo"), <Redo2 size={16} strokeWidth={2} aria-hidden />, () => {
                  editor.focus()
                  editor.dispatchCommand(REDO_COMMAND, undefined)
                  setMoreOpen(false)
                })}
                <span className="mdx-selection-bubble__sep mdx-selection-bubble__sep--inner" aria-hidden />
                {toolBtn(
                  t("workspace.selectionBubbleSubscript"),
                  <Subscript size={16} strokeWidth={2} aria-hidden />,
                  () => onFormat("subscript"),
                )}
                {toolBtn(
                  t("workspace.selectionBubbleSuperscript"),
                  <Superscript size={16} strokeWidth={2} aria-hidden />,
                  () => onFormat("superscript"),
                )}
                <span className="mdx-selection-bubble__sep mdx-selection-bubble__sep--inner" aria-hidden />
                {toolBtn(
                  t("workspace.selectionBubbleCode"),
                  <Code size={16} strokeWidth={2} aria-hidden />,
                  () => onFormat("code"),
                )}
                <span className="mdx-selection-bubble__sep mdx-selection-bubble__sep--inner" aria-hidden />
                {toolBtn(t("workspace.selectionBubbleLink"), <Link2 size={16} strokeWidth={2} aria-hidden />, () => {
                  editor.focus()
                  runLinkShortcut(editor)
                  setMoreOpen(false)
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export const selectionBubblePlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addBottomAreaChild$]: () => <SelectionBubbleHost />,
    })
  },
})
