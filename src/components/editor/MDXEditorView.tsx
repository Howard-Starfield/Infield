import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ForwardedRef } from "react";
import {
  MDXEditor,
  AdmonitionDirectiveDescriptor,
  codeBlockPlugin,
  codeMirrorPlugin,
  diffSourcePlugin,
  directivesPlugin,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  sandpackPlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { useWorkspaceStore, type WorkspaceNodeSummary } from "../../stores/workspaceStore";
import {
  SLASH_MENU_CLOSE,
  SLASH_MENU_OPEN,
  SLASH_MENU_PICK,
  SLASH_MENU_SET_INDEX,
  SLASH_MENU_UPDATE,
  slashCommandPlugin,
  type SlashMenuItem,
} from "./slashCommandPlugin";
import { HandyMdxToolbar } from "./HandyMdxToolbar";
import { selectionBubblePlugin } from "./selectionBubblePlugin";
import { VoiceMemoRecordingDirectiveDescriptor } from "./VoiceMemoRecordingDirectiveDescriptor";
import { WorkspaceNodeListIcon } from "../workspace/workspaceNodeListIcon";
import { workspaceMenuSurfaceStyle } from "../workspace/chrome/workspaceMenuChrome";
import {
  fitRectInViewport,
  placeMenuAtPointer,
  workspaceFloatingZ,
} from "@/lib/workspaceFloatingLayer";

interface MDXEditorViewProps {
  editorRef: ForwardedRef<MDXEditorMethods | null>;
  markdown: string;
  onChange: (markdown: string) => void;
  className?: string;
  /** When true, editor is display-only (e.g. note import still transcribing). */
  readOnly?: boolean;
}

/** Default Sandpack preset (matches @mdxeditor/editor built-in defaults). */
const DEFAULT_SANDPACK_CONFIG = {
  defaultPreset: "react" as const,
  presets: [
    {
      name: "react",
      meta: "live react",
      label: "React",
      sandpackTemplate: "react" as const,
      sandpackTheme: "light" as const,
      snippetFileName: "/App.js",
      snippetLanguage: "jsx",
      initialSnippetContent: `
export default function App() {
  return (
    <div className="App">
      <h1>Hello CodeSandbox</h1>
      <h2>Start editing to see some magic happen!</h2>
    </div>
  );
}
`,
    },
  ],
}

const PLUGINS = [
  toolbarPlugin({
    toolbarClassName: "handy-mdx-toolbar-root",
    toolbarContents: () => <HandyMdxToolbar />,
  }),
  headingsPlugin(),
  listsPlugin(),
  selectionBubblePlugin(),
  quotePlugin(),
  thematicBreakPlugin(),
  markdownShortcutPlugin(),
  linkPlugin(),
  linkDialogPlugin(),
  imagePlugin(),
  tablePlugin(),
  frontmatterPlugin(),
  codeBlockPlugin({ defaultCodeBlockLanguage: "" }),
  codeMirrorPlugin({
    codeBlockLanguages: {
      "": "Plain text",
      js: "JavaScript",
      ts: "TypeScript",
      py: "Python",
      rs: "Rust",
      sh: "Shell",
    },
  }),
  sandpackPlugin({ sandpackConfig: DEFAULT_SANDPACK_CONFIG }),
  directivesPlugin({
    directiveDescriptors: [
      AdmonitionDirectiveDescriptor,
      VoiceMemoRecordingDirectiveDescriptor,
      {
        name: "generic",
        type: "textDirective",
        attributes: [],
        hasChildren: false,
        testNode(node) {
          return node.type === "textDirective" && node.name !== "voice_memo_recording";
        },
        Editor({ mdastNode }) {
          const name = (mdastNode as any).name ?? "";
          const children = (mdastNode as any).children ?? [];
          const text = children.map((c: any) => c.value ?? "").join("");
          return (
            <code style={{ color: "var(--workspace-accent)", fontFamily: "monospace" }}>
              {`::${name} ${text}`.trim()}
            </code>
          );
        },
      },
    ],
  }),
  diffSourcePlugin(),
  slashCommandPlugin(),
]

// ─── Wikilink Autocomplete Overlay ─────────────────────────────────────────────

interface AutocompleteResult {
  node: WorkspaceNodeSummary
  insertText: string
}

interface WikilinkOverlayProps {
  query: string
  position: { top: number; left: number }
  onSelect: (result: AutocompleteResult) => void
  onCreateAndInsert: (name: string) => void
  onClose: () => void
}

const WIKILINK_MENU_W = 240
const WIKILINK_MENU_MAX_H = 280

function WikilinkOverlay({ query, position, onSelect, onCreateAndInsert, onClose }: WikilinkOverlayProps) {
  const { t } = useTranslation()
  const [results, setResults] = useState<WorkspaceNodeSummary[]>([])
  const [loading, setLoading] = useState(false)
  const searchNodes = useWorkspaceStore(s => s.searchNodes)
  const overlayId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  const [menuPos, setMenuPos] = useState(() =>
    placeMenuAtPointer(position.left, position.top + 24, {
      menuWidth: WIKILINK_MENU_W,
      menuHeight: WIKILINK_MENU_MAX_H,
    }),
  )

  useLayoutEffect(() => {
    const initial = placeMenuAtPointer(position.left, position.top + 24, {
      menuWidth: WIKILINK_MENU_W,
      menuHeight: WIKILINK_MENU_MAX_H,
    })
    setMenuPos(initial)
    const id = requestAnimationFrame(() => {
      const el = listRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setMenuPos(
        fitRectInViewport({
          top: initial.top,
          left: initial.left,
          width: r.width,
          height: r.height,
        }),
      )
    })
    return () => cancelAnimationFrame(id)
  }, [position.left, position.top, results.length, loading, query])

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await searchNodes(query, { limit: 10 })
        setResults(res)
      } finally {
        setLoading(false)
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [query, searchNodes])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        listRef.current?.querySelector<HTMLButtonElement>('[data-wk-item]:nth-child(2)')?.focus()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [onClose])

  const style: React.CSSProperties = {
    ...workspaceMenuSurfaceStyle(),
    position: 'fixed',
    top: menuPos.top,
    left: menuPos.left,
    zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
    width: WIKILINK_MENU_W,
    maxHeight: 280,
    overflowY: 'auto',
    padding: '4px 0',
    boxShadow: 'var(--workspace-shadow-soft)',
  }

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '6px 12px',
    border: 'none', background: 'none', cursor: 'pointer',
    fontSize: 12, fontFamily: 'Space Grotesk, sans-serif',
    color: 'var(--workspace-text)', textAlign: 'left', borderRadius: 4,
  }

  return createPortal(
    <div id={overlayId} ref={listRef} style={style} role="listbox">
      {loading && <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--workspace-text-soft)' }}>{t('workspace.wikilink.searching', 'Searching…')}</div>}
      {!loading && results.length === 0 && query.trim() && (
        <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--workspace-text-soft)' }}>{t('workspace.wikilink.noResults', 'No results')}</div>
      )}
      {results.map((node, i) => (
        <button
          key={node.id}
          data-wk-item={i + 1}
          style={itemStyle}
          onMouseDown={e => { e.preventDefault(); onSelect({ node, insertText: `[${node.name}](node://${node.id})` }) }}
        >
          <WorkspaceNodeListIcon icon={node.icon} size={13} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
          {node.parent_name && <span style={{ fontSize: 10, opacity: 0.5 }}>{node.parent_name}</span>}
        </button>
      ))}
      <div style={{ height: 1, background: 'var(--workspace-border)', margin: '4px 8px' }} />
      <button
        data-wk-create
        style={{ ...itemStyle, color: 'var(--workspace-accent)' }}
        onMouseDown={e => { e.preventDefault(); onCreateAndInsert(query) }}
      >
        <span style={{ fontSize: 13 }}>+</span>
        <span>
          {t('workspace.wikilink.createNamed', {
            defaultValue: 'Create "{{name}}"',
            name: query,
          })}
        </span>
      </button>
    </div>,
    document.body
  )
}

// ─── Slash command menu (/) ─────────────────────────────────────────────────

type SlashOverlayState = {
  open: boolean
  top: number
  left: number
  query: string
  items: SlashMenuItem[]
  selectedIndex: number
}

const SLASH_MENU_W = 280
const SLASH_MENU_MAX_H = 300

function SlashMenuOverlay({
  state,
  onPick,
  onClose,
  onHighlight,
}: {
  state: SlashOverlayState
  onPick: (id: string) => void
  onClose: () => void
  onHighlight: (index: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  const [menuPos, setMenuPos] = useState(() =>
    placeMenuAtPointer(state.left, state.top, {
      menuWidth: SLASH_MENU_W,
      menuHeight: SLASH_MENU_MAX_H,
    }),
  )

  useLayoutEffect(() => {
    if (!state.open) return
    const initial = placeMenuAtPointer(state.left, state.top, {
      menuWidth: SLASH_MENU_W,
      menuHeight: SLASH_MENU_MAX_H,
    })
    setMenuPos(initial)
    const id = requestAnimationFrame(() => {
      const el = listRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setMenuPos(
        fitRectInViewport({
          top: initial.top,
          left: initial.left,
          width: r.width,
          height: r.height,
        }),
      )
    })
    return () => cancelAnimationFrame(id)
  }, [state.open, state.left, state.top, state.items.length, state.query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [onClose])

  if (!state.open) return null

  const itemStyle = (active: boolean): React.CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    width: "100%",
    padding: "8px 12px",
    border: "none",
    background: active ? "var(--workspace-accent-soft)" : "none",
    cursor: "pointer",
    fontSize: 13,
    fontFamily: "Space Grotesk, sans-serif",
    color: "var(--workspace-text)",
    textAlign: "left",
    borderRadius: 4,
  })

  return createPortal(
    <div
      ref={listRef}
      role="listbox"
      style={{
        ...workspaceMenuSurfaceStyle(),
        position: "fixed",
        top: menuPos.top,
        left: menuPos.left,
        zIndex: Number.parseInt(workspaceFloatingZ(), 10) || 12001,
        width: SLASH_MENU_W,
        maxHeight: SLASH_MENU_MAX_H,
        overflowY: "auto",
        padding: "6px 0",
        boxShadow: "var(--workspace-shadow-soft)",
      }}
    >
      <div
        style={{
          padding: "4px 12px 8px",
          fontSize: 11,
          color: "var(--workspace-text-muted)",
          borderBottom: "1px solid var(--workspace-border)",
        }}
      >
        {state.query ? `/${state.query}` : "Commands"}
      </div>
      {state.items.map((item, i) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={i === state.selectedIndex}
          style={itemStyle(i === state.selectedIndex)}
          onMouseDown={(e) => {
            e.preventDefault()
            onPick(item.id)
          }}
          onMouseEnter={() => onHighlight(i)}
        >
          <span style={{ fontWeight: 600 }}>{item.label}</span>
          {item.hint && (
            <span style={{ fontSize: 11, color: "var(--workspace-text-soft)" }}>
              {item.hint}
            </span>
          )}
        </button>
      ))}
    </div>,
    document.body,
  )
}

// ─── MDXEditorView ─────────────────────────────────────────────────────────────

export const MDXEditorView = React.forwardRef<
  MDXEditorMethods | null,
  Omit<MDXEditorViewProps, "editorRef">
>(({ markdown, onChange, className, readOnly = false }, ref) => {
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const navigateTo = useWorkspaceStore(s => s.navigateTo)
  const createNode = useWorkspaceStore(s => s.createNode)
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const [autocompleteQuery, setAutocompleteQuery] = useState('')
  const [autocompletePosition, setAutocompletePosition] = useState({ top: 0, left: 0 })
  const [prevMarkdown, setPrevMarkdown] = useState('')

  const [slashMenu, setSlashMenu] = useState<SlashOverlayState>({
    open: false,
    top: 0,
    left: 0,
    query: '',
    items: [],
    selectedIndex: 0,
  })

  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<SlashOverlayState>).detail
      setSlashMenu({
        open: true,
        top: d.top,
        left: d.left,
        query: d.query,
        items: d.items,
        selectedIndex: d.selectedIndex,
      })
    }
    const onUpdate = (e: Event) => {
      const d = (e as CustomEvent<Pick<SlashOverlayState, 'query' | 'items' | 'selectedIndex'>>).detail
      setSlashMenu((prev) => ({
        ...prev,
        open: true,
        query: d.query,
        items: d.items,
        selectedIndex: d.selectedIndex,
      }))
    }
    const onClose = () => {
      setSlashMenu((s) => ({ ...s, open: false }))
    }
    window.addEventListener(SLASH_MENU_OPEN, onOpen)
    window.addEventListener(SLASH_MENU_UPDATE, onUpdate)
    window.addEventListener(SLASH_MENU_CLOSE, onClose)
    return () => {
      window.removeEventListener(SLASH_MENU_OPEN, onOpen)
      window.removeEventListener(SLASH_MENU_UPDATE, onUpdate)
      window.removeEventListener(SLASH_MENU_CLOSE, onClose)
    }
  }, [])

  const highlightSlashItem = useCallback((index: number) => {
    window.dispatchEvent(new CustomEvent(SLASH_MENU_SET_INDEX, { detail: { index } }))
  }, [])

  const handleSlashPick = useCallback((id: string) => {
    window.dispatchEvent(new CustomEvent(SLASH_MENU_PICK, { detail: { id } }))
  }, [])

  // Detect [[ trigger from onChange
  const handleChange = useCallback((newMarkdown: string) => {
    if (readOnly) return
    onChange(newMarkdown)

    // Detect [[ insertion: compare new vs prev markdown
    if (newMarkdown.length > prevMarkdown.length) {
      const inserted = newMarkdown.slice(prevMarkdown.length)
      if (inserted === '[[') {
        // Show overlay anchored near caret
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) {
          const range = sel.getRangeAt(0)
          const rect = range.getBoundingClientRect()
          setAutocompletePosition({ top: rect.top, left: rect.left })
          setAutocompleteQuery('')
          setShowAutocomplete(true)
        }
      } else if (showAutocomplete) {
        // Accumulate query text after [[
        const doubleBracketIdx = newMarkdown.lastIndexOf('[[')
        if (doubleBracketIdx >= 0) {
          setAutocompleteQuery(newMarkdown.slice(doubleBracketIdx + 2))
        }
      }
    } else if (newMarkdown.length < prevMarkdown.length) {
      // Text was deleted — close overlay if [[ was removed
      if (!newMarkdown.includes('[[') && showAutocomplete) {
        setShowAutocomplete(false)
      }
    }
    setPrevMarkdown(newMarkdown)
  }, [onChange, prevMarkdown, showAutocomplete, readOnly])

  // node:// click interception via event delegation on contentEditable
  useEffect(() => {
    const container = editorContainerRef.current
    if (!container) return
    const handleClick = (e: MouseEvent) => {
      const target = (e.target as Element).closest('a')
      if (!target) return
      const href = target.getAttribute('href')
      if (!href?.startsWith('node://')) return
      e.preventDefault()
      const uuid = href.replace('node://', '')
      void navigateTo(uuid, { source: 'wikilink' })
    }
    container.addEventListener('click', handleClick)
    return () => container.removeEventListener('click', handleClick)
  }, [navigateTo])

  // Insert wikilink at cursor, replacing [[... trigger text
  const insertWikilink = useCallback((insertText: string) => {
    const editor = (ref as React.RefObject<MDXEditorMethods | null>)?.current
    if (!editor) return
    // Get current markdown and remove the [[... trigger
    const current = editor.getMarkdown()
    const bracketIdx = current.lastIndexOf('[[')
    if (bracketIdx >= 0) {
      const before = current.slice(0, bracketIdx)
      const after = editor.getSelectionMarkdown() ?? ''
      editor.setMarkdown(before + insertText + after)
    }
    setShowAutocomplete(false)
  }, [ref])

  // Create new page and insert wikilink
  const handleCreateAndInsert = useCallback(async (name: string) => {
    const node = await createNode(null, 'document', name)
    insertWikilink(`[${name}](node://${node.id})`)
  }, [createNode, insertWikilink])

  const handleAutocompleteSelect = useCallback((result: AutocompleteResult) => {
    insertWikilink(result.insertText)
  }, [insertWikilink])

  return (
    <div
      ref={editorContainerRef}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <MDXEditor
        ref={ref}
        markdown={markdown}
        onChange={handleChange}
        plugins={PLUGINS}
        className={className ?? ""}
        contentEditableClassName="mdx-prose"
        readOnly={readOnly}
      />
      {showAutocomplete && (
        <WikilinkOverlay
          query={autocompleteQuery}
          position={autocompletePosition}
          onSelect={handleAutocompleteSelect}
          onCreateAndInsert={handleCreateAndInsert}
          onClose={() => setShowAutocomplete(false)}
        />
      )}
      <SlashMenuOverlay
        state={slashMenu}
        onPick={handleSlashPick}
        onHighlight={highlightSlashItem}
        onClose={() => {
          window.dispatchEvent(new CustomEvent(SLASH_MENU_CLOSE));
        }}
      />
    </div>
  );
})

MDXEditorView.displayName = "MDXEditorView"

export type { MDXEditorMethods }
