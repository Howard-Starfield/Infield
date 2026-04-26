# Knowledge Import: wire Files tab + audit shared import pipeline — Design

**Date:** 2026-04-26
**Scope:** Wire the `Import → Files` tab from cosmetic shell to working local-media import. Reuse the existing `ImportQueueService` and `enqueue_import_paths` Tauri command. Extract shared queue-list components so URL and Files tabs share one stateful CompletedPanel. Fix latent bugs uncovered during inspection: specta digit-snake-case TS drift, queue cross-leaking between tabs, all-or-nothing path enqueue, missing duplicate guard, missing cloud-sync placeholder filter.
**Surfaces touched:** `src/components/ImportFilesTab.tsx`, `src/components/ImportUrlTab.tsx`, `src/components/ImportView.tsx`, `src/components/AppShell.tsx`, `src/components/ImportQueueLists.tsx` (new), `src/utils/importJobs.ts` (new), `src/styles/import.css`, `src-tauri/src/import/mod.rs`, `src-tauri/src/import/web_media.rs`, `src-tauri/src/commands/import_queue.rs`.

---

## Background

The `Import` page (`AppShell.tsx:148`, currentPage = `'import'`) splits into two tabs via `ImportView.tsx`:

- **URL Downloader** (`ImportUrlTab.tsx`) — fully wired to the Rust `ImportQueueService`. Uses `commands.enqueueImportUrls`, subscribes to live snapshots via `useImportQueue()`, renders Processing + Completed panels. End-to-end pipeline: yt-dlp → ffmpeg segment → whisper transcribe → vault write.
- **Files** (`ImportFilesTab.tsx`) — cosmetic shell. The dropzone's `onDrop` handler is empty (`{ e.preventDefault(); setIsDragging(false); }`), the "Imports folder" / "New Knowledge Batch" buttons have no `onClick`, and the Processing/Completed panels render hardcoded mock data ("Helix Research", "Readwise · highlights"). The frontend never invokes `commands.enqueueImportPaths` despite the Rust command being fully implemented.

The Rust backend (`enqueue_import_paths`, `import/mod.rs:1387`) accepts paths and routes through `ImportQueueService` — the same queue the URL tab uses. Supported via `classify_path` (`import/mod.rs:182`):

- **Markdown:** `md`, `markdown`, `mdx`
- **Plain text:** `txt`, `text`, `log`, `csv`
- **PDF:** `pdf`
- **Audio:** `wav`, `mp3`, `m4a`, `aac`, `flac`, `ogg`, `opus`
- **Video:** `mp4`, `mov`, `mkv`, `avi`, `webm`, `mpeg`, `mpg`, `wmv`

Audio and video flow through the full transcription pipeline; markdown/text/pdf flow through `extract_text_from_mem` and create a workspace document. All imports land under the workspace node `"Imported Files"` (📁) at the vault root, created on first import (`import/mod.rs:339-353`).

The page header currently reads "Intelligence Ingestion". Per user direction the title becomes **"Knowledge Import"**.

---

## Decisions (locked during brainstorm)

1. **Scope = B (wire + shared-pipeline bug audit).** Wire the dropzone, file picker, "New Knowledge Batch" button, and "Imports folder" button. Replace mock lists with real `useImportQueue()` data. Audit and fix shared code paths (specta drift, queue filtering, partial enqueue, duplicate guard, cloud-sync placeholders). Do **not** wire the source-connector chips (Notion/Obsidian/Readwise/Bear/Apple Notes/Browser) — each is its own brainstorm.
2. **Queue partitioning by job kind (Approach 1).** URL tab shows only `kind === 'web_media'` jobs. Files tab shows only `kind ∈ {markdown, plain_text, pdf, audio, video}` jobs. Each tab feels self-contained; this also fixes a latent bug where the URL tab was leaking file-import jobs into its lists.
3. **Hybrid extraction for queue rendering.** `CompletedPanel` is ~145 lines of stateful UX (auto-expand on new arrival, `recentIds` highlighting, `hideTimerRef` auto-collapse). Duplicating it would invite drift. Instead extract `<ImportProcessingList>` and `<ImportCompletedList>` to `src/components/ImportQueueLists.tsx`, parameterized by a `renderThumb` prop so each tab supplies its own icon dispatch (URL = remote thumbnail/platform icon; Files = file-type icon). Pure formatters move to `src/utils/importJobs.ts`.
4. **Source chips: visible but disabled.** Greyed-out (opacity 0.45), non-clickable, `title="Connector coming soon"` tooltip. Communicates planned coverage without misleading users that the integrations work.
5. **"Imports folder" button = navigate to Notes tab.** Calls `onNavigate('notes')`. User sees `Imported Files` 📁 at the tree root and clicks. Direct node-open from outside Notes would require a `pendingOpenNodeId` channel in `VaultContext` — out of scope.
6. **"New Knowledge Batch" button = file picker alias.** Same handler as the dropzone click. Multi-select, all supported extensions filterable via grouped filters (All / Documents / Audio / Video).
7. **Drag-drop = Tauri webview event, not HTML5.** `getCurrentWebview().onDragDropEvent(...)` returns real OS paths. HTML5 `e.dataTransfer.files` only gives `File` objects in Tauri webview — useless for `enqueueImportPaths`. Listener mounts/unmounts with the Files tab.
8. **Drop anywhere on the Files tab counts.** No bounding-rect gate. The dropzone is a visual hint, not a strict target. Improves "I dropped a file but nothing happened" UX.
9. **Pre-flight bug fixes happen first.** Specta `WebMediaFormat` rename (TS2820 currently failing in `tsc --noEmit`) and bindings regen are step 1. Then queue filtering. Then Files-tab wiring. Then backend bug fixes (5.1, 5.2, 5.3).

---

## Section 1 — Pre-flight bug fixes

### 1.1 Specta `WebMediaFormat` rename — fix TS2820

Rust at `src-tauri/src/import/web_media.rs:265-270`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WebMediaFormat {
    #[specta(rename = "mp3_audio")]
    Mp3Audio,
    #[specta(rename = "mp4_video")]
    Mp4Video { max_height: u32 },
}
```

**Why per-variant `#[specta(rename = "...")]` rather than `#[specta(rename_all = "snake_case")]`:** the latter re-runs specta-2.0.0-rc.22's broken digit-boundary algorithm and produces the same `mp_3_audio` output. Per-variant rename pins the literal.

Existing serde test at `web_media.rs:194-206` already pins the wire format. Add a doc comment above the enum explaining the dual-rename gotcha so the next person doesn't simplify it back to `rename_all`.

### 1.2 Regenerate `bindings.ts`

Run `bun run tauri dev` once. tauri-specta emits `bindings.ts` on app boot. Verify `bindings.ts:2600` becomes:

```ts
export type WebMediaFormat = { kind: "mp3_audio" } | { kind: "mp4_video"; max_height: number }
```

The same regen also picks up the `clear_completed_imports` command from the in-progress `import_queue.rs` diff (currently causing TS2339 on `ImportUrlTab.tsx:804`). Both type errors disappear together.

### 1.3 Verify

`bun run tsc --noEmit` should no longer report:

- `ImportUrlTab.tsx(128,19): error TS2820: Type '"mp4_video"' is not assignable...`
- `ImportUrlTab.tsx(136,17): error TS2820: Type '"mp3_audio"' is not assignable...`
- `ImportUrlTab.tsx(804,61): error TS2339: Property 'clearCompletedImports' does not exist...`

Pre-existing unrelated errors (App.tsx, EbayConnectModal.tsx, etc.) remain — DoD requires "zero **new** errors", not zero errors.

---

## Section 2 — Shared utilities and components

### 2.1 New file: `src/utils/importJobs.ts`

Pure helpers, lifted verbatim from `ImportUrlTab.tsx:33-93` (and the `jobTitle` helper at line 91):

```ts
import type { ImportJobDto } from '../bindings';

export function formatBytes(bytes: number): string { /* … */ }
export function formatDuration(seconds: number): string { /* … */ }
export function jobProgress(job: ImportJobDto): number { /* … */ }
export function jobStatusLine(job: ImportJobDto): string { /* … */ }
export function jobTitle(job: ImportJobDto): string {
  return job.web_meta?.title ?? job.file_name;
}

export const TERMINAL_STATES: ReadonlySet<ImportJobDto['state']> =
  new Set(['done', 'error', 'cancelled']);
```

One small enhancement to `jobStatusLine` for the file-import case:

```ts
case 'preparing':
case 'segmenting':
  return job.current_step ?? 'Preparing audio…';
```

URL jobs leave `current_step` null during these states (existing behavior preserved). File jobs set it to "Detecting speech…" / "Segmenting audio…" via `patch_job` calls in `run_import_media` — those richer labels now surface.

### 2.2 New file: `src/components/ImportQueueLists.tsx`

Two components extracted from `ImportUrlTab.tsx:664-875`:

```tsx
interface ListProps {
  jobs: ImportJobDto[];
  renderThumb: (job: ImportJobDto) => React.ReactNode;
}

export function ImportProcessingList({ jobs, renderThumb }: ListProps) { /* … */ }

interface CompletedProps extends ListProps {
  onClear: () => void;
}

export function ImportCompletedList({ jobs, renderThumb, onClear }: CompletedProps) {
  /* internal state: seenIdsRef, recentIds, autoExpanded, manualExpanded, hideTimerRef */
}
```

`ImportCompletedList` keeps all of `CompletedPanel`'s internal state (`seenIdsRef`, `recentIds`, `autoExpanded`, `manualExpanded`, `hideTimerRef`, the auto-expand-on-new-arrival effect with 1 s collapse, the manual expand/collapse). The `onClear` prop replaces the inlined `commands.clearCompletedImports()` call so callers can intercept (for tests, future toasts, etc.).

Both components import shared formatters from `src/utils/importJobs.ts`.

### 2.3 Edits to `ImportUrlTab.tsx`

- Delete `formatBytes`, `formatDuration`, `jobProgress`, `jobStatusLine`, `jobTitle`, `JobThumb`, `ProcessingPanel`, `CompletedPanel`, and the local `TERMINAL_STATES` const (~250 lines removed).
- Import from new modules.
- Filter by kind:

  ```ts
  const processing = jobs.filter(j => j.kind === 'web_media' && !TERMINAL_STATES.has(j.state));
  const completed = jobs.filter(j => j.kind === 'web_media' && TERMINAL_STATES.has(j.state));
  ```

- Provide `renderUrlThumb(job)`:

  ```tsx
  function renderUrlThumb(job: ImportJobDto) {
    const thumb = job.web_meta?.thumbnail_url;
    if (thumb) { /* existing img-tag block */ }
    const platform = job.web_meta?.platform ?? '';
    const Icon = platform.toLowerCase().includes('youtube') ? Globe : FileText;
    return <div className="job-thumb"><Icon size={14} /></div>;
  }
  ```

- Replace `<ProcessingPanel jobs={processing} />` with `<ImportProcessingList jobs={processing} renderThumb={renderUrlThumb} />`.
- Replace `<CompletedPanel jobs={completed} />` with `<ImportCompletedList jobs={completed} renderThumb={renderUrlThumb} onClear={() => commands.clearCompletedImports()} />`.

Net delta: removes ~250 lines, adds ~30. Behavior unchanged for URL imports.

---

## Section 3 — Files-tab wiring

### 3.1 Component shape

`ImportFilesTab.tsx` becomes:

```tsx
export function ImportFilesTab({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { jobs } = useImportQueue();
  const [isDragging, setIsDragging] = useState(false);

  const processing = jobs.filter(j =>
    j.kind !== 'web_media' && j.kind !== 'unknown' && !TERMINAL_STATES.has(j.state)
  );
  const completed = jobs.filter(j =>
    j.kind !== 'web_media' && j.kind !== 'unknown' && TERMINAL_STATES.has(j.state)
  );

  // 3.2 drag-drop, 3.3 file picker, 3.4 enqueuePaths, 3.5 source chips, 3.6 buttons …
}
```

### 3.2 Drag-drop via Tauri webview event

```tsx
useEffect(() => {
  let unlisten: (() => void) | null = null;
  (async () => {
    const webview = getCurrentWebview();
    unlisten = await webview.onDragDropEvent((event) => {
      switch (event.payload.type) {
        case 'enter':
        case 'over':  setIsDragging(true); break;
        case 'leave': setIsDragging(false); break;
        case 'drop':
          setIsDragging(false);
          enqueuePaths(event.payload.paths);
          break;
      }
    });
  })();
  return () => { unlisten?.(); };
}, []);
```

The HTML5 `onDragOver` / `onDragLeave` handlers on the dropzone div are removed — Tauri events drive `isDragging`. The HTML5 `onDrop` is removed entirely. The dropzone div remains as a click target and visual indicator.

### 3.3 File picker via `@tauri-apps/plugin-dialog`

```tsx
const SUPPORTED_EXTS = [
  'md','markdown','mdx','txt','log','csv','pdf',
  'wav','mp3','m4a','aac','flac','ogg','opus',
  'mp4','mov','mkv','avi','webm','mpeg','mpg','wmv',
];

async function pickFiles() {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({
    multiple: true,
    filters: [
      { name: 'All supported', extensions: SUPPORTED_EXTS },
      { name: 'Documents',     extensions: ['md','markdown','mdx','txt','log','csv','pdf'] },
      { name: 'Audio',         extensions: ['wav','mp3','m4a','aac','flac','ogg','opus'] },
      { name: 'Video',         extensions: ['mp4','mov','mkv','avi','webm','mpeg','mpg','wmv'] },
    ],
  });
  if (Array.isArray(result)) await enqueuePaths(result);
  else if (typeof result === 'string') await enqueuePaths([result]);
}
```

Triggers: dropzone `onClick`, "New Knowledge Batch" button `onClick`. Dynamic import (`await import(...)`) matches the pattern at `src/utils/pathsExist.ts:15`.

### 3.4 Shared `enqueuePaths`

```tsx
async function enqueuePaths(paths: string[]) {
  if (paths.length === 0) return;
  const res = await commands.enqueueImportPaths(paths);
  if (res.status === 'error') {
    toast.error(res.error);
    return;
  }
  // After Section 4.1 backend change, res.data is { accepted, rejected }
  if (res.data.rejected.length > 0) {
    const summary = res.data.rejected.length === 1
      ? `${basename(res.data.rejected[0].path)}: ${res.data.rejected[0].reason}`
      : `${res.data.rejected.length} files skipped — see console`;
    toast.warning(summary);
    if (res.data.rejected.length > 1) {
      console.warn('[Knowledge Import] rejected:', res.data.rejected);
    }
  }
}

// Helper local to ImportFilesTab.tsx — strips directory, keeps file name only.
function basename(path: string): string {
  const m = path.match(/[^/\\]+$/);
  return m ? m[0] : path;
}
```

### 3.5 Source chips — disabled placeholders

Replace each `<button className="heros-btn">` with a `<div className="heros-btn import-source-chip--disabled" title="Connector coming soon">…</div>`. Add CSS to `src/styles/import.css`:

```css
.import-source-chip--disabled {
  opacity: 0.45;
  cursor: default;
  pointer-events: auto; /* allow tooltip via title */
  user-select: none;
}
.import-source-chip--disabled:hover {
  background: rgba(255,255,255,0.08); /* no hover lift */
}
```

### 3.6 Header buttons

```tsx
<button className="heros-btn" onClick={() => onNavigate('notes')}>
  <FolderOpen size={15} /> Imports folder
</button>
<button className="heros-btn heros-btn-brand" onClick={pickFiles}>
  <Plus size={15} /> New Knowledge Batch
</button>
```

### 3.7 Replace mock lists with real components

Remove the hardcoded `processingBatches` and `completedGroups` blocks (`ImportFilesTab.tsx:14-46`). Replace the two right-column `<section>` blocks (`ImportFilesTab.tsx:135-235`) with:

```tsx
<ImportProcessingList jobs={processing} renderThumb={renderFileThumb} />
<ImportCompletedList
  jobs={completed}
  renderThumb={renderFileThumb}
  onClear={() => commands.clearCompletedImports()}
/>
```

Where `renderFileThumb` dispatches by `job.kind`:

```tsx
function renderFileThumb(job: ImportJobDto) {
  const Icon =
    job.kind === 'audio'      ? Music    :
    job.kind === 'video'      ? Film     :
    job.kind === 'pdf'        ? FileText :
    job.kind === 'markdown'   ? FileText :
    job.kind === 'plain_text' ? FileText :
    File;
  return (
    <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon size={14} />
    </div>
  );
}
```

`Music`, `Film`, `File` come from `lucide-react` (already used for other icons).

### 3.8 H1 rename

Single edit at `ImportFilesTab.tsx:69`: `Intelligence Ingestion` → `Knowledge Import`.

### 3.9 Prop threading

`AppShell.tsx:148`: `<ImportView />` → `<ImportView onNavigate={onNavigate} />`.

`ImportView.tsx`: accept `onNavigate: (page: string) => void` prop, pass to `<ImportFilesTab onNavigate={onNavigate} />`. URL tab does not receive it (no current need).

---

## Section 4 — Backend bug fixes

### 4.1 Partial-success enqueue (5.1)

Current `enqueue_paths` (`import/mod.rs:1387-1435`) returns `Err` on the first unsupported file, dropping all valid files in the same batch. Replace with partial-success.

New types in `src-tauri/src/import/mod.rs`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EnqueuePathRejection {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct EnqueuePathsResult {
    pub accepted: Vec<String>, // job IDs
    pub rejected: Vec<EnqueuePathRejection>,
}
```

`ImportQueueService::enqueue_paths`:

```rust
pub async fn enqueue_paths(&self, paths: Vec<String>) -> Result<EnqueuePathsResult, String> {
    let mut accepted = Vec::new();
    let mut rejected = Vec::new();
    let mut active_paths = self.active_source_paths().await; // 4.2

    for p in paths {
        let path_str = p.trim().to_string();
        let path = PathBuf::from(&path_str);

        if !path.is_file() {
            rejected.push(EnqueuePathRejection { path: path_str, reason: "File not found".into() });
            continue;
        }

        if is_cloud_sync_placeholder(&path) {
            rejected.push(EnqueuePathRejection {
                path: path_str,
                reason: "Cloud-sync placeholder — wait for download to complete".into(),
            });
            continue;
        }

        let kind = classify_path(&path);
        if kind == ImportJobKind::Unknown {
            rejected.push(EnqueuePathRejection {
                path: path_str,
                reason: format!("Unsupported type: .{}", path.extension().and_then(|e| e.to_str()).unwrap_or("?")),
            });
            continue;
        }

        // 4.3 duplicate guard
        let canonical = path.canonicalize().unwrap_or_else(|_| path.clone());
        if active_paths.contains(&canonical) {
            rejected.push(EnqueuePathRejection {
                path: path_str,
                reason: "Already importing this file".into(),
            });
            continue;
        }
        active_paths.insert(canonical);

        let id = uuid::Uuid::new_v4().to_string();
        let job = /* …existing ImportJob construction… */;
        self.inner.jobs.lock().await.push(job);
        accepted.push(id);
    }

    if !accepted.is_empty() {
        emit_snapshot(&self.inner).await;
        self.inner.wake.notify_one();
    }
    Ok(EnqueuePathsResult { accepted, rejected })
}
```

Tauri command signature in `src-tauri/src/commands/import_queue.rs:6`:

```rust
pub async fn enqueue_import_paths(
    service: State<'_, ImportQueueService>,
    paths: Vec<String>,
) -> Result<EnqueuePathsResult, String> { /* … */ }
```

This is the only call site — only the new Files tab consumes it. Bindings regen picks up the new return type.

### 4.2 Active-paths helper (for duplicate guard, 5.2)

```rust
async fn active_source_paths(&self) -> std::collections::HashSet<PathBuf> {
    let jobs = self.inner.jobs.lock().await;
    jobs.iter()
        .filter(|j| !matches!(j.state, ImportJobState::Done | ImportJobState::Error | ImportJobState::Cancelled))
        .filter(|j| j.kind != ImportJobKind::WebMedia) // URL jobs use synthetic source_path
        .map(|j| j.source_path.canonicalize().unwrap_or_else(|_| j.source_path.clone()))
        .collect()
}
```

Rationale: `WebMediaImportJob.source_path = PathBuf::from(url)` is not a real filesystem path, and URL tab already has its own `already_imported` check via `fetch_url_metadata`. Excluding WebMedia avoids false positives.

This is in-flight dedup only. Cross-session dedup (sha256 hash of file vs already-imported notes) is a separate, larger feature and is **not** included in this round.

### 4.3 Cloud-sync placeholder check (5.3)

```rust
fn is_cloud_sync_placeholder(path: &Path) -> bool {
    let name = match path.file_name().and_then(|n| n.to_str()) {
        Some(n) => n.to_ascii_lowercase(),
        None => return false,
    };
    // Per CLAUDE.md Rule 13a — patterns we already document in the vault watcher carve-out
    name.ends_with(".icloud")
        || name.ends_with(".tmp")
        || name.ends_with(".conflicted.md")
        || name.contains(" (conflict ")
        // Cloud Storage hidden placeholders
        || name == ".ds_store"
        || name == "thumbs.db"
        || name == "desktop.ini"
}
```

Lives near `classify_path` in `import/mod.rs`.

### 4.4 Tests

```rust
#[test]
fn enqueue_paths_partial_success() {
    // Pass [valid.mp3, invalid.docx, valid.pdf] (using temp files);
    // assert accepted.len() == 2, rejected.len() == 1, rejected[0].path ends with "invalid.docx".
}

#[test]
fn enqueue_paths_rejects_cloud_sync_placeholder() {
    // Pass foo.mp3.icloud (touch a temp file with that name);
    // assert it lands in rejected[] with reason containing "Cloud-sync placeholder".
}

#[test]
fn enqueue_paths_dedupes_active_imports() {
    // Enqueue path X. Enqueue X again. Assert second call's rejected[]
    // contains X with reason "Already importing this file".
}

#[test]
fn is_cloud_sync_placeholder_recognizes_known_patterns() {
    assert!(is_cloud_sync_placeholder(Path::new("foo.mp3.icloud")));
    assert!(is_cloud_sync_placeholder(Path::new("paper.pdf.tmp")));
    assert!(is_cloud_sync_placeholder(Path::new("note (conflict 2026-04-26).md")));
    assert!(!is_cloud_sync_placeholder(Path::new("normal.mp3")));
}
```

Specta TS-snapshot test deferred — specta-2.0.0-rc.22 lacks a clean public API for asserting generated TS strings in unit tests. The `tsc --noEmit` gate in CI is the regression backstop; the doc comment on `WebMediaFormat` documents the gotcha for future contributors.

---

## Section 5 — Bug audit summary

| # | Bug / risk | Severity | Resolution |
|---|---|---|---|
| 5.1 | `enqueue_import_paths` short-circuits on first unsupported file — drop 5 mixed files, 0 enqueue | High | Section 4.1 — partial-success return type |
| 5.2 | No duplicate guard. Drop same MP3 twice → two transcription jobs and two notes | Medium | Section 4.2 — in-flight dedup by canonical source path |
| 5.3 | Cloud-sync placeholder files (`.icloud`, `.tmp`, `(conflict …)` etc.) not filtered | Medium | Section 4.3 — `is_cloud_sync_placeholder` filter, applied before classify |
| 5.4 | Windows long paths (>260 chars) | Low | No code change. Verify error from `fs::metadata` flows through `rejected[]` toast. CLAUDE.md already documents the registry / cargo target-dir workaround |
| 5.5 | `classify_path` extension handling for compound suffixes | None | Already correct — uses `.extension()` which only sees the last segment |
| 5.6 | URL tab leaks file-import jobs into its lists (no kind filter) | Medium | Section 2.3 — kind filter in both tabs |
| 5.7 | specta digit-snake-case TS drift — `WebMediaFormat` types wrong | High (build error) | Section 1.1 — per-variant `#[specta(rename = …)]` |
| 5.8 | Dropzone has `cursor: 'pointer'` but no click handler | Cosmetic | Section 3.3 — wire to `pickFiles` |

---

## Section 6 — Testing plan

### 6.1 Static checks

- `bun run tsc --noEmit` — zero new errors. The two TS2820s and one TS2339 from Section 1.3 are gone.
- `bunx vitest run` — existing tests green.
- `cargo test --lib` — 125 lib tests + 4 new tests from Section 4.4 = 129 green.

### 6.2 Manual smoke (`bun run tauri dev`)

1. Drop one `.mp3` on the Files tab → appears in Processing, transitions Segmenting → Transcribing → Done, lands as a child of "Imported Files" in Notes.
2. Drop ten files at once (mix of pdf/md/audio) → all enqueue, queue scrolls if needed.
3. Drop one `.docx` → no jobs created, toast: `"Unsupported type: .docx"`.
4. Drop two valid + one invalid → two enqueue, toast: `"foo.docx: Unsupported type: .docx"`.
5. Drop the same `.pdf` twice quickly → second drop toasts `"Already importing this file"`, only one job runs.
6. Drop a `.mp3.icloud` placeholder → toast: `"…: Cloud-sync placeholder — wait for download to complete"`.
7. Click "New Knowledge Batch" → file picker opens, multi-select 3 files → all enqueue.
8. Click dropzone (no drag) → file picker opens.
9. Click "Imports folder" → switches to Notes tab. "Imported Files" 📁 visible at tree root.
10. Cancel a transcribing job → moves to Completed with `cancelled` badge.
11. Click "Clear" on Completed → list empties (in-memory only — backend `clear_completed_imports` already handles this).
12. Switch to URL tab during a file import → file jobs do **not** appear there. Switch back → file jobs reappear in Files tab.
13. Source chips (Notion / Obsidian / Readwise / Bear / Apple Notes / Browser) → hover shows "Connector coming soon", click does nothing.
14. Header reads **"Knowledge Import"**, not "Intelligence Ingestion".

### 6.3 Cross-tab sanity

- Start a YouTube download in URL tab. Switch to Files tab. Drop an MP3. Switch back. URL tab shows only the YouTube job; Files tab shows only the MP3 job.
- Both tabs' "Clear" buttons clear the same underlying queue (`commands.clearCompletedImports()`). Document this behavior — clearing in one tab also clears the other tab's completed list. Acceptable for v1.

---

## Out of scope (this round)

- Source-connector chips (Notion ZIP parser, Readwise API, Bear DB reader, Apple Notes export, Browser-extension sync). Each is its own brainstorm.
- Cross-session duplicate detection (file content hash vs. already-imported notes' source frontmatter). Bigger feature; defer.
- Direct node-open from "Imports folder" button (would need `pendingOpenNodeId` in `VaultContext`).
- "Auto-grouped batches" UI concept ("Helix Research (auto-grouped)" in old mock). Backend has no batch grouping; would require a new job-batching abstraction.
- Drag-drop progress on the dropzone itself ("3 files queued"). The Processing list is the canonical feedback surface.
- Specta TS-snapshot unit test (no clean API in rc.22).

---

## Open items resolved during brainstorm

- **Inline vs. extract for queue rendering** — rejected pure inlining after inspecting `CompletedPanel` (~145 lines of stateful UX). Hybrid extraction approved (Section 2).
- **Source-chip behavior** — visible disabled with tooltip (decision 4).
- **Dropzone-only vs. whole-page drop target** — whole page (decision 8).
- **"Imports folder" target** — Notes tab, not direct node-open (decision 5).
- **Bug audit scope** — B (this tab + shared pipeline only, not other in-progress URL-tab work).

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| `getCurrentWebview().onDragDropEvent` not available or differs in Tauri 2 rc | Low — used in other Tauri 2 projects, plugin-fs and plugin-dialog already wired here | If signature differs, fall back to listening on `tauri://drag-drop` event via `listen()` from `@tauri-apps/api/event` |
| `path.canonicalize()` fails on Windows network drives | Low | Falls back to non-canonical path; dedup may miss exotic cases — acceptable |
| specta `#[specta(rename = "...")]` not respected in rc.22 | Low — rename attribute is standard since rc.20 | Verify after regen; if not honored, generate the TS file manually (post-build sed against bindings.ts is documented as a last-resort in tauri-specta issue tracker — but adds maintenance burden) |
| Pre-existing TS errors mask new ones | Confirmed — many pre-existing errors in App.tsx, Ebay*, etc. | Verify by diffing `tsc --noEmit` output before vs. after |
| Auto-clear of in-progress queue on app restart | Out of scope — separate "boot recovery" concern documented in `import_queue.rs:38-43` | Not a regression; documented behavior |
