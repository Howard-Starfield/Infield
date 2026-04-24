# W2 — Notes wiring (Workspace tree + CodeMirror 6 editor)

**Status:** design locked 2026-04-23 · ready for implementation plan
**Phase:** Backend Wiring Phase (W) — follows W0 (onboarding) + W1 (voice
transcribe).
**Companion docs:** [CLAUDE.md](../../../CLAUDE.md) (rules + invariants),
[PLAN.md](../../../PLAN.md) W2 block (scope), AudioView for reference
on voice-memo audio playback.

---

## 1. Goal

Replace the dormant eBay-style `NotesView` shell with a functional
**tree + CodeMirror 6 editor + backlinks** surface wired to Handy's
stable Rust workspace backend. Users can create, edit, drag, rename,
and delete documents; their edits autosave to `workspace.db` and the
vault `.md` file on disk; voice-memo recordings render as inline pills
with playback; external edits trigger an inline conflict banner.

After W2, Notes is the primary way users put knowledge into Handy —
every other wiring phase (W3 search, W4 databases, W5 settings, W6 AI
chat) either reads from Notes docs or extends the editor.

---

## 2. Invariants honoured

Every hard rule from CLAUDE.md that applies to editor work:

| # | Rule | Compliance |
|---|---|---|
| 2 | `currentPage` + Context, no Zustand | `NotesView` reads `activeNodeId` from component state; no new stores |
| 10 | Body is raw markdown, not JSON trees | CM6 `EditorState.doc.toString()` IS the raw markdown written to `workspace_nodes.body` and the vault `.md` file. No JSON round-trip. |
| 11 | No separate folder node type | Tree renders a caret when a doc has ≥1 non-deleted child. "New Folder" button creates a `node_type = "document"` with icon `📁` — same as "New Document", different default name/icon |
| 13 | Vault write conflict guard | Every `update_node` call passes `last_seen_mtime_secs`; `ExternalEditConflict` triggers the inline banner state machine (§6) |
| 13a | Vault path normalization | Handled by Rust (NFC, case-insensitive, ignore patterns) — frontend stays out of the way |
| 14 | No filesystem watcher | Reconciliation is lazy: on node open, on window focus (`workspace:window-focused` event dispatched by existing boot code), on explicit Reload click |
| 18 | CSS hygiene (BEM prefix, token-only, concern files) | New `src/styles/notes.css` concern file. Classes prefixed `.notes-*`, `.tree-row`, `.editor-*`. All values via `var(--token)`. No raw px, hex, shadow, or `!important`. |
| 22 | CodeMirror 6 + GFM, no Agentz fork | `@codemirror/lang-markdown` + `@lezer/markdown` GFM. Zero telemetry deps. |
| 23 | Slash commands via `@codemirror/autocomplete` | Line-start guarded completion source over existing `src/editor/slashCommands.ts` |

---

## 3. Locked decisions (from brainstorming)

1. **Tree filter**: inline `HerOSInput` at top of left pane, case-
   insensitive substring match, no persistence across tab switches.
   No `fuse.js` or other fuzzy-match dependency.
2. **New-node flow**: `Cmd+N` creates root doc named "Untitled",
   editor mounts immediately with title input auto-focused + selected.
   Left-pane header has two buttons: "New Document" (`📄`) and
   "New Folder" (`📁`); both call `create_node({node_type: "document"})`
   per Rule 11, differing only in default name and icon. Row context
   menu offers "New child document".
3. **Voice-memo pill Unavailable state**: matches AudioView's visual
   treatment — `⚠ Audio unavailable` muted-orange chip, click attempts
   retry; on success it flips back to the normal play state. AudioView
   itself uses verbatim-ported inline literals per Rule 12's carve-out;
   the W2 voice-memo pill (new code) expresses the same visual state
   via `var(--heros-brand)` + `color-mix(…)` to satisfy Rule 12 / 18
   for new surfaces. No new hex literals introduced.
4. **Conflict banner**: sticky strip at top of right (editor) pane,
   above the CM6 editor area, full-width of the pane, amber-tinted.
   Three buttons: Reload / Keep mine / Open diff. Open diff is
   disabled (tooltip: "coming in a later release") in v1 per Rule 13.
5. **Autosave indicator**: tiny footer text bottom-right —
   `Saving…` during in-flight, `Saved h:MM` on success (auto-fades
   after 2s), `Save failed — click to retry` in brand-red on error.
6. **Drag-drop position math**: frontend computes midpoint from
   sibling positions and passes the float to existing `move_node`
   (which already accepts `position: f64`). Uses `@dnd-kit/sortable`'s
   built-in drag animations (`CSS.Transform.toString()` + spring
   transition) + `DragOverlay` for the drag ghost. Rebalance on
   sibling gap < 1e-9 happens in Rust via an optional follow-up
   command only if it's observed in practice — not built pre-emptively.
7. **Right panel**: repurposed as "Backlinks" pane. Uses existing
   `get_backlinks(activeNodeId)` Rust command. eBay "Side Notes",
   "Contextual Intelligence", and "Security" cards are retired.

---

## 4. Architecture

### 4.1 CodeMirror 6 ownership model — Approach B (uncontrolled)

CM6 owns the doc body. `EditorState.doc` is the single source of truth
for the currently-open node's markdown. React reads from it only when
saving (`view.state.doc.toString()` → `update_node`).

When the user switches to a different node:
1. The active editor's pending save (if any) is flushed synchronously.
2. The existing `EditorView` is `destroy()`ed.
3. A fresh `EditorView` is built from the new node's body and mounted.

This prevents React↔CM6 feedback loops, avoids cursor-reset jitter on
state changes, and scales cleanly to 50KB+ bodies (no per-keystroke
React re-renders, no full-string comparisons). Matches the
`@uiw/react-codemirror` production pattern and Obsidian's architecture.

### 4.2 Ownership summary

| Concern | Owner |
|---|---|
| Hierarchy (tree state, expansion, drag-drop) | `Tree.tsx` (flat list in memory, built from `list_children`) |
| Doc body (markdown) | CM6 `EditorState.doc` inside `MarkdownEditor.tsx` |
| Active-node id | `NotesView.tsx` (via `useState`, passed down) |
| Autosave debounce + conflict state machine | `MarkdownEditor.tsx` (per-editor-session) |
| Backlinks | `BacklinksPane.tsx` (re-fetches on activeNodeId change) |
| UI preferences (future: split ratio, last-selected node) | deferred to a later W phase — in-memory only for W2 |

No new Zustand stores. No new VaultContext fields (per Rule 2).

### 4.3 CM6 extension stack

Assembled once and reused by every `EditorView` mount:

```ts
const makeExtensions = (opts: EditorOptions) => [
  // Core
  EditorView.lineWrapping,
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap,
            indentWithTab]),
  // Markdown + GFM
  markdown({ base: markdownLanguage, extensions: [GFM] }),
  // Completion: slash + wikilink
  autocompletion({
    override: [slashCompletionSource(), wikilinkCompletionSource()],
    activateOnTyping: true,
  }),
  // Voice-memo pill decoration
  voiceMemoPillPlugin(opts.onPlayRequest),
  // node:// link click interception
  nodeLinkClickPlugin(opts.onNodeLinkClick),
  // Autosave — fires the debounced save on every user-initiated doc change
  autosavePlugin(opts.onPersist, opts.onDirtyChange),
  // Theme — maps CM6 selectors to var(--heros-*) tokens
  EditorView.theme(herosEditorTheme),
]
```

### 4.4 Data flow — save path

```
user types
  → CM6 updates EditorState.doc
    → autosavePlugin.updateListener fires
      → debounce(300ms) → onPersist(doc.toString(), lastSeenMtime)
        → commands.updateNode({ id, name, icon, properties, body, lastSeenMtimeSecs })
          → Rust writes DB row + vault .md via write_node_to_vault
            → on success: lastSeenMtime ← fresh server-returned updated_at
            → on ExternalEditConflict: flip conflict state, pause autosave
```

### 4.5 Data flow — node switch

```
user clicks tree row or presses arrow/enter
  → NotesView.setActiveNodeId(newId)
    → MarkdownEditor.useEffect([nodeId]):
       1. flush pending save (synchronous debounced fn cancel + immediate save)
       2. view.destroy()
       3. const { body, updatedAt } = await getNode(newId)
       4. state = EditorState.create({ doc: body, extensions })
       5. view = new EditorView({ state, parent: editorRef })
    → BacklinksPane.useEffect([nodeId]):
       1. const links = await getBacklinks(newId)
       2. setBacklinks(links)
```

---

## 5. File inventory

### New files

| Path | Purpose |
|---|---|
| `src/components/Tree.tsx` | Workspace tree — filter, drag-drop, keyboard nav, context menu |
| `src/components/MarkdownEditor.tsx` | CM6 editor wrapping markdown + GFM + slash + wikilink + voice-memo + autosave |
| `src/components/BacklinksPane.tsx` | Right-column pane listing docs that link to the active node |
| `src/editor/slashCompletion.ts` | Wraps `slashCommands.ts` in the CM6 autocomplete source (moved from inline in `slashCommands.ts`) — see §7.1 |
| `src/editor/wikilinkCompletion.ts` | CM6 autocomplete source for `[[` — debounced `search_workspace_title` |
| `src/editor/voiceMemoPill.ts` | CM6 ViewPlugin that decorates `::voice_memo_recording{path=…}` directives as interactive pills |
| `src/editor/nodeLinkClick.ts` | CM6 ViewPlugin that intercepts clicks on `node://<uuid>` href rendered links and routes via `onNodeLinkClick` |
| `src/editor/autosavePlugin.ts` | CM6 `updateListener` with 300ms debounce + save callback + dirty state |
| `src/editor/herosTheme.ts` | CM6 `EditorView.theme` mapping `.cm-*` selectors to `var(--heros-*)` tokens |
| `src/utils/pathsExist.ts` | Shared `pathsExist(paths: string[]): Promise<Set<string>>` utility extracted from `AudioView.tsx` (same implementation) so the voice-memo pill can use it without depending on AudioView |
| `src/editor/commands/today.ts` | `/today` slash command — calls existing `get_or_create_daily_note` (Tier 2, ships in W2) |
| `src/editor/commands/link.ts` | `/link` — inserts `[[` to trigger wikilink autocomplete (Tier 2, ships in W2) |
| `src/styles/notes.css` | Concern file for `.notes-*`, `.tree-row*`, `.editor-*` classes |
| `src/editor/__tests__/slashCompletion.test.ts` | Unit tests: line-start guard, query match, insertion dispatch |
| `src/editor/__tests__/voiceMemoPill.test.ts` | Unit tests: directive parse + widget range detection |
| `src/editor/__tests__/autosavePlugin.test.ts` | Unit tests: debounce timing, flush-on-unmount |
| `src/editor/__tests__/conflictStateMachine.test.ts` | Unit tests: idle → saving → conflicted transitions |

### Modified files

| Path | Change |
|---|---|
| `src/components/NotesView.tsx` | Replace inner content with `<Tree />` + `<MarkdownEditor />` + `<BacklinksPane />`. Keep outer `.heros-page-container` intact. Delete eBay `sideNotes`, `handleCommit`, `findNoteById`, inline editor, split-drag logic |
| `src/editor/slashCommands.ts` | Split `slashCompletionSource` out into `src/editor/slashCompletion.ts` so Tier 2 commands plug in via a single registry. Keep Tier 1 list here. |
| `src/components/AppShell.tsx` | Wire `Cmd+N` → `notesView.createRootDoc()` when `currentPage === 'notes'`; wire `Cmd+Shift+J` → open today's daily note |
| `package.json` | Add `codemirror`, `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `@codemirror/language`, `@codemirror/search`, `@codemirror/lang-markdown`, `@codemirror/autocomplete`, `@lezer/markdown`. Versions pinned to current stable — **no** `Agentz360/secure-lang-markdown` |
| `src/components/AudioView.tsx` | Extract `pathsExist(paths: string[])` from the local module scope into a new `src/utils/pathsExist.ts` and import from both AudioView and the voice-memo pill module. No behaviour change. |

### Deleted files

None in W2 proper. The legacy eBay `VaultSidebar.tsx` remains referenced
by other dormant views (per Cosmetic-Port Discipline) — W7 cleanup
decides whether to delete. `NotesView` just stops importing it.

### Summary counts

- **14 new files**: 3 React components + 6 editor extensions + 2
  Tier 2 slash commands (`today`, `link`) + 1 stylesheet + 1 shared
  util + 4 test files. The other three Tier 2 commands (`/voice`,
  `/database`, `/embed`) are **not** stubbed; they land in their own
  follow-up phase (tracked in PLAN.md's W2.5 block).
- **5 modified files**: `NotesView.tsx` (rewrite), `slashCommands.ts`
  (split), `AppShell.tsx` (keyboard wiring), `package.json` (CM6
  deps), `AudioView.tsx` (extract `pathsExist`).
- **0 deletions.**

---

## 6. Component specs

### 6.1 `Tree.tsx`

**Props:**
```ts
interface TreeProps {
  activeNodeId: string | null
  onSelect: (nodeId: string) => void
  onRequestCreateRoot: () => Promise<void>
  onRequestCreateChild: (parentId: string) => Promise<void>
  onRequestCreateFolder: () => Promise<void>  // root-level doc with 📁 icon
}
```

**State (local, `useReducer`):**
```ts
type TreeState = {
  nodes: Map<string, WorkspaceNode>    // flat, keyed by id
  childrenByParent: Map<string, string[]>  // parent_id (or "__root__") → ordered ids
  expanded: Set<string>                 // expanded parent ids
  filter: string                        // current filter text, empty = no filter
  loading: boolean
  error: string | null
}
```

**Loading:**
- On mount: `get_root_nodes()` → populate root. Root-level ids are
  stored under key `"__root__"` in `childrenByParent`.
- On caret expand: if children not yet loaded for a parent,
  `get_node_children(parentId)` → populate. Expanded set persisted
  only in-memory for W2.

**Filter:**
- Controlled `HerOSInput` bound to `state.filter`.
- Match = `node.name.toLowerCase().includes(filter.toLowerCase())`.
- When filter non-empty: render the subset of matched nodes PLUS
  their ancestor chain (so hierarchy reads sensibly). Non-matching
  leaves are hidden.
- Rendering a node with no matched descendants and no self-match →
  hidden.

**Drag-drop:**
- `@dnd-kit/core` `DndContext` wraps the tree; `@dnd-kit/sortable`
  `SortableContext` with `verticalListSortingStrategy` over the
  flattened visible list.
- Every row is a `useSortable({ id })` row with depth-aware padding.
- `DragOverlay` renders a portaled ghost during drag.
- On drop:
  1. Compute new `parent_id` from the drop target's depth +
     predecessor sibling's parent.
  2. Compute new `position` = midpoint of the two adjacent siblings'
     positions (`(a + b) / 2.0`). For drop at end: `last + 1.0`. For
     drop at start: `first - 1.0` (Rust clamps negatives to valid
     float positions — no need to floor).
  3. Call `move_node({ id, parent_id, position })`. On success
     refresh siblings (the moved node's new parent + old parent if
     different) from `get_node_children`.
  4. On error: toast + revert optimistic state.

**Keyboard nav** (per CLAUDE.md's Keyboard Contracts section):
- `↑ / ↓`: select prev / next visible row.
- `← / →`: collapse / expand. At collapsed state on `←`, jump to parent.
- `Enter`: `onSelect(focusedId)` (opens the doc in the editor).
- `Delete` / `Backspace`: `delete_node(focusedId)` (soft delete, moves
  to trash, row animates out). `Cmd/Ctrl+Z` undo not wired in W2 —
  Trash recovery in Settings is the recovery path.
- `F2` or `Enter` while already-selected: inline rename. For W2,
  rename mode lets the user edit the name inline; on blur/Enter it
  calls `update_node({ id, name, icon, properties, body, last_seen_mtime_secs })`
  — we fetch the fresh body + mtime from server first to honour Rule 13.

**Context menu** (right-click or `⋯` on hover):
- New child document
- Rename (enters inline rename mode)
- Delete (soft)
- Copy wikilink (`[title](node://<uuid>)` to clipboard)

**Windowing:**
- `@tanstack/react-virtual` (already in `package.json`) over the
  flattened visible rows when total visible count exceeds 500.
  Threshold matches the table-virtualization threshold in CLAUDE.md
  Performance Targets.

**Header actions (top of left pane):**
- `HerOSInput` filter (icon: Search from lucide)
- "+ New Document" button → `onRequestCreateRoot()`
- "+ New Folder" button → `onRequestCreateFolder()`

### 6.2 `MarkdownEditor.tsx`

**Props:**
```ts
interface MarkdownEditorProps {
  nodeId: string
  onNodeLinkClick: (nodeId: string) => void    // routes via NotesView
  onDirtyChange?: (dirty: boolean) => void
}
```

**Internal state:**
```ts
const viewRef = useRef<EditorView | null>(null)
const lastSeenMtimeRef = useRef<number | null>(null)
const [conflict, setConflict] = useState<{ diskMtime: number } | null>(null)
const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
const [savedAt, setSavedAt] = useState<number | null>(null)
```

**Mount / unmount lifecycle:**
- `useEffect([nodeId])`: tears down the previous view, fetches the
  node, builds a new `EditorState` + `EditorView`. Captures
  `lastSeenMtimeRef.current = node.updated_at` for the Rule 13 guard.
- `useEffect` cleanup on unmount: flush pending save, destroy view,
  null refs.

**Autosave:**
- `autosavePlugin` registers an `EditorView.updateListener`. On every
  `update.docChanged && update.transactions.some(tr => tr.isUserEvent('input.type') || ...)`,
  mark dirty, schedule `doSave(view.state.doc.toString(), lastSeenMtimeRef.current)` on a 300ms
  debounce.
- Before firing, coalesce with any in-flight save (cancel the prior,
  fire with latest content).

**Save call:**
```ts
const doSave = async (body: string, lastSeenMtime: number | null) => {
  setSaveState('saving')
  const node = await commands.getNode(nodeId)  // use cached name/icon/props
  if (node.status !== 'ok' || !node.data) { setSaveState('error'); return }
  const res = await commands.updateNode({
    id: nodeId,
    name: node.data.name,
    icon: node.data.icon,
    properties: node.data.properties,
    body,
    lastSeenMtimeSecs: lastSeenMtime,
  })
  if (res.status !== 'ok') {
    if (isExternalEditConflictError(res.error)) {
      const diskMtime = parseConflictDiskMtime(res.error)
      setConflict({ diskMtime })
      setSaveState('error')
      return
    }
    toast.error('Save failed', { description: res.error })
    setSaveState('error')
    return
  }
  lastSeenMtimeRef.current = res.data.updated_at
  setSavedAt(Date.now())
  setSaveState('saved')
  // Fade "Saved" indicator after 2s
  window.setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2000)
}
```

**Conflict banner state machine:**
- `idle → saving → saved/error → idle`
- `saving → conflicted` (when `update_node` returns ExternalEditConflict)
- `conflicted`: autosave is paused. Editor remains editable (user can
  continue typing; changes are in-memory only).
- `conflicted → [Reload] → idle`:
  1. Discard in-memory changes. Fetch `getNode(nodeId)`.
  2. Replace CM6 doc (`view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: node.body } })`).
  3. `lastSeenMtimeRef.current = node.updated_at`
  4. `setConflict(null)`, resume autosave.
- `conflicted → [Keep mine] → saving`:
  1. `lastSeenMtimeRef.current = conflict.diskMtime` (adopt on-disk
     mtime as our baseline, next save wins).
  2. `setConflict(null)`, trigger immediate save.

**Diff button**: disabled with tooltip "coming in a later release" in v1.

**Conflict error marshalling (Rust ↔ TS) — verified against source:**

Rust currently returns `Result<T, String>` and the Rule 13 guard IS
already implemented at
[workspace_manager.rs:1659-1677](../../../src-tauri/src/managers/workspace/workspace_manager.rs:1659).
On conflict the error string is:

```
VAULT_CONFLICT:{"node_id":"<uuid>","disk_mtime_secs":<i64>,"last_seen_secs":<i64>}
```

Frontend detects conflicts by testing `error.startsWith('VAULT_CONFLICT:')`
and parses the JSON payload after the colon. `disk_mtime_secs` becomes
the new `lastSeenMtimeRef.current` if the user chooses "Keep mine"
(§6.2 state machine).

No Rust changes required — the error format is already stable.

**Keyboard bindings (scoped to the editor):**
- `Cmd/Ctrl+S`: flush pending save immediately (skip debounce), show
  "Saving…" indicator.
- The global `Cmd+N`, `Cmd/Ctrl+[`, `Cmd/Ctrl+L`, `Cmd+=/-/0` are
  handled by `AppShell`, not the editor. CM6 doesn't swallow them.

**Slash commands:** See §7.1.

**Wikilink autocomplete:** See §7.2.

**Voice-memo pill:** See §7.3.

**`node://` link interception:** See §7.4.

**Footer:** Right-aligned `saveState` text:
- `'idle' | null` → empty
- `'saving'` → `Saving…` (muted colour)
- `'saved'` → `Saved 2:43 PM` (success colour, fades to `idle` after 2s)
- `'error'` + no conflict → `Save failed — click to retry` (brand red,
  clicking triggers immediate retry)

### 6.3 `BacklinksPane.tsx`

**Props:**
```ts
interface BacklinksPaneProps {
  activeNodeId: string | null
  onSelect: (nodeId: string) => void
}
```

**Behaviour:**
- On `activeNodeId` change: `await commands.getBacklinks(activeNodeId)`.
- Renders a list of linking nodes — each row is clickable (delegates
  to `onSelect`).
- Empty state: "No backlinks yet. Link to this doc from another note
  with `[[` and it'll appear here."

Minimal component — ~80 lines. Uses `.heros-glass-card` for its container.

### 6.4 `NotesView.tsx` (rewrite)

**Scope:**
- Keep the outer `.heros-page-container` + `.heros-glass-panel` wrapper
  intact (per W2 task brief + HerOS Design System rules).
- Inner content: `grid-template-columns: 240px 1fr 280px` —
  `<Tree />` / `<MarkdownEditor />` / `<BacklinksPane />`.
- Split is static in W2 (no user-resizable drag handle). If that
  becomes painful, add `react-resizable-panels` (already in
  `package.json`) in a later W-phase.
- Owns `activeNodeId` state + the create/delete callbacks that
  `Tree` calls.

**Node creation flow:**
```ts
const handleCreateRoot = async () => {
  const res = await commands.createNode({
    parentId: null, nodeType: 'document', name: 'Untitled'
  })
  if (res.status !== 'ok') { toast.error('Could not create doc'); return }
  setActiveNodeId(res.data.id)
  // MarkdownEditor will mount with title input focused + selected
  // (controlled via a ref callback passed down to MarkdownEditor)
}
```

**Title rendering:** The editor shows the node's `name` in a text
input ABOVE the CM6 area (separate from CM6 because the title is a
first-class DB column, not part of the markdown body). Rename = call
`update_node({ name: newName, body: currentBody, … })`.

---

## 7. Editor extensions in detail

### 7.1 Slash commands

Existing `src/editor/slashCommands.ts` already ships Tier 1 (10 block
primitives) + the completion source. W2 additions:

- **Extract** the `slashCompletionSource` function into
  `src/editor/slashCompletion.ts` so Tier 2 commands can plug in via
  a registry pattern. The catalog file stays the source of truth for
  which commands exist.
- **Tier 2 scope for W2:** ship `/link` + `/today` — both are cheap
  (one Rust call each, no new backend). Defer `/voice`, `/database`,
  `/embed` to W2.5 (`/voice` overlaps the recording UX; `/database`
  needs W4; `/embed` needs a transclusion renderer).
- **Line-start guard**: already implemented. Tests added in
  `src/editor/__tests__/slashCompletion.test.ts`.

### 7.2 Wikilink autocomplete

A second `@codemirror/autocomplete` source, `wikilinkCompletionSource`,
triggers when the text before the caret matches `/\[\[([^\]]*)$/`.

- Debounce 150ms. On every match, call
  `commands.searchWorkspaceTitle(query, 10)`.
- Completion options render title + node type indicator.
- **Apply**: replace `[[query` with `[title](node://<uuid>)`. Caret
  lands immediately after the closing `)`.
- **Empty query** (just `[[`): show the 10 most-recently-updated docs
  (the title search returns server-ordered results already).

### 7.3 Voice-memo pill Lezer decoration

`voiceMemoPillPlugin` is a `ViewPlugin` that builds a `DecorationSet`:

1. Iterate the Lezer tree; find every text node matching
   `::voice_memo_recording{path="…"}`. (Simpler than a grammar
   extension: plain regex scan of the visible viewport's doc slice,
   re-run on `update.docChanged`.)
2. For each match, produce a `Decoration.replace({ widget: new
   VoiceMemoWidget(path, ...) })` spanning the directive's range.
3. The widget DOM: identical structure to AudioView's `<PlayButton>` +
   transcript-snippet (shortened to ~120 chars), same state table
   (no-audio / unavailable / loading / playing / idle).
4. Widget uses `convertFileSrc(path)` + a singleton `<audio>` element
   that lives on a module-level ref inside the pill module (independent
   of AudioView's singleton — two editors on two different nodes
   could have two different pills playing, but W2 keeps it simple
   with a single pill playing at a time).

**Unavailable state:** On mount, pill checks `pathsExist([path])`
once. If `path` is missing, pill renders in `unavailable` state.
Click retries — if the file is now there, flip to `idle`.

### 7.4 `node://` link click interception

CM6 renders source text with syntax highlighting, not rendered HTML —
there are no `<a>` tags to hook a browser click handler on. Instead,
use a Lezer-backed **mark decoration**:

1. `nodeLinkPlugin` is a `ViewPlugin` that walks the syntax tree via
   `syntaxTree(view.state).iterate(…)`, looking for Lezer nodes of
   type `URL` whose text matches `/^node:\/\/[0-9a-f-]+$/`.
2. For each match, attach a `Decoration.mark({ class: "cm-node-link",
   attributes: { "data-node-id": <uuid> } })` to the URL range and
   optionally also to the link's title-text range so the whole
   `[title](node://uuid)` surface reads as clickable.
3. `view.dom.addEventListener('click', …)` handler in the same plugin
   walks up from `ev.target` to find the nearest `[data-node-id]`
   element. If found → `ev.preventDefault()` + `onNodeLinkClick(id)`.
4. The `.cm-node-link` CSS class in `src/styles/notes.css` gives the
   mark a hover cursor + the HerOS brand accent on hover, so users
   can see a decorated link is clickable in the source view.

The raw markdown on disk stays `[title](node://<uuid>)` — no mutation.
Click routing is purely a render-time decoration.

`NotesView` passes `onNodeLinkClick = (id) => setActiveNodeId(id)`. In
a later W-phase the same callback could route across pages (e.g.
link into a database row under W4).

### 7.5 HerOS theme

`herosEditorTheme` maps CM6 selectors to HerOS tokens:

```ts
export const herosEditorTheme = EditorView.theme({
  '&': { color: 'var(--heros-text)', backgroundColor: 'transparent' },
  '.cm-content': { fontFamily: 'var(--font-sans)', padding: 'var(--space-6) 0' },
  '.cm-editor': { fontSize: 'var(--text-base)', lineHeight: 'var(--leading-relaxed)' },
  '.cm-focused': { outline: 'none' },
  '.cm-line': { padding: '0 var(--space-6)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--surface-accent)' },
  // Headings
  '.cm-line:has(.tok-heading1)': { fontSize: 'var(--text-3xl)', fontWeight: 300 },
  '.cm-line:has(.tok-heading2)': { fontSize: 'var(--text-2xl)', fontWeight: 400 },
  '.cm-line:has(.tok-heading3)': { fontSize: 'var(--text-xl)', fontWeight: 500 },
  // Code
  '.cm-line:has(.tok-monospace)': { fontFamily: 'var(--font-mono)' },
  // Autocomplete popup (override to match HerOS)
  '.cm-tooltip-autocomplete': {
    background: 'var(--surface-container)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 'var(--radius-container)',
    boxShadow: 'var(--shadow-md)',
  },
})
```

All colours, radii, and spacing come from `var(--heros-*)` or `--space-*` tokens. Zero literals.

---

## 8. Raw-markdown vault file contract (Rule 10 re-stated)

The CM6 `EditorState.doc.toString()` IS the raw markdown written to:

1. **`workspace_nodes.body`** (SQLite) via `update_node`.
2. **`<vault_root>/<vault_rel_path>.md`** (vault file) via Rust's
   existing `write_node_to_vault` (temp-write + atomic rename).

No JSON serialisation, no rich-text round-trip, no synthetic YAML
inserted by the editor. The file a user sees in their vault folder
via Finder / Explorer is byte-identical to the editor's text.

**Slash-command insertions produce canonical markdown** (e.g. `# `,
`- [ ] `, `| col | col |\n| --- | --- |`). No HTML, no data-attributes,
no `<div>` wrappers. Opening the file in any plain-text editor or on
GitHub shows exactly what the user sees.

**Voice-memo directives** remain as the existing custom directive:
`::voice_memo_recording{path="…"}`. The pill is a *render-time*
decoration — the raw directive stays in the source markdown. Users
who read the vault file outside Handy see the directive (which is
the acceptable trade for keeping voice-memo provenance).

**Wikilinks** render as `[title](node://<uuid>)` — valid inline
markdown links. Third-party markdown tools render them as plain
links; they lose the node-routing behaviour but the file is still
valid markdown. Frontend's `node://` click interceptor only fires
inside Handy.

**Frontmatter is Rust-managed metadata, invisible to CM6** — verified
against [workspace_manager.rs:1609](../../../src-tauri/src/managers/workspace/workspace_manager.rs:1609)
and [app_identity.rs:127](../../../src-tauri/src/app_identity.rs:127).

Every document node's on-disk `.md` file has this shape:

```markdown
---
id: <uuid>
parent_id: <uuid-or-null>
title: <name>
icon: <emoji>
created_at: <rfc3339>
updated_at: <rfc3339>
properties_json: '<…>'
vault_version: 1
---
<body — raw markdown, what the user typed>
```

- **On write:** Rust synthesises the frontmatter from `WorkspaceNode`
  fields. CM6 supplies only the body. The frontend never touches
  frontmatter.
- **On read:** `read_markdown_body_from_vault_file` strips the
  frontmatter and returns just the body, which is what `get_node`
  puts into `node.body` and what CM6 renders.
- **Rule 10 compliance:** `node.body` — the thing CM6 edits — is raw
  markdown. The frontmatter is metadata, not content, and round-trips
  cleanly without touching the user's words.
- **User opens the vault `.md` in a third-party editor:** they see a
  standard YAML-frontmatter markdown file (same convention Obsidian /
  Jekyll / Hugo use). Fully portable.

Database row nodes (W4) have their own frontmatter conventions per
vault-database-storage.md; not in scope for W2.

---

## 9. Error handling

| Condition | Surface |
|---|---|
| `list_children` / `get_node` fails on tree load | Inline error message in tree pane; retry button |
| `create_node` fails | Sonner toast + no state change |
| `update_node` ExternalEditConflict | Inline banner (§6.2 state machine) |
| `update_node` any other error | Sonner toast + `saveState = 'error'` in footer |
| `get_backlinks` fails | Silent: Backlinks pane shows empty state |
| `search_workspace_title` fails during wikilink autocomplete | Autocomplete shows empty list; no toast (autocomplete failures should be invisible) |
| Voice-memo audio missing | Pill shows unavailable state (§7.3) |
| `move_node` fails | Toast + revert optimistic state |

No silent data loss. Every write path has visible failure.

---

## 10. Testing strategy

### 10.1 Vitest (pure pieces)

| File | What it tests |
|---|---|
| `slashCompletion.test.ts` | Line-start guard (no trigger mid-sentence), query-prefix match, aliases, case-insensitive, `apply` dispatch moves caret correctly |
| `wikilinkCompletion.test.ts` | Trigger regex `\[\[([^\]]*)$`, debounce behaviour, selection inserts correct markdown |
| `voiceMemoPill.test.ts` | Directive parse from editor state; widget range for single / multiple directives per doc; handles malformed directives (no crash) |
| `autosavePlugin.test.ts` | 300ms debounce; immediate-flush on `Cmd+S`; cancellation + coalescing of overlapping saves |
| `conflictStateMachine.test.ts` | idle → saving → conflicted transitions; Reload resets mtime + body; Keep mine adopts disk mtime + fires immediate save; saves paused while conflicted |
| `src/components/__tests__/Tree.test.tsx` | Filter substring match; caret expand/collapse; keyboard nav (↑/↓/←/→/Enter/Delete); drag-drop position math (midpoint / start / end) |

CM6-dependent tests mount `EditorView` via jsdom — we already have
jsdom configured (`devDependencies.jsdom`) and Vitest set up.

### 10.2 `cargo test --lib`

No new Rust code expected for W2 unless the `ExternalEditConflict`
error string needs a prefix tweak — in which case add a regression
test in `workspace_manager` module.

### 10.3 End-to-end via preview tools

After implementation, use `preview_start` + `preview_*` to verify:

1. **Create + edit**: Cmd+N → new doc → type → wait 300ms → reload
   page → body persists.
2. **Switch nodes**: open A, type, switch to B → A's body persisted,
   B's body loads fresh.
3. **Slash command**: type `/table` → menu opens → select → 2x2 table
   inserted with caret in first cell.
4. **Wikilink**: type `[[proj` → menu shows matching docs → select →
   inserted as `[title](node://<uuid>)` → click the rendered link →
   routes to that doc.
5. **Voice memo pill**: open a doc with `::voice_memo_recording{…}` —
   pill renders, click plays audio, raw markdown preserved on save.
6. **Delete**: select tree row → Delete key → node disappears, trash
   count increments.
7. **Drag**: drag node A above B → `move_node` fires with correct
   midpoint → refresh → order persists.
8. **External edit conflict**: with app open, externally edit the `.md`
   → alt-tab back → banner appears → Reload loads disk body → Keep
   mine overwrites it.

---

## 11. Performance

Per CLAUDE.md Performance Targets, W2 must hit:

| Target | Strategy |
|---|---|
| Tree load 1,000 nodes < 100ms | One flat `get_root_nodes` call + Map index; no per-row async |
| Tree load 10,000 nodes < 400ms | `@tanstack/react-virtual` kicks in past 500 visible rows |
| Page open < 200ms | Lazy-load children only on caret expand; editor view built synchronously after body fetch |
| Autosave roundtrip < 200ms for ≤50KB | 300ms debounce ceiling; CM6 `doc.toString()` on 50KB is ~1ms; Rust write is the hot path |

Tracked via a dev-only `performance.mark` / `performance.measure` sweep
during implementation verification; removed before commit.

---

## 12. Out of scope (deferred)

- AI/LLM features (W6)
- Multi-pane / split view (CLAUDE.md Deferred list)
- Real-time collaborative editing (Deferred)
- Graph view (data exists, UI deferred)
- Column resize / custom split-pane ratios in `NotesView`
- Open-diff view in conflict banner (v2)
- Tier 2 slash commands other than `/link` and `/today`
- Rebalance-on-gap-shrink command — build only if needed
- Settings for the editor (font size, line-wrap toggle, vim mode) —
  W5

---

## 13. Open risks

1. ~~**ExternalEditConflict error marshalling**~~ — **Resolved during
   self-review.** Verified the Rust-side format against source:
   error string is `VAULT_CONFLICT:{json}` (see §6.2). No backend
   changes required; frontend pattern-matches the `VAULT_CONFLICT:`
   prefix.
2. **CM6 + React 19 compat** — React 19 is in `package.json`.
   `@codemirror/view` uses its own DOM ownership, which is fine, but
   a careful pattern is needed for strict-mode double-invocation in
   dev. Mitigation: all view setup in `useEffect` with proper cleanup;
   `useRef` for imperative handles; never touch DOM in render.
3. **Lezer tree traversal cost on large docs** — scanning the full
   Lezer tree on every update is O(n). Mitigation: restrict the voice-
   memo pill scan to the visible viewport slice (CM6 gives us
   `view.visibleRanges`).
4. **Drag + virtualization interaction** — `@dnd-kit` and
   `react-virtual` can fight (overlay DOM vs. windowed row DOM).
   Mitigation: if virtual kicks in (>500 visible), fall back to a
   non-virtualized render during active drag (temporary; up to ~500ms
   drag duration). Detect active drag via `useDndMonitor`.
5. **Conflict while the editor is unmounted** — If the user switches
   to another doc and Rule 13 fires the conflict on the previous
   doc's final save, the banner has no mount point. Mitigation: flush
   pending save synchronously in the `useEffect` cleanup (before
   `view.destroy()`), and surface any conflict via a Sonner toast
   with a "Reopen and resolve" action that sets `activeNodeId` back.

---

## 14. Done criteria (copy from task brief)

1. `bun run build` zero new errors
2. `cargo test --lib` green (125-test baseline held)
3. `bunx vitest run` green, with new tests in §10.1
4. `bun run tauri dev` boots; all §10.3 E2E scenarios pass
5. Performance targets in §11 met
6. No hardcoded colours / radii / px in any new file (Rule 12 + 18)
7. Conflict banner functional for Reload + Keep mine

## 15. Post-ship

- Update PLAN.md W2 block to ✅ SHIPPED with commit refs
- Confirm PLAN.md's W2.5 block covers `/voice`, `/database`,
  `/embed` Tier 2 slash commands and the conflict-banner diff view
  (those stub files are intentionally NOT created in W2 — the
  registry shape should be obvious once W2.5 kicks off)
- Add a pitfall.md entry if the CM6 + React 19 strict-mode dance
  turns out to have gotchas worth remembering
