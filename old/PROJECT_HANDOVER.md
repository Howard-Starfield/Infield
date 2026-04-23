# Project Handover — Handy/Infield Workspace

**Last updated:** 2026-04-20
**Status:** Active development — vault-as-source-of-truth fully implemented for notes;
table/calendar/board vault export implemented; table/calendar/board vault import and unified
source-of-truth for databases is the next major phase

---

## 1. Project Vision and Goal

### 1.1 What We Are Building

A **local-first, offline-first unified workspace app** where all content lives as plain files
on disk (Obsidian-style) **and** is indexed in SQLite for fast queries. The vault
(`<app_data>/handy-vault/`) is the source of truth; the database is derived and serves as an
index.

The long-term vision:
- **Documents** — raw `.md` files with YAML frontmatter, Obsidian-compatible
- **Databases (Table, Calendar, Board)** — each stored as `.md` files in
  `databases/<name>/` using YAML frontmatter + CSV (table), Obsidian Tasks format
  (calendar), or sub-documents (board cards)
- **All content** feeds into the embedding pipeline → vector store → hybrid search
- **Transcription** (mic, system audio, file import) creates workspace documents,
  organized in folders, with vault as the write target

### 1.2 The Professional/Unified Approach

Yes — a vault-as-source-of-truth architecture with unified handling of all content types
is cleaner and more professional than treating notes differently from databases:

| Aspect | Notes DB (legacy) | Unified Vault (current) |
|---|---|---|
| File format | SQLite row | `.md` + YAML frontmatter |
| External editor compat | None | Obsidian-compatible |
| Data portability | Locked to app | Plain files, version-control friendly |
| Search | SQLite FTS | FTS5 + vector hybrid |
| Backup | Manual | Copy folder |
| Unified handling | No | Yes — same create/update/move pipeline |

The key insight: **the vault is the golden copy; SQLite is an index**. Every create,
update, move, and delete operation goes through Rust handlers that write both
simultaneously. The embedding pipeline consumes the vault content.

### 1.3 Technology Stack

```
Frontend:
  React 18 + TypeScript
  Vite (build)
  Zustand + Immer (state)
  Tailwind CSS v4 (legacy database/ only; workspace/ uses inline + CSS vars)
  Glide Data Grid (table view)
  MDXEditor (document editor)
  dnd-kit (drag and drop)
  @tauri-apps/api v2 (Rust bridge)
  Sonner (toasts)
  react-i18next (i18n)

Backend (Rust):
  Tauri v2 (desktop shell)
  Tokio (async runtime)
  rusqlite (SQLite)
  notify v8 (file watcher — present, see §10)
  usearch (vector similarity search)
  hound + symphonia (audio)
  csv + serde_yaml (vault export)

Embedding:
  llama.cpp (via HTTP sidecar process)
  Custom EmbeddingWorker (background chunk + embed pipeline)
  VectorStore (usearch + SQLite chunk metadata)
```

---

## 2. Vault Architecture

### 2.1 Source of Truth: The Vault Directory

```
<app_data_dir>/
  handy-vault/               ← vault root (defined in app_identity.rs)
    Daily Notes/
      daily-note-2026-04-20.md
    Mic Transcribe/
      Voice Memos — 2026-04-20.md   ← ISO format date; all recordings that day appended
    System Audio/
      2026-04-20-14-30-00.md       ← session start timestamp
    Imported Files/
      meeting-recording.mp3.vault.md  ← draft transcript
    databases/
      my-project/
        my-project.md          ← table: YAML frontmatter + CSV body
        calendar.md            ← calendar view
        board.md              ← board overview
        cards/
          <row-uuid>.md      ← each card as sub-document
    Page A.md                  ← root-level page
    Projects/
      Page B.md                ← nested page (path = Projects/Page B.md)
```

### 2.2 Frontmatter Format (Obsidian-compatible)

```yaml
---
id: <uuid>
parent_id: <parent-uuid or null>
title: Page Title
icon: 📄
created_at: 1713000000
updated_at: 1713000000
properties_json: '{}'
vault_version: 1
---
<body content as raw markdown>
```

### 2.3 Vault Path Computation

**Key file:** `managers/workspace/workspace_manager.rs` lines 1358–1400

```rust
// get_ancestor_chain(parent_id) → Vec<WorkspaceNode> in root→leaf order
// compute_vault_rel_path(node, &ancestor_chain) → "ancestor0/ancestor1/.../name.md"
```

**Rules:**
- Root-level pages: `handy-vault/<name>.md`
- Nested pages: `handy-vault/<parent-name>/<name>.md`
- Nested to any depth: walks ancestor chain
- Collision: appends first 8 chars of UUID (`my-note-a1b2c3d4.md`)
- Database stored as: `databases/<slug>.md` (table), `databases/<slug>/calendar.md`,
  `databases/<slug>/board.md`, `databases/<slug>/cards/<row-id>.md`

### 2.4 DB vs Vault Responsibilities

| Concern | Where handled |
|---|---|
| Node metadata (name, icon, parent, position) | Both: DB `workspace_nodes` + vault frontmatter |
| Document body (raw MDX) | Vault file body (source of truth); DB body is cache |
| Database field values | Vault CSV/YAML (source of truth) |
| FTS index | `workspace_fts` SQLite table (derived from vault) |
| Vector embeddings | `embeddings.usearch` + `embedding_chunks` SQLite table |
| Wikilinks edges | `page_links` SQLite table |
| Tree structure | DB `workspace_nodes.parent_id` (source of truth); derived from vault frontmatter on import |

### 2.5 ⚠️ Open Questions & Edge Cases

> The following are open questions that need resolution before implementation begins.

**Q1: Embedding — raw markdown or plain text?**
PLAN.md says "Use a simple strip function; no external parser needed for v1." The embedding
pipeline currently sends raw markdown body to `ChunkPipeline.chunk_text()`. Should we strip
markdown syntax (headings, bold, lists, etc.) to get plain text before embedding, or is
raw markdown acceptable? **Tradeoff:** Plain text produces cleaner semantic vectors that
reflect meaning rather than markup. Raw markdown is simpler but headers and emphasis become
noise in the embedding space.

**Q2: Database vault format versioning and backward compatibility**
The current `infield_version: 1` format in vault exports is set. When the format changes
(e.g., adding a new field type, changing a serialization format), how should the import
path handle older files? Options:
- (A) Forward-compat only — import fails gracefully on unknown fields, ignores them
- (B) Explicit version migration — `infield_version: 2` migration function runs on import
- (C) Always latest — ignore old format, require re-export from app

**Q3: Conflict resolution when vault file and SQLite diverge**
If the app is open and editing a database, and the user also edits the vault file
externally (in Obsidian), the two will diverge. The document system resolves this via
`get_node`'s mtime check (file wins if newer). Should the same rule apply to databases?
Or should SQLite always win for databases since they are edited primarily in-app?

**Q4: Board card frontmatter — is `title` stored separately or derived from `Name` field?**
In the table format, the primary column value is in the CSV body. In the board card format,
the YAML frontmatter has a `title:` field. These could get out of sync if a card's primary
field is renamed in table view but the card's YAML `title:` isn't updated. Should the card
file's `title:` be authoritative, or should it be derived from the table CSV on every load?

**Q5: Wikilinks in database cells — supported or not?**
PLAN.md defers wikilinks inside table rich-text cells. Is this still the plan for v2?
If so, the cell format in the CSV would need to store `node://uuid` links, and the
import path would need to resolve them.

**Q6: `voice_memo_mirror` props — is `note_id: <self>` correct?**
The mic transcription flow writes `props = {"voice_memo_mirror": {"note_id": "<self>",
"recorded_at_ms": <ms>, "audio_file_path": "..."}}`. The `note_id` points to the workspace
node's own ID. Is this intentional (a self-referential mirror), or should it reference
the legacy notes.db row that the voice memo would have created in the old system? Does
anything consume this `note_id` field today?

**Q7: External edit while app is open on the same document**
Today: `get_node` on navigation re-reads the vault file and syncs. But if the user has
the document open in the editor, the UI never learns about the external change. Options:
- (A) `window:focus` listener → re-fetch current node → push to editor
- (B) Keep as-is (navigate away and back)
- (C) Vault watcher (but see §10 — it's recommended for removal)

**Q8: `::voice_memo_recording{}` directive — stable format for re-import?**
The `::voice_memo_recording{path="..."}` directive written to daily note bodies is not
currently parsed on import. Should this directive be:
- (A) Ignored on import (treated as plain text)
- (B) Parsed and used to reconstruct a `voice_memo_mirror` property
- (C) Converted to a different format
This matters if users ever want to move their vault between installations.

**Q9: System audio file naming — collisions on same-minute sessions**
System audio session files are named by timestamp (`2026-04-20-14-30-00.md`). If two
sessions start in the same minute, the second overwrites the first. Should the filename
include a UUID suffix to guarantee uniqueness?

---

## 3. Note / Document Workflow

### 3.1 Creating a Note

**Trigger:** User presses `Cmd+N` or right-clicks → "Add child page"

**Call chain:**
```
Frontend: workspaceStore.navigateTo / tree context menu
  → invoke('create_node', { parent_id, name, icon })   [commands/workspace_nodes.rs:37]
    → WorkspaceManager.create_node()                   [workspace_manager.rs:1962]
      → create_node_raw()                             [workspace_manager.rs:1651]
        → INSERT workspace_nodes
    → sync_node_fts()  [inline in create_node_raw]
    → write_node_to_vault(app, &node)                 [workspace_manager.rs:1426]
      → get_ancestor_chain(parent_id)                 [line 1435]
      → compute_vault_rel_path(node, &ancestors)     [line 1436]
      → write temp file + rename() (atomic)
      → frontmatter + body written
    → update_vault_rel_path(node.id, &rel_path)       [workspace_manager.rs:1519]
    → embedding_worker.enqueue_index(node_id, body)
```

**Files involved:**
- `src-tauri/src/commands/workspace_nodes.rs` — `create_node` command
- `src-tauri/src/managers/workspace/workspace_manager.rs` — `create_node`,
  `create_node_raw`, `write_node_to_vault`, `get_ancestor_chain`,
  `compute_vault_rel_path`, `sync_node_fts`
- `src-tauri/src/managers/embedding_worker.rs` — background embedding pipeline

**Frontend:**
- `src/stores/workspaceStore.ts` — `createNode()`, `navigateTo()`
- `src/components/workspace/WorkspaceTree.tsx` — tree UI

### 3.2 Opening / Reading a Note

**Trigger:** User clicks a tree node

**Call chain:**
```
Frontend: workspaceStore.navigateTo(nodeId)
  → invoke('get_node', { id: nodeId })              [commands/workspace_nodes.rs:39]
    → WorkspaceManager.get_node(id)                   [workspace_manager.rs:1973]
      → DB read (SELECT FROM workspace_nodes WHERE id = ?)
      → IF vault_rel_path exists AND file_mtime > updated_at + 1s:
          → read_markdown_body_from_vault_file()    [app_identity.rs]
          → sync_document_body_from_vault()         [workspace_manager.rs:2024]
            → UPDATE body + updated_at = now
            → sync_node_fts()
            → replace_page_links_for_source()
            → embedding_worker.enqueue_index()
      → return updated node
    → Frontend renders MDXEditorView with node.body
```

**Files involved:**
- `src-tauri/src/commands/workspace_nodes.rs` — `get_node` command
- `src-tauri/src/managers/workspace/workspace_manager.rs` — `get_node`,
  `sync_document_body_from_vault`
- `src-tauri/src/app_identity.rs` — `resolve_vault_root`,
  `read_markdown_body_from_vault_file`
- `src/components/workspace/WorkspaceLayout.tsx` — routes to document/row/database shell
- `src/components/workspace/RowPageView.tsx` — row detail (body editor placeholder to complete)
- `src/components/editor/MDXEditorView.tsx` — MDX editor

### 3.3 Updating / Autosave

**Trigger:** 800ms debounce after last keystroke in editor

**Call chain:**
```
Frontend: MDXEditorView onChange → workspaceStore.handleEditorSave()
  → invoke('update_node', { id, name?, icon?, body?, properties_json? })
    → WorkspaceManager.update_node()                  [workspace_manager.rs:2112]
      → UPDATE workspace_nodes SET body = ?, updated_at = now
      → sync_node_fts()                              [workspace_manager.rs:3189]
        → replace_workspace_fts_row(conn, id, name, body)  [BEGIN IMMEDIATE transaction]
      → replace_page_links_for_source()              [extracts node://uuids from body]
      → write_node_to_vault(app, &node)             [async, atomic rename]
      → update_vault_rel_path()
      → embedding_worker.enqueue_index(node_id, plain_text)
```

**Files involved:**
- `src-tauri/src/commands/workspace_nodes.rs` — `update_node` command
- `src-tauri/src/managers/workspace/workspace_manager.rs` — `update_node`, `sync_node_fts`,
  `replace_workspace_fts_row`, `replace_page_links_for_source`, `write_node_to_vault`

### 3.4 Renaming a Node

Same as update — `update_node` command with a new `name`. The vault path recomputes
via `get_ancestor_chain` and the old file is deleted.

### 3.5 Moving / Reparenting a Node (Drag-and-drop in Tree)

**Trigger:** User drags a page to a new parent

**Call chain:**
```
Frontend: DnD drop → invoke('move_node', { id, parent_id, position })
  → WorkspaceManager.move_node(id, parent_id, position)   [workspace_manager.rs:2486]
    → UPDATE workspace_nodes SET parent_id = ?, position = ?, updated_at = now
    → sync_node_fts(&updated_node)                        [line 2501]
    → embedding_worker.enqueue_index()
  → commands/workspace_nodes.rs:move_node command wrapper:
    → write_node_to_vault(app, &node)                     [NEW parent path computed]
    → if old_rel_path != new_rel_path: delete old vault file
    → update_vault_rel_path(node.id, &new_rel_path)
```

**Files involved:**
- `src-tauri/src/commands/workspace_nodes.rs` — `move_node` command (lines 139–169)
- `src-tauri/src/managers/workspace/workspace_manager.rs` — `move_node` (lines 2486–2511)

### 3.6 Deleting a Node

**Trigger:** Delete key on tree node

```
invoke('soft_delete_node', { id })
  → WorkspaceManager.soft_delete_node(id)    [workspace_manager.rs]
    → UPDATE workspace_nodes SET deleted_at = now
    → sync_node_fts()  [deletes FTS row]
    → embedding_worker.enqueue_delete(id)
    → page_links cleanup

invoke('permanent_delete_node', { id })
  → deletes all descendants
  → deletes workspace_fts rows
  → deletes from page_links
  → DELETES vault files (both old and new path if moved)
```

---

## 4. Database Views (Table, Calendar, Board)

### 4.1 Current State

**Export:** ✅ Implemented (`export_database_to_vault`, `export_all_databases_to_vault`)
— writes vault files from SQLite state

**Import:** ❌ NOT built — the next major phase. Must be implemented to enable:
- Round-trip: export → edit externally in Obsidian → import back
- Vault files as true source of truth for databases
- Users migrating from other Obsidian-compatible tools

### 4.2 Table Export Format

**File:** `managers/workspace/vault/table.rs`

```
databases/<slug>.md
---
id: <uuid>
name: Table Name
icon: 🗃️
infield_version: 1
infield_type: table
created_at: 1713000000
updated_at: 1713000000
fields:
  - id: <uuid>
    name: Name
    type: rich_text
  - id: <uuid>
    name: Status
    type: single_select
    type_option:
      options:
        - id: <uuid>
          name: To do
          color: blue
        - id: <uuid>
          name: Done
          color: green
  - id: <uuid>
    name: Date
    type: date
    type_option:
      include_time: false
views:
  - id: <uuid>
    name: Table
    layout: table
    filters: '[]'
    sorts: '[]'
    view_options: '{}'
---
_id,_name,_status,_date
<row-uuid>,Task name,"To do",2026-04-20
<row-uuid>,Another,"Done",
```

### 4.3 Calendar Export Format

**File:** `managers/workspace/vault/calendar.rs`

```
databases/<slug>/calendar.md
---
[id/title/frontmatter same as table]
---
- [ ] Task name
  id: <row-uuid>
  date: 2026-04-20
  #tag
```

### 4.4 Board Export Format

**File:** `managers/workspace/vault/board.rs`

```
databases/<slug>/board.md
---
[header frontmatter]
---
## To Do
## In Progress
## Done

databases/<slug>/cards/<row-uuid>.md
---
id: <row-uuid>
column_option_id: <selected-option-uuid>
position: 1.0
parent_id: <board-uuid>
title: Task name
created_at: 1713000000
updated_at: 1713000000
---
Task description body (raw markdown)
```

### 4.5 Import + Export: Unified Source of Truth for Databases

Both import AND export are required for vault-as-source-of-truth to work for databases.
This is the next major implementation phase.

**Export (already done):**
```
SQLite state (workspace_nodes.row + node_views)
  → VaultManager.export_database_to_vault()
  → writes databases/<slug>.md (table), calendar.md, board.md, cards/<id>.md
```

**Import (to build):**
```
Vault files (databases/<slug>.md, cards/<id>.md)
  → parse YAML frontmatter + CSV body
  → populate workspace_nodes.row + node_views + field_definitions
  → index in workspace_fts
```

**Design principles for import:**
1. **Load on open:** When a user opens a database, read its vault file(s) and
   populate the SQLite tables from it. If the vault file is missing, fall back to
   the SQLite cache (if any), or show an error.
2. **File wins on mtime:** Same as documents — if vault file is newer than SQLite
   state, import wins. This is the core invariant of vault-as-truth.
3. **Partial edit protection:** If the vault file is malformed (missing required fields,
   unparseable CSV), import should fail gracefully with a visible error, not corrupt
   the SQLite state. The existing SQLite cache should be preserved on import failure.
4. **`infield_version` migration:** If a vault file has a higher `infield_version` than
   the importer understands, it should either (a) fail with a clear error, or (b)
   attempt best-effort import of known fields, preserving unknown fields as JSON.
   **Q2 (above) must be resolved before implementing import.**
5. **Board cards loaded from `cards/<id>.md` files:** On database open, scan the
   `cards/` subdirectory and load each card's frontmatter + body to reconstruct
   the rows table. **Q4 (above) must be resolved before implementing board import.**

**Planned implementation order (matches migration.md §5b):**
1. Table import (CSV + frontmatter → `workspace_nodes.row`)
2. Board import (card sub-docs → rows, board.md → view metadata)
3. Calendar import (Obsidian Tasks → rows with date field)

**Planned approach:**
1. **Table as canonical source** — the CSV in `databases/<slug>.md` defines the rows
2. **Board as view** — reads table CSV, groups by `column_option_id` from card YAML,
   writes card sub-docs on cell/edit
3. **Calendar as view** — reads table CSV, filters by date field, renders Obsidian Tasks

**Files to create/modify for import:**
- `src-tauri/src/managers/workspace/vault/import.rs` — new import module
- `src-tauri/src/managers/workspace/vault/table_import.rs` — CSV + YAML parser for tables
- `src-tauri/src/managers/workspace/vault/board_import.rs` — card sub-doc parser
- `src-tauri/src/managers/workspace/vault/calendar_import.rs` — Obsidian Tasks parser
- `src-tauri/src/commands/vault_sync.rs` — add `import_database_from_vault` command
- `src-tauri/src/managers/workspace/workspace_manager.rs` — add `load_database_from_vault()`
- Frontend: `DatabaseShell.tsx` — call import on open if vault is newer

---

## 5. Transcribe Workflows

### 5.1 Overview

Three independent transcription paths, all writing to `workspace.db` + vault:

| Source | Entry point | File | Folder strategy | Vault write timing |
|---|---|---|---|---|
| File Import | `ImportQueueService::run_import_media` | `import/mod.rs` | Creates `Imported Files/` folder; nested imports go under it | Finalization only (not per-segment) |
| Mic Transcription | `actions.rs:process_transcription_output` | `actions.rs` | Daily note under `Mic Transcribe/`; all recordings same day appended to one doc | Every append (streaming) |
| System Audio | `start_loopback` / `stop_loopback` | `system_audio.rs` | Creates `System Audio/` folder; one doc per session | Per-chunk (1s interval) + final |

### 5.2 File Import Flow

**Trigger:** User drops/selects audio file in ImportTab

**Files involved:**
- `src-tauri/src/import/mod.rs` — `ImportQueueService`, `run_import_media`
- `src-tauri/src/import/segmenting.rs` — Silero VAD segmentation
- `src-tauri/src/managers/transcription.rs` — TranscriptionManager
- `src-tauri/src/managers/workspace/workspace_manager.rs` — `create_document_child`,
  `update_node_body_persist_only`, `write_node_to_vault`

**Step-by-step:**

```
1. enqueue_paths(paths) → ImportQueueService job queued

2. Worker picks up job → state = Segmented
   → ffmpeg converts to 16kHz WAV if needed
   → Silero VAD segments → segments.json

3. state = DraftCreated
   → ensure_file_import_folder() → creates/finds "📁 Imported Files" root doc
     → write_node_to_vault() at folder creation [workspace_manager.rs:1610]
   → create_document_child(folder_id, title, "🎙️", "")
     → INSERT workspace_nodes (body = "")
     Note: draft node's vault write happens at finalization step 8

4. state = Transcribing
   For each segment:
   → read_wav_samples_range(tmp_wav, start, end)
   → tauri::spawn_blocking → tm.transcribe(samples)
   → buffered_fragment += <!-- seg:N --> + text
   → flush_import_buffer() when:
       buffered_fragment chars >= 4_000  OR  2 seconds elapsed
     → get_node(note_id) → read current body
     → next_body = existing.body + fragment
     → update_node_body_persist_only(note_id, next_body)
         → UPDATE workspace_nodes SET body = ?
         → sync_node_fts()  [BEGIN IMMEDIATE transaction]
     ⚠️ vault NOT written during transcription

5. state = PostProcessing
   → post_process_import_transcript() → LLM cleanup

6. state = Finalizing
   → update_node_body_persist_only(note_id, final_body)
       → UPDATE + sync_node_fts()
   → finalize_node_search_index(note_id)
       → embedding_worker.enqueue_index()
   → sync_workspace_document_to_vault()
       → write_node_to_vault(app, node)  ← SECOND vault write (with full body)
       → update_vault_rel_path(node.id, &rel_path)
   → emit_workspace_import_synced()
```

**Key constants** (`import/mod.rs:39-40`):
- `IMPORT_DB_FLUSH_INTERVAL = 2s`
- `IMPORT_DB_FLUSH_MAX_CHARS = 4_000`

### 5.3 Mic Transcription Flow (Push-to-Talk and Always-On)

**Files involved:**
- `src-tauri/src/actions.rs` — `TranscribeAction::start()`,
  `process_transcription_output`, `maybe_create_note_from_transcription`,
  `append_transcription_to_voice_doc`
- `src-tauri/src/transcription_coordinator.rs` — `TranscriptionCoordinator`,
  hotkey routing
- `src-tauri/src/managers/audio.rs` — `AudioRecordingManager`, VAD, frame buffering
- `src-tauri/src/managers/voice_session.rs` — `VoiceSessionManager`
- `src-tauri/src/transcription_workspace.rs` — shared helpers
- `src-tauri/src/managers/workspace/workspace_manager.rs` — `create_document_child`,
  `create_document_child_with_properties`, `update_node_body_persist_only`,
  `write_node_to_vault`, `ensure_transcription_folder`

**Trigger:** Hotkey press → `ACTION_MAP["transcribe"].start()` →
`AudioRecordingManager.try_start_recording()`

**On hotkey release → `process_transcription_output()`:**

```
process_transcription_output(app, raw_text, post_process=true)
  → post_process_transcription() if enabled
  → maybe_create_note_from_transcription(app, final_text, audio_path)

maybe_create_note_from_transcription(app, text, audio_path):
  1. VoiceSessionManager.get_workspace_doc_id() → cached daily doc id
     → get_node(cached_id) → if name == today_title: append_transcription_to_voice_doc()
  2. get_root_nodes() → find "Mic Transcribe" folder
  3. Find first child with name == today_title
     → found: append_transcription_to_voice_doc()
  4. Not found: create new daily doc
     → ensure_transcription_folder("Mic Transcribe")
         → creates root doc "Mic Transcribe" if missing
         → write_node_to_vault(app, &node)  [root folder vault write]
     → create_document_child_with_properties(folder_id, today_title, "🎙️", body, props)
         → body = "::voice_memo_recording{path=\"...\"}\n\nTranscript text"
         → props = {"voice_memo_mirror": {"note_id": "<self>", "recorded_at_ms": <ms>, "audio_file_path": "..."}}
         → write_node_to_vault(app, &node)  [daily doc vault write]
     → VoiceSessionManager.set_workspace_doc_id(created.id)
     → emit_workspace_transcription_synced()

append_transcription_to_voice_doc(app, state, existing_doc, transcription, audio_path):
  next_body = append_markdown_note_content(existing.body, voice_memo_recording_block(audio_path, text))
  → update_node_body_persist_only(doc.id, next_body)
      → UPDATE + sync_node_fts()
  → write_node_to_vault(app, updated)
      → update_vault_rel_path()
  → emit_workspace_node_body_updated_throttled()  [1s throttle per node]
```

**Daily note naming: ISO format `Voice Memos — YYYY-MM-DD`** (e.g., `Voice Memos — 2026-04-20`)
— Note: code currently uses `M/D/YYYY` format. Must be changed to ISO before deployment.

**`::voice_memo_recording{}` directive format:**
```
::voice_memo_recording{path="<escaped-audio-path>"}

<transcript text>
```
- Path backslashes and quotes are escaped: `"` → `\"`, `\` → `\\`
- Multiple recordings in the same daily note are separated by double newlines
- **Q8 (open question above):** This directive is written but not currently parsed on import

**Always-on mode:** Each hotkey press/release is one recording session; appends to the same daily doc
**On-demand mode:** Same behavior — one doc per day, all recordings appended

### 5.4 System Audio Flow

**Files involved:**
- `src-tauri/src/managers/system_audio.rs` — `start_loopback()`, `stop_loopback()`
- `src-tauri/src/transcription_coordinator.rs` — `Command::SystemAudioToggle`

**Trigger:** Tray/hotkey toggle → `start_loopback()`

**During recording (every 1 second):**
```
LoopbackCapture fires on_chunk callback with text
→ render_paragraphs_markdown(paragraphs) → text
→ ensure_system_audio_folder() → "🔊 System Audio" root doc
  → write_node_to_vault() for root folder [system_audio.rs:287]
→ create_workspace_system_audio_doc() if first chunk:
  → create_document_child(folder_id, title, "🔊", "")
  → write_node_to_vault()  [initial vault write]
  → workspace_session_doc_id = doc.id
→ if should_persist (1s elapsed):
  → update_node_body_persist_only(ws_doc_id, text)
      → UPDATE + sync_node_fts()
  → write_node_to_vault(app, node)  [per-chunk vault mirror]
  → update_vault_rel_path()
  → emit_workspace_node_body_updated_throttled()
  → emit_workspace_transcription_synced()
  → last_workspace_persist_ms = now
```

**On stop:** `stop_loopback()` → final `update_node_body_persist_only` →
`finalize_node_search_index` → `write_node_to_vault` (final)

**System audio session file naming:** `YYYY-MM-DD-HH-MM-SS.md` (from session start time).
**Q9 (open question above):** If two sessions start in the same minute, the second
overwrites the first. UUID suffix recommended for collision safety.

**Key constant** (`system_audio.rs:24`):
- `WORKSPACE_PERSIST_INTERVAL_MS = 1000` (1 second)

### 5.5 Transcribe → Vault → Embedding Pipeline (Full Path)

For ALL three flows, the final step after vault write is the same:

```
embedding_worker.enqueue_index(node_id, plain_text)
  → mpsc channel → EmbeddingWorker loop
  → ChunkPipeline.chunk_text(id, &text)  [chunking.rs — recursive Unicode-aware
    splitting, 300-char target, 50-char overlap]
  → EmbeddingManager.embed_batch(chunks)  [HTTP to llama.cpp sidecar]
  → VectorStore.delete_by_note(node_id)  [remove old chunks]
  → VectorStore.upsert_chunk() per chunk  [writes to embeddings.usearch + vectors.db]
  → emit "note-indexed" event to frontend
```

**⚠️ Q1 (embedding raw MDX — see §2.5):** The pipeline currently sends raw markdown
body. A markdown-strip function should be added before chunking to produce cleaner
semantic vectors. This affects all three transcription flows.

---

## 6. Embedding Pipeline — Full Detail

### 6.1 Components

| Component | File | Role |
|---|---|---|
| `EmbeddingManager` | `managers/embedding.rs` | HTTP client to llama.cpp sidecar; `is_available()` gate |
| `EmbeddingWorker` | `managers/embedding_worker.rs` | Background task; receives jobs via mpsc channel |
| `ChunkPipeline` | `managers/chunking.rs` | Splits text into overlapping chunks (~300 chars) |
| `VectorStore` | `managers/vector_store.rs` | usearch index + SQLite chunk metadata |
| Sidecar process | `src-tauri/src/bin/handy-embedding-sidecar.rs` | llama.cpp HTTP server (Axum), runs on separate thread |
| `SearchManager` | `managers/search.rs` | Hybrid FTS5 + vector via RRF |

### 6.2 Sidecar Startup (lib.rs:322-449 — pending removal)

```
setup():
  → SidecarProcess::new()  [spawns child process]
    → finds llama-model in resources/models/
    → starts HTTP server on dedicated tokio thread
    → health polling until ready
  → EmbeddingManager::new()  [creates HTTP client]
  → EmbeddingWorker::new()   [spawns mpsc receiver task]
  → WorkspaceManager.set_embedding_worker()
```

### 6.3 Chunking Detail (managers/chunking.rs)

Recursive Unicode-aware text splitter:
- Target chunk size: ~300 chars
- Overlap: 50 chars (to preserve context at boundaries)
- Respects word boundaries (never splits mid-word)
- Skips boilerplate sections (handles `---` frontmatter separators)

### 6.4 Vector Store Detail (managers/vector_store.rs)

```
SQLite table: embedding_chunks
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  block_id TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL DEFAULT '1.0',
  is_stale INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL

usearch index: embeddings.usearch
  1536-dimensional vectors (all-MiniLM-L6-v2)
  Cosine similarity metric
  Post-load reserve(index.size() + 1024)  [prevents "Reserve capacity" errors on reload]
```

### 6.5 Hybrid Search Flow

```
search_workspace_hybrid(query, limit=20)
  → FTS5: SELECT node_id, title, snippet(workspace_fts, ...) WHERE workspace_fts MATCH ?
  → Vector: usearch search(query_embedding, k=limit*2) → filtered by workspace node existence
  → RRF (Reciprocal Rank Fusion): merge keyword rank + semantic rank
  → return WorkspaceSearchResult[]
```

### 6.6 SearchManager is Shared

The same `SearchManager` handles both legacy notes and workspace nodes.
`search_notes_hybrid` (legacy) and `search_workspace_hybrid` (new) are separate
Tauri commands but share the same `SearchManager` instance.

---

## 7. FTS Corruption — Why It Happens and How Healing Works

### 7.1 The Root Cause

**FTS5 virtual tables** use shadow tables (an internal `content` table and an `idx`
table of inverted indices). When SQLite does a `DELETE` and then an `INSERT` on the
same FTS row in separate transactions, FTS5 may reuse the same `rowid` across
different segments. If a crash or busy-timeout occurs between the DELETE and the
INSERT, the `rowid` pool becomes inconsistent — producing a **malformed inverted
index**.

**Specific trigger in this codebase:** `replace_workspace_fts_row` did a bare
`DELETE + INSERT` in two separate implicit transactions. Without `BEGIN IMMEDIATE`,
concurrent writers (autosave + watcher) could interleave:

```
Thread A: DELETE FROM workspace_fts WHERE node_id = ?     [rowid N freed]
Thread B: DELETE FROM workspace_fts WHERE node_id = ?     [rowid N freed again, no-op]
Thread A: INSERT (same node_id, new content)             [gets rowid N]
Thread B: INSERT (same node_id, newer content)           [overwrites at rowid N — idx broken]
```

### 7.2 The Fix (workspace_manager.rs:1183–1212)

```rust
fn replace_workspace_fts_row(conn: &Connection, node_id: &str, title: &str, body: &str) -> Result<(), String> {
    // BEGIN IMMEDIATE: acquires a write lock immediately, not at first write.
    // Prevents concurrent writers from interleaving DELETE and INSERT.
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| {
        Self::delete_workspace_fts_row(conn, node_id)?;  // idempotent DELETE
        conn.execute("INSERT INTO workspace_fts ...", params![node_id, title, body])?;
        Ok(())
    })();
    match result {
        Ok(()) => conn.execute_batch("COMMIT"),
        Err(e) => { let _ = conn.execute_batch("ROLLBACK"); Err(e) }
    }
}
```

**Key changes:**
1. `BEGIN IMMEDIATE` instead of implicit transaction — blocks other writers immediately
2. `delete_workspace_fts_row` now checks `EXISTS` before DELETE — idempotent
3. No `rowid` reuse across the DELETE/INSERT gap

### 7.3 The Healing / Startup Repair

**File:** `managers/workspace/workspace_manager.rs` lines 1236–1264 (`probe_and_repair`)

```rust
pub fn probe_and_repair(&self) -> Result<(), String> {
    // Called once at startup after ensure_workspace_fts_populated
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if check != "ok" {
        log::warn!("[workspace] quick_check failed: {}. Running REINDEX.", check);
        for table in &["workspace_fts", "notes_fts"] {
            if let Err(e) = conn.execute(&format!("REINDEX {}", table), []) {
                if table == "workspace_fts" {
                    self.rebuild_workspace_fts_locked(&mut conn)?;  // full rebuild
                }
            }
        }
    }
    Ok(())
}
```

`rebuild_workspace_fts_locked` (lines 1928–1937): drops and recreates the `workspace_fts`
virtual table, then repopulates from `workspace_nodes` (SELECT + INSERT).

### 7.4 Why the Badge Still Shows Red Sometimes

The health badge is driven by `record_db_health_from_error` which pattern-matches error
strings. A `malformed` keyword in any SQLite error routes through this and flips the badge.
The `probe_and_repair` fix should clear this on restart, but:
- If `quick_check` runs before migrations complete, it may not catch corruption
- If corruption accumulates during active use (from concurrent writes without
  `BEGIN IMMEDIATE`), the badge turns red next time an error surfaces
- The `BEGIN IMMEDIATE` fix prevents NEW corruption but doesn't retroactively heal
  existing corruption

---

## 8. Workspace DB vs Notes DB Architecture

### 8.1 Double-Connection Problem

Both `WorkspaceManager` and `NotesManager` open `workspace.db` independently:
- `WorkspaceManager` uses one `Arc<Mutex<Connection>>`
- `NotesManager` opens a second connection to the same file via `open_shared_database`

**Why this matters:** WAL checkpoints from the notes connection can interleave with
workspace writes. `BEGIN IMMEDIATE` on FTS operations mitigates this but doesn't
eliminate it. This is a known architectural issue — in v1 it works because writes
are serialized through individual `BEGIN IMMEDIATE` transactions.

### 8.2 WAL Mode

Enabled at `lib.rs:222` (WorkspaceManager startup):
```rust
ws_conn.pragma_update(None, "journal_mode", "WAL")?;
ws_conn.pragma_update(None, "synchronous", "NORMAL")?;  // safe: WAL + NORMAL
ws_conn.pragma_update(None, "busy_timeout", 5000)?;     // 5s wait on SQLITE_BUSY
ws_conn.pragma_update(None, "cache_size", -32000)?;     // 32MB
ws_conn.pragma_update(None, "temp_store", "MEMORY")?;
```

---

## 9. All Key File Reference

### 9.1 Rust Backend Files

| File | Purpose |
|---|---|
| `src-tauri/src/lib.rs` | App setup, DB connections, command registration, vault watcher (pending removal — see §10) |
| `src-tauri/src/commands/workspace_nodes.rs` | Tauri commands: `get_node`, `create_node`, `update_node`, `move_node`, `soft_delete_node`, `permanent_delete_node` |
| `src-tauri/src/managers/workspace/workspace_manager.rs` | Core workspace logic: CRUD, FTS, vault I/O, path computation |
| `src-tauri/src/managers/workspace/vault/mod.rs` | `VaultManager` orchestrator for database export |
| `src-tauri/src/managers/workspace/vault/table.rs` | Table export: YAML frontmatter + CSV |
| `src-tauri/src/managers/workspace/vault/calendar.rs` | Calendar export: Obsidian Tasks format |
| `src-tauri/src/managers/workspace/vault/board.rs` | Board export: main file + card sub-docs |
| `src-tauri/src/managers/workspace/vault/format.rs` | Shared types, cell serialization, YAML/CSV helpers |
| `src-tauri/src/managers/workspace/vault/table_import.rs` | ⚠️ TO CREATE — table import (CSV + YAML → workspace_nodes.row) |
| `src-tauri/src/managers/workspace/vault/board_import.rs` | ⚠️ TO CREATE — board import (card sub-docs → rows) |
| `src-tauri/src/managers/workspace/vault/calendar_import.rs` | ⚠️ TO CREATE — calendar import (Obsidian Tasks → rows) |
| `src-tauri/src/managers/embedding.rs` | EmbeddingManager: HTTP client to llama.cpp sidecar |
| `src-tauri/src/managers/embedding_worker.rs` | EmbeddingWorker: mpsc consumer for background indexing |
| `src-tauri/src/managers/vector_store.rs` | VectorStore: usearch + SQLite chunk metadata |
| `src-tauri/src/managers/chunking.rs` | ChunkPipeline: recursive text chunker |
| `src-tauri/src/managers/search.rs` | SearchManager: hybrid FTS5 + vector RRF |
| `src-tauri/src/managers/notes.rs` | NotesManager: legacy notes (do not extend) |
| `src-tauri/src/managers/system_audio.rs` | LoopbackCapture, start/stop_loopback |
| `src-tauri/src/managers/audio.rs` | AudioRecordingManager, VAD, frame buffer |
| `src-tauri/src/managers/voice_session.rs` | VoiceSessionManager: daily doc pointer per session |
| `src-tauri/src/actions.rs` | Mic transcription: TranscribeAction, `process_transcription_output`, `maybe_create_note_from_transcription`, `append_transcription_to_voice_doc` |
| `src-tauri/src/import/mod.rs` | ImportQueueService, `run_import_media`, `flush_import_buffer` |
| `src-tauri/src/transcription_coordinator.rs` | TranscriptionCoordinator: hotkey routing for mic + system audio |
| `src-tauri/src/transcription_workspace.rs` | Shared helpers: `emit_workspace_node_body_updated_*`, `emit_workspace_transcription_synced` |
| `src-tauri/src/app_identity.rs` | `resolve_vault_root()`, `read_markdown_body_from_vault_file()`, app name/vault dir constants |

### 9.2 Frontend Files

| File | Purpose |
|---|---|
| `src/stores/workspaceStore.ts` | Single source of truth for workspace navigation, active node, recents, favorites |
| `src/components/workspace/WorkspaceLayout.tsx` | Page router: document/row/database shell |
| `src/components/workspace/WorkspaceTree.tsx` | Left sidebar tree (reads workspace_nodes flat query, builds parent→children map in JS) |
| `src/components/workspace/GridView.tsx` | Table/grid view via Glide Data Grid |
| `src/components/workspace/CalendarView.tsx` | Calendar view (schedule-x) |
| `src/components/workspace/BoardView.tsx` | Board view |
| `src/components/workspace/DatabaseShell.tsx` | Database page shell: header, toolbar, view switcher |
| `src/components/workspace/RowPageView.tsx` | Row detail page (body editor placeholder to complete) |
| `src/components/workspace/ViewSwitcher.tsx` | Linked-view tab strip |
| `src/components/editor/MDXEditorView.tsx` | MDX editor (takes/emits raw markdown) |
| `src/components/database/DatabaseContainer.tsx` | Legacy bridge stub (kept for compat) |

---

## 10. The Vault Watcher — Current State and Recommended Removal

### 10.1 What It Does

**File:** `src-tauri/src/lib.rs` lines 322–449

At startup, a `notify::RecommendedWatcher` is spawned in a background thread watching
`handy-vault/`. On every `.md` file change:
1. Looks up `node_id` from vault file's `id:` frontmatter
2. Calls `workspace_manager.reindex_node_fts(node_id)` — does `DELETE + INSERT` on `workspace_fts`
3. Enqueues embedding reindex
4. Emits `vault-file-changed` to frontend (nothing consumes this event)

### 10.2 Why It Should Be Removed

**Cascade risk (confirmed by code review):** `reindex_node_fts` calls `replace_workspace_fts_row`
which uses `BEGIN IMMEDIATE`. The watcher path is now safer with that fix — but the watcher
path has never been tested in that context.

**Not solving the real UX problem:** If a user edits a file in Obsidian while the same
document is open in Handy, the watcher detects the change and reindexes FTS — but the
UI still shows the old body because the frontend has no listener for `vault-file-changed`.
The watcher was dead code for the UI update path.

**Redundant with pull-based sync:** `get_node` on navigation already reads the newer file
and syncs it back to DB. External edits are picked up on next navigation.

**Complexity with no benefit:** The watcher adds a thread, debounce logic (500ms), and
IPC surface area for a scenario (external edit while app is open on the same doc) that
is rare and has no UI feedback anyway.

### 10.3 What to Remove

- `START_VAULT_WATCHER` Once block in `lib.rs`
- The `notify::RecommendedWatcher` thread and callback closure
- The `vault-file-changed` event emission
- Keep the `notify` crate in `Cargo.toml` (other use possible)
- Remove `reindex_node_fts` if nothing else calls it (confirmed: only the watcher calls it)

**What stays:** The `+1s` mtime buffer in `get_node` (line 60) is still useful as a guard
against our own writes creating mtime slightly ahead of DB commit time.

---

## 11. Remaining Gaps (Priority Order)

| Priority | Item | Why |
|---|---|---|
| **P0** | **Remove vault watcher** (§10) | Complexity, dead UI code, cascade risk |
| **P0** | **Database import** — vault files → `workspace_nodes.row` + `node_views` | Without this, databases are write-to-vault-but-never-read-back. Can't round-trip |
| **P0** | **Board card editing** — cell edits write back to `cards/<id>.md` | Without this, board is write-once on export; edits don't persist to vault |
| **P1** | **`window:focus` re-fetch** — external edits while doc is open | **Q7 (open question):** Implement focus re-fetch, or accept navigate-away-and-back UX |
| **P1** | **Delete old vault files on rename/move** | `update_node` writes new vault file but doesn't delete old slug path; `move_node` handles it, but `update_node` rename path may not |
| **P1** | **Mic transcription daily note → ISO format** | Currently `M/D/YYYY`; must change to `YYYY-MM-DD` for filesystem sortability |
| **P2** | **System audio collision-safe naming** | **Q9:** Add UUID suffix to prevent same-minute session overwrites |
| **P2** | **`sync_all_nodes_to_vault` UI button** | Users may have old notes not yet in vault |
| **P2** | **`workspace_fts` population on first launch** | `ensure_workspace_fts_populated` exists; is it called at startup? |
| **P2** | **Embedding markdown stripping** | **Q1:** Strip markdown syntax before embedding for cleaner semantic vectors |
| **P3** | **Graph view** | Data is ready via `page_links`; UI deferred |

---

## 12. Open Questions Summary

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | Embedding — raw markdown or plain text? | (A) Raw markdown; (B) Strip to plain text | **B** — cleaner semantic vectors; PLAN.md already calls for this |
| Q2 | Database vault format backward compat on import? | (A) Fail gracefully; (B) Version migration; (C) Always latest | **A** — fail with clear error; preserve SQLite state on failure |
| Q3 | Conflict: vault file and SQLite both edited externally? | (A) File wins (same as documents); (B) SQLite always wins | **A** — consistent with document model; file mtime wins |
| Q4 | Board card `title:` in YAML — authoritative or derived from CSV? | (A) YAML authoritative; (B) Derived from table CSV on load | **B** — single source of truth in table CSV; avoids sync drift |
| Q5 | Wikilinks in database rich-text cells — supported? | (A) Yes in v2; (B) Never; (C) Deferred | **A** — deferred v2; PLAN.md already says this |
| Q6 | `voice_memo_mirror.note_id` — self-referential, correct? | Yes or no | Unclear — **needs verification**; nothing consumes this field today |
| Q7 | External edit while doc is open — UX approach? | (A) `window:focus` re-fetch; (B) Navigate away/back; (C) Keep watcher | **A** — lightweight, no watcher complexity |
| Q8 | `::voice_memo_recording{}` directive — parse on import? | (A) Ignore (plain text); (B) Parse and reconstruct mirror; (C) Convert format | **A** — simplest; mirrors not critical for function |
| Q9 | System audio filename collision — same-minute sessions? | (A) Add UUID suffix; (B) Keep as-is | **A** — UUID suffix is safe and low-cost |

---

*This document should be given to any Claude Opus instance taking over this project.
All code paths have been verified against the actual source. If something contradicts
the source, the source is authoritative.*
