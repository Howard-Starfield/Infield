# W4 — Databases wiring (Table + Board)

**Status:** design locked 2026-04-25 (revised after review) · ready for implementation plan
**Phase:** Backend Wiring Phase (W) — W4 of the W-roadmap. Follows W3 (hybrid search). Precedes W5 (settings).
**Companion docs:** [CLAUDE.md](../../../CLAUDE.md) (rules + invariants) · [vault-database-storage.md](../../architecture/vault-database-storage.md) (storage contract) · [card-glass-tiers-design.md](2026-04-25-card-glass-tiers-design.md) (token tiers consumed by this surface).

---

## 1. Goal

Replace `src/components/DatabasesView.tsx`'s mock UI with a real, vault-backed Notion-style database surface. Two views ship in W4: **Table** (TanStack Table + virtualized rows) and **Board** (dnd-kit kanban). Calendar / List / Gallery / Timeline render `<EmptyState>` and ship in later phases.

Every cell edit, row create/delete, and group-drag round-trips through Tauri commands and writes the affected `rows/<id>.md` file in the same operation, vault first. The vault remains source of truth (Invariant #1) — if SQLite ever corrupts, `vault/import.rs` rebuilds the index.

The architecture is LLM-tool-ready by construction: every mutation is an atomic Tauri command, so a future LLM tool layer ("add this to my Helix tasks board, status In Progress") just wraps the same commands the UI calls.

---

## 2. Scope

### Included

1. **Two views fully wired:** Table (TanStack Table v8 + `@tanstack/react-virtual` for row virtualization) and Board (dnd-kit/sortable).
2. **Six field types:** `RichText`, `Number`, `Date`, `SingleSelect`, `MultiSelect`, `Checkbox`. The other 8 backend `FieldType`s render read-only with a "field type not supported in W4" tooltip.
3. **Database sidebar** — flat alphabetic list of all `node_type='database'` workspace nodes via a new dedicated `list_databases` Rust command. Includes the existing search input. No grouping, no pinning in W4.
4. **Database chrome** — title, view tabs, filter pills, footer stats. Largely keeps the existing CSS shapes; rewires data sources.
5. **Live vault persistence (vault-first)** — every cell edit / row create / row delete / group drag rewrites the affected file (`rows/<id>.md`, `database.md`, or `views/<id>.view.json`) **before** mirroring to SQLite. Atomic temp-file + rename. Debounce policy is split (§3).
6. **Conflict guard (Rule 13)** — `export_row` checks mtime before overwrite; on `ExternalEditConflict`, fires a sonner toast with "Open / Reload / Keep mine" actions. If the user clicks Open, routes to Notes view where the existing inline conflict banner takes over.
7. **Window-focus mtime check (Rule 14) — capped to viewport.** On focus, re-stat row files for **the ~50 currently rendered rows** in the active database (TanStack Table virtualization gives us the visible range). Off-screen rows reconcile lazily as the user scrolls. Non-blocking "Refreshed from disk" toast if any row body changed.
8. **Row → Notes routing** — clicking a row's title cell sets `currentPage='notes'` with the row's node id. Same CodeMirror editor handles row body. Row frontmatter (cells) edits in DatabasesView; row body edits in Notes. Wikilinks in row bodies index normally via `page_links`.
9. **Row deletion** — right-click row → "Delete" calls existing `soft_delete_node`. Row's `workspace_nodes.deleted_at` is set; row hides from table; `rows/<id>.md` **stays on disk** (matches Rule 13 vault lifecycle for documents). Recoverable from Trash (existing surface). `permanent_delete_node` from Trash deletes the file.
10. **Paged cell fetch** — new Rust command `get_cells_for_rows(db_id, row_ids: Vec<String>) -> Vec<(String, Vec<(String, CellData)>)>`. Frontend calls it for the **visible row window + buffer** (~80 rows: 50 visible + 15 above + 15 below) on initial mount and on virtualizer scroll. Replaces the N+1 fetch and avoids the all-rows-on-mount bottleneck.
11. **One new VaultManager method** — `export_row(db_id, row_id) -> Result<PathBuf>`. Atomic temp-file + rename. Used by mutation commands as the **first** call (vault first), then SQLite mirror.

### Explicitly excluded (deferred)

- **Calendar / List / Gallery / Timeline views.** Render `<EmptyState>` with "Coming in W4.5". Calendar has its own future home as a standalone Calendar app (separate W-phase) — Schedule-X-based, not a database view.
- **Pinning / starring databases.** Sidebar shows a flat alphabetic list. Pinning lands in a polish phase if it earns its keep.
- **Filter / sort / group editor UIs.** Pills exist visually in the chrome; the dropdowns to edit them are deferred. Default views (no filter, no sort, group by Status for Board) ship working.
- **`reindex_database_from_vault` Tauri command + Settings UI.** The recovery path exists architecturally (`vault/import.rs` already rebuilds an index from disk); exposing it as a UI button is a Settings-phase task.
- **Rich-text inside cells, wikilinks inside cells, formulas, rollups, relations.** All deferred — see CLAUDE.md `## Deferred — Do Not Implement in v1`.
- **Field schema editor UI.** Adding/renaming/deleting fields via UI is deferred. Field schemas are created programmatically — by `create_database` for new databases, or by direct vault edit of `database.md` (which round-trips via `vault/import.rs` on next read). No in-app schema editor ships in W4.
- **Cross-database operations** — drag a row from one db to another, multi-select bulk edit. Deferred.
- **Column resize + width persistence.** Per CLAUDE.md deferred list.
- **Seed database on first-run.** Cut from W4 (was DoD #17 in prior draft). Empty state with "Create your first database" CTA replaces it. Sample content with placeholder names looks like leftover mocks.
- **`database-cell-updated` event.** Cut. No consumer in W4. Adds when its first consumer (LLM watcher in W6, or live-collab) lands. Body changes continue to use the existing `workspace-node-body-updated` event.

### Not changed

- **Existing Rust managers** (`DatabaseManager`, `WorkspaceManager`, `VaultManager`) — unchanged in shape. One method added (`export_row`), two commands added (`list_databases`, `get_cells_for_rows`).
- **Existing Tauri commands** — `update_cell`, `create_row`, `create_row_in_group`, `update_row_date`, `create_select_option` etc. unchanged in signature. Internally each gets reordered to call `vault::export_row(...)` **first**, then SQLite mirror.
- **Frontend bindings** — regenerated via specta; no manual edits.

---

## 3. Architecture

### File layout (mirrors Notes)

Notes pattern: flat `src/components/`, peer `src/editor/` for non-component logic. Mirrored exactly. **Component count slimmed from prior draft (8 → 4).** Sidebar and chrome are inline in `DatabasesView.tsx` until they earn extraction.

```
src/components/                         ← all flat, per CLAUDE.md DoD #5
  DatabasesView.tsx                     ← shell: inline sidebar + chrome + view router (rewrite)
  DatabaseTableView.tsx                 ← TanStack Table + react-virtual rows
  DatabaseBoardView.tsx                 ← dnd-kit kanban
  DatabaseSelectPopover.tsx             ← shared SingleSelect/MultiSelect editor (used in both views)

src/database/                           ← non-component logic, peer of src/editor/
  cellRenderers.tsx                     ← one renderer per supported FieldType (DOM, not canvas)
  useDatabase.ts                        ← single hook: data fetch + mutations + virtualization-aware paging
  __tests__/

src/styles/
  databases.css                         ← all .db-* classes; tokens-only per Rule 12 (new file)
```

No `glideTheme.ts` — TanStack Table renders DOM `<td>`s; CSS tokens cascade naturally, no JS theme adapter needed.

### Component tree

```
DatabasesView (selectedDbId, currentView)
  ├─ aside.db-sidebar                   ← inline; flat list + search
  └─ section.heros-glass-card.heros-glass-card--deep
       ├─ header.db-chrome              ← inline; title row, view tabs, filter pills (display-only in W4)
       └─ <view router>
            ├─ DatabaseTableView    (when currentView==='table')
            ├─ DatabaseBoardView    (when currentView==='board')
            └─ <EmptyState>         (calendar | list | gallery | timeline)
```

### Single hook — `useDatabase(dbId)`

Returns:

```ts
{
  fields: Field[]
  rowIndex: RowMeta[]                                      // id + title + position + group key — small per-row payload
  cellsForRange: (startIdx, endIdx) => void                // tells the hook to fetch cells for that visible window
  cells: Map<string, Map<string, CellData>>                // rowId → fieldId → cell — only contains fetched rows
  isLoading: boolean
  mutateCell: (rowId, fieldId, data) => Promise<void>      // atomic vs typing — see debounce policy below
  createRow: () => Promise<Row>
  createRowInGroup: (fieldId, optionId) => Promise<Row>    // for Board "+ in column"
  moveRowGroup: (rowId, fieldId, optionId) => Promise<void>// drag between board columns
  deleteRow: (rowId) => Promise<void>                      // soft delete via soft_delete_node
}
```

Internal:

- `rowIndex` loads once on mount via `get_rows_filtered_sorted` — small payload (id + title + group key), cheap at 10k rows.
- `cells` is a sparse `useRef<Map>` populated on demand by `cellsForRange`. The Table's virtualizer calls `cellsForRange(visibleStart, visibleEnd)` after each scroll; the hook diffs against already-fetched rows and issues one batched `get_cells_for_rows` call for the missing slice.
- A `cellsVersion` counter triggers re-render of just the affected rows (TanStack's `getRowId` + memoized cell components keep this cheap).
- All mutations are optimistic: local state updates immediately, vault-then-SQLite roundtrip in the background, rollback on error with sonner toast.

### Debounce policy (split — atomic vs typing)

Prior draft had one 300ms debounce for everything. Atomic mutations don't benefit from coalescing and add perceived lag. Split:

| Mutation kind | Round-trip |
|---|---|
| `RichText` typing, `Number` typing | 300ms debounce per `(rowId, fieldId)` key |
| `Checkbox` toggle | Immediate |
| `SingleSelect` / `MultiSelect` change | Immediate |
| `Date` pick | Immediate |
| Board drag-between-columns | Immediate (calls `moveRowGroup`) |
| Row create / delete | Immediate |

### Data flow per mutation (vault-first)

```
User edits cell
  → mutateCell(rowId, fieldId, newData)
       ├─ optimistic: cellsRef.current.set(rowId/fieldId, newData)
       ├─ cellsVersion++; row re-renders
       └─ debounced (or immediate, per policy)
            → invoke('update_cell', { rowId, fieldId, fieldType, data })
                 [Rust — vault-first]
                 ├─ VaultManager.export_row(dbId, rowId)
                 │    ├─ read row + cells from SQLite (current cell pre-write read)
                 │    ├─ apply pending mutation in-memory
                 │    ├─ Rule 13 mtime check
                 │    ├─ write rows/<row-slug>.md.tmp atomically
                 │    └─ fs::rename (.tmp → final); update last_read_mtime
                 └─ DatabaseManager.update_cell  (SQLite mirror — only if vault write succeeded)
            ← Result<(), String>
       └─ on error: rollback cellsRef + sonner toast "Failed to save"
```

**Why vault-first:** Invariant #1 says vault is source of truth. If the vault write throws `ExternalEditConflict`, SQLite is never touched — the in-memory optimistic update is what rolls back. SQLite never holds a value the disk doesn't have.

### TanStack cell renderers (one per supported FieldType)

| FieldType | Cell component | Editor |
|---|---|---|
| `RichText` | `<TextCell>` | `contenteditable` `<div>` with token-driven styles |
| `Number` | `<NumberCell>` | `<input type="number">` |
| `Date` | `<DateCell>` | Pill display + `<input type="date">` on click |
| `SingleSelect` | `<SelectCell>` | `DatabaseSelectPopover` (single mode, `@floating-ui/react`) |
| `MultiSelect` | `<SelectCell>` | `DatabaseSelectPopover` (multi mode) |
| `Checkbox` | `<CheckboxCell>` | Native `<input type="checkbox">` styled via tokens |

All renderers are plain DOM in `src/database/cellRenderers.tsx`. Token-driven via CSS variables — no JS theme adapter.

### Sidebar data source

New dedicated Rust command (replaces the prior draft's `searchWorkspaceTitle({ query: '', limit: 200 })` abuse, which silently capped at 200):

```rust
#[tauri::command]
pub async fn list_databases(
    prefix: Option<String>,                  // optional filter for the sidebar search input
) -> Result<Vec<DatabaseSummary>, String>;
```

Returns `{ id, title, icon, row_count }` for every `node_type='database'` workspace node where `deleted_at IS NULL`, sorted alphabetically. No grouping. Cheap — single SQL with one `COUNT(*)` subquery per row, or a `LEFT JOIN` on a row-count CTE for >100 databases.

### Board view structure

Columns sourced from the database's group-by field — answer to old Q1: **first SingleSelect field in `fields` order** (by `position`). Documented; user can re-pick when the view editor lands.

```
.db-board
  .db-board__col[data-option-id]
     .db-board__col-head { label, count, + button }
     .db-board__cards (DndContext.SortableContext, strategy=verticalListSortingStrategy)
       .db-board__card * N (DndContext.useSortable per card)
```

Drag interactions:

- **Within a column** → reorder. Persist via `WorkspaceManager.reorder_node_children` (existing).
- **Across columns** → `moveRowGroup(rowId, statusFieldId, newOptionId)`. Internally: `update_cell` with the new SingleSelect option ID. Vault export triggered as the first step inside `update_cell`.

If a database lacks a SingleSelect field, Board view shows `<EmptyState>` "Add a SingleSelect field to use Board view". (Field-schema editor is deferred, so this state is reachable only via direct `database.md` edit; documented in §11.)

---

## 4. Live vault persistence

### Storage contract — already pinned

Per [vault-database-storage.md](../../architecture/vault-database-storage.md):

```
databases/<db-slug>/
  database.md                         ← schema in YAML frontmatter
  rows/<row-slug>.md                  ← one row = one file, frontmatter cells + body
  views/<view-id>.view.json           ← per-view filter / sort / group config
```

Atomic-write pattern: `rows/<slug>.md.tmp` → `fs::rename`. Rule 13 mtime check before rename.

### Existing whole-db exports vs new per-row export

Today, `vault/table.rs::export_table` and `vault/board.rs::export_board` rewrite the **entire** database directory on any change (slow at 10k rows; floods cloud-sync). W4 adds `VaultManager::export_row` which writes **one** `rows/<id>.md`, leaving siblings untouched.

The whole-db exports stay as the import/recovery counterpart and the path used by `create_database` for the initial `database.md` write (DoD #5 confirms `create_database` already calls `export_table`; no change needed).

### `VaultManager::export_row(db_id, row_id)`

```rust
impl VaultManager {
    pub async fn export_row(
        &self,
        db_id: &str,
        row_id: &str,
        ws_mgr: &WorkspaceManager,
        db_mgr: &DatabaseManager,
    ) -> Result<PathBuf, String> {
        // 1. Read row node + database node from SQLite (parent slug + row slug)
        // 2. Read all cells for row from db_mgr (post-mutation in-memory state)
        // 3. Read database fields (schema) for cell-to-frontmatter formatting
        // 4. Read row body from workspace_nodes (markdown)
        // 5. Compose YAML frontmatter + body via vault/format.rs helpers
        // 6. Compute target path: databases/<db-slug>/rows/<row-slug>.md
        // 7. Rule 13 mtime check (skip if file does not yet exist — first-write)
        // 8. Write .tmp + fs::rename
        // 9. Update workspace_nodes.last_read_mtime
        // 10. Return relative path
    }
}
```

Reused by every mutation command **before** the SQLite write: `update_cell`, `create_row`, `create_row_in_group`, `update_row_date`, `update_node` (for body changes that hit a `node_type='row'`), `move_node` (for row-slug renames).

**Rename semantics in `move_node`:** when a row's slug changes, `export_row` writes the new path then deletes the old `rows/<old-slug>.md`. Both operations under the same Rule 13 guard against the new path.

### When `database.md` rewrites

Only when the schema changes (W4: never, since field-schema editor is deferred). On import-from-vault path, `database.md` is the source of truth for fields. **Confirmed:** `create_database_inner` already calls `export_table` which writes `database.md` on first creation, so W4 databases are recoverable from disk via `vault/import.rs` from day one.

### When `views/<id>.view.json` rewrites

Only when the user adds/renames/deletes a view, or changes filter/sort/group. W4: only the default view is auto-created via `ensure_default_view`; user-driven view editing is deferred.

### Recovery path (architecturally present, UI deferred)

`vault/import.rs` already round-trips a database directory back into SQLite. Exposing this as a Settings → Databases → "Re-index from vault" button is a follow-up task, not W4.

---

## 5. Conflict handling, external edits, and deletion

Rule 13 (conflict guard) and Rule 14 (no watcher; check on focus + navigation) apply identically.

| Trigger | Action |
|---|---|
| Cell edit in Handy, row file mtime drifted | `export_row` returns `ExternalEditConflict` **before** any SQLite write → sonner toast `{rowTitle} changed on disk. [Open] [Reload] [Keep mine]`. Optimistic local state rolls back. |
| Window-focus | `useFocusReconcile` hook re-stats **only the rows currently rendered by the virtualizer** (~50 rows max). Off-screen rows reconcile lazily as the user scrolls them into view. Body changes → silent re-fetch + cell update. Frontmatter changes → re-fetch cells. |
| Cloud-sync materialization (file len 0 → >0, or only YAML changed) | Rule 14 toast suppression — apply silently. |
| User clicks Open in conflict toast | `currentPage='notes'`, route to row's node id. Existing Notes inline conflict banner takes over (Reload / Keep mine / Diff). |
| User clicks Reload | Re-fetch row, push to local state, dismiss toast. |
| User clicks Keep mine | Set `last_read_mtime = disk_mtime`, retry write once. |
| Row soft-delete (right-click → Delete or Del key) | `soft_delete_node(rowId)` — sets `deleted_at`, hides from table. **Vault file stays.** Recoverable from Trash. |
| Row permanent-delete (from Trash) | `permanent_delete_node(rowId)` — deletes `rows/<slug>.md` from vault. |
| External `rows/<slug>.md` deletion (file gone on disk) | Detected on focus reconcile or navigation. Row marked as vault-orphan in SQLite; surfaced in "Vault issues" panel (existing surface from CLAUDE.md cloud-sync defensiveness). Never silently deleted from SQLite. |

Autosave for the conflicted row pauses until resolved (matches Notes behavior).

---

## 6. Card-tier mapping

Every database surface consumes the new card-glass-tier tokens. Zero hardcoded rgba in `databases.css`.

| Surface | Tier | Notes |
|---|---|---|
| `.db-stage` (main content frame) | `--card-deep-*` | Default `.heros-glass-card` fallback; no modifier needed |
| `.db-sidebar` | `--card-mid-*` | Chrome surface |
| `.db-chrome` (title + tabs + pills) | (no separate surface — sits inside `.db-stage` deep) | Just typography + spacing |
| `.db-pill` filter chips | `--card-mid-*` | Pill background |
| `.db-pill` :hover | `--row-hover-fill` | Already mapped via card-tiers spec |
| `.db-table thead th` | `--card-deep-*` | Already migrated in card-tiers spec commit B |
| `.db-table tr:hover td` | `--row-hover-fill` | Already mapped |
| `.db-board__col` | (transparent — sits on `.db-stage` deep) | Column is just a flex container |
| `.db-board__card` | `--card-mid-*` | Each kanban card is a mid-tier surface |
| `.db-board__card:hover` | `--row-hover-fill-deep` | Already mapped (`.kan-card:hover`) |
| `DatabaseSelectPopover` | `--card-overlay-*` | Floating popover via `@floating-ui/react` |

Because TanStack Table renders DOM, every cell inherits `--heros-text-*`, font tokens, and the row-hover token directly through CSS — no `getComputedStyle` adapter, no MutationObserver.

---

## 7. LLM forward-compatibility

The architecture is already LLM-tool-ready. No new abstractions in W4; just discipline:

1. **Every mutation goes through a Tauri command.** Never frontend-only state hacks. The user's "click to change status" path and a future LLM's "set this row's status" path call the same command.
2. **Each command is atomic and idempotent-friendly.** `update_cell(rowId, fieldId, data)` overwrites — running it twice is a no-op the second time. `create_row` returns the new row id so a tool can reference it in subsequent calls.
3. **Reads are queryable.** `list_databases({ prefix })` lists databases; `get_fields` returns schema; `get_rows_filtered_sorted` answers "show me rows where Status = In Progress"; `get_cells_for_rows` returns cell payloads. A tool layer composes these without any new commands.
4. **Events emit on every change.** A future agent observing the workspace listens to `workspace-node-body-updated` for body changes. Cell-only events are added when the first agent consumer lands (deferred from W4).

Concrete W4 commitment: **no UI-only optimistic state without a vault round-trip.** Every change visible in the UI must, on success, also be a vault file change.

---

## 8. Definition of Done

In addition to CLAUDE.md's standard DoD:

1. ✅ `DatabasesView.tsx` is rewritten — no hardcoded mock arrays, no `motion/react` for view transitions (replaced with conditional render), no inline-style rgba literals. Sidebar + chrome inline; flat list of databases via `list_databases`.
2. ✅ Three new components in flat `src/components/` (`DatabaseTableView`, `DatabaseBoardView`, `DatabaseSelectPopover`).
3. ✅ Two new files in `src/database/` (`cellRenderers.tsx`, `useDatabase.ts`) plus `__tests__/`.
4. ✅ `src/styles/databases.css` exists; all `.db-*` classes prefixed; zero hardcoded rgba; tier tokens consumed.
5. ✅ Two new Rust commands registered in `src-tauri/src/lib.rs`: `list_databases`, `get_cells_for_rows`.
6. ✅ One new method `VaultManager::export_row` exists and is called as the **first** step of every row-affecting mutation command (vault before SQLite).
7. ✅ Every mutation affecting a row writes `rows/<id>.md` on success via `VaultManager::export_row`. Concretely: `update_cell`, `create_row`, `create_row_in_group`, `update_row_date`, `soft_delete_node` (no-op for vault — file stays), `permanent_delete_node` (deletes file), plus `update_node` (body change for a row) and `move_node` (row-slug rename, writes new + deletes old). Workspace-layer commands check `node_type=='row'` and route to `export_row` instead of the standard document path; document writes are unchanged.
8. ✅ Rule 13 conflict guard fires on row writes **before** the SQLite mirror; sonner toast wired with Open / Reload / Keep mine actions.
9. ✅ Rule 14 focus-reconcile hook re-stats only the **virtualizer-visible** rows for the active database, not all rows.
10. ✅ Six field types render + edit in Table view: RichText, Number, Date, SingleSelect, MultiSelect, Checkbox. Other 8 types render read-only with tooltip.
11. ✅ Board view renders columns from the database's first SingleSelect field in `fields` order; cards drag within and across columns; `<EmptyState>` if no SingleSelect field exists.
12. ✅ Calendar / List / Gallery / Timeline render `<EmptyState>` with "Coming in W4.5".
13. ✅ Clicking a row title cell routes to Notes view at that row's node id; row body edits via the same CodeMirror editor as Notes. Other cells edit in place (resolves old Q3).
14. ✅ Right-click on row → context menu with "Open" + "Delete" (soft); Trash surface handles permanent delete (existing).
15. ✅ Sidebar lists all `node_type='database'` workspace nodes flat, alphabetically, with the existing search input — backed by `list_databases`, no 200-row cap.
16. ✅ Debounce split per §3: typing fields debounced 300ms; atomic mutations (Checkbox/Select/Date/drag/create/delete) round-trip immediately.
17. ✅ Cells lazy-load by visible row range (50 visible + ~30 buffer); scrolling triggers further `get_cells_for_rows` calls for new rows; cells already fetched are reused. Sort and filter run server-side in `get_rows_filtered_sorted` — they operate on row IDs, not on the lazy cell payload, so sort correctness is unaffected by the visible window.
18. ✅ `bun run build` zero new errors. `bunx vitest run` green. `cargo test --lib` green.
19. ✅ Cleanup: files retired and code removed (§12).
20. ✅ Manual smoke: create db → add row → edit cell → change status → drag in board → soft-delete row → restore from trash → reload app → state restored from vault → break SQLite → re-import from vault rebuilds.

---

## 9. Risks

**Sort correctness with lazy cell loading.** A user concern: "if rows aren't loaded, can sort still work?" Answer: yes. `get_rows_filtered_sorted` runs on the Rust/SQLite side and returns an **ordered list of row IDs** for the entire database. The frontend lazy-loads cells for the visible window of that ordered ID list. Changing sort direction or column re-issues `get_rows_filtered_sorted` (not `get_cells_for_rows`); the frontend resets its cell cache and the new visible window is fetched. Sort is never frontend-only.

**Vault-first ordering rollback symmetry.** If `export_row` succeeds but `DatabaseManager.update_cell` fails (rare — should only happen on SQLite I/O error), the disk has the new value but SQLite doesn't. On next read, `vault/import.rs` reconciles. No data loss; transient inconsistency is healed by the recovery path that already exists. Logged as a Rust warning.

**TanStack render cost at 10k rows.** Mitigated by `@tanstack/react-virtual` row virtualization (only ~50 rows in the DOM at any time) plus memoized cell components keyed on `(rowId, fieldId, cellsVersion)`. DOM is faster to update sparsely than canvas for the cell counts we expect (≤10k); above 50k, revisit.

**Vault write contention.** A burst of cell edits at 300ms debounce produces ~3 writes/second to the same row file. Atomic temp-rename means no corruption, but iCloud / OneDrive sync may flag rapid rewrites. Atomic mutations (Checkbox/Select) coalesce naturally because they're one-shot per user click. If RichText typing produces noisy writes, batching by row (one write fanout per row, multiple cells) is a future optimization.

**Rule 13 conflict storms during cloud-sync materialization.** A vault on iCloud/OneDrive may rewrite many row files within seconds during initial sync. Rule 14's `+3s` cloud-sync grace window already covers this for Notes — same mechanism applies to row files.

**Verbatim-port drift.** The current DatabasesView.tsx has hardcoded `style={{}}` rgba and inline `motion/react` transitions ported from `copy/`. This surface was wholesale-swapped in the 2026-04-23 frontend swap, not a verbatim port maintained against `copy/` upstream. Detokenizing it does **not** invoke the Rule 12 carve-out — that applies only to `heros.css` and `blobs.css`, which we are not touching.

---

## 10. Out of scope (parked)

- Standalone Calendar app (its own future W-phase, Schedule-X-based).
- Filter / sort / group editor popovers (chrome pills exist; editing them is deferred).
- Field schema editor (add / rename / delete fields via UI).
- Pinning / starring databases.
- Cross-database row drag, multi-select bulk edit.
- Column resize + width persistence.
- Rich-text inside cells, wikilinks inside cells, formulas, rollups, relations.
- 8 of 14 field types: URL, Checklist, LastEditedTime, CreatedTime, Time, Media, DateTime, Protected.
- Settings → Databases → Re-index from vault button (architecturally present; UI deferred).
- Inline-database-as-CodeMirror-widget inside notes (architecturally compatible later; not in W4).
- Real-time collaboration / multi-cursor / CRDT (per CLAUDE.md deferred list).
- Seed database on first-run.
- `database-cell-updated` event (lands with first consumer).

---

## 11. Resolved questions and remaining unknowns

### Resolved during review

1. **Default group-by for Board** → first SingleSelect field in `fields` order (by `position`). Documented in §3 "Board view structure". User can re-pick when the view editor lands.
2. **Seed database** → cut. Empty state with CTA replaces it.
3. **Cell click vs. row title click** → title cell routes to Notes; other cells edit in place. Glide-style "double-click to edit" is not used; first click on a non-title cell opens the inline editor immediately.
4. **Board column "+" button** → adds a row pre-populated with that column's option ID. Title defaults to empty; focus jumps to the title cell after creation.

### Resolved during pre-plan verification

5. **Slug-collision policy.** Already implemented in `WorkspaceManager::write_node_to_vault` ([workspace_manager.rs:1581-1602](../../../src-tauri/src/managers/workspace/workspace_manager.rs)): when target file exists and belongs to a different node id, append `-<first 8 chars of node id>` to the slug. `export_row` reuses the same helper. No new policy to invent.

### Pre-existing gap surfaced during review (NOT W4 scope, flagged for visibility)

**`move_node` does not currently touch the vault.** Today's `WorkspaceManager::move_node` updates only `parent_id` / `position` in SQLite plus FTS/embedding sync ([workspace_manager.rs:2808](../../../src-tauri/src/managers/workspace/workspace_manager.rs)). The vault file rewrite happens lazily via `write_node_to_vault` on the next body save — and **the old file at the previous path is never deleted**. This is a pre-existing bug for documents, not specific to rows.

W4 routes `move_node` for `node_type='row'` through `export_row` (writes new path) plus an explicit delete of the old path. **The same fix is NOT applied to documents in W4** — that's an out-of-scope cleanup ticket. Flag for follow-up phase. DoD #7 only covers the row path.

### Remaining unknowns to verify after work

1. **Orphaned cell value when a SingleSelect option is deleted.** Schema-editor is deferred, so the only way to hit this is direct `database.md` edit. Proposed behavior: on import, rows pointing to a now-missing option ID render with greyed pill `(missing option: opt_xyz)`. Vault data preserved; user can re-add the option to restore. Confirm visually after the first manual repro.
2. **TanStack column-width state on reload.** Column resize is deferred (CLAUDE.md), but TanStack still tracks an internal default width. Confirm widths derived from field type (e.g., Checkbox = 40px, Date = 120px, RichText = flex-grow) survive reload because they're declared in `cellRenderers.tsx`, not stored. No persistence layer needed in W4.
3. **`@tanstack/react-virtual` + dnd-kit interaction in Board.** Board view doesn't virtualize columns in W4 (deferred until >500 cards/column per §2 Excluded). Confirm dnd-kit drag handles render correctly when the Table view's virtualizer is active simultaneously (e.g., user splits screen — currently impossible, but trivially possible later).

---

## 12. Files retired / cleanup checklist

The wiring rewrite leaves nothing behind. Verify each item in the final commit:

### Deleted

- `src/components/DatabasesView.tsx` — replaced by the new shell. Old version's mock arrays (`databases`, `rows`, `columns`, `calendarEvents`), inline rgba literals, and `motion/react` `<AnimatePresence>` view transition all gone.
- Any inline `style={{ ... rgba ... }}` literals inside the new DatabasesView. Use tokens or class names per Rule 12.

### Imports to audit and remove from DatabasesView

- `motion`, `AnimatePresence` from `motion/react` — no longer used in this file. (`motion/react` package stays installed; other components still use it.)
- `lucide-react` icons unused after rewrite (e.g., `Grid`, `Star`, `ArrowUpRight`, `Download` if no longer rendered) — drop from the import list.
- `ScrollShadow` — keep if still used in the inline sidebar; verify usage post-rewrite. Component is shared with 10+ other surfaces; do not delete the file itself.

### Stale references to verify

- `src/bindings.ts` — regenerated by specta on next `bun run tauri dev`. Old TS bindings for removed mock-shaped types (none expected) auto-clear. **Do not hand-edit.**
- `src/styles/notes.css` line ~792 — system-audio variant `background: rgba(6, 9, 20, 0.46) !important;` was already migrated by the card-glass-tiers refactor. Confirm no W4 code re-introduces hardcoded rgba in `databases.css`.
- `copy/src/components/DatabasesView.tsx` — historical reference only; not wired. No action.

### Verification greps (run before final commit)

| Pattern | Files searched | Expected |
|---|---|---|
| `rgba\(` | `src/components/DatabasesView.tsx`, `src/components/DatabaseTableView.tsx`, `src/components/DatabaseBoardView.tsx`, `src/components/DatabaseSelectPopover.tsx`, `src/database/**`, `src/styles/databases.css` | Zero matches |
| `motion/react` | same | Zero matches |
| `useState.*\[\s*\{` (inline mock arrays) | same | Zero matches |
| `searchWorkspaceTitle.*node_type.*database` | `src/**` | Zero matches (replaced by `list_databases`) |
| `getComputedStyle` | `src/database/**`, `src/components/DatabaseTableView.tsx` | Zero matches (TanStack uses CSS directly) |

### Build + tests (per CLAUDE.md DoD)

- `bun run build` zero new errors
- `bunx vitest run` green; new component tests in `src/database/__tests__/` cover: paged cell fetch slice math, sort survives lazy loading, atomic mutation skips debounce, soft-delete hides row but file stays
- `cargo test --lib` green; new Rust tests cover: `export_row` first-write skips mtime check, `export_row` mtime conflict returns `ExternalEditConflict`, `list_databases` returns alphabetical order, `get_cells_for_rows` honors row order
