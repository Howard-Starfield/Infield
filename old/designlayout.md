# Handy Workspace — Design Layout Document

> **Purpose:** Provide LLM design partners with complete context on the current backend architecture,
> frontend component tree, design token system, and navigation flows — so they can propose a
> professional redesign that respects the existing warm editorial aesthetic.

---

## 1. Backend & Stack

### 1.1 Framework & Runtime

| Layer | Technology |
|-------|------------|
| Desktop framework | **Tauri 2.x** (Rust backend + WebView frontend) |
| Frontend runtime | React 18 + Vite |
| Async runtime | Tokio |
| State (frontend) | Zustand with Immer |
| Database | SQLite (WAL mode) |

### 1.2 Rust Backend Structure

```
src-tauri/src/
├── main.rs                  # Entry point
├── lib.rs                   # Command registration, plugin setup, app init
├── commands/                # Tauri command handlers
│   ├── workspace_nodes.rs   # Node CRUD: create_node, get_node, update_node, delete_node, move_node
│   └── search.rs            # search_notes_hybrid, search_workspace_hybrid
└── managers/                # Business logic
    ├── workspace/
    │   ├── workspace_manager.rs   # Core workspace CRUD, FTS sync
    │   └── node_types.rs         # Node type definitions
    ├── database/
    │   └── manager.rs            # Database schema, fields, rows, cells, views
    ├── search.rs                 # SearchManager (hybrid FTS + usearch RRF)
    ├── vector_store.rs           # usearch vector index
    ├── embedding_worker.rs       # Background chunking + embedding pipeline
    └── notes.rs                  # Legacy notes manager (do not extend)
```

### 1.3 Database Schema

**`workspace.db`** (canonical — used by all new features):

```sql
-- Nodes: documents, databases, rows
workspace_nodes (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES workspace_nodes(id) ON DELETE CASCADE,
  node_type TEXT CHECK(node_type IN ('document','database','row')),
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📄',
  position REAL NOT NULL DEFAULT 0.0,   -- Fractional indexing
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  properties TEXT NOT NULL DEFAULT '{}', -- JSON: cell data for rows, field defs for databases
  body TEXT NOT NULL DEFAULT ''          -- Raw markdown (never JSON)
)

-- Views per database
node_views (
  id TEXT PRIMARY KEY,
  node_id TEXT REFERENCES workspace_nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  layout TEXT CHECK(layout IN ('board','grid','calendar','list','table','gallery')),
  position REAL NOT NULL DEFAULT 0.0,
  color TEXT,
  filters TEXT DEFAULT '[]',
  sorts TEXT DEFAULT '[]',
  view_options TEXT DEFAULT '{}'
)

-- Full-text search
workspace_fts USING fts5(node_id, title, body)  -- title = name, body = body

-- Wikilinks
page_links (source_node_id, target_node_id)

-- User preferences
user_preferences (key PRIMARY KEY, value)
```

**Field types** supported in databases: `RichText`, `Number`, `DateTime`, `SingleSelect`, `MultiSelect`, `Checkbox`, `Url`, `Checklist`, `Media`, `Date`, `Time`, `LastEditedTime`, `CreatedTime`, `Protected`.

### 1.4 Tauri Command Conventions

- snake_case names: `get_node`, `update_node`, `ws_update_cell`
- All commands auto-generated via **specta** → `src/bindings.ts`
- Frontend calls via `invoke()` from `@tauri-apps/api/core`
- Return type: `Result<T, String>`

**Key commands:**

| Command | Purpose |
|---------|---------|
| `create_node`, `get_node`, `update_node`, `delete_node`, `move_node` | Node lifecycle |
| `get_node_children`, `get_root_nodes` | Tree loading (single flat query, build in JS) |
| `create_node_view`, `get_node_views`, `update_node_view` | View management |
| `ws_update_cell`, `ws_get_cell` | Cell read/write |
| `ws_add_field`, `ws_set_field_type`, `ws_delete_field` | Schema changes |
| `get_or_create_daily_note` | Daily note routing |
| `search_workspace_hybrid` | FTS + vector hybrid search |
| `get_user_preference`, `set_user_preference` | Appearance persistence |

### 1.5 Search Stack

| Component | Location | Role |
|-----------|----------|------|
| `usearch` | Cargo dependency | Vector similarity |
| `workspace_fts` | SQLite FTS5 | Full-text search on workspace nodes |
| `EmbeddingWorker` | `managers/embedding_worker.rs` | Background embed pipeline |
| `SearchManager` | `managers/search.rs` | Hybrid FTS + vector via RRF |

Eligible nodes for indexing: `node_type IN ('document', 'row')` AND `deleted_at IS NULL`.

---

## 2. Frontend Layout & Component Tree

### 2.1 Top-Level Architecture

```
App
└── WorkspaceLayout           # Main router — branches on node_type
    ├── DocumentView         # node_type = 'document'
    │   └── DocumentEditor
    │       ├── TopBar (36px)
    │       │   ├── Breadcrumb
    │       │   ├── Save Status
    │       │   └── Sidenotes / AI toggles
    │       ├── Scroll Area
    │       │   ├── Title textarea
    │       │   ├── Metadata pills (date, word count)
    │       │   ├── MDXEditorView (markdown editor)
    │       │   └── BacklinksSection
    │       └── Optional Side Panel (resizable)
    │
    ├── DatabaseView          # node_type = 'database'
    │   └── DatabaseShell
    │       ├── Cover (optional, 120px)
    │       ├── DatabaseHeader (name, icon)
    │       ├── ViewSwitcher (tab strip)
    │       ├── AddViewPopover
    │       ├── ViewTabContextMenu
    │       └── Active View Content
    │           ├── GridView        (GlideDataGrid) ← default
    │           ├── BoardView       (dnd-kit)
    │           ├── CalendarView    (schedule-x)
    │           ├── ChartView       (Recharts)
    │           ├── ListView        (custom)
    │           └── GalleryView     (custom)
    │
    └── RowPageView           # node_type = 'row'
        ├── Row Header
        ├── Body (raw markdown via MDXEditorView)
        └── PropertiesSidebar (field-value pairs)
```

### 2.2 Sidebar (WorkspaceTree)

```
WorkspaceTree (left sidebar)
├── SidebarHeader ("Handy", workspace name)
├── SidebarSection ("Pages")
│   └── SidebarItem (recursive, depth-indented)
│       ├── Chevron (expander)
│       ├── Icon (emoji)
│       ├── Name (truncated)
│       └── Hover actions (+, ⋯)
└── SidebarFooter (New document, Settings)
```

The tree is loaded with a **single flat query** — no recursive SQL:

```sql
SELECT id, name, node_type, parent_id, position, icon, deleted_at
FROM   workspace_nodes
WHERE  deleted_at IS NULL
ORDER  BY parent_id, position;
```

JS builds the parent→children map. Bodies are **never loaded** during tree init.

### 2.3 State Management

| Store | File | Responsibility |
|-------|------|----------------|
| `workspaceStore` | `stores/workspaceStore.ts` | Navigation, active node, history stack, tree |
| `databaseStore` | `stores/databaseStore.ts` | Fields, rows, cells (legacy calendar still uses it) |
| `workspaceAppearanceStore` | `stores/workspaceAppearanceStore.ts` | Theme, density, CSS override tokens |
| `settingsStore` | `stores/settingsStore.ts` | App settings |

**Navigation pattern** (the ONLY correct way):

```typescript
// Navigate to any node
workspaceStore.navigateTo(nodeId, { viewId?, source? })
workspaceStore.goBack()   // uses internal history stack, NOT window.history

// NEVER use window.history.pushState for workspace navigation
```

### 2.4 Frontend Dependencies

| Library | Purpose |
|---------|---------|
| `@tauri-apps/api` | Tauri IPC (`invoke`) |
| `@mdxeditor/editor` | Markdown/MDX rich text |
| `@glideapps/glide-data-grid` | Grid/table view |
| `@dnd-kit/core` + `@dnd-kit/sortable` | Board drag-and-drop |
| `@schedule-x/react` | Calendar month/day grid |
| `recharts` | Chart visualizations |
| `zustand` + `immer` | State management |
| `react-resizable-panels` | Resizable editor panels |
| `react-select` | Select dropdowns |
| `lucide-react` | Icons |

---

## 3. Current Design Token System

### 3.1 Color Palette (Warm Editorial — Light Theme)

```css
/* ── Backgrounds ── */
--workspace-bg:            #fdf9f3;   /* Warm cream — canvas */
--workspace-bg-soft:       #f7f3ee;   /* Softer cream */
--workspace-cream:         #f1ebe4;   /* Canonical cream */
--workspace-pane:          color-mix(in srgb, var(--workspace-cream) 92%, transparent);
--workspace-panel:         #fffef9;   /* Panel/card white */
--workspace-panel-muted:   #f7f3ee;

/* ── Text ── */
--workspace-text:          #1c1c19;   /* Warm near-black */
--workspace-text-muted:    rgba(91, 64, 58, 0.82);
--workspace-text-soft:     rgba(91, 64, 58, 0.50);

/* ── Borders ── */
--workspace-border:        rgba(143, 112, 105, 0.14);
--workspace-border-strong: rgba(143, 112, 105, 0.24);

/* ── Accent (deep red) ── */
--workspace-accent:          #b72301;
--workspace-accent-soft:     rgba(183, 35, 1, 0.09);
--workspace-accent-strong:   rgba(183, 35, 1, 0.18);
--workspace-accent-secondary: #6d4c4d;

/* ── Shadows ── */
--workspace-shadow:       0 18px 40px rgba(28, 28, 25, 0.08);
--workspace-shadow-soft:  0 10px 24px rgba(28, 28, 25, 0.05);

/* ── Grid cells ── */
--workspace-grid-bg-cell:    #fdf9f3;
--workspace-grid-bg-header: #f7f3ee;
--workspace-grid-border:    rgba(28, 28, 25, 0.08);
--workspace-grid-link:      #b72301;

/* ── Widget headers (per feature) ── */
--workspace-widget-todo:           #c45a3e;
--workspace-widget-calendar:       #b8956a;
--workspace-widget-recent:         #7a8f72;
--workspace-widget-quickcapture:   #c9a227;
--workspace-widget-aiinsights:    #8b7355;
--workspace-widget-notifications: #b87a7a;
--workspace-widget-stats:          #6d7b8b;
--workspace-widget-voicememos:     #b72301;

/* ── Calendar event colors ── */
--workspace-cal-purple:  #8b7355;
--workspace-cal-pink:    #ec407a;
--workspace-cal-green:   #66bb6a;
--workspace-cal-blue:    #42a5f5;
--workspace-cal-orange: #ffa726;
--workspace-cal-yellow: #ffee58;
```

### 3.2 Typography

```css
/* Body */
font-size: 15px;
line-height: 24px;
font-weight: 400;
font-family: "Inter", "Segoe UI Variable Text", "Segoe UI", sans-serif;

/* Display headings (serif) */
font-family: ui-serif, Georgia, "Iowan Old Style", serif;
font-weight: 600;
letter-spacing: -0.02em;

/* Eyebrow labels */
font-size: 10px;
font-weight: 700;
letter-spacing: 0.18em;
text-transform: uppercase;
font-family: "Space Grotesk", sans-serif;
```

### 3.3 AppFlowy Design Tokens (Database Views)

These are the established spatial constants for Grid/Board/List/Gallery views:

```css
/* Spacing */
--cell-padding-h:     10px;
--cell-padding-v:     8px;
--header-height:      36px;
--row-action-width:   40px;    /* leading hover area */
--board-card-width:   256px;
--board-card-margin:  3px 4px;
--board-column-gap:   4px;

/* Row hover */
--row-hover-bg:  rgba(0, 0, 0, 0.04);
--row-active-bg: rgba(0, 0, 0, 0.08);

/* Card hover lift */
--card-hover-shadow: 0 4px 12px rgba(0,0,0,0.12);

/* Transitions */
--transition-fast:   80ms ease;                          /* hover bg */
--transition-card:    200ms cubic-bezier(0.2, 0, 0, 1);   /* card lift */
--transition-popover: 120ms ease;                        /* popover appear */

/* Popover entrance */
@keyframes popIn {
  from { opacity: 0; transform: scale(0.96) translateY(-4px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
```

### 3.4 Component-Level Styling Rules

| Rule | Location | Description |
|------|----------|-------------|
| **Inline styles + CSS vars only** | All `workspace/` components | Tailwind banned from new workspace code |
| **Pseudo-elements** | `App.css` or `workspace.css` | No `<style>` tags in components |
| **CSS overflow coercion** | Grid cells, scroll areas | `overflowY: 'visible'` auto-coerced to `auto` — use separate inner div |

---

## 4. Navigation Flow

```
User clicks node in SidebarTree
        │
        ▼
workspaceStore.navigateTo(nodeId, { source: 'tree' })
        │
        ├── Push current nodeId to historyStack (max 100)
        │
        ├── invoke('get_node', { id: nodeId })
        │       │
        │       ▼
        │   WorkspaceNode returned (with body = '' for non-documents)
        │
        ├── If node_type === 'database'
        │       invoke('get_node_views', { node_id: nodeId })
        │       invoke('get_node_children', { node_id: nodeId })  -- fields + rows
        │
        ├── If node_type === 'row'
        │       invoke('get_node', { id: node.parent_id })  -- get parent database
        │
        ├── Update workspaceStore { activeNode, activeNodeChildren, views }
        │
        └── WorkspaceLayout re-renders → DocumentView | DatabaseView | RowPageView
```

**Wikilinks (`node://uuid`):**
- Caught by custom MDX link renderer (NOT browser default)
- Renderer calls `workspaceStore.navigateTo(uuid, { source: 'wikilink' })`
- Same flow as above

---

## 5. View-Specific Layout Details

### 5.1 GridView (Default Database View)

```
┌─ Header bar ──────────────────────────────────────────────────┐
│ [+ Add Field] [⋮ Group by▾] [⚡ Fields▾]    [Search] [⋮ More] │
├─ Grid ────────────────────────────────────────────────────────┤
│   │ □ │ Field1 │ Field2 │ Field3 │        ← Header (36px)    │
├───┼───┼────────┼────────┼────────┼──────────────────────────┤
│ ⋮⋮ │ □ │ cell   │ cell   │ cell   │   ← Row (32px)         │
│ ⋮⋮ │ □ │ cell   │ cell   │ cell   │                         │
│ ⋮⋮ │ □ │ cell   │ cell   │ cell   │                         │
│ 40px leading hover area (drag handle + insert button)         │
└───────────────────────────────────────────────────────────────┘
```

- Row leading area: 40px, hidden (`opacity: 0`) by default, revealed on row hover
- Column headers: field type icon + name, click opens `FieldEditorPopover`
- Cell rendering per field type (RichText, Number, Checkbox, etc.)
- Tab/Shift+Tab navigates cells; Enter starts editing; Escape stops

### 5.2 BoardView (Kanban)

```
┌─ Board bar ─────────────────────────────────────────┐
│ [Group by: Status▾] [+ Add Column]                   │
├─────────────────────────────────────────────────────┤
│ ┌─ To Do ──────┐ ┌─ In Progress ─┐ ┌─ Done ───────┐ │
│ │ ┌──────────┐ │ │ ┌──────────┐  │ │ ┌──────────┐ │ │
│ │ │ Card     │ │ │ │ Card     │  │ │ │ Card     │ │ │
│ │ └──────────┘ │ │ └──────────┘  │ │ └──────────┘ │ │
│ │ [+ Add card] │ │ [+ Add card]  │ │             │ │
│ │ 256px wide   │ │              │ │              │ │
│ └──────────────┘ └──────────────┘ └──────────────┘ │
│ 4px column gap                                        │
└─────────────────────────────────────────────────────┘
```

- Horizontal scroll when columns overflow
- Card drag between columns updates `single_select` cell value
- Column = each distinct option value of the group field

### 5.3 CalendarView

```
┌─ CalendarToolbar ────────────────────────────────────────┐
│ [< May 2026 >]  [Month] [Week] [Day]   [+ Add event]   │
├─────────────────────────────────────────────────────────┤
│ Sun │ Mon  │ Tue  │ Wed  │ Thu  │ Fri  │ Sat             │
├─────┼──────┼──────┼──────┼──────┼──────┼─────┤
│     │   1  │   2  │   3  │   4  │   5  │   6  │  ← Day cells
│     │ ●2   │      │      │      │      │      │    with event
│     │      │      │      │      │      │      │      chips
└─────┴──────┴──────┴──────┴──────┴──────┴─────┘
```

- Uses `@schedule-x/react`
- Date field on database rows determines event placement
- Overflow panel for days with many events

### 5.4 ListView & GalleryView

- **ListView**: Flat list of row cards with expandable preview
- **GalleryView**: Masonry/grid of row cards with card fields shown as overlay

---

## 6. Editor (MDXEditorView)

```
┌─ Toolbar ─────────────────────────────────────────────┐
│ B  I  U  S  │ H1 H2 H3 │ • ─ " │ Link │ ⋯ More      │
├──────────────────────────────────────────────────────┤
│                                                          │
│  # Document Title                                        │
│                                                          │
│  Typed markdown content...                               │
│                                                          │
│  [[wikilink]] → navigates to node on click              │
│                                                          │
└──────────────────────────────────────────────────────┘
```

- Toolbar pinned count controlled by `MDX_TOOLBAR_PINNED_COUNT` in `mdxToolbarIds.ts`
- Wikilinks stored as `[display text](node://uuid)` in body markdown
- Wikilink click → custom renderer → `workspaceStore.navigateTo(uuid)`

---

## 7. Design Principles to Preserve

| Principle | Rationale |
|-----------|-----------|
| **Warm cream palette** (`#fdf9f3` base) | Core brand identity — deep red accent on cream is distinctive |
| **Inline styles + CSS vars** | CLAUDE.md architectural rule for workspace components |
| **Fractional position indexing** | Gap-based reordering; never sequential integers |
| **Optimistic UI** | Instant feedback, async persist, rollback on error |
| **Lazy body loading** | Bodies never loaded during tree init — only on `navigateTo` |
| **Granular Zustand selectors** | Never subscribe to whole store — re-render only what changed |

---

## 8. Key Files Reference

| Path | Purpose |
|------|---------|
| `src-tauri/src/lib.rs` | Tauri app setup, all command registrations |
| `src-tauri/src/managers/workspace/workspace_manager.rs` | Core workspace CRUD + FTS sync |
| `src-tauri/src/managers/database/manager.rs` | Database/field/row/cell CRUD |
| `src/stores/workspaceStore.ts` | Central workspace state + navigation |
| `src/stores/databaseStore.ts` | Database-specific state |
| `src/components/workspace/WorkspaceLayout.tsx` | Main router (DocumentView / DatabaseView / RowPageView) |
| `src/components/workspace/DatabaseShell.tsx` | Database page shell + view switcher |
| `src/components/workspace/GridView.tsx` | GlideDataGrid implementation |
| `src/components/workspace/BoardView.tsx` | Kanban board with dnd-kit |
| `src/components/workspace/CalendarView.tsx` | Calendar view |
| `src/components/workspace/ChartView.tsx` | Chart view (Recharts) |
| `src/components/workspace/ListView.tsx` | List view |
| `src/components/workspace/GalleryView.tsx` | Gallery view |
| `src/components/workspace/RowPageView.tsx` | Row detail page |
| `src/components/workspace/WorkspaceTree.tsx` | Left sidebar tree |
| `src/components/editor/MDXEditorView.tsx` | Markdown editor wrapper |
| `src/App.css` | Main styles + all CSS design tokens |
| `src/workspace.css` | Workspace-specific styles |
| `src/bindings.ts` | Auto-generated Tauri command bindings (DO NOT EDIT) |

---

## 9. What NOT to Change

| Item | Why |
|------|-----|
| `src/bindings.ts` | Auto-generated — overwritten on every build |
| `translation.json` / `database.calendar.*` keys | Used by `CalendarToolbar` — renaming breaks calendar |
| `src/stores/databaseStore.ts` | Still imported by `database/calendar/` components |
| `window.history.pushState` in `WorkspaceLayout` | Legacy exception, surface area minimal — do not extend |
| `notes.rs` voice-memo helpers | Kept only for legacy notes tab |

---

*Document version: 2026-04-18. Update when architecture changes.*
