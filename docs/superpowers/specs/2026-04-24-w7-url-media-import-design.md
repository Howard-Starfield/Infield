# W7 — URL Media Import (Design)

> **Status:** Design approved 2026-04-24, ready for plan.
> **Companion phases:** Extends `import/mod.rs` (the file-import pipeline shipped pre-Phase-A). Forward-compat hooks for **W2** (CodeMirror click-to-seek) and **W6** (LLM summary / chapters / tags). **W8 (Visual Import)** is the sibling phase that will follow the same module pattern for image OCR after **W4 (Databases)** lands.

---

## 1. Goal

Let users paste any media URL (YouTube, podcasts, TikTok, Vimeo, Twitter/X, Reddit, Loom, Twitch — 1000+ sites) into the existing Import page and end up with a workspace document containing the full transcript, source metadata, a cached thumbnail, and (optionally) the cached audio for replay.

The pipeline reuses the existing `import/mod.rs` state machine — URL handling is a new head-of-pipeline stage, not a parallel system.

## 2. Non-goals (explicit deferrals)

| Item | Reason | Future home |
|---|---|---|
| Inline transcript timestamps in markdown body | User decision: keep body clean. Sidecar JSON used instead for forward-compat. | W2 reads `segments.json` to add click-to-seek decorations. |
| Auto-summary / chapter detection / tag suggestions | Requires LLM infrastructure. | W6. |
| Visual / receipt / image OCR | Different engine, different output target (database rows). | W8. |
| Authentication-required content (private, members-only, age-restricted) | Out of scope for v1 — would require credential storage, which raises privacy + security obligations we don't want to take on yet. | Possibly post-v1 with explicit user consent flow. |
| Live-stream capture | Unbounded length, separate concurrency model. | Not planned. yt-dlp returns "is_live"; we surface a clear "try again after the stream ends" error. |
| VPN / region workarounds | Out of scope. We surface the platform's own region-availability error verbatim. | Not planned. |
| Mid-download pause/resume | Adds complexity for marginal value. Cancel + re-enqueue is the supported control. | Not planned. |

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ ImportView (React)                                                  │
│  ┌──────────────────┐  ┌──────────────────────────────────────────┐ │
│  │ URL textarea     │  │ Processing / Completed (unified queue)   │ │
│  │ (auto-detects 1  │  │  rows from BOTH file and URL imports     │ │
│  │  vs N URLs)      │  │  ordered by enqueue time                 │ │
│  │ Format / Keep    │  └──────────────────────────────────────────┘ │
│  │ [Preview/Enqueue]│                                                │
│  └──────────────────┘                                                │
└──────────────┬──────────────────────────────────────────────────────┘
               │ invoke() — see §6 for command surface
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ src-tauri/src/import/                                                │
│                                                                      │
│  mod.rs (existing 939 lines — EXTEND)                                │
│   ├─ ImportJobKind:: + WebMedia                                      │
│   ├─ ImportJobState:: + FetchingMeta, Downloading                    │
│   └─ ImportQueueService::enqueue_urls(urls, opts)                    │
│                                                                      │
│  web_media.rs (NEW)                                                  │
│   ├─ YtDlpHandle — wraps the binary, parses --dump-json + progress   │
│   ├─ fetch_metadata(url) → WebMediaMetadata                          │
│   ├─ fetch_playlist_entries(url) → Vec<PlaylistEntry>                │
│   ├─ download_media(url, opts, on_progress) → MediaArtefacts         │
│   ├─ verify_artefacts(dir) → Result<()>                              │
│   └─ WebMediaError — typed errors (Unsupported, Private, ...)        │
│                                                                      │
│  segmenting.rs, post_processing.rs (existing — unchanged)            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ PathBuf to local audio
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Existing Audio pipeline (unchanged):                                 │
│   Preparing → Segmenting → DraftCreated → Transcribing →             │
│   PostProcessing → Finalizing → Done                                 │
│ Respects Rule 16a — yields ORT lane to active mic session.           │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Vault write (Invariant #1):                                          │
│   <vault>/<parent_folder>/<title-slug>.md   ← workspace document     │
│   <vault>/.handy-media/web/<node-id>/        ← media sidecar dir     │
│     ├─ audio.mp3                                                     │
│     ├─ video.mp4   (if user chose MP4)                               │
│     ├─ thumbnail.jpg                                                 │
│     └─ segments.json                                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Key principles

1. **Extend, don't rebuild.** `import/mod.rs` is shipped, working, and wired into `embedding_worker`, `search`, `workspace_manager`. We add two head states (`FetchingMeta`, `Downloading`) and one variant (`ImportJobKind::WebMedia`); after `Preparing`, the existing pipeline runs unchanged. (Invariant #5.)
2. **yt-dlp is an optional plugin, not a bundled dependency.** Core installer ships without it. File imports work without it. URL imports prompt install on first use. (See §4.)
3. **`web_media.rs` is the modular boundary.** All URL-specific concerns — sidecar invocation, progress parsing, error taxonomy, platform quirks — live in one file. The existing pipeline stays generic.
4. **No new filesystem watcher** (Rule 14). Cleanup happens at well-defined moments: job complete, job cancel, plugin uninstall.

## 4. Plugin install model

yt-dlp is treated as a user-installable optional extension. Three install entry points:

1. **Import-page banner** — when the URL textarea is focused and the plugin is missing, the input area becomes a card: "Media downloader not installed · 12 MB · Required for URL imports — [Install] [Skip for now]."
2. **Settings → Extensions** (new view) — single card per plugin, with version, install date, size, last-checked timestamp, and `[Check for update]` / `[Uninstall]` actions.
3. **Onboarding extensions step** (new, optional) — slot inserted between `vault` and `done`. Skippable. Lists all available optional plugins (just yt-dlp at v1; W6/W8 plugins later).

### Install location

`<app_data>/handy/extensions/yt-dlp/` (NOT in vault — extensions are app-scope, not vault-scope, and shouldn't be backed up with vault contents).

```
<app_data>/handy/extensions/yt-dlp/
├── yt-dlp[.exe]          ← platform-appropriate self-contained binary
├── version.txt           ← installed version string
├── installed_at.txt      ← ISO 8601 timestamp
└── checksum.sha256       ← SHA256 of the binary as installed
```

### Acquisition

1. Frontend calls `install_yt_dlp_plugin()` Tauri command.
2. Backend resolves platform → asset URL on yt-dlp's GitHub Releases (`yt-dlp.exe`, `yt-dlp_macos`, `yt-dlp_linux`).
3. Fetches the release's published `SHA2-256SUMS` file.
4. Downloads the binary into a temp file with progress events.
5. Computes SHA256 of the downloaded file.
6. **Compares against the published checksum.** Mismatch → discard, error: "Download integrity check failed — try again."
7. Moves into place: `<app_data>/handy/extensions/yt-dlp/yt-dlp[.exe]`.
8. Writes `version.txt`, `installed_at.txt`, `checksum.sha256`.
9. macOS: ad-hoc codesigns the binary (`codesign --force --sign - <path>`) per Rule 17.
10. Marks plugin available; emits `plugin-state-changed` event.

### Update

- **Auto-check cadence**: weekly. On Handy boot, if `last_checked_at > 7 days ago` and network reachable, check GitHub Releases API for latest tag; cache result in app state.
- **Manual check**: button on Settings → Extensions and on Import page.
- **Apply**: only when no `WebMedia` jobs are in `FetchingMeta` or `Downloading` state. Otherwise mark "Update pending — will apply after current queue finishes" and apply on next idle.
- **In-place replacement on Windows**: target file may be locked; download to `.new`, rename on next launch (or after queue idle on POSIX).

### Uninstall

- If active jobs exist: confirm "N active URL imports will be cancelled — continue?"
- Cancel all `WebMedia` jobs in `{Queued, FetchingMeta, Downloading}`.
- `fs::remove_dir_all(<app_data>/handy/extensions/yt-dlp/)`.
- Emit `plugin-state-changed`.

### Plugin-missing detection

`yt_dlp_plugin_status() -> { installed: bool, version: Option<String>, last_checked_at: Option<DateTime>, latest_available: Option<String> }`. Frontend polls on Import page mount and on focus.

## 5. State machine extensions

```rust
pub enum ImportJobKind {
    Markdown, PlainText, Pdf, Audio, Video,
    WebMedia,     // NEW
    Unknown,
}

pub enum ImportJobState {
    Queued,
    FetchingMeta,    // NEW — yt-dlp --dump-json running
    Downloading,     // NEW — yt-dlp fetching media
    Preparing,       // EXISTING — pipeline unchanged from here on
    Segmenting,
    DraftCreated,
    Transcribing,
    PostProcessing,
    Finalizing,
    Done, Error, Cancelled,
}
```

Flow for `WebMedia`:

```
Queued
  → FetchingMeta            (yt-dlp --dump-json with --no-playlist)
  → Downloading             (yt-dlp -x --audio-format mp3 ...)
  → Preparing               (existing — converts mp3 → temp WAV for whisper)
  → Segmenting              (existing — long-audio chunking)
  → DraftCreated            (existing — workspace_node row created with frontmatter)
  → Transcribing            (existing — yields ORT to active mic session per Rule 16a)
  → PostProcessing          (existing)
  → Finalizing              (existing — vault file write)
  → Done                    (existing)
```

`Error` and `Cancelled` are terminal at any stage. On `Cancelled` from `Downloading` or earlier: kill yt-dlp child process group, `remove_dir_all` the partial sidecar dir.

## 6. Tauri commands

### New

```rust
#[tauri::command]
async fn fetch_url_metadata(url: String) -> Result<WebMediaMetadata, String>;
// Side-effect-free preview. Runs yt-dlp --dump-json --no-playlist.

#[tauri::command]
async fn fetch_playlist_entries(url: String) -> Result<PlaylistEnvelope, String>;
// For playlist URLs. Runs yt-dlp --flat-playlist --dump-single-json.

#[tauri::command]
async fn enqueue_import_urls(
    urls: Vec<String>,
    opts: WebMediaImportOpts,
) -> Result<Vec<String>, String>;   // returns one job_id per URL
```

### New (plugin management)

```rust
#[tauri::command]
async fn yt_dlp_plugin_status() -> Result<PluginStatus, String>;

#[tauri::command]
async fn install_yt_dlp_plugin() -> Result<(), String>;
// Emits 'plugin-install-progress' events: { phase: "download"|"verify"|"finalize", bytes, total }

#[tauri::command]
async fn check_yt_dlp_update() -> Result<UpdateCheckResult, String>;

#[tauri::command]
async fn uninstall_yt_dlp_plugin() -> Result<(), String>;
```

### Existing (unchanged but used by URL flow)

```rust
get_import_queue() -> ImportQueueSnapshot
cancel_import_job(job_id: String) -> ()
enqueue_import_paths(paths: Vec<String>) -> Vec<String>   // file imports, untouched
```

### New queue control

```rust
#[tauri::command]
async fn pause_import_queue() -> Result<(), String>;

#[tauri::command]
async fn resume_import_queue() -> Result<(), String>;

#[tauri::command]
async fn import_queue_pause_state() -> Result<bool, String>;
```

## 7. Data model

```rust
pub struct WebMediaMetadata {
    pub url: String,
    pub source_id: String,                          // yt-dlp canonical id, used for dedup
    pub title: String,
    pub thumbnail_url: Option<String>,              // remote URL (we cache locally on download)
    pub duration_seconds: Option<f64>,
    pub channel: Option<String>,
    pub platform: String,                           // "youtube", "tiktok", "vimeo", ...
    pub published_at: Option<String>,               // ISO 8601 if available
    pub available_video_heights: Vec<u32>,          // [360, 480, 720, 1080]
    pub is_live: bool,                              // surfaced as terminal error
    pub already_imported: Option<AlreadyImportedHit>,  // dedup hit, if any
}

pub struct AlreadyImportedHit {
    pub node_id: String,
    pub imported_at: String,
    pub vault_path: String,
}

pub struct PlaylistEnvelope {
    pub playlist_url: String,
    pub playlist_title: String,
    pub channel: Option<String>,
    pub entries: Vec<PlaylistEntry>,
}

pub struct PlaylistEntry {
    pub url: String,
    pub source_id: String,
    pub title: String,
    pub duration_seconds: Option<f64>,
    pub thumbnail_url: Option<String>,
    pub channel: Option<String>,
    pub already_imported: Option<AlreadyImportedHit>,
}

pub struct WebMediaImportOpts {
    pub keep_media: bool,                           // default true
    pub format: WebMediaFormat,                     // default Mp3Audio
    pub parent_folder_node_id: Option<String>,      // None = use Settings default
    pub playlist_source: Option<PlaylistSource>,    // set when enqueued from selector
}

pub enum WebMediaFormat {
    Mp3Audio,
    Mp4Video { max_height: u32 },                   // 720 or 1080
}

pub struct PlaylistSource {
    pub title: String,
    pub url: String,
    pub index: u32,
}

pub struct PluginStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub installed_at: Option<String>,
    pub last_checked_at: Option<String>,
    pub latest_available: Option<String>,
    pub size_bytes: Option<u64>,
}

pub struct UpdateCheckResult {
    pub current: Option<String>,
    pub latest: String,
    pub update_available: bool,
}
```

`ImportJobDto` (existing) gains four optional fields, all `None` for non-WebMedia jobs:

```rust
pub web_meta: Option<WebMediaMetadata>,
pub download_bytes: Option<u64>,
pub download_total_bytes: Option<u64>,
pub download_speed_human: Option<String>,    // "2.1 MB/s"
```

## 8. Vault write format

### Workspace document

Path: `<vault>/<parent_folder>/<title-slug>.md`. Default parent folder is `Web Clips/` (auto-created on first import); user can override per-Settings via a tree-picker.

Slug derivation: `slugify(title)` → first 80 chars of `[a-z0-9-]` filtered; on collision, append first 8 chars of node UUID (existing `compute_vault_rel_path` pattern).

Frontmatter:

```yaml
---
id: 0194a8f7-3c1d-7c2a-9e4b-8f2d1a3b5c6e
title: "Original Video Title"
source_url: "https://www.youtube.com/watch?v=abc123"
source_id: "abc123"                          # canonical dedup key
source_platform: youtube
source_channel: "Channel Name"
source_duration_seconds: 1847
source_published_at: "2026-03-12"
media_dir: ".handy-media/web/0194a8f7-3c1d-7c2a-9e4b-8f2d1a3b5c6e/"
imported_at: "2026-04-24T14:22:31Z"
imported_via: web_media
media_kept: true
playlist_source:                             # optional, from playlist selector
  title: "Playlist Title"
  url: "https://www.youtube.com/playlist?list=PLxyz"
  index: 3
---
```

Body:

```markdown
::web_clip{url="https://..." thumb=".handy-media/web/0194.../thumbnail.jpg" platform="youtube"}

Transcript paragraph 1 — plain text, no inline timestamps.

Transcript paragraph 2.

...
```

The `::web_clip{...}` directive parallels Rule 9's `::voice_memo_recording{...}`. Pre-W2 it renders as plain text. Post-W2, CM6 will decorate it as a rich card (thumbnail, title, channel, duration, play button).

### Sidecar files

`<vault>/.handy-media/web/<node-id>/`:

| File | Always? | Purpose |
|---|---|---|
| `audio.mp3` | if `media_kept: true` | Playback + W2 click-to-seek target |
| `video.mp4` | only if user chose MP4 | Optional, retained for replay |
| `thumbnail.jpg` | always (if metadata had a thumbnail URL) | Card rendering, cached locally per Invariant #1 |
| `segments.json` | **always** | W2 click-to-seek retrofit path |

`segments.json` shape:

```json
[
  { "start_ms": 0,    "end_ms": 3200, "text": "Welcome to the show." },
  { "start_ms": 3200, "end_ms": 7100, "text": "Today we're talking about..." }
]
```

This is whisper's per-segment output; we already produce it internally during `Transcribing`. Adding it to disk is one `serde_json::to_writer`. Omitting it from the body keeps the markdown clean per the user's preference; W2 will read it directly from the sidecar.

### Storage layout (full picture)

```
<vault>/
├── Web Clips/                                 ← default parent folder
│   ├── original-video-title.md
│   └── another-video.md
└── .handy-media/                              ← hidden, ignored by FTS/embedding scan
    ├── web/                                   ← W7 namespace
    │   ├── 0194a8f7-.../
    │   │   ├── audio.mp3
    │   │   ├── thumbnail.jpg
    │   │   └── segments.json
    │   └── 0194a8f8-.../
    │       └── ...
    ├── voice/                                 ← future W1 migration target
    ├── images/                                ← W8 namespace (reserved)
    └── files/                                 ← reserved for PDF originals if ever kept
```

Atomic per-node cleanup: deleting a workspace node permanently → `fs::remove_dir_all(.handy-media/web/<node-id>/)`. One call, no orphan risk.

`.handy-media/**` is added to Rule 13a's ignore-list and excluded from `workspace_fts` / vector embedding scans.

## 9. UI changes

### 9.1 ImportView (rewrite from current dormant mock)

Existing structure (left column = input area, right column = Processing + Completed panels) is preserved. The left column gets a new top section for URL input, above the existing dropzone; the right column becomes a unified queue surface fed by real `import-queue-updated` events instead of mocked data.

URL input section:

- Auto-resizing textarea (1 line tall by default, grows on multi-line paste)
- Placeholder: "Paste a URL — YouTube, podcasts, social platforms, 1000+ sites"
- Below: format picker dropdown (`MP3` / `MP4 720p` / `MP4 1080p`) + "Keep audio" checkbox
- Below: action button, label depends on detected URL count:
  - 0 valid URLs → button disabled
  - 1 URL → `[Preview]`
  - 2+ URLs → `[Enqueue N URLs]`

URL detection: split on `\n` and whitespace, trim, filter to entries matching `^https?://` and a dotted domain. Dedup within the textarea (a paste of the same URL twice counts as one).

Single-URL flow:

1. User presses `[Preview]` (or hits Enter) → 400ms debounce → invoke `fetch_url_metadata`.
2. Skeleton card appears.
3. On success: preview card with thumbnail, title, channel, duration. If `is_live: true` → "Live streams not supported" error variant. If `already_imported.is_some()` → "Already imported on Y → [Open note] / [Import anyway]". If `_type == "playlist"` → "Playlist of N videos → [Choose videos…]".
4. User clicks `[Import]` → invoke `enqueue_import_urls([url])` → input clears → row appears in Processing panel.

Multi-URL flow:

1. User pastes multiple URLs.
2. Button label updates to `[Enqueue N URLs]`.
3. Click → invoke `enqueue_import_urls(urls)` → all rows appear in Processing panel; metadata fetched async per-job and decorates rows as it arrives.

Plugin-missing flow:

When `yt_dlp_plugin_status().installed === false`, the URL input area is replaced by an install banner card: `[icon] Media downloader not installed · 12 MB · Required for URL imports — [Install] [Skip for now]`. Click `[Install]` → progress bar shows download bytes; on success, banner replaced by URL input.

### 9.2 PlaylistSelectorModal (new)

Modal overlay over ImportView, glass surface per HerOS:

- Header: playlist title, channel, "N videos" count
- Filter input
- Toolbar: `[Select all] [Select none] [Invert]`
- Body: virtualized list (`@tanstack/react-virtual` if entries > 100, per CLAUDE.md perf targets). Each row: checkbox, thumbnail, title, duration, channel, "already imported" badge if applicable.
- Footer: format picker + keep-audio toggle (apply to all selected) + `[Cancel] [Import N videos →]`

On import: each ticked entry enqueues one WebMedia job with `playlist_source: { title, url, index }` in opts → carried into frontmatter.

### 9.3 Queue row (Processing panel)

Existing row layout retained. WebMedia rows populate fields as state progresses:

| State | Icon | Subtitle | Right side |
|---|---|---|---|
| `Queued` | platform logo | "Queued" | `[✕]` |
| `FetchingMeta` | platform logo dim | "Fetching metadata…" | spinner |
| `Downloading` | thumbnail | `12.3 / 40.0 MB · 2.1 MB/s · ETA 00:14` | progress bar + % |
| `Preparing` / `Segmenting` | thumbnail | "Preparing audio…" | indeterminate |
| `Transcribing` (free lane) | thumbnail | "Transcribing · 4 / 12" | progress bar + % |
| `Transcribing` (waiting) | thumbnail | "Waiting for mic session to end…" | clock icon |
| `PostProcessing` | thumbnail | "Finalizing…" | indeterminate |
| `Done` | thumbnail | "Saved to Web Clips/title.md" | `[Open]` |
| `Error` | ⚠ | typed error message + `[Why?]` | `[Retry] [Dismiss]` |
| `Cancelled` | thumbnail dim | "Cancelled" | `[Retry] [Dismiss]` |

### 9.4 Queue controls

Above Processing panel header:

- `[⏸ Pause queue]` / `[▶ Resume queue]` toggle
- `[Clear completed]`
- Counter: `active 3 · queued 2 · done today 17`

Pause stops the worker from picking the next job; in-flight job runs to completion (no kill).

### 9.5 Settings → Extensions (new view)

New entry in Settings sidebar: "Extensions". Single card per available plugin:

```
┌──────────────────────────────────────────────────────┐
│ 📥  Media downloader (yt-dlp)                        │
│     Installed · v2026.04.15 · Last checked 2d ago    │
│     Enables URL imports from YouTube, podcasts, ...  │
│     [Check for update] [Uninstall]                   │
└──────────────────────────────────────────────────────┘
```

If not installed: `[Install (12 MB)]` button only.
If update available: `[Update to vX.Y.Z]` button highlighted.
If update pending (jobs running): info row "Update queued — will apply when imports finish."

### 9.6 Onboarding extensions step (new)

Slot inserted between `vault` and `done`. Backend: extend `OnboardingStep` enum:

```rust
pub enum OnboardingStep {
    Mic, Accessibility, Models, Vault,
    Extensions,    // NEW
    Done,
}
```

Migration: **no row rewrite**. The enum simply gains a variant; existing `Done` users stay `Done` and never re-enter onboarding. Users who happen to be mid-onboarding at `Vault` step naturally advance to `Extensions` next instead of `Done` (the next-step logic walks the enum order). New users see all steps.

This is **distinct from the W0 `Welcome → Mic` self-heal pattern**, which removed a step and needed row rewriting. We're adding a step, which is a no-op migration.

UI: list of available optional plugins with checkboxes. Today only yt-dlp; W6/W8 will add LLM runtime and OCR engine. `[Skip for now]` advances to `Done` without installs; `[Install selected]` installs ticked plugins serially with progress, then advances.

### 9.7 Files

| File | Action |
|---|---|
| `src/components/ImportView.tsx` | Rewrite (currently dormant mock) |
| `src/components/PlaylistSelectorModal.tsx` | New |
| `src/components/SettingsExtensionsView.tsx` | New |
| `src/components/OnboardingStepExtensions.tsx` | New |
| `src/hooks/useImportQueue.ts` | New — subscribes to `import-queue-updated`, exposes snapshot + controls |
| `src/hooks/useYtDlpPlugin.ts` | New — install / uninstall / version state |
| `src/styles/import.css` | New — token-only styles per Rule 12 / 18 |
| `src/components/SettingsView.tsx` | Touched — add "Extensions" sidebar entry |
| `src/components/OnboardingOverlay.tsx` | Touched — slot in extensions step |

All new components flat under `src/components/` per Definition of Done #5.

## 10. Concurrency

| Pool | Limit | Reason |
|---|---:|---|
| Metadata fetches (`yt-dlp --dump-json`) | 4 | Cheap, network-bound, no ORT contention |
| Downloads (`yt-dlp -x ...`) | 2 | Balances bandwidth with platform rate-limit etiquette |
| Transcription | **1 (shared with existing pipeline)** | Single ORT whisper session, Rule 16a-compliant |

All three are settings-toggleable for later tuning; hardcoded defaults for v1.

### Rule 16a coordination (mic quiescence)

Before transitioning a WebMedia job to `Transcribing`, the worker calls `transcription_session_holds_model(app)` (existing helper in `managers/transcription.rs`). If the mic holds the ORT session, the WebMedia job stays in a held `Preparing` state with subtitle "Waiting for mic session to end…" and polls every 2s. Resumes when mic releases.

### Rate limiting / politeness

When dispatching multiple downloads in a single batch, yt-dlp is invoked with `--sleep-interval 1 --max-sleep-interval 3` — small randomized sleep between sequential download phases. Invisible to user, keeps Handy a good citizen of the platforms it interacts with. Settings toggle for power users to disable.

## 11. Error handling

```rust
pub enum WebMediaError {
    Unsupported(String),                // yt-dlp: "Unsupported URL"
    RegionUnavailable { country: Option<String> },
    AuthRequired,                       // private / members-only / age-restricted
    DeletedOrNotFound,
    LiveStream,                         // is_live: true
    DurationExceedsLimit { duration_seconds: f64, limit_seconds: f64 },
    NetworkError(String),
    YtDlpNotFound,                      // plugin missing or removed mid-job
    YtDlpCrashed { exit_code: i32, stderr_tail: String },
    FfmpegFailed(String),
    DiskFull,
    IntegrityCheckFailed,               // post-download magic-byte / size validation
}
```

### Retry policy

| Error | Auto-retry? | UX |
|---|---|---|
| `NetworkError` | Yes, once after 5s | If second fails → manual `[Retry]` |
| `YtDlpCrashed` | Yes, once | Mirrors Rule 16's restart-once philosophy for native workers |
| `IntegrityCheckFailed` | No | "Downloaded file failed verification — [Retry]" |
| `RegionUnavailable` / `AuthRequired` / `DeletedOrNotFound` / `Unsupported` / `LiveStream` / `DurationExceedsLimit` | No | Terminal — clear message, manual `[Retry]` available |
| `YtDlpNotFound` | No | Global banner "Media downloader missing — [Reinstall]" |
| `DiskFull` | No | Terminal with vault-disk-space dialog |
| `FfmpegFailed` | Yes, once | If second fails → manual retry |

### Verification on download success

After yt-dlp claims success:

1. Expected output file exists at predicted path.
2. File size > 1 KB.
3. ffmpeg exit code 0 (we drive ffmpeg explicitly via `--audio-format mp3 --audio-quality 2`).
4. Magic-byte check on the mp3 (`ID3` or sync frame).
5. Thumbnail file exists if metadata had a thumbnail URL.

Any failure → `IntegrityCheckFailed`, `remove_dir_all` the sidecar dir, no partial vault write.

### Cancel cleanup

Cancel during `Downloading` or earlier:

1. yt-dlp child process spawned in its own process group (`setsid` on Unix) / job object (Windows).
2. Cancel sends `SIGTERM` to the group → all yt-dlp + ffmpeg + http children die together.
3. After 5s: `SIGKILL` if any survive.
4. `fs::remove_dir_all(.handy-media/web/<node-id>/)`.
5. Job state → `Cancelled`.

### Boot recovery

On Handy boot, scan jobs persisted in DB where `state IN ('FetchingMeta', 'Downloading', 'Preparing', 'Segmenting')`. These were active when Handy last exited — assume crashed mid-flight. Mark each as `Error` with message "Interrupted — retry to restart." User clicks `[Retry]` → fresh enqueue (no resume of partial download — yt-dlp's `-c` continue is unreliable for app-aborted sessions; clean re-fetch is more predictable).

## 12. Edge cases & decisions

| # | Case | Decision |
|---|---|---|
| 1 | User pastes the same URL twice in textarea | Dedupe within textarea before fetch. |
| 2 | User pastes 1 URL, it's a playlist | Preview card shows "Playlist of N videos → [Choose videos…]" — opens selector, no silent expansion. |
| 3 | User pastes mix of single URLs and playlist URLs | Each playlist URL opens its own selector modal in sequence on `[Enqueue]`. Single URLs enqueue normally. |
| 4 | Same source_id already imported | Preview shows "Already imported on Y → [Open note] / [Import anyway as copy]". Bulk paste: skipped silently with a toast "3 URLs already imported, skipped." User can override per-Settings. |
| 5 | Source_id already imported but original was deleted (`deleted_at IS NOT NULL`) | Treated as fresh import. If in trash, offer "Restore from trash" alongside "Import anyway." |
| 6 | Plugin removed during active download | Active jobs error with `YtDlpNotFound`, sidecar dirs cleaned up, banner prompts reinstall. |
| 7 | yt-dlp output file path differs from prediction (extractor quirk) | We pass `--print after_move:filepath` and capture the actual final path from yt-dlp stdout, not predict it. |
| 8 | Unicode title with filesystem-hostile chars (`/ \ : *`) | `compute_vault_rel_path` slugifies; Rule 13a NFC normalize applies. |
| 9 | Title slug collision (two videos titled "Lecture 1") | Existing pattern: append first 8 chars of node UUID. |
| 10 | User changes default parent folder mid-batch | New jobs use new default; in-flight jobs land in their original target. |
| 11 | Default parent folder missing/deleted | Auto-recreate at vault root, or fall back to vault root if recreate fails. |
| 12 | Network drops mid-download | yt-dlp errors → `NetworkError` → auto-retry once after 5s. |
| 13 | Disk fills mid-download | yt-dlp errors → `DiskFull` → terminal, surface clear UI. |
| 14 | Title sanitization for YAML frontmatter | Use a YAML library (`serde_yaml`) — never raw string interpolation. Quotes/colons/special chars handled correctly. |
| 15 | Length cap | Default `max_import_duration_seconds: 14400` (4h). Settings toggle. Over-limit URLs warn in preview, allow override. |
| 16 | Bulk paste includes a malformed line | Filtered out before enqueue; toast: "2 lines didn't look like URLs, skipped." |

## 13. Forward-compat hooks

| Hook | What v1 ships | What W2/W6/W8 will use |
|---|---|---|
| `segments.json` sidecar | Always written | W2 reads to wire CM6 click-to-seek decorations |
| `::web_clip{...}` directive | Renders as plain text | W2 CM6 decoration → rich card (thumb, title, play button) |
| Frontmatter keys (`source_*`, `media_dir`) | Written | W6 may add `summary:`, `chapters:[]` siblings |
| `imported_via: web_media` | Written | Stable identifier for source class — survives engine swap |
| `OnboardingStep::Extensions` | Added | W6 (LLM runtime), W8 (OCR engine) slot in here |
| `.handy-media/<source-type>/<node-id>/` layout | `web/` populated | `images/` (W8), `voice/` (future W1 migration) ready |
| `ImportJobKind::WebMedia` enum | Added | `Image` (W8) follows same pattern: variant + sibling module + state-machine reuse |

## 14. Settings additions

| Key | Default | Purpose |
|---|---|---|
| `import.web.default_parent_folder_id` | auto-create `Web Clips/` on first import | Where new URL imports land |
| `import.web.default_format` | `Mp3Audio` | Pre-selected in format picker |
| `import.web.default_keep_media` | `true` | Pre-selected in keep-audio toggle |
| `import.web.max_duration_seconds` | `14400` (4h) | Hard cap; over-limit warns user |
| `import.web.media_cleanup_after_days` | `0` (never) | Optional age-out of `.handy-media/web/<id>/` |
| `import.web.concurrent_downloads` | `2` | Parallel yt-dlp download processes |
| `import.web.concurrent_meta_fetches` | `4` | Parallel `--dump-json` calls |
| `import.web.politeness_sleep_min` / `_max` | `1` / `3` | yt-dlp `--sleep-interval` flags |
| `extensions.yt_dlp.auto_check_updates` | `true` | Weekly background update check |

All keys live under `user_preferences` (existing settings store).

## 15. Testing strategy

### Unit (Rust)

- Fixture-driven `--dump-json` parser tests: canned outputs from various platforms checked into `src-tauri/src/import/web_media_fixtures/`.
- State machine transitions: synthetic `WebMedia` job fed through mock yt-dlp handle.
- Error taxonomy: each `WebMediaError` variant produced from canned stderr fixtures.
- Integrity checks (magic-byte, file-size, ffmpeg-exit) — synthetic broken outputs.
- Sha256 verification — synthetic checksum match + mismatch.

### Integration (Rust, opt-in)

- `cargo test --features integration` runs against one known-stable URL (CC-licensed sample on a stable host).
- Default test runs do NOT hit network.

### Frontend (vitest)

- ImportView URL detection logic (1 vs N URLs, malformed, dedup).
- Queue row state rendering for each `ImportJobState`.
- Plugin-missing → banner replaces input.
- Playlist selector multi-select math (select-all / invert / partial).

### Manual / E2E

- Full end-to-end via `bun run tauri dev`: paste → preview → import → note appears in tree → audio plays from sidecar.
- Plugin install / uninstall / update across all three platforms.
- Cancel during download — verify no orphan files in `.handy-media/`.
- Mic-quiesce: start mic recording, then enqueue URL — verify URL transcription waits.

## 16. Definition of Done

Standard project DoD plus W7-specific:

- [ ] `bun run build` zero new errors
- [ ] `bunx vitest run` + `cargo test --lib` green; new tests added for WebMedia parser fixtures, state transitions, integrity checks, and integrity-check-failure paths (concrete count established during plan)
- [ ] Plugin install + uninstall + update flows work on Windows + macOS + Linux
- [ ] Single-URL import: paste → preview → import → note opens, audio plays, transcript present, frontmatter complete
- [ ] Bulk URL import (5+ URLs): all enqueue, all complete in order, queue handles cancel mid-batch
- [ ] Playlist selector: 50-entry playlist renders smoothly (virtualized), multi-select math correct
- [ ] Cancel mid-download leaves no orphan files
- [ ] Boot after crash mid-download: stale jobs surface as Error with retry option
- [ ] Mic quiescence verified: active mic session holds URL transcription, releases cleanly
- [ ] Onboarding extensions step renders, install/skip both lead to `Done` correctly, legacy `Vault`-state rows self-heal
- [ ] No hardcoded color/radius/shadow/spacing literals in new files (Rule 12 / 18)
- [ ] All new components flat in `src/components/`
- [ ] `.handy-media/` ignored by FTS / embedding / vault sync scans
- [ ] Performance: preview metadata fetch < 3s p50 over reasonable network; queue UI smooth at 50 active rows

## 17. Open questions / deferred

- **Cookie / authentication support for non-public content** — deliberately out of scope for v1. If user demand emerges, design a separate auth flow under explicit consent.
- **Playlist sub-grouping in vault** — currently each playlist video lands as a flat doc under `Web Clips/` with `playlist_source` in frontmatter. Could later group as `Web Clips/<playlist-title>/<video-title>.md`. Defer until a user actually has 50+ playlist imports and the flat layout becomes unwieldy.
- **Re-transcribe action** — if whisper model upgrades, user may want to re-run transcription on existing imports using cached audio. Pattern fits naturally (cached mp3 + sidecar + frontmatter all present); add as Settings → Advanced action in a follow-up.
- **Caption fallback** — many YouTube videos have human-authored captions (`.vtt`/`.srt`). yt-dlp can fetch them. We could prefer captions over whisper for these (cheaper, often more accurate). Defer until v1 ships and we have data on which platforms have good captions.
