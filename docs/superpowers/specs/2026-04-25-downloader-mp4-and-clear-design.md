# URL Downloader: MP4 mode + Clear-completed — Design

**Date:** 2026-04-25
**Scope:** Polish the W7 URL Downloader (`Import → URL` tab). Enable the existing MP4 toggle, add per-card resolution picker and an opt-in transcribe checkbox, append a date+time stamp to imported note titles, and add a Clear button to the Completed panel.
**Surfaces touched:** `src-tauri/src/import/web_media.rs`, `src-tauri/src/import/mod.rs`, `src-tauri/src/commands/url_import.rs`, `src-tauri/src/commands/import_queue.rs`, `src-tauri/src/lib.rs`, `src/components/ImportUrlTab.tsx`, `src/styles/import.css` (if needed).

---

## Background

The W7 URL Downloader (`ImportUrlTab.tsx`) ships with the **MP4** toggle disabled and tooltipped "Video downloads coming soon — MP3 audio only for now". The backend already declares `WebMediaFormat::Mp4Video { max_height: u32 }` and has a serialization test (`web_media.rs:201-205`), but the actual download path (`YtDlpHandle::download_audio`) is hardcoded for audio-only with `-x --audio-format mp3`. There is no video download path yet.

Terminal jobs (`Done`, `Error`, `Cancelled`) accumulate in the in-memory import queue until app restart. The existing `cancel_import_job` command refuses to remove them ("Job already finished"). Users have no way to tidy the Completed panel.

Imported notes are titled `web_meta.title` (or `"Imported Media"` if metadata is missing). Two imports of the same source on the same day collide on slug and require UUID disambiguation.

---

## Decisions (locked from brainstorm Q1–Q3)

1. **MP4 = "download for review" with optional transcription.** Default `transcribe = false` when MP4 is selected. A global "Transcribe audio too" checkbox lets the user opt back in. MP3 mode always transcribes.
2. **Default resolution = highest available** for each URL (per-card).
3. **Clear completed = simple wipe**, no confirmation, no undo. Removes terminal-state jobs from the in-memory queue.
4. **Note title = `<video title> — <YYYY-MM-DD HH:MM>`** (local time). The hidden sidecar dir at `.handy-media/web/<draft_node_id>/` stays UUID-based.

---

## Section 1 — Backend: MP4 download path + transcribe opt

### 1.1 Type changes (`src-tauri/src/import/web_media.rs`)

Extend `WebMediaImportOpts`:

```rust
pub struct WebMediaImportOpts {
    pub keep_media: bool,
    pub format: WebMediaFormat,
    pub transcribe: bool,                            // NEW
    pub parent_folder_node_id: Option<String>,
    pub playlist_source: Option<PlaylistSource>,
}

impl Default for WebMediaImportOpts {
    fn default() -> Self {
        Self {
            keep_media: true,
            format: WebMediaFormat::default(),       // Mp3Audio
            transcribe: true,                        // mp3 always transcribes
            parent_folder_node_id: None,
            playlist_source: None,
        }
    }
}
```

The frontend always sends `transcribe = true` for MP3 mode and the user's checkbox value (default `false`) for MP4.

### 1.2 New method `YtDlpHandle::download_video`

Mirrors the structure of `download_audio` (web_media.rs:389-461) — same progress/cancel scaffolding, same process-group handling, same artefact-finding helper.

```rust
pub async fn download_video(
    &self, url: &str, target_dir: &Path, max_height: u32,
    on_progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
    cancel: Arc<AtomicBool>,
) -> Result<MediaArtefacts, WebMediaError>
```

yt-dlp args:
```
-f "bv*[height<={N}]+ba/b[height<={N}]"
--merge-output-format mp4
--write-thumbnail --convert-thumbnails jpg
--no-playlist --newline
--sleep-interval 1 --max-sleep-interval 3
-o video.%(ext)s
-o "thumbnail:thumbnail.%(ext)s"
```

Returns `MediaArtefacts { audio_path: None, video_path: Some(<dir>/video.mp4), thumbnail_path: Some(...) }`.

### 1.3 Verify

Extend `verify_artefacts`:
- If `video_path` is set: file exists, size > 1 KiB, first 12 bytes contain an `ftyp` box (`b"ftyp"` at offset 4..8). Lighter than full demux; sufficient to reject zero-byte / truncated downloads.
- Audio path branch unchanged.

### 1.4 Worker — `handle_downloading` (`src-tauri/src/import/mod.rs`)

Branch on `web_opts.format`:

```rust
let result = match &web_opts.format {
    WebMediaFormat::Mp3Audio => handle.download_audio(&url, &media_dir, on_progress, cancel.clone()).await,
    WebMediaFormat::Mp4Video { max_height } => handle.download_video(&url, &media_dir, *max_height, on_progress, cancel.clone()).await,
};
```

`web_opts` is read from the existing `job.web_opts` field. No DTO changes needed.

### 1.5 Worker — `handle_preparing_web_media`

Branch on `transcribe`:

- **`transcribe == true`:** call `run_import_media` with `kind = ImportJobKind::Audio` (mp3 path) or `ImportJobKind::Video` (mp4 path). For mp4, `prepare_wav_for_transcription` already handles video extension via ffmpeg.
- **`transcribe == false`:** call new `finalize_web_media_no_transcript(...)`:
  - Compute `title = format!("{} — {}", web_meta.title, chrono::Local::now().format("%Y-%m-%d %H:%M"))`. Fallback `"Imported Media — <stamp>"` if no `web_meta`.
  - Ensure `Imported Files` folder via `ensure_file_import_folder`.
  - Create draft via `workspace.create_document_child(folder_id, &title, "🎙️", "")`.
  - Build body + properties via `build_web_media_document(job_id, web_meta, web_opts, draft_node_id, &[])` (empty paragraphs).
  - `update_node_body_persist_only` with the directive-only body.
  - `update_node_properties` with the JSON.
  - `write_segments_json(media_dir, &[])`.
  - Honour `keep_media=false` cleanup (delete `audio.mp3` *and* `video.mp4`; keep thumbnail + segments.json).
  - `finalize_node_search_index`, `sync_workspace_document_to_vault`, emit `workspace-import-synced`.
  - Transition to `Done`.

### 1.6 Title with date+time stamp (transcribe path too)

Currently `handle_preparing_web_media` computes:
```rust
let title = job.web_meta.as_ref().map(|m| m.title.clone()).unwrap_or_else(|| "Imported Media".to_string());
```
Change to append `" — YYYY-MM-DD HH:MM"` (local time). Same line in the no-transcript finalizer. Em-dash separator and ISO-style date keep titles sortable and avoid slug collisions for repeated imports.

### 1.7 `keep_media=false` cleanup

Existing branch in `run_import_media` deletes `audio.mp3`. Extend to also remove `video.mp4` if present. The thumbnail and `segments.json` stay so the `::web_clip` directive still has its preview image.

---

## Section 2 — Frontend UI (`src/components/ImportUrlTab.tsx`)

### 2.1 State additions

```ts
const [transcribeMp4, setTranscribeMp4] = useState(false);          // NEW
const [resolutionByUrl, setResolutionByUrl] = useState<Record<string, number>>({});  // NEW
```

### 2.2 `FormatToggle`

Remove `disabled = f === 'mp4'` and the "coming soon" tooltip. Both buttons now active.

### 2.3 Conditional row — visible only when `format === 'mp4'`

Below the keep-media checkbox, same alignment:

```tsx
{format === 'mp4' && (
  <label
    style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
             fontSize: 12, color: 'var(--heros-text-muted)', alignSelf: 'center' }}
    title="Off = video only (faster). On = also transcribe spoken audio."
  >
    <input
      type="checkbox"
      checked={transcribeMp4}
      onChange={e => setTranscribeMp4(e.target.checked)}
      style={{ accentColor: 'var(--heros-brand)' }}
    />
    <span>Transcribe audio too</span>
  </label>
)}
```

### 2.4 `UrlPreviewCard` — interactive resolution picker

Currently the height chips are read-only and show 6 values. When `format === 'mp4'` and `state.kind === 'ready'`:

- Each chip becomes a `<button>`, clickable, with active state using `--heros-brand` background (mirrors `FormatToggle` styling).
- Default selection on first render = `Math.max(...state.meta.available_video_heights)`. Set in a `useEffect` that watches `format` and the URL key.
- Persist the user's choice in `resolutionByUrl[url]`.
- If `available_video_heights` is empty, hide the picker and disable the Download button (rare — yt-dlp usually returns at least one height).

`UrlPreviewCard` accepts two new props: `format: Format`, `selectedHeight: number | null`, `onSelectHeight: (h: number) => void`.

### 2.5 `makeOpts(url)` — per-URL options

```ts
function makeOpts(url: string): WebMediaImportOpts {
  if (format === 'mp4') {
    const heights = (previews[url] as any)?.meta?.available_video_heights as number[] | undefined;
    const h = resolutionByUrl[url] ?? (heights?.length ? Math.max(...heights) : 720);
    return {
      keep_media: keepMedia,
      format: { kind: 'mp4_video', max_height: h },
      transcribe: transcribeMp4,
      parent_folder_node_id: null,
      playlist_source: null,
    };
  }
  return {
    keep_media: keepMedia,
    format: { kind: 'mp3_audio' },
    transcribe: true,
    parent_folder_node_id: null,
    playlist_source: null,
  };
}
```

`downloadOne(url)` and `downloadAll()` call `makeOpts(url)` per URL. `commitPlaylist` does the same per entry, with the playlist URL as the key.

---

## Section 3 — Clear completed (simple)

### 3.1 Backend

In `ImportQueueService` (`src-tauri/src/import/mod.rs`):

```rust
pub async fn clear_completed_imports(&self) -> Result<(), String> {
    let mut jobs = self.inner.jobs.lock().await;
    jobs.retain(|j| !matches!(
        j.state,
        ImportJobState::Done | ImportJobState::Error | ImportJobState::Cancelled,
    ));
    drop(jobs);
    emit_snapshot(&self.inner).await;
    Ok(())
}
```

Tauri command in `src-tauri/src/commands/import_queue.rs`:

```rust
#[tauri::command] #[specta::specta]
pub async fn clear_completed_imports(service: State<'_, ImportQueueService>) -> Result<(), String> {
    service.clear_completed_imports().await
}
```

Register in `src-tauri/src/lib.rs::invoke_handler`.

### 3.2 Frontend

In `CompletedPanel`, add a small ghost-style "Clear" button to the right of the panel-header label, before the chevron. `stopPropagation` so click doesn't toggle the panel's manual-expand.

```tsx
<button
  onClick={(e) => { e.stopPropagation(); commands.clearCompletedImports(); }}
  className="heros-btn"
  style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, opacity: 0.7 }}
  title="Clear completed history"
>
  Clear
</button>
```

Existing `AnimatePresence` on the row list animates them out as the snapshot event fires.

---

## Architecture invariants

- **Rule 12 (tokens only):** new inline styles use existing `--heros-*` / `--space-*` / `--radius-*` tokens. The fixed pixel values for chip padding/font follow the verbatim-port carve-out (matches `FormatToggle`).
- **Rule 18 (CSS hygiene):** no new global classes needed — all extensions use inline styles for state-driven values, identical to existing patterns in `ImportUrlTab.tsx`.
- **Rule 20 / 21 (UI scaling):** unaffected — no new layout primitives.
- **`src/bindings.ts` is auto-generated** by specta on `bun run tauri dev`. Do not hand-edit; the new `transcribe: bool` field and the two new commands appear automatically.

## Out of scope

- Per-card transcribe override (global toggle is enough for v1).
- Resolution defaulting beyond "highest available" (e.g. 720p preference, bitrate-aware picks).
- Undo for clear (decision: not over-engineering this; it's a UI log).
- Persisting the queue across app restarts (queue stays in-memory; matches existing W7 behaviour).
- Per-row dismiss buttons in the Completed panel.

## Testing notes

- `cargo test` — extend the existing `web_media_format_serializes_with_snake_case_kind` and `enqueue_urls_opts_default_keep_media_true` tests to cover `transcribe` field.
- New unit test: `download_video` builds the right yt-dlp arg vector for a representative `max_height` (no process spawn — wrap arg construction in a helper).
- New unit test: `verify_artefacts` accepts a buffer with an `ftyp` box, rejects truncated.
- Manual: paste a YouTube URL → fetch → flip to MP4 → verify height chips become buttons → pick 480p → download → confirm `.handy-media/web/<id>/video.mp4` exists, note title is `"<title> — YYYY-MM-DD HH:MM"`, body has only the `::web_clip` directive (transcribe off).
- Manual: same flow with "Transcribe audio too" checked → confirm transcript body lands.
- Manual: clear completed with a mix of Done/Error/Cancelled — confirm all three states wipe and active jobs survive.
