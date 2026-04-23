# Pitfall log

Engineering traps we have hit in this repo: **workspace board DnD** (frontend) and **Windows input simulation** (Tauri / Rust).

## Workspace board drag-and-drop

This note captures **why board DnD bugs were hard to diagnose**, **what actually broke**, **what we changed**, and **whether the approach should evolve**.

---

### Symptoms (what users saw)

- Cards on the Kanban board **did not drag** (no reorder, no cross-column moves).
- Double-click on cards used to swap the whole workspace to the row page (now opens an **edit modal** instead; see “Code layout” below).
- Sometimes **“no debug output”** while investigating: HTTP ingest logging was expected to write a file, but nothing appeared unless the Tauri-side NDJSON path was used.

---

### Why this took so long to find

Several issues **stacked** and **masked** each other:

1. **Wrong mental model for “debug not firing”**  
   Instrumentation that `fetch()`es a local ingest server only produces a log file **if that server is running**. The app’s reliable path was **Tauri `append_cursor_debug_log` → `debug-840aad.log`**. Chasing “no logs” without confirming which transport was active burned time.

2. **`@dnd-kit` gives almost no signal when activators are empty**  
   When sortable **`listeners` is `{}`**, there is no `onPointerDown` / `onMouseDown` to activate a drag. The UI still renders; nothing obvious breaks in the console. You only see it if you log `Object.keys(listeners)` (or equivalent).

3. **PointerSensor vs MouseSensor**  
   If custom handlers **spread after** `{...listeners}` or replace kit handlers, **MouseSensor** paths (`onMouseDown`) can be dropped. Docs and Stack Overflow often assume Pointer-only. Easy to “fix” logging and accidentally **remove** the real activators.

4. **Invalid PointerSensor options**  
   A **`tolerance` smaller than `distance`** (or inconsistent activation constraints) can make activation **mathematically impossible**. Again, little runtime noise—drag just never starts.

5. **Nested `SortableContext` id collided with the column’s sortable id**  
   Inner card list used `SortableContext id={columnId}` while the column row also used `useSortable({ id: columnId })`. **Same string for container vs item** in nested sortables is a subtle `@dnd-kit` footgun; it showed up as **empty `listenerKeys`** on cards, not as a thrown error.

6. **Cross-database “board” was a different failure mode**  
   Each `BoardView` wraps the board in its **own `DndContext`**. The sidebar tree uses **another `DndContext`**. Dragging a card “onto” another database in the tree **never** produces an `over` in the board context—by design in dnd-kit, not a small bug. That looked like “still broken” after intra-board drag was fixed.

---

### What was wrong (root causes)

| Area | Problem |
|------|--------|
| Sensors / DOM | Activators missing or overridden; bad activation constraints. |
| Nested sortables | Inner `SortableContext` **id** reused the column’s draggable **id**. |
| Architecture | **Multiple isolated `DndContext`s** → no `over` for cross-surface drops. |
| Observability | HTTP-only debug vs Tauri file log; easy to conclude “code didn’t run”. |

---

### What we fixed (to make it work)

#### Intra-board (same database)

1. **PointerSensor configuration** — Removed invalid `tolerance` / `distance` combinations; kept a sensible `distance` threshold so drags actually start.
2. **Preserve `{...listeners}`** — Capture-phase logging only; **never** replace or spread on top of kit listeners in a way that drops `onMouseDown` / `onPointerDown`.
3. **Nested `SortableContext` id** — Inner card context id changed from `columnId` to a **distinct** value (e.g. `board-cards:${columnId}`) so it does not collide with the column `useSortable` id.
4. **Touch / pointer** — e.g. `touchAction: 'none'` on cards where needed for consistent pointer behavior.
5. **Sensors list** — Stable `SensorDescriptor` list (Pointer + Keyboard) so behavior isn’t accidentally churning.

#### Cross-database (board → another database)

6. **Pointer hit-testing on drag end** — When `over` is `null` (expected for a different DndContext), use **last pointer position** + `document.elementsFromPoint` + stable **`data-*` attributes** on the tree and board strip to detect **target database id**, then **`moveNode`** + reload children for the source DB.
7. **Tree DOM metadata** — e.g. `data-workspace-node-type`, `data-workspace-node-id`, and for rows `data-workspace-row-parent-id` so drops on nested rows still resolve the parent database.

#### Debugging ergonomics

8. **NDJSON via Tauri** to a known workspace log file when ingest HTTP is unavailable.
9. **`sessionStorage` fallback** when `invoke('append_cursor_debug_log')` fails (e.g. non-Tauri web build).

---

### Do we need to do this differently?

**Short answer:** Intra-board fixes belong exactly where they are (local to `BoardView` / columns / cards). **Cross-surface moves** are the awkward part: dnd-kit does not span sibling `DndContext`s, so either we **accept a hybrid** (kit inside board + explicit pointer/DOM bridge for workspace moves) or we **redesign**.

| Approach | Pros | Cons |
|----------|------|------|
| **Current hybrid** (dnd-kit + hit-test for cross-DB) | Small, localized; no mega-refactor. | Two models for “drop”; must keep `data-*` and pointer tracking in sync. |
| **Single top-level `DndContext`** wrapping tree + main | One collision model; true `over` everywhere. | Large refactor; risk of id collisions and merged sensor/drag logic for tree vs board. |
| **HTML5 drag-and-drop for “export row”** | Natural cross-boundary story. | Second implementation path; accessibility and kit coexistence. |

**Recommendation:** Keep **dnd-kit** for **within-board** mechanics. For **workspace-level** reparenting (tree, another DB, future split panes), prefer either the **current hit-test bridge** or a **small explicit “move row” API** (context menu / command palette) as a non-drag fallback. If split views ever show **two boards at once**, the `data-workspace-board-database-id` hook is already there to extend the same hit-test.

---

### Code layout (post-refactor)

Board concerns are split so the next reader sees **in-board DnD** vs **cross-surface reparenting** vs **card editing**:

| Area | Location |
|------|-----------|
| `data-*` contract for tree + board strip | [`src/components/workspace/board/workspaceDropDataAttrs.ts`](../src/components/workspace/board/workspaceDropDataAttrs.ts) — keep in sync with `WorkspaceTree` and `boardCrossWorkspaceDrop`. |
| Hit-test | [`board/boardCrossWorkspaceDrop.ts`](../src/components/workspace/board/boardCrossWorkspaceDrop.ts) (Vitest: `board/boardCrossWorkspaceDrop.test.ts`). |
| Pointer tracking during drag | [`board/useBoardDragPointer.ts`](../src/components/workspace/board/useBoardDragPointer.ts). |
| Cross-DB move on drag end | [`board/applyCrossDatabaseBoardDrop.ts`](../src/components/workspace/board/applyCrossDatabaseBoardDrop.ts). |
| In-board card persistence after drag | [`board/boardCardDropPersistence.ts`](../src/components/workspace/board/boardCardDropPersistence.ts). |
| Card title + body preview | [`board/boardCardPreview.ts`](../src/components/workspace/board/boardCardPreview.ts) + `BoardCard`. |
| Row title/body modal (autosave) | `BoardRowEditModal.tsx` — uses `updateCell` for primary title and **`invoke('update_node')` + `loadNodeChildren`** for body so `activeNode` is not replaced with the row while still on the database board. **Open full page** uses `navigateTo` (same as tree navigation). |

---

### Checklist for the next person (board DnD)

- [ ] Confirm logging path (Tauri file vs HTTP ingest) before concluding instrumentation failed.
- [ ] Log **`Object.keys(listeners)`** on sortables when drag won’t start.
- [ ] Grep for **`SortableContext` `id`** vs **`useSortable` `id`** — must not reuse the same id for nested parents/children.
- [ ] Remember: **`over === null` on drag end** may mean “dropped outside this `DndContext`”**, not “user cancelled”.
- [ ] After changing sensors, verify **mouse** and **trackpad** in the real shell (e.g. WebView2), not only in dev browser.

---

---

## Windows `0xc0000005` during paste / auto-submit (Enigo)

Handy uses the Rust crate **`enigo`** to **simulate keyboard and mouse input** from the Tauri/Rust side: paste key chords (Ctrl+V, Shift+Insert, …), optional **“direct typing”** (`enigo.text()`), **auto-submit** (Enter / Ctrl+Enter / Cmd+Enter), and **cursor position** reads. That is the right *kind* of tool for a cross-platform desktop helper: one API surface for Linux/macOS/Windows without maintaining three completely separate input stacks everywhere.

**The pitfall:** on **Windows**, Enigo’s implementation path for **certain keys and modifiers** (virtual-key / layout mapping) can **fault in native code** — the process dies with **`STATUS_ACCESS_VIOLATION` (`0xc0000005`)** with no catchable Rust `Result`. The codebase already documented this for **Shift+Insert** (“bypass Enigo… use `SendInput` instead”). The same class of failure also showed up for **Ctrl+V**, **Ctrl+Shift+V**, **`enigo.text()` (Direct paste)**, and **`enigo.key` with `Key::Control`** (auto-submit **Ctrl+Enter**), because those still went through Enigo on Windows.

### What we changed (fix)

| User-facing behavior | Before (Windows) | After (Windows) |
|----------------------|------------------|-----------------|
| Ctrl+V / Ctrl+Shift+V | `enigo.key(…)` | **`SendInput`** with `VK_CONTROL`, `VK_SHIFT`, `VK_V` and explicit up/down ordering + short delay before releasing modifiers (matches prior timing). |
| Shift+Insert | Already `SendInput` | Unchanged. |
| Paste method **Direct** | `enigo.text()` | **Clipboard round-trip + same `SendInput` Ctrl+V** (save → write text → paste → restore), so we never call `enigo.text()` on Windows. |
| **Auto-submit** after paste | `enigo.key` for Return / Control / Meta | **`SendInput`** only (`VK_RETURN` with extended flag where needed; Ctrl+Enter; Cmd+Enter mapped to **Win+Return** via `VK_LWIN`). |

Linux and macOS still use Enigo (and Linux keeps native typing tools where configured). **`paste_text_direct`** is compiled **only on non-Windows** so there is no dead Enigo entry point on Windows.

### Why it works now

**`SendInput`** submits low-level **`INPUT` / `KEYBDINPUT`** structures with **explicit virtual keys**. It does **not** go through Enigo’s Windows keyboard-layout / mapping layer that was crashing. So paste and auto-submit no longer execute the faulty native path, and the process stays alive.

### Where in code

| Concern | Location |
|---------|----------|
| Ctrl+V / Ctrl+Shift+V / auto-submit `SendInput` | [`src-tauri/src/input.rs`](../src-tauri/src/input.rs) — `windows_send_ctrl_v_combo`, `windows_send_ctrl_shift_v_combo`, `windows_send_auto_submit_return`; `send_paste_shift_insert` (Windows branch). |
| Clipboard paste + Direct (Windows → clipboard shim) | [`src-tauri/src/clipboard.rs`](../src-tauri/src/clipboard.rs) — `paste_via_clipboard`, `paste_direct`, `send_return_key`. |

### Checklist for the next person (Windows input)

- [ ] If a new **keyboard simulation** path is added on Windows, default to **`SendInput`** (or another well-scoped Win32 API), not Enigo, when **modifiers** or **high-risk** keys are involved.
- [ ] Do not assume “user changed paste away from Ctrl+V” fixes crashes — **Direct** and **auto-submit** were separate Enigo surfaces.
- [ ] **`0xc0000005` on exit** is not always Enigo — distinguish from **`0xc000013a`** (Ctrl+C / control-C exit) when reading Cargo/Tauri dev logs.
- [ ] **`append_note_body: database disk image is malformed`** is **SQLite file corruption**, unrelated to Enigo; fix by replacing `notes.db` (+ `-wal`/`-shm`) with the app fully quit, not by changing paste method.

---

## Workspace calendar — deferred product work

**Templates (“Start from…”)** and **recurrence (“Repeat…”)** are intentionally **not** in the current UI pass. They ship **after** event-modal interaction stability and Schedule-X remount/refresh behavior are proven in production.

**Where they should live (when built):**

- Templates: primarily **inside the event modal** and/or **grid context menu**; optional short preset strip (3–5) under the sidebar mini-month only if we keep it lightweight.
- Recurrence: **inside the modal** (collapsible), only once we have a real persistence model (series + exceptions).

**Engineering note:** `WorkspaceCalendarScheduleBody` must not key remount on each sidebar day; the selected day is synced into the existing Schedule-X app via internal `datePickerState` + `calendarState.setRange` (see `syncScheduleXSelectedPlainDate` in code). `useCalendarApp` from `@schedule-x/react` only consumes initial config on mount.

### Calendar edit surface (modal vs anchored popover)

**Decision (2026-04-18):** Keep **`WorkspaceCalendarEventModal`** for full edit (title, start/end, validation, keyboard focus). Right-click / kebab flows stay on **`WorkspaceCalendarContextMenu`** for fast actions (open editor, delete, etc.). We did **not** replace the modal with a small context menu alone — dense datetime fields need a dedicated surface. A future **anchored popover or side sheet** (Apple-like inspector) remains a separate UX project if we want less modal weight; it would need width, scroll, and mobile behavior designed explicitly, not a thin menu.

---

## Embedding model pooling convention

**Trap**: treating every BERT-family sentence embedder as "mean-pool
over non-padding tokens then L2-normalize." Looks generic and
reasonable. For some model families it's wrong and degrades
retrieval quality measurably.

Each sentence-embedding model family specifies its own pooling
strategy in its model card. Verify the card, don't default:

| Family | Pooling | Notes |
|---|---|---|
| **BGE** (bge-small/base/large, bge-m3) | `[CLS]` token (row 0 of `last_hidden_state`) | BAAI explicitly recommends CLS for retrieval tasks |
| sentence-transformers / MiniLM | mean-pool | Classic sentence-BERT convention |
| E5 family | mean-pool, with `"query: "` / `"passage: "` prefixes at tokenize time | Prefix is part of the contract |
| Nomic | prefix-aware mean-pool (`"search_query: "` / `"search_document: "`) | |
| Instructor | `[CLS]` with task-specific instruction prefix | |

**Empirical delta** measured 2026-04-22 during Phase A spike on
bge-small-en-v1.5, test pair `("hello world", "greetings earth")`
both L2-normalized:

- mean-pool → cos_sim = 0.6594
- `[CLS]` → cos_sim = 0.7036

Enough to flip which side of a retrieval threshold a query lands on.
`embedding_ort.rs` documents the current model's pooling at the top
of the file; when switching models, update the pooling function and
re-verify against the new model's HF card + a test pair or two.

---

## Windows MSVC CRT mismatch in ORT / tokenizers stack

**Trap**: adding `tokenizers` with default features on Windows
against a crate that already links `whisper-rs` / `onnxruntime`.
`tokenizers`'s default `esaxx_fast` pulls in `esaxx-rs` which builds
with `/MT` (static CRT) while `whisper_rs_sys` + `ort` expect `/MD`
(dynamic CRT). Linker fails with `LNK2038 RuntimeLibrary mismatch`
or `LNK2005 already defined` depending on order.

**Fix**: `tokenizers = { version = "0.20", default-features = false,
features = ["onig", "progressbar"] }`. `esaxx_fast` is only used at
training time; inference path doesn't need it. Discovered in Phase A
spike 2026-04-22 while wiring bge-small ORT session.

**Adjacent trap — ort rc.12 error types aren't Send + Sync**. In
`ort = "=2.0.0-rc.12"`, `ort::Error<SessionBuilder>` wraps
`Vec<Box<dyn Operator>>` which isn't thread-safe. `?` propagation
via `anyhow::Result<T>` fails to compile. Workaround: explicit
`.map_err(|e| anyhow!("{e}"))` on every ORT call. Document at the
top of any file that wraps ort. Likely fixed by ort 2.0 GA; re-check
when that ships.

---

*Last updated: 2026-04-22 — embedding pooling convention + Windows CRT mismatch in ORT/tokenizers stack (both Phase A spike findings).*
