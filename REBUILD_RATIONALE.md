# Rebuild Rationale — How We Got Here

> Companion to [PLAN.md](PLAN.md) and [CLAUDE.md](CLAUDE.md). Captures
> the discussion, thought process, tradeoffs, and decisions that led to
> the rebuild scope locked on 2026-04-22.
>
> Read this when you want to understand **why** the plan is the way it
> is — not what the plan is (PLAN.md), not the rules (CLAUDE.md).

---

## The user (who this is for)

- **Howard** — desktop app developer, already shipped a Tauri app called
  "IRS Third-Party Selling Desktop" (eBay reseller dashboard) from
  scratch. That project gave him a frontend he's proud of and knows
  inside-out: vanilla CSS "Sovereign Glass" aesthetic, flat
  `src/components/` layout, charcoal + terracotta amber + 28px glass
  blur + kinetic blob backgrounds.
- Wants Infield to **look like IRS** and **use the same frontend
  organization**, but keep the depth of Handy's backend (local-first
  knowledge workspace, transcription, vault, hybrid search).
- Values: premium hardware feel, high information density, local-first,
  offline-first, minimal external dependencies, readable vault files on
  disk, no bloat.

---

## The stacks (two projects, one target)

### IRS Third-Party Selling Desktop — the visual/frontend source

**Frontend**
- React 18 + TypeScript
- Vite 5
- **Vanilla CSS** — one file (`src/app.css`, ~2,700 lines), hardcoded hex
  literals, no preset system
- Flat `src/components/*.tsx` (30 files, no subfolders)
- Framer Motion v12 for animation (imported as `framer-motion`)
- Three.js + @react-three/fiber + drei + postprocessing for 3D
- @dnd-kit for drag
- react-resizable-panels v4 for layout
- Radix UI for Dialog / Popover / Tooltip
- canvas-confetti, @formkit/auto-animate for flourishes
- React Context only (no Zustand)
- No i18n — hardcoded English

**Backend**
- Rust + Tauri 2.x
- SQLite (likely managed via Rust)
- eBay OAuth domain logic (ebay_client, sync, rate_limit)
- Native Rust encryption for a "Sovereign Vault" envelope
- LLM integration (`llm.rs`)

### Handy (Infield) — the feature/backend source

**Frontend**
- React 19.1.1 + TypeScript 5.6
- Vite 6
- **Token-driven theme** — three tiers (primitive → semantic →
  component), four built-in presets, live theme editor, schema-versioned
  persistence
- Nested `src/components/workspace/`, `src/components/database/`,
  `src/components/editor/`, `src/components/home/`, etc. (~250
  components)
- Tailwind 4 for legacy `database/` components only
- Motion v12 (imported as `motion/react`)
- @dnd-kit + modifiers + sortable
- @floating-ui/react for tooltips + popovers
- @glideapps/glide-data-grid (canvas-rendered tables)
- @schedule-x/* (calendar views)
- @mdxeditor/editor (MDX editing)
- @tanstack/react-virtual (not yet wired)
- Zustand + Immer (workspaceStore, notesStore, themeStore, etc.)
- react-i18next + 20 locale files, ~3,000 translation keys
- hyperformula (spreadsheet formulas)
- recharts (dashboard charts)
- zod (schema validation)

**Backend**
- Rust + Tauri 2.10
- SQLite with WAL + FTS5 (`workspace_fts`), `workspace_nodes`,
  `node_views`, `page_links`, `user_preferences`
- usearch (HNSW vector index) + separate `handy-embedding-sidecar` Rust
  binary over HTTP for embeddings
- Vault at `<app_data>/handy-vault/` — markdown files with YAML
  frontmatter, bidirectional sync with SQLite
- Transcription pipeline: cpal mic capture + Whisper (via sidecar or
  local) + Enigo text injection OR voice-memo auto-note creation
- System audio capture (WASAPI/CoreAudio)
- Embedding worker with background chunking + retry
- Accessibility + mic permission onboarding
- Global shortcuts (push-to-talk, daily note, debug toggle)
- Tray icon with 3 states (idle / recording / transcribing)

---

## The problem that triggered this conversation

User opened a session on the Handy codebase wanting to push Phase 3 of
the existing `frontendplan.md` forward. Phase 3 was "rebuild the shell"
— and we did: `AppShell`, `Titlebar`, `IconRail`, `AtmosphericStage`.
Then the user ran the app and noticed the visual DNA **didn't match**
what he was used to in IRS and the HerOS reference kit: the app rendered
uniform terracotta instead of charcoal + kinetic amber blobs.

Root cause: the existing `heros-terracotta` preset had `brand` AND
`surfaceBase` both set to `#cc4c2b`, flattening the cinematic contrast.
Fixing that → unlocked the question: "why not just use my IRS frontend
wholesale?"

---

## The big question: swap to IRS approach or selectively adopt?

**User's initial ask:** copy the IRS frontend into Handy, wire Handy's
backend into it. Keep the IRS vanilla-CSS + flat-components +
no-preset-system simplicity.

**Tension identified:**

The IRS frontend is designed for a **seller dashboard** (ConversationList,
InspectorPanel, AccountSidebar, AudioView, InboxView). It has no analog
for:
- Workspace tree with 10k nodes
- MDX editor with wikilinks
- Database views (grid / board / calendar)
- Hybrid FTS + vector search UI
- Voice-memo auto-note flow

And the Handy architecture has investment that doesn't exist in IRS:
- Token-driven theme (preset switching, user customization, contrast
  checking, schema versioning)
- i18n with 20 locales
- Granular Zustand selectors (vs whole-tree re-renders on Context)
- Schema-versioned localStorage + DB persistence

**The honest tradeoff:**

| "Swap to IRS wholesale" | "Selectively adopt IRS aesthetic" |
|---|---|
| 3-6 months of rebuild | Weeks, not months |
| Lose i18n (20 locales gone) | Keep i18n |
| Lose theme preset system | Keep token system |
| Rebuild workspace tree, editor, databases, search from scratch | Same — these are being rebuilt anyway |
| Context-only state (scales poorly at 2-5k DOM nodes) | Keep Zustand granular selectors |
| IRS visual DNA | IRS visual DNA (identical end result) |

**Where the conversation landed (the user's actual need):**

- User **doesn't actually care about the architecture**; he cares about
  the aesthetic and the feel.
- Handy's token system is already a superset of IRS's vanilla CSS —
  every token is a CSS variable, you can override any value directly in
  `app.css`, the preset abstraction is optional, not required.
- So the right move is: **adopt IRS aesthetic + IRS file organization
  (flat components), keep Handy's architectural infrastructure**
  (zustand, i18n, tokens, schema versioning).

Net: the app looks and feels like IRS; the skeleton stays
professional-grade.

---

## Key decisions, in order

### 1. Sovereign Glass DNA port (completed)

Before the scope conversation, we ported the IRS visual recipe into the
existing `heros-terracotta` preset:

- `surfaceBase: #0a0b0f` (cinematic charcoal, not terracotta)
- `brand: #cc4c2b` (terracotta — drives accents + kinetic blobs only)
- `glassBlur: 32` (was 24)
- `glassSaturate: 220` (was 120)
- Three animated blob clusters (A: warm orange 11s, B: deep red 14s,
  C: bright orange 9s) in `AtmosphericBackground`
- Titlebar: `rgba(10,11,15,0.75)` charcoal glass + brand-tinted
  underline (`0 1px 0 rgba(204,76,43,0.15)`)
- IconRail: translucent glass pill (`rgba(255,255,255,0.03)`, 24px blur)
  with 3px brand stripe + brand glow on active

All token changes were in-place edits to existing files. No new deps.

### 2. LoadingScreen port (completed)

User reviewed and said the halo bloom I'd added was "too much" and
wanted the IRS LoadingScreen verbatim. Reverted the bloom from
`LemniscateOrb`, rewrote `LoadingScreen.tsx` to mirror the IRS structure:
420×10 progress bar, 24px greeting / 112px wordmark / 20px wide-tracked
tag, "Her / Spike Jonze" credits block, no grain overlay. Kept
Handy-specific essentials (progress prop from real hydration staging,
CanvasBoundary for WebGL fallback, WindowControls for decorations-off
requirement).

### 3. Theme kill-switch + schema migration v2 (completed)

User noticed stale theme state from the IRS port hadn't flushed
correctly. Added a `FORCE_DEFAULT_THEME` const in `ThemeProvider` to
wipe localStorage on boot for testing, then bumped `SCHEMA_VERSION` from
1 to 2 and updated both `isPersistedState` (in `themeStorage.ts`) and
the FOUT inline script (in `index.html`) to reject v1 payloads. This
way returning users' stale theme state auto-invalidates without code
flags, and `FORCE_DEFAULT_THEME` could go back to `false`.

### 4. Dependency audit (completed)

Compared IRS and Handy `package.json`:

- **IRS has, Handy doesn't:** `@radix-ui/*`, `@react-three/drei`,
  `@react-three/postprocessing`, `@formkit/auto-animate`,
  `canvas-confetti`, `vite-plugin-checker`
- **Verdict:** nothing Handy needs for the Sovereign Glass DNA port.
  `@floating-ui/react` already covers what Radix would. @react-three/drei
  + postprocessing installed later (for the bloom effect, now reverted).
- **Motion package:** IRS uses `framer-motion` import path, Handy uses
  `motion/react` — same library at v12, just renamed. Handy is on the
  correct new import path.
- **react-resizable-panels:** IRS v4 vs Handy v2. Not a functional gap
  for current scope.

### 5. Scope debate → rebuild Handy's domain UI in IRS style

User confirmed willingness to rebuild workspace tree, MDX editor,
database views, hybrid search UI from scratch. Raised the question:
"what else won't wire easily?"

Answer identified:
- **Audio / transcription backend**: fully intact, works as-is
- **Voice memos → workspace docs**: requires tree/doc infrastructure —
  keep the current flow (decision: voice memos land in the databases
  tab with parent/child tree, same as Handy does today)
- **Onboarding**: rebuild Apple-style (7 steps, glass panels, one
  decision per screen)
- **Global shortcuts**: wire into settings tab
- **Tray icon**: monochrome hex silhouette for 16/32px; detailed
  `logo.png` at dock/desktop sizes
- **Backend commands**: prune unused ones in Phase I; nothing touched
  before then
- **Embeddings**: switch from usearch+sidecar to sqlite-vec (see §6)

### 6. Embeddings: sqlite-vec over usearch+sidecar

Three options weighed:

| Approach | Pros | Cons |
|---|---|---|
| Keep usearch + sidecar | Process isolation for model crashes | Two binaries, HTTP IPC overhead, separate `.usearch` file to back up |
| **sqlite-vec** | Vectors in the main SQLite DB. One file to back up. Unified SQL across FTS + vector. Simpler SearchManager — no sidecar roundtrip. Eliminates the sidecar binary. | Cross-platform extension shipping is a one-time setup cost |
| In-process Candle / ONNX | Simplest, fastest | Model crash = app crash |

**Decision: sqlite-vec.** Phase A of the rebuild. At 100k documents
it's within 20-30% of usearch; cell-partitioned indexes scale to ~1M.
Past that we revisit. The embedding model runs in-process via the
**`ort` crate (ONNX Runtime 2.0.0-rc.12)** — decision D1 in PLAN.md,
flipped from Candle to ORT on 2026-04-22 after confirming
`transcribe-rs 0.3.5` already bundles ORT for six of its seven
transcription engines; reusing that shared native library eliminates
all per-platform codesign / bundling work for embeddings. Risk
mitigated per Rule 16 with dedicated OS thread + sentinel +
restart-once + FTS-only fallback on repeated failures.

### 7. Vault: bidirectional (Option A)

Three options weighed:

- A: Keep bidirectional (status quo — external editors work, conflict
  UI needed)
- B: Export-only vault (SQLite is truth, vault is derived, no conflict
  guard)
- C: Drop vault entirely (SQLite-only)

**Decision: A — bidirectional.** User wants external md edits to flow
back into the app. Conflict guard (Rule 13) stays in place, UX gets
cleaner in Phase D: **inline banner** at top of editor (not a modal)
with three clear actions (Reload / Keep mine / Open diff). Never
auto-merge, never silently overwrite.

### 8. Database views: unified modular component

User asked: "should table, kanban, list be different representations of
the same data?" Answer: yes — this is the industry-standard "views
over data" pattern (Notion, Airtable, Coda, AppFlowy, AFFiNE all use
it). Handy already does this correctly via `node_views` +
`DatabaseShell.tsx` + layout-specific renderers. The architecture stays;
the implementation gets rebuilt.

Layouts in scope: Grid + Board + Calendar + List + Gallery. Timeline /
Gantt / Chart deferred. All read the same `rows` + `view.options`; all
share filters, sorts, field editing, row-page-open.

Grid aesthetic: **Excel / Google Sheets 100%** — thin grey gridlines,
row numbers, frozen first row/column, fill-handle drag, TSV copy/paste,
formula support via hyperformula. Glide Data Grid stays (best
canvas-rendered grid for 100k rows) — reskin via custom cell renderers
to match IRS tokens.

### 9. Vault file format: markdown + YAML frontmatter

User wants Notion/Obsidian-style hierarchy (freeform folders, drag
notes in/out, tree reflects on disk). Chose `.md` over JSON because:

- Human-readable if opened in a text editor
- Obsidian / VS Code can read them for backup inspection
- YAML frontmatter carries structured metadata without polluting body
- Git-friendly (diff'able, mergeable)

This is exactly what Handy does today. Only the frontend tree UI is
being rebuilt.

### 10. Google OAuth: AI chat auth only (not sync)

User confirmed scope: Google OAuth unlocks Gemini / Vertex for AI chat
with the user's own API quota. **Not** required to use the app; **not**
cross-device sync (no backend infra for that yet); **not** cloud
backup.

Implementation: `@tauri-apps/plugin-oauth` or manual PKCE flow with
localhost redirect. Tokens in OS keychain via `tauri-plugin-stronghold`
or `keyring`. OAuth client ID is safe to ship in the binary (it's not a
secret). ~2-3 days in Phase B or G.

User needs to create a Google Cloud project with a Desktop App OAuth
client ID, enable Vertex AI / Generative Language API, and configure
the consent screen.

### 11. Onboarding: 7-step Apple-style

Final flow:

1. **Welcome hero** → "Sign in with Google" + "Continue without account"
2. **Theme picker** (4 preset cards with live preview swatches)
3. **Mic permission** (big mic icon + native prompt trigger)
4. **Accessibility permission** (macOS only — for push-to-talk text injection)
5. **Whisper model download** (Tiny / Small / Medium + progress bar)
6. **Vault location** (default `~/Documents/Infield Vault` + browse)
7. **Done** → "Enter Infield"

Each step = one full-screen IRS glass panel, big centered icon, single
primary CTA. Skip links where appropriate. Apple-style progressive
disclosure, one decision per screen. Lands in Phase B.

### 12. Tray icon approach

User's attached logo (detailed hex crystal + copper + math equations)
works as `logo.png` for dock/installer/taskbar at large sizes. At
16×16 / 32×32 tray it won't read — becomes a red blob.

**Decision:** generate a **simplified monochrome hex silhouette** for
tray / small-size taskbar (outer hex outline + inner geometry hint,
single-color fill), keep the full detail logo at 256/512px for dock.
States: idle / recording / transcribing (+ light/dark variants).
Execution in Phase I.

### 13. Planning hygiene

User requested:
- Retire all existing plans to `old/` folder (`PLAN.md` v1,
  `frontendplan.md`, `UI_POLISH_PLAN.md`, `designlayout.md`,
  `migration.md`, `vault-clarifications.md`, `EmbeddingPitfall.md`)
- New `PLAN.md` phase-by-phase (not all up-front)
- Aggressive trim of `CLAUDE.md` — keep small, preserve live rules +
  decision logs, drop abandoned-phase references

All done 2026-04-22.

### 14. PROJECT_HANDOVER.md retired (2026-04-22)

45KB deep architecture reference written 2026-04-20, before the
rebuild scope was locked. Contains: vault architecture (still valid),
transcription flows (still valid), embedding pipeline (stale —
sidecar being removed in Phase A), database views (stale — being
rebuilt in Phase E), pre-rebuild gaps + questions (superseded by
PLAN.md).

**Moved to [old/PROJECT_HANDOVER.md](old/PROJECT_HANDOVER.md).**

Rationale: two-thirds of the file is still-accurate backend
architecture, one-third is about-to-be-deleted code. Line-number
references throughout will drift during the rebuild, misleading
future readers. Cleaner to retire as a historical snapshot and
rebuild per-concern architecture docs under `docs/architecture/`
as each phase lands.

New reference structure:
- `CLAUDE.md` — live rules + decision logs
- `PLAN.md` — active roadmap + per-phase blueprint
- `REBUILD_RATIONALE.md` — this file, the "why"
- `docs/architecture/*.md` — per-concern deep dives, added as
  needed during rebuild phases
- `old/PROJECT_HANDOVER.md` — historical snapshot, not a current
  source of truth

### 15. Critical review gate passed (2026-04-22)

Before Phase A kickoff, a fresh Claude instance was handed the plan
docs for independent review. The review flagged 8 high-severity risks,
7 medium-severity concerns, and 6 low-severity nits. All high- and
most medium-severity items were addressed in a single pre-kickoff
doc-updates pass:

**High-severity — resolved by doc + dep edits, no code yet:**

- **1.1 `rusqlite` missing `load_extension` feature** — will add to
  `Cargo.toml` at Phase A kickoff. Also: static-link sqlite-vec via
  the `sqlite-vec = "0.1"` crate + `sqlite3_auto_extension`, avoiding
  dlopen / macOS notarization entirely for this extension. Rule 17
  stays for future dlopen-required extensions. (D10 locked.)
- **1.2 `search.rs` entangled with `notes.db`** — decided to delete
  `notes.db` + `NotesManager` outright in Phase A. No data migration.
  (D8 locked.)
- **1.3 vec0 migration transaction issue + re-embed not a migration** —
  Phase A blueprint now (a) spikes the virtual-table DDL standalone
  before plumbing into `rusqlite_migration`, (b) adds explicit
  `embed_backfill_queue` table as the durable userspace job queue
  (separate from schema migration), (c) re-enqueues `in_progress`
  rows as `pending` on boot for crash-resume.
- **1.4 Candle on Windows CPU slower than stated** — timing revised
  from "3-5 min / 10k" to "15-45 min / 10k, 2-8 hours / 100k". UX
  moved from foreground modal to background banner. (D9 locked.)
- **1.5 tokio ↔ OS-thread bridge for Candle** — concrete code sketch
  added to Phase A blueprint (`InferenceHandle` with
  `crossbeam_channel::bounded` + `tokio::sync::oneshot` response,
  heartbeat sentinel, respawn-once semantics per Rule 16).
- **1.6 BGE model licensing** — Phase A deliverable: copy `LICENSE`
  (MIT) + write `MODEL_HASH.txt` (sha256 of safetensors) into
  `src-tauri/resources/models/bge-small-en-v1.5/`. Settings →
  About panel gets the "Powered by BGE" attribution line.
- **1.7 Google OAuth production-grade timing** — scope deferred from
  Phase B to Phase G. Phase B onboarding removes the sign-in step;
  OAuth lands with the chat gate in Phase G (4-6 days). Phase B
  target trims to 3-4 days. (D2a locked.)
- **1.8 `.handy.lock` not implemented despite Rule 15** — added as
  explicit Phase A deliverable. Uses `fs2::FileExt::try_lock_exclusive`.
  Second-instance behavior: native dialog + clean exit, no IPC, no
  focus-steal. (D11 locked.)

**Medium-severity — addressed via rules / stubs:**

- Dimension-change guard → new Rule 19 + `embedding_model_info`
  table in Phase A
- Phase G vs F ordering → Phase G stub clarified (RAG builds on F)
- Phase D depends on C (not F) → explicit in Phase D stub
- "149 tests stay green" brittle through rebuild → DoD item #2
  realigned: "retired-tree tests count as deleted; new components
  land with critical-path coverage"
- iCloud/OneDrive toast spam → Rule 14 amended with materialization
  suppression (zero-byte → non-zero, frontmatter-only changes)
- Glide Data Grid can't consume `var(--token)` → Rule 12 carve-out
  for canvas-rendered third-party widgets; `tokenBridge.ts` utility
  deliverable moved to Phase E
- PurgeCSS + dynamic class names → Phase I deliverable adds
  `tools/css-safelist.txt` hand-curation step

**Low-severity — addressed inline:**

- Cmd+W conflicts with macOS window-close → rebound to `Cmd/Ctrl+[`
  in keyboard contracts
- `@react-three/drei` + `@react-three/postprocessing` left in
  `package.json` after bloom revert → uninstalled via `bun remove`
- `docs/architecture/entry-experience.md` referenced the deleted
  sidecar → updated progress-source list; top-of-file rewrite
  banner added (Phase B will fully rewrite)
- Rule 13 `+1s` vs Rule 13a `+3s` cloud-sync drift → Rule 14 now
  explicitly cross-references Rule 13a
- `workspace_manager.rs` at 3,576 lines → flagged in PLAN.md Phase I

Net effect: no blocker remains for Phase A. Status tracker reflects
"ready for kickoff" with all D1-D11 locked.

**Addendum — D1 flip (Candle → ORT), same day:** After the review gate
landed, Howard noted the model files downloaded to
`src-tauri/resources/models/` are `.onnx`, not `.safetensors`. While
verifying, we confirmed that `transcribe-rs 0.3.5` (Handy's existing
transcription crate) already bundles `ort 2.0.0-rc.12` transitively
for six of its seven engines (Parakeet, Moonshine, Moonshine
Streaming, SenseVoice, GigaAM, Canary — only Whisper uses whisper.cpp
instead). Using ONNX Runtime for embeddings therefore reuses fully
shipped infrastructure: no new native library to bundle, no new
codesign / notarization path, no additional per-platform complexity.
Candle would have required shipping a second inference runtime for
a single feature.

D1 → **ONNX Runtime locked**. Adjusted in PLAN.md Phase A:
- Cargo deps: swapped `candle-*` (3 crates) for a single direct
  `ort = "=2.0.0-rc.12"` dep, pinned to the exact version
  transcribe-rs uses so they share the same native lib
- New file: `src-tauri/src/managers/embedding_ort.rs` (was
  `embedding_candle.rs`)
- Code sketch for the tokio ↔ OS-thread bridge rewritten for
  `ort::Session` + BERT input tensors (`input_ids`, `attention_mask`,
  `token_type_ids`) + mean-pool + L2-normalize over
  `last_hidden_state`
- Realistic timing adjusted 2-3× faster: 10k docs now 8-20 min
  (was 15-45 min), 100k docs 1-3 h (was 2-8 h). ORT-DirectML on
  Windows accelerates GPU-capable setups further.
- Rule 16 still applies — native ML can still panic, dedicated
  OS-thread + sentinel pattern preserved

**Addendum — D1d model-storage flip (bundled → downloaded), same day:**
Howard flagged the inconsistency that transcription models (Whisper,
Parakeet, etc.) live in `<app_data>/models/` (downloaded during
onboarding via the existing `ModelInfo` registry) while the embedding
model was planned to ship bundled inside `src-tauri/resources/`. The
split was defensible — "user-chosen optional = app_data, required core
= bundled" — but flipping to downloaded wins on:
- Consistency (one mental model: all models live in app_data)
- Smaller installer (−133 MB)
- User can inspect / delete / replace the model file
- Integrates cleanly with the existing `ModelInfo` download
  infrastructure; Phase B just adds bge-small as a second required
  download alongside Whisper

Cost: +1 day in Phase A (add bge-small entry to `ModelInfo` registry,
wire boot-time presence check + "download in Settings" banner when
missing) and +1 hour in Phase B onboarding copy (rename "Whisper model
download" → "Models download", parallel progress bar).

D1d → **Locked: `<app_data>/models/bge-small-en-v1.5/`.** Bundled
option rejected. The existing files at `src-tauri/resources/models/`
(put there by Howard for dev testing) need to be moved or replaced by
a dev-time download before Phase A wiring; production flow via
onboarding ships in Phase B.

**Phase A kickoff spike findings (2026-04-22):**

Standalone crate at `spikes/sqlite_vec_spike` validated the riskiest
sqlite-vec unknowns before committing to schema shape. Results:

- ✓ sqlite-vec v0.1.9 static-links cleanly on Windows via
  `rusqlite[bundled]` + `load_extension` feature
- ✓ `sqlite3_auto_extension` binding works; `vec_version()` reachable
  on every newly-opened connection
- ✓ `CREATE VIRTUAL TABLE ... USING vec0(...)` DDL survives
  `rusqlite_migration`'s wrapping transaction — no `up_from_sql`
  fallback needed (review risk §1.3 first-half resolved)
- ✓ KNN round-trip works; cosine distance returns 0 for identity,
  1 for orthogonal as expected
- ✗ **PLAN.md schema was broken for chunking**: `node_id TEXT PRIMARY
  KEY` fails on the second chunk of the same node (`UNIQUE constraint
  failed`). Corrected schema uses sqlite-vec's `partition key`
  syntax:
  ```sql
  CREATE VIRTUAL TABLE vec_embeddings USING vec0(
    node_id TEXT partition key,
    chunk_index INTEGER,
    embedding float[384] distance_metric=cosine
  );
  ```
  Partition key lets the same `node_id` repeat across chunks while
  giving KNN a free ~10× speedup on per-node scoping queries.
  `distance_metric=cosine` matches bge-small's L2-normalized output
  convention. PLAN.md Phase A schema block updated to the corrected
  shape.

**Cargo.toml dep sweep landed** (all resolve clean):
- `sqlite-vec = "0.1"` (0.1.9)
- `ort = "=2.0.0-rc.12"` (pinned to transcribe-rs transitive)
- `tokenizers = "0.20"` (0.20.4)
- `crossbeam-channel = "0.5"` (0.5.15)
- `zerocopy = "0.8"` (required by tokenizers transitively)
- `rusqlite` features flipped to `["bundled", "load_extension"]`
- `usearch` + `llama-cpp-2` kept in place (delete-later / stay-for-G)

**New decision D1e — Multi-file `ModelInfo` support.** The spike
surfaced that the existing `ModelInfo` registry shape only supports
single-file or single-archive (`is_directory: bool` tar.gz)
downloads. bge-small needs 6 files from separate HF resolve URLs —
structural extension required. Three options weighed:
- A: Extend `DownloadSpec` enum with a `MultiFile` variant
- B: Host a pre-packaged tarball on a CDN Howard controls
- C: Bespoke download path just for bge-small

Option A locked — ~1 day inside Phase A budget, future-proofs the
registry for re-rankers / other embedders / fine-tunes, preserves
D1d's "one mental model" consistency. Rejected B (CDN operational
burden for content HF already hosts reliably) and C (violates the
consistency D1d was justified on).

The spike's third step (ORT hello-world with correctness check) was
blocked by absence of the bge-small files on disk; Howard staged
them at `%APPDATA%\com.pais.infield\models\bge-small-en-v1.5\` via a
one-liner PowerShell download from HF, unblocking resumption.

**Step 3 findings (ORT hello-world test):**

- **Pooling bug in PLAN.md — corrected.** Plan specified mean-pool +
  L2-normalize (the generic sentence-BERT default). BGE's own model
  card recommends `[CLS]` token for retrieval tasks. Empirical delta
  on the test pair `("hello world", "greetings earth")`:
  mean-pool → 0.6594, `[CLS]` → 0.7036. Enough to flip retrieval
  thresholds. PLAN.md Phase A patched; `embedding_ort.rs`
  implementation uses `[CLS]`. Added a new pitfall.md entry
  "Embedding model pooling convention" covering the broader rule
  (BGE vs sentence-transformers vs E5 vs Nomic vs Instructor all
  have different pooling conventions; verify the model card, don't
  default).
- **Windows CRT mismatch — worked around.** `tokenizers`'s
  `esaxx_fast` default feature pulls in `/MT` statics that collide
  with `whisper_rs_sys` / `ort` which expect `/MD`. Pinned to
  `default-features = false, features = ["onig", "progressbar"]`
  (esaxx_fast is training-only; inference unaffected). Captured in
  pitfall.md alongside the `ort::Error` Send+Sync gotcha in rc.12.
- **Icons missing at `src-tauri/icons/`** — only `logo.png` present;
  `tauri.conf.json` references 5 generated artifacts that don't
  exist. Latent release-build blocker surfaced during Phase A.
  Regenerated via `bunx tauri icon src-tauri/icons/logo.png`. Full-
  detail versions at all sizes for now; tray-glyph monochrome
  simplification remains Phase I scope.
- **Linkage strategy locked via Option B**: ORT hello-world test
  lives inside `managers/embedding_ort.rs` as a `#[cfg(test)]` block
  with `#[ignore]` gating on model-file presence, not a separate
  spike crate. Inherits `transcribe-rs`'s proven ort-directml +
  load-dynamic linkage config; no standalone onnxruntime.dll to
  ship. `spikes/sqlite_vec_spike/` kept as regression target;
  `spikes/ort_bge_spike/` removed after port.

### 15a. Phase A execution wrap (2026-04-22)

All Phase A deliverables (1-11) shipped across nine reviewable commits
plus a trailing stop-gate validation pass. Rust tree compiles
release-clean, frontend compiles clean, 125 library tests pass (2
pre-existing portable rebrand failures unchanged), release build
12m 05s on Windows.

The execution surfaced five plan-level corrections worth recording.
Each was raised mid-flight rather than silently absorbed — adopting the
"flag concretely during execution" rule set at kickoff.

1. **Schema correction (refined vec0 shape).** The PLAN.md Phase A
   schema specified `node_id TEXT PRIMARY KEY` alongside `chunk_index
   INTEGER`. The spike at `spikes/sqlite_vec_spike/` proved vec0
   enforces PK uniqueness on TEXT columns — a second INSERT with the
   same node_id fails with `UNIQUE constraint failed on vec_embeddings
   primary key`, breaking the one-node-many-chunks invariant. Refined
   shape landed: `node_id TEXT partition key, chunk_index INTEGER,
   embedding float[384] distance_metric=cosine`. Implicit rowid is the
   real PK; partition key still supports later sub-tree-scoped KNN
   pre-filter.

2. **CLS pooling, not mean-pool.** PLAN.md Phase A's embedding recipe
   specified "mean-pooling over non-padding tokens + L2 normalization".
   The BGE model card for `bge-small-en-v1.5` explicitly recommends
   `[CLS]` pooling. Empirical delta on the shipped stop-gate test:
   `cos_sim("hello world", "greetings earth") = 0.6594` with mean-pool
   vs `0.7036` with `[CLS]`. Above-noise difference; the 0.7 retrieval
   threshold fails mean-pool and clears `[CLS]`. Captured in
   pitfall.md under "Embedding model pooling convention" with BGE /
   sentence-transformers / E5 / Nomic / Instructor comparison table so
   future model swaps re-verify pooling against the model card.

3. **Sidecar binary is dual-mode.** The plan framed
   `bin/handy-embedding-sidecar.rs` + `embedding_sidecar_protocol.rs`
   as embedding-only, safe to delete with the llama-cpp sidecar path.
   A blast-radius audit revealed `managers/llm.rs` spawns the same
   binary with `SidecarModeDto::Inference` for local-LLM inference
   (Phase G territory). Corrected: sidecar infra stays, trimmed to
   LLM-only (`SidecarModeDto::Embedding` variant + `EmbedBatch`
   request + `EmbedBatchResult` response + embedding runtime
   stripped). `TODO(Phase G)` headers mark the files as scheduled
   deletion when Phase G rewrites LlmManager on Gemini/Vertex. Binary
   name stays `handy-embedding-sidecar` historically — cross-file
   rename wasn't worth churning LlmManager spawn args for a
   soon-deleted path.

4. **Init race on slow disks.** The initial `InferenceHandle::spawn`
   design used `LOAD_TIMEOUT = 10s` as a hard cap; on timeout,
   `vector_search_available` stayed false forever even if the worker
   later finished loading. The sentinel's "exit when unavailable"
   path compounded this by tearing itself down during the pre-load
   gap. Three fixes landed together: (a) `LOAD_TIMEOUT` bumped to
   30s, (b) worker thread self-flips availability on successful load
   so late loads are recoverable, (c) sentinel exits only on
   `respawn_count > MAX_RESPAWNS`, not on transient unavailability.
   Rule 19 check still bounded by `LOAD_TIMEOUT` — on a boot where
   session loads >30s the check is skipped for that boot; next boot
   catches it. Accepted one-boot window documented inline at
   `managers/embedding_ort.rs` `LOAD_TIMEOUT` const.

5. **Rule 19 orphan-data case.** Initial implementation had a
   None-arm `FirstInstall` that trusted existing `vec_embeddings`
   rows when `embedding_model_info` was empty — risk of cosine-space
   contamination from a prior install's vectors against an unknown
   model identity. Corrected with a distinct
   `Rule19Outcome::OrphanVectorsRequeued` variant: None +
   `vec_embeddings` rowcount > 0 → wipe + requeue + populate identity
   row. Catches partial resets and manual DB surgery.

**Implementation wrinkles worth archival:**

- **`ort::Error<SessionBuilder>` is not `Send + Sync`** in
  `ort = 2.0.0-rc.12`. `anyhow::Error: From<_>` doesn't fire; explicit
  `.map_err(|e| anyhow!("{e}"))` required on every ORT fallible call.
  Pattern documented at the top of `managers/embedding_ort.rs`.
- **`tokenizers` crate's `esaxx_fast` default feature** builds
  `esaxx-rs` with /MT (static MSVC runtime); `whisper-rs-sys` builds
  /MD (dynamic). Link-time LNK2038 `RuntimeLibrary` mismatch on
  Windows. Fix: disable `esaxx_fast` — SentencePiece *training*
  optimization; Phase A is inference-only.
- **`PRAGMA` factoring.** Commit 2's cross-review flagged the worker
  connection and main connection duplicating six pragma lines.
  `apply_workspace_conn_pragmas` extracted as `pub(crate) fn` in
  `workspace_manager.rs`; mismatch between connections on
  `workspace.db` corrupts WAL under concurrent writes — single-source
  helper prevents future drift.
- **`rfd` for dialog.** The `.handy.lock` failure path needs a native
  dialog at a point in init where `tauri_plugin_dialog` isn't yet
  accessible (pre-Tauri-builder). `rfd` was already transitively
  linked via `tauri-plugin-dialog`; declared as a direct dep in
  Cargo.toml — zero new compiled code, explicit edge instead of
  transitive.

**Test delta:**

- Added: 4 migration tests, 4 stop-gate tests, 6 ORT semantic
  regression tests, 2 sha256 regression tests on bge-small.
- Removed (with deleted modules): 13 tests in `managers::notes::tests`,
  4 in `managers::embedding::tests`, plus peripheral coverage in
  `tagging` and `import::recovery`.
- Net library test count: 149 → 125 (+2 pre-existing portable
  failures unchanged).

**Spike crates kept in-tree for regression value:**

- `spikes/sqlite_vec_spike/` — vec0 DDL regression + schema validation.
- `spikes/seed_vault/` — synthetic workspace.db generator (10k nodes
  in ~4 min on SSD; 100k would need bulk-mode optimization, per the
  nonlinear FTS+vec0 insert cost curve observed).

**Honest deferrals into later phases:**

- `bindings.ts` not hand-synced with Rust deletions; specta regenerates
  on next `bun run tauri dev`, authoritative shape wins.
- `settings::EmbeddingModel` enum (nomic / bge-m3 variants) left as
  dead code for serde-compat on upgrade deserialization. Phase I
  cleanup.

**Howard's runtime smokes (open, non-blocking):**

- Real-machine DirectML benchmark on a 10k-doc vault.
- Manual `.handy.lock` second-instance dialog verification.

Phase B starts from a Rust backend that no longer has a legacy notes
path, a sidecar running LLM-only, embeddings in-DB via sqlite-vec, and
search surfacing `workspace_nodes` exclusively. Frontend has
`src/entry/` scaffolding (LoadingScreen / LoginPage / LemniscateOrb)
ready for the 6-step onboarding (OAuth deferred to Phase G per D2a).

### 16. i18n during rebuild (D6)

**Decision:** hardcode English in new components during the rebuild,
lift to `t()` calls in Phase I as a single sweep. Rationale: faster
iteration velocity while the UI is still shifting; one pass at the end
catches everything consistently. The 20 locale files stay in place;
Phase I decides which ones to keep based on quality.

---

## What survives from Handy (no rework)

- Entire `src-tauri/` Rust code except the embedding sidecar
- SQLite schema: `workspace_nodes`, `node_views`, `workspace_fts`,
  `user_preferences`, `page_links`
- Vault bidirectional sync logic, atomic write protocol, path computation
- Transcription pipeline (mic + system audio), Whisper integration,
  Enigo text injection
- Voice-memo → workspace doc flow, `VoiceSessionManager`, daily-note
  resolution
- Tauri plugins: fs, clipboard, store, global-shortcut, os, opener,
  dialog, updater, sql, autostart
- `bindings.ts` auto-generated bridge
- Theme module (tokens, presets, editor, schema-versioned persistence)
- Zustand stores (`workspaceStore` is the canonical nav source per
  Rule 2)
- i18n via react-i18next + 20 locale files (content gets audited in
  Phase I)
- Sovereign Glass primitives already in `src/shell/primitives/`
- AppShell / Titlebar / IconRail / AtmosphericStage (Phase 3 shell work)
- LoadingScreen / LoginPage / LemniscateOrb (entry surfaces, IRS-ported)
- 149 passing tests
- Tray icon Rust logic

## What's being rebuilt

- Workspace tree component (flat `src/components/Tree.tsx`)
- MDX editor wrapper (flat `src/components/Editor.tsx` or similar)
- Database views (unified `DatabaseShell` + per-layout renderers)
- Hybrid search UI (quick-open overlay + results list)
- AI chat UI
- Audio capture UI (mic transcribe + system audio panels)
- Onboarding screens
- Settings page (IRS-style sidebar)

## What's being retired

- `usearch` Rust crate + `bin/handy-embedding-sidecar.rs` + sidecar HTTP
  protocol (Phase A)
- `managers/embedding.rs` HTTP client + `managers/vector_store.rs`
  usearch wrapper (Phase A)
- `src/components/TopBar.tsx`, `Sidebar.tsx`, `BottomBar.tsx`,
  `components/workspace/chrome/WorkspaceShell.tsx`,
  `components/chat/ChatWindow.tsx` (unreferenced, Phase I deletes)
- `src/components/workspace/*` (replaced over Phases C-H)
- `src/components/database/*` (replaced in Phase E)
- Planning docs that captured the pre-rebuild direction (already moved
  to [old/](old/))

---

## The execution plan

Detailed phase-by-phase in [PLAN.md](PLAN.md). Summary:

**Phase A** (current, queued) — sqlite-vec migration. Backend-only.
Replaces usearch + sidecar. Unblocks every search-related phase.

**Phase B** — Apple-style onboarding with Google OAuth + theme picker +
vault location.

**Phase C** — Workspace tree v2. Drag/drop, fractional-indexed, vault
round-trip. Split notes/databases tabs.

**Phase D** — MDX editor v2. Simpler toolbar, wikilinks, voice-memo
pills, quieter external-edit conflict banner.

**Phase E** — Databases v2. Unified `<DatabaseShell>` + Grid (Excel
reskin) + Board + Calendar + List + Gallery.

**Phase F** — Search v2. Hybrid FTS + vector in one SQL. Quick-open
overlay.

**Phase G** — AI chat v2. Gemini/Vertex via user's Google OAuth.

**Phase H** — Audio v2. Mic transcribe + system audio UI in IRS style.

**Phase I** — Polish. Tray icons, settings consolidation, i18n
gap-fill, backend command prune, legacy file deletion.

---

## Reading order for someone joining mid-rebuild

1. **This file** — why we're doing what we're doing
2. [PLAN.md](PLAN.md) — what phase we're in, what's next
3. [CLAUDE.md](CLAUDE.md) — the rules every piece of code must obey
4. [pitfall.md](pitfall.md) — engineering traps we've already
   hit (evergreen)
5. [docs/architecture/](docs/architecture/) — per-concern deep dives
   (vault-database storage, theme module, entry experience,
   atmospheric stack, panel system)
6. [old/](old/) — historical reference only, including the archived
   PROJECT_HANDOVER.md. Useful if you're tracking down why a retired
   decision was made, not for learning current architecture.

---

**End of rationale.** Updates to this file should be additive — append
a new dated section under "Key decisions, in order" when a significant
scope or direction change happens.
