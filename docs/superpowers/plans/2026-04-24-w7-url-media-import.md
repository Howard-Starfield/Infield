# W7 — URL Media Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the dormant `ImportView` to a URL-paste pipeline that downloads media via a yt-dlp plugin, transcribes via the existing whisper pipeline, and lands a workspace document under `Web Clips/` with full source metadata, cached thumbnail, cached audio, and a `segments.json` sidecar for forward-compat with W2 click-to-seek.

**Architecture:** Extend the existing `import/mod.rs` state machine with a `WebMedia` variant + two head states (`FetchingMeta`, `Downloading`); from `Preparing` onward, the pipeline runs unchanged. yt-dlp is shipped as an optional user-installable plugin (not bundled), with three install entry points (Import banner, Settings → Extensions, optional Onboarding step). All URL-specific concerns live in a new `src-tauri/src/import/web_media.rs` module.

**Tech Stack:** Rust + Tauri (backend), TypeScript + React (frontend), yt-dlp standalone binary as Tauri sidecar, ffmpeg (already shipped for whisper), `@tanstack/react-virtual` (playlist selector), sqlite-vec / FTS5 (existing).

**Spec:** [`docs/superpowers/specs/2026-04-24-w7-url-media-import-design.md`](../specs/2026-04-24-w7-url-media-import-design.md). Read it before starting Task 1.

**Read also:** `CLAUDE.md` (Invariants, Rules 9, 12, 13, 14, 16, 16a, 17, 18, 22), `PLAN.md` (W7 entry), `src-tauri/src/import/mod.rs` (the 939-line existing pipeline you're extending — read end-to-end).

---

## File Structure

### New backend files

| File | Responsibility |
|---|---|
| `src-tauri/src/import/web_media.rs` | yt-dlp wrapper, metadata + download, error mapping, integrity verification. Sibling of existing `segmenting.rs` / `post_processing.rs`. |
| `src-tauri/src/plugin/mod.rs` | New module — plugin host (currently only yt-dlp). |
| `src-tauri/src/plugin/yt_dlp.rs` | yt-dlp install/uninstall/update + status. |
| `src-tauri/src/commands/url_import.rs` | Tauri commands: `fetch_url_metadata`, `fetch_playlist_entries`, `enqueue_import_urls`, queue pause/resume. |
| `src-tauri/src/commands/yt_dlp_plugin.rs` | Tauri commands: plugin status, install, update-check, uninstall. |
| `src-tauri/src/import/web_media_fixtures/` | Canned `--dump-json` outputs for fixture-driven tests. |

### Modified backend files

| File | What changes |
|---|---|
| `src-tauri/src/import/mod.rs` | Add `ImportJobKind::WebMedia` variant; add `FetchingMeta` + `Downloading` states; extend `ImportJobDto` with web fields; add `enqueue_urls` to `ImportQueueService`; extend worker loop to handle new states. |
| `src-tauri/src/lib.rs` | Register new commands; extend `OnboardingStep::Extensions` between `Vault` and `Done`; init plugin module. |
| `src-tauri/src/commands/onboarding.rs` | Update enum (matching frontend type via specta). |
| `src-tauri/src/settings.rs` | New keys per spec §14. |
| `src-tauri/Cargo.toml` | Add `sha2`, `reqwest` (if not present), `serde_yaml` (likely present), `thiserror`, `futures-util`. |
| `src-tauri/tauri.conf.json` | No yt-dlp bundle resource entry — plugin is installed at runtime. |

### New frontend files

| File | Responsibility |
|---|---|
| `src/components/PlaylistSelectorModal.tsx` | Virtualized multi-select for playlist entries. |
| `src/components/SettingsExtensionsView.tsx` | Plugin management UI (install/update/uninstall). |
| `src/components/OnboardingStepExtensions.tsx` | New optional onboarding step. |
| `src/hooks/useImportQueue.ts` | Subscribes to `import-queue-updated`; exposes snapshot + controls. |
| `src/hooks/useYtDlpPlugin.ts` | Plugin install/uninstall/version state. |
| `src/styles/import.css` | Token-only styles for URL input, preview card, queue rows (Rules 12 + 18). |

### Modified frontend files

| File | What changes |
|---|---|
| `src/components/ImportView.tsx` | Full rewrite — replace mocked data with real queue, add URL input with auto-detect, preview card, plugin-missing banner. |
| `src/components/SettingsView.tsx` | Add "Extensions" sidebar entry pointing to `SettingsExtensionsView`. |
| `src/components/OnboardingOverlay.tsx` | Slot in `OnboardingStepExtensions`. |
| `src/bindings.ts` | Auto-regenerated — do not edit by hand. |

---

## Task 0: Baseline verification & spec read

**Files:** none — read-only

- [ ] **Step 1: Read the spec end-to-end.** You must understand: §3 architecture, §5 state machine, §7 data model, §8 vault format, §11 error taxonomy, §12 edge cases.

- [ ] **Step 2: Read `import/mod.rs` end-to-end.** Locate `ImportJobKind`, `ImportJobState`, `ImportJobDto`, `ImportQueueService`, the worker loop, and the `Audio` pipeline path you'll be feeding into.

- [ ] **Step 3: Verify baseline tests pass:**
  - `cd src-tauri && cargo test --lib`
  - `bunx vitest run`
  - `bun run build`

  All must be green. If anything is red, **stop and fix or report — do not start the plan on a broken baseline.**

- [ ] **Step 4: Snapshot the current import enum sizes.** Note the current `ImportJobKind` variants (Markdown, PlainText, Pdf, Audio, Video, Unknown) and `ImportJobState` variants. You'll be adding to these — no replacing.

- [ ] **Step 5: No commit (read-only task).**

---

## Task 1: Add `WebMedia` enum variants (no functionality)

**Files:**
- Modify: `src-tauri/src/import/mod.rs` (enum definitions near top, ~line 41)

- [ ] **Step 1: Write the failing test**

Add to the bottom of `src-tauri/src/import/mod.rs` (or in a `#[cfg(test)] mod tests` block if one exists):

```rust
#[cfg(test)]
mod web_media_enum_tests {
    use super::*;

    #[test]
    fn web_media_kind_serializes_snake_case() {
        let kind = ImportJobKind::WebMedia;
        let json = serde_json::to_string(&kind).unwrap();
        assert_eq!(json, "\"web_media\"");
    }

    #[test]
    fn fetching_meta_state_serializes_snake_case() {
        let state = ImportJobState::FetchingMeta;
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(json, "\"fetching_meta\"");
    }

    #[test]
    fn downloading_state_serializes_snake_case() {
        let state = ImportJobState::Downloading;
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(json, "\"downloading\"");
    }
}
```

- [ ] **Step 2: Run, expect compile error**

```
cd src-tauri && cargo test --lib web_media_enum_tests
```

Expected: compile error — `WebMedia` / `FetchingMeta` / `Downloading` not found.

- [ ] **Step 3: Add the variants**

In `ImportJobKind`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ImportJobKind {
    Markdown,
    PlainText,
    Pdf,
    Audio,
    Video,
    WebMedia,   // NEW — W7
    Unknown,
}
```

In `ImportJobState`, insert immediately after `Queued`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ImportJobState {
    Queued,
    FetchingMeta,    // NEW — W7
    Downloading,     // NEW — W7
    Preparing,
    Segmenting,
    DraftCreated,
    Transcribing,
    PostProcessing,
    Finalizing,
    ExtractingText,
    CreatingNote,
    Done,
    Error,
    Cancelled,
}
```

- [ ] **Step 4: Run tests + build**

```
cd src-tauri && cargo test --lib
```

Expected: all tests pass. If exhaustive `match` arms broke elsewhere, fix by adding `WebMedia | _ => …` or explicit `WebMedia` arms — minimal stubs only, real handling lands in later tasks.

- [ ] **Step 5: Commit**

```
git add src-tauri/src/import/mod.rs
git commit -m "feat(w7): add WebMedia kind + FetchingMeta/Downloading states

Enum-only change. Pipeline does not yet handle WebMedia; subsequent
tasks add web_media.rs, the worker transitions, and command surface."
```

---

## Task 2: Extend `ImportJobDto` with web-specific optional fields

**Files:**
- Modify: `src-tauri/src/import/mod.rs` (around `ImportJobDto`, ~line 69)

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn import_job_dto_web_fields_default_none_for_non_web_jobs() {
    let dto = ImportJobDto {
        id: "test".into(),
        file_name: "x.pdf".into(),
        source_path: "/tmp/x.pdf".into(),
        kind: ImportJobKind::Pdf,
        state: ImportJobState::Queued,
        message: None,
        note_id: None,
        progress: 0.0,
        segment_index: 0,
        segment_count: 0,
        web_meta: None,
        download_bytes: None,
        download_total_bytes: None,
        download_speed_human: None,
    };
    assert!(dto.web_meta.is_none());
    assert!(dto.download_bytes.is_none());
}
```

(Match the actual struct shape — read it from `mod.rs` first.)

- [ ] **Step 2: Run, expect compile error**

- [ ] **Step 3: Add the fields**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ImportJobDto {
    // ... existing fields ...
    #[serde(skip_serializing_if = "Option::is_none")]
    pub web_meta: Option<WebMediaMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_speed_human: Option<String>,
}
```

`WebMediaMetadata` doesn't exist yet — add a stub above the DTO that subsequent tasks will replace:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WebMediaMetadata {
    pub url: String,
    pub source_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    pub platform: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    pub available_video_heights: Vec<u32>,
    pub is_live: bool,
}
```

Search every existing constructor of `ImportJobDto` and add the four new `None` fields to keep them compiling.

- [ ] **Step 4: Run tests + build**

```
cd src-tauri && cargo test --lib
bun run build
```

`bun run build` regenerates `src/bindings.ts` — verify the new fields appear there.

- [ ] **Step 5: Commit**

```
git add src-tauri/src/import/mod.rs src/bindings.ts
git commit -m "feat(w7): extend ImportJobDto with optional web-media fields

WebMediaMetadata struct added inline (will be moved to web_media.rs in
a later task). All optional, all None for non-WebMedia jobs."
```

---

## Task 3: Plugin module scaffold + platform-aware paths

**Files:**
- Create: `src-tauri/src/plugin/mod.rs`
- Create: `src-tauri/src/plugin/yt_dlp.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod plugin;`)

- [ ] **Step 1: Create module skeleton**

`src-tauri/src/plugin/mod.rs`:

```rust
//! User-installable optional plugins. v1: yt-dlp for URL media imports.
pub mod yt_dlp;
```

`src-tauri/src/lib.rs` — add near other top-level `mod` declarations:

```rust
mod plugin;
```

- [ ] **Step 2: Write the platform path resolver**

`src-tauri/src/plugin/yt_dlp.rs`:

```rust
//! yt-dlp plugin install/uninstall/update.
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") { "yt-dlp.exe" }
    else if cfg!(target_os = "macos") { "yt-dlp_macos" }
    else { "yt-dlp_linux" }
}

pub fn extension_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("extensions").join("yt-dlp"))
}

pub fn binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(extension_dir(app)?.join(binary_name()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_name_per_platform() {
        let name = binary_name();
        if cfg!(target_os = "windows") { assert_eq!(name, "yt-dlp.exe"); }
        else if cfg!(target_os = "macos") { assert_eq!(name, "yt-dlp_macos"); }
        else { assert_eq!(name, "yt-dlp_linux"); }
    }
}
```

- [ ] **Step 3: Run tests**

```
cd src-tauri && cargo test --lib plugin::yt_dlp
```

Expected: pass.

- [ ] **Step 4: Commit**

```
git add src-tauri/src/plugin/ src-tauri/src/lib.rs
git commit -m "feat(w7): plugin module scaffold + yt-dlp path resolution"
```

---

## Task 4: Plugin status reading

**Files:**
- Modify: `src-tauri/src/plugin/yt_dlp.rs`
- Modify: `src-tauri/Cargo.toml` (add `tempfile` as dev-dep if missing)

- [ ] **Step 1: Add `cargo add --dev tempfile`** if not present.

- [ ] **Step 2: Write failing tests + status reader**

```rust
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PluginStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub installed_at: Option<String>,
    pub last_checked_at: Option<String>,
    pub latest_available: Option<String>,
    pub size_bytes: Option<u64>,
}

pub fn read_status_at(dir: &Path) -> PluginStatus {
    let bin = dir.join(binary_name());
    let installed = bin.exists();
    if !installed {
        return PluginStatus {
            installed: false, version: None, installed_at: None,
            last_checked_at: None, latest_available: None, size_bytes: None,
        };
    }
    let read_trim = |name: &str| fs::read_to_string(dir.join(name)).ok().map(|s| s.trim().to_string());
    PluginStatus {
        installed,
        version: read_trim("version.txt"),
        installed_at: read_trim("installed_at.txt"),
        last_checked_at: read_trim("last_checked_at.txt"),
        latest_available: read_trim("latest_available.txt"),
        size_bytes: fs::metadata(&bin).ok().map(|m| m.len()),
    }
}

pub fn read_status(app: &AppHandle) -> Result<PluginStatus, String> {
    Ok(read_status_at(&extension_dir(app)?))
}

#[cfg(test)]
mod status_tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn returns_not_installed_for_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let s = read_status_at(tmp.path());
        assert!(!s.installed);
        assert!(s.version.is_none());
    }

    #[test]
    fn returns_installed_when_binary_present() {
        let tmp = TempDir::new().unwrap();
        let bin = tmp.path().join(binary_name());
        fs::write(&bin, b"fake binary").unwrap();
        fs::write(tmp.path().join("version.txt"), "2026.04.15\n").unwrap();
        fs::write(tmp.path().join("installed_at.txt"), "2026-04-24T10:00:00Z").unwrap();
        let s = read_status_at(tmp.path());
        assert!(s.installed);
        assert_eq!(s.version.as_deref(), Some("2026.04.15"));
        assert_eq!(s.installed_at.as_deref(), Some("2026-04-24T10:00:00Z"));
        assert_eq!(s.size_bytes, Some(11));
    }
}
```

- [ ] **Step 3: Run + Commit**

```
cd src-tauri && cargo test --lib plugin::yt_dlp
git add src-tauri/src/plugin/yt_dlp.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(w7): yt-dlp plugin status reader"
```

---

## Task 5: GitHub release metadata fetch

**Files:**
- Modify: `src-tauri/src/plugin/yt_dlp.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add deps if missing**

```
cd src-tauri
cargo add reqwest --features json,stream
cargo add sha2 futures-util
```

(`reqwest` may already be a transitive dep — check `Cargo.toml` first.)

- [ ] **Step 2: Add release metadata struct + fetcher**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReleaseMetadata {
    pub tag_name: String,
    pub asset_url: String,
    pub checksums_url: String,
}

const GITHUB_RELEASES_API: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

pub async fn fetch_latest_release_metadata() -> Result<ReleaseMetadata, String> {
    let client = reqwest::Client::builder()
        .user_agent("Handy/1.0 (yt-dlp plugin updater)")
        .build()
        .map_err(|e| e.to_string())?;
    let resp: serde_json::Value = client
        .get(GITHUB_RELEASES_API)
        .send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?
        .json().await.map_err(|e| e.to_string())?;
    let tag_name = resp["tag_name"].as_str().ok_or("missing tag_name")?.to_string();
    let assets = resp["assets"].as_array().ok_or("missing assets")?;
    let target_name = binary_name();
    let asset_url = assets.iter()
        .find(|a| a["name"].as_str() == Some(target_name))
        .and_then(|a| a["browser_download_url"].as_str())
        .ok_or_else(|| format!("no asset named {}", target_name))?
        .to_string();
    let checksums_url = assets.iter()
        .find(|a| a["name"].as_str() == Some("SHA2-256SUMS"))
        .and_then(|a| a["browser_download_url"].as_str())
        .ok_or("no SHA2-256SUMS asset")?
        .to_string();
    Ok(ReleaseMetadata { tag_name, asset_url, checksums_url })
}
```

- [ ] **Step 3: Add an opt-in integration test (network-gated)**

```rust
#[cfg(test)]
mod release_tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn fetches_real_release_metadata() {
        let r = fetch_latest_release_metadata().await.unwrap();
        assert!(!r.tag_name.is_empty());
        assert!(r.asset_url.starts_with("https://github.com/"));
        assert!(r.checksums_url.contains("SHA2-256SUMS"));
    }
}
```

Manual run: `cargo test --lib fetches_real_release_metadata -- --ignored --nocapture`.

- [ ] **Step 4: Commit**

```
git add src-tauri/src/plugin/yt_dlp.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(w7): GitHub releases API fetcher for yt-dlp metadata"
```

---

## Task 6: SHA256 download + verification

**Files:**
- Modify: `src-tauri/src/plugin/yt_dlp.rs`

- [ ] **Step 1: Add functions**

```rust
use sha2::{Digest, Sha256};
use std::io::Write;

pub fn compute_sha256(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn parse_checksums_for(checksums_text: &str, asset_name: &str) -> Option<String> {
    for line in checksums_text.lines() {
        let mut parts = line.splitn(2, "  ");
        let hex = parts.next()?.trim();
        let name = parts.next()?.trim();
        if name == asset_name { return Some(hex.to_string()); }
    }
    None
}

pub async fn fetch_text(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder().user_agent("Handy/1.0").build().map_err(|e| e.to_string())?;
    client.get(url).send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())
}

pub async fn download_with_progress(
    url: &str, target: &Path,
    on_progress: impl Fn(u64, Option<u64>),
) -> Result<(), String> {
    use futures_util::StreamExt;
    let client = reqwest::Client::builder().user_agent("Handy/1.0").build().map_err(|e| e.to_string())?;
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?
        .error_for_status().map_err(|e| e.to_string())?;
    let total = resp.content_length();
    let mut file = fs::File::create(target).map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut so_far: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).map_err(|e| e.to_string())?;
        so_far += chunk.len() as u64;
        on_progress(so_far, total);
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: Tests**

```rust
#[cfg(test)]
mod checksum_tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn computes_known_sha256() {
        let tmp = TempDir::new().unwrap();
        let f = tmp.path().join("x.bin");
        fs::write(&f, b"hello").unwrap();
        let h = compute_sha256(&f).unwrap();
        assert_eq!(h, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    }

    #[test]
    fn parses_sha256sums_format() {
        let text = "abc123  yt-dlp_linux\ndef456  yt-dlp_macos\n789xyz  yt-dlp.exe\n";
        assert_eq!(parse_checksums_for(text, "yt-dlp_macos").as_deref(), Some("def456"));
        assert!(parse_checksums_for(text, "nonexistent").is_none());
    }
}
```

- [ ] **Step 3: Run + Commit**

```
cd src-tauri && cargo test --lib plugin::yt_dlp
git add src-tauri/src/plugin/yt_dlp.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(w7): SHA256 verification + streamed download for plugin"
```

---

## Task 7: Plugin install orchestration

**Files:**
- Modify: `src-tauri/src/plugin/yt_dlp.rs`

- [ ] **Step 1: Write the install function**

```rust
use chrono::Utc;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum InstallProgress {
    FetchingMetadata,
    Downloading { bytes: u64, total: Option<u64> },
    Verifying,
    Finalizing,
    Done,
}

pub async fn install(app: &AppHandle) -> Result<(), String> {
    let dir = extension_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let _ = app.emit("plugin-install-progress", InstallProgress::FetchingMetadata);
    let release = fetch_latest_release_metadata().await?;

    let target = dir.join(binary_name());
    let tmp = dir.join(format!("{}.downloading", binary_name()));

    let app_clone = app.clone();
    download_with_progress(&release.asset_url, &tmp, move |bytes, total| {
        let _ = app_clone.emit("plugin-install-progress",
            InstallProgress::Downloading { bytes, total });
    }).await?;

    let _ = app.emit("plugin-install-progress", InstallProgress::Verifying);
    let checksums_text = fetch_text(&release.checksums_url).await?;
    let expected = parse_checksums_for(&checksums_text, binary_name())
        .ok_or("checksum line for our asset not found")?;
    let actual = compute_sha256(&tmp)?;
    if !actual.eq_ignore_ascii_case(&expected) {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Download integrity check failed (expected {}, got {})", expected, actual));
    }

    let _ = app.emit("plugin-install-progress", InstallProgress::Finalizing);
    if target.exists() { fs::remove_file(&target).map_err(|e| e.to_string())?; }
    fs::rename(&tmp, &target).map_err(|e| e.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&target).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&target, perms).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("codesign")
            .args(["--force", "--sign", "-"]).arg(&target).output();
        if let Ok(o) = out {
            if !o.status.success() {
                log::warn!("codesign failed: {}", String::from_utf8_lossy(&o.stderr));
            }
        }
    }

    fs::write(dir.join("version.txt"), &release.tag_name).map_err(|e| e.to_string())?;
    fs::write(dir.join("installed_at.txt"), Utc::now().to_rfc3339()).map_err(|e| e.to_string())?;
    fs::write(dir.join("checksum.sha256"), &actual).map_err(|e| e.to_string())?;

    let _ = app.emit("plugin-install-progress", InstallProgress::Done);
    let _ = app.emit("plugin-state-changed", ());
    Ok(())
}
```

- [ ] **Step 2: Add a synthetic test for the comparison logic** (full install requires network — exercised in Task 34 manual E2E):

```rust
#[cfg(test)]
mod install_helper_tests {
    #[test]
    fn case_insensitive_hex_match() {
        assert!("deadbeef".eq_ignore_ascii_case("DEADBEEF"));
        assert!(!"deadbeef".eq_ignore_ascii_case("deadbeed"));
    }
}
```

- [ ] **Step 3: Run + Commit**

```
cd src-tauri && cargo test --lib plugin::yt_dlp
git add src-tauri/src/plugin/yt_dlp.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(w7): yt-dlp plugin install orchestration

Fetch release → stream download with progress events → SHA256 verify
against published checksum → atomic rename → write metadata files.
macOS ad-hoc codesign. Unix exec bit set."
```

---

## Task 8: Plugin uninstall + update check

**Files:**
- Modify: `src-tauri/src/plugin/yt_dlp.rs`

- [ ] **Step 1: Add functions**

```rust
pub fn uninstall(app: &AppHandle) -> Result<(), String> {
    let dir = extension_dir(app)?;
    if dir.exists() { fs::remove_dir_all(&dir).map_err(|e| e.to_string())?; }
    let _ = app.emit("plugin-state-changed", ());
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UpdateCheckResult {
    pub current: Option<String>,
    pub latest: String,
    pub update_available: bool,
}

pub async fn check_update(app: &AppHandle) -> Result<UpdateCheckResult, String> {
    let release = fetch_latest_release_metadata().await?;
    let status = read_status(app)?;
    let current = status.version.clone();
    let update_available = current.as_deref() != Some(&release.tag_name);

    let dir = extension_dir(app)?;
    if dir.exists() {
        let _ = fs::write(dir.join("last_checked_at.txt"), Utc::now().to_rfc3339());
        let _ = fs::write(dir.join("latest_available.txt"), &release.tag_name);
    }
    Ok(UpdateCheckResult { current, latest: release.tag_name, update_available })
}

pub fn should_auto_check_now(status: &PluginStatus) -> bool {
    let Some(last) = status.last_checked_at.as_deref() else { return true; };
    let Ok(last_dt) = chrono::DateTime::parse_from_rfc3339(last) else { return true; };
    let elapsed = Utc::now().signed_duration_since(last_dt.with_timezone(&Utc));
    elapsed.num_days() >= 7
}
```

- [ ] **Step 2: Tests for auto-check logic**

```rust
#[cfg(test)]
mod auto_check_tests {
    use super::*;

    fn status_with_last_check(at: Option<String>) -> PluginStatus {
        PluginStatus { installed: true, version: Some("v1".into()), installed_at: None,
            last_checked_at: at, latest_available: None, size_bytes: None }
    }

    #[test]
    fn auto_check_when_never_checked() {
        assert!(should_auto_check_now(&status_with_last_check(None)));
    }

    #[test]
    fn auto_check_after_seven_days() {
        let eight_days_ago = (Utc::now() - chrono::Duration::days(8)).to_rfc3339();
        assert!(should_auto_check_now(&status_with_last_check(Some(eight_days_ago))));
    }

    #[test]
    fn no_auto_check_within_seven_days() {
        let two_days_ago = (Utc::now() - chrono::Duration::days(2)).to_rfc3339();
        assert!(!should_auto_check_now(&status_with_last_check(Some(two_days_ago))));
    }
}
```

- [ ] **Step 3: Run + Commit**

```
cd src-tauri && cargo test --lib plugin::yt_dlp
git add src-tauri/src/plugin/yt_dlp.rs
git commit -m "feat(w7): plugin uninstall + weekly update check logic"
```

---

## Task 9: Tauri commands for plugin

**Files:**
- Create: `src-tauri/src/commands/yt_dlp_plugin.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create command file**

```rust
//! Tauri commands for yt-dlp plugin lifecycle.
use crate::plugin::yt_dlp;
use tauri::AppHandle;

#[tauri::command]
#[specta::specta]
pub async fn yt_dlp_plugin_status(app: AppHandle) -> Result<yt_dlp::PluginStatus, String> {
    yt_dlp::read_status(&app)
}

#[tauri::command]
#[specta::specta]
pub async fn install_yt_dlp_plugin(app: AppHandle) -> Result<(), String> {
    yt_dlp::install(&app).await
}

#[tauri::command]
#[specta::specta]
pub async fn check_yt_dlp_update(app: AppHandle) -> Result<yt_dlp::UpdateCheckResult, String> {
    yt_dlp::check_update(&app).await
}

#[tauri::command]
#[specta::specta]
pub async fn uninstall_yt_dlp_plugin(app: AppHandle) -> Result<(), String> {
    // Active-job cancellation is added in Task 18 once the worker exists.
    yt_dlp::uninstall(&app)
}
```

- [ ] **Step 2: Register in `commands/mod.rs`**

Add: `pub mod yt_dlp_plugin;`

- [ ] **Step 3: Register handlers in `lib.rs`**

Find `tauri::generate_handler![...]` and add the four new commands. Also add them to the specta export (likely `tauri_specta::collect_commands!`).

- [ ] **Step 4: Build to regenerate bindings**

```
bun run build
grep -E "ytDlpPluginStatus|installYtDlpPlugin|checkYtDlpUpdate|uninstallYtDlpPlugin" src/bindings.ts
```

- [ ] **Step 5: Commit**

```
git add src-tauri/src/commands/ src-tauri/src/lib.rs src/bindings.ts
git commit -m "feat(w7): Tauri commands for yt-dlp plugin lifecycle"
```

---

## Task 10: web_media.rs scaffold + WebMediaError

**Files:**
- Create: `src-tauri/src/import/web_media.rs`
- Modify: `src-tauri/src/import/mod.rs` (add `mod web_media;` and re-exports)
- Modify: `src-tauri/Cargo.toml` (add `thiserror`)

- [ ] **Step 1: `cargo add thiserror`** if missing.

- [ ] **Step 2: Move `WebMediaMetadata` into `web_media.rs` and add the error enum**

Cut `WebMediaMetadata` from `mod.rs`, paste into the new file:

```rust
//! yt-dlp wrapper. URL-specific concerns isolated here.
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WebMediaMetadata {
    pub url: String,
    pub source_id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    pub platform: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    pub available_video_heights: Vec<u32>,
    pub is_live: bool,
}

#[derive(Debug, Clone, Error, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WebMediaError {
    #[error("Unsupported source: {0}")]
    Unsupported(String),
    #[error("Content not available in this region")]
    RegionUnavailable { country: Option<String> },
    #[error("Authentication required (private / members-only / restricted)")]
    AuthRequired,
    #[error("Content deleted or not found")]
    DeletedOrNotFound,
    #[error("Live streams aren't supported")]
    LiveStream,
    #[error("Duration {duration_seconds}s exceeds limit {limit_seconds}s")]
    DurationExceedsLimit { duration_seconds: f64, limit_seconds: f64 },
    #[error("Network error: {0}")]
    NetworkError(String),
    #[error("yt-dlp plugin not installed")]
    YtDlpNotFound,
    #[error("yt-dlp crashed (exit {exit_code})")]
    YtDlpCrashed { exit_code: i32, stderr_tail: String },
    #[error("ffmpeg failed: {0}")]
    FfmpegFailed(String),
    #[error("Disk full")]
    DiskFull,
    #[error("Downloaded file failed integrity check")]
    IntegrityCheckFailed,
}

pub struct YtDlpHandle {
    pub binary: PathBuf,
}

impl YtDlpHandle {
    pub fn new(binary: PathBuf) -> Self { Self { binary } }
    pub fn is_available(&self) -> bool { self.binary.exists() }
}
```

In `mod.rs` near top: `mod web_media;` and `pub use web_media::{WebMediaMetadata, WebMediaError, YtDlpHandle};`.

- [ ] **Step 3: Tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handle_reports_availability_from_path() {
        let h = YtDlpHandle::new(PathBuf::from("/nonexistent/yt-dlp"));
        assert!(!h.is_available());
    }

    #[test]
    fn error_serializes_with_kind_tag() {
        let e = WebMediaError::AuthRequired;
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"kind\":\"auth_required\""));
    }
}
```

- [ ] **Step 4: Run + Commit**

```
cd src-tauri && cargo test --lib import::web_media
git add src-tauri/src/import/ src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(w7): web_media.rs scaffold with WebMediaError taxonomy"
```

---

## Task 11: web_media.rs — fetch_metadata

**Files:**
- Modify: `src-tauri/src/import/web_media.rs`
- Create: `src-tauri/src/import/web_media_fixtures/youtube_video.json`

- [ ] **Step 1: Capture or hand-craft fixture JSON**

If you have yt-dlp locally for fixture generation only:
```
yt-dlp --dump-json --no-playlist "<known-public CC-licensed video URL>" > src-tauri/src/import/web_media_fixtures/youtube_video.json
```

Otherwise hand-craft a minimal fixture with the fields the parser cares about (id, title, duration, channel, thumbnail, extractor, formats, is_live, upload_date).

- [ ] **Step 2: Add the parser + classifier**

```rust
pub fn parse_metadata(json: &str, url: &str) -> Result<WebMediaMetadata, WebMediaError> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| WebMediaError::YtDlpCrashed { exit_code: 0, stderr_tail: format!("JSON parse: {}", e) })?;

    let source_id = v["id"].as_str().ok_or_else(||
        WebMediaError::Unsupported("yt-dlp returned no id".into()))?.to_string();
    let title = v["title"].as_str().unwrap_or("Untitled").to_string();
    let thumbnail_url = v["thumbnail"].as_str().map(|s| s.to_string());
    let duration_seconds = v["duration"].as_f64();
    let channel = v["channel"].as_str().or_else(|| v["uploader"].as_str()).map(|s| s.to_string());
    let platform = v["extractor_key"].as_str().or_else(|| v["extractor"].as_str())
        .unwrap_or("unknown").to_string().to_lowercase();
    let published_at = v["upload_date"].as_str().and_then(|d| {
        if d.len() == 8 { Some(format!("{}-{}-{}", &d[0..4], &d[4..6], &d[6..8])) } else { None }
    });
    let is_live = v["is_live"].as_bool().unwrap_or(false);
    let mut heights: Vec<u32> = v["formats"].as_array().map(|fs| {
        fs.iter().filter_map(|f| f["height"].as_u64().map(|h| h as u32)).filter(|h| *h > 0).collect()
    }).unwrap_or_default();
    heights.sort_unstable();
    heights.dedup();

    Ok(WebMediaMetadata {
        url: url.to_string(), source_id, title, thumbnail_url, duration_seconds, channel,
        platform, published_at, available_video_heights: heights, is_live,
    })
}

pub fn classify_stderr(stderr: &str, exit_code: i32) -> WebMediaError {
    let s = stderr.to_ascii_lowercase();
    if s.contains("unsupported url") {
        WebMediaError::Unsupported(stderr.lines().last().unwrap_or("").trim().to_string())
    } else if s.contains("private video") || s.contains("login required")
              || s.contains("members-only") || s.contains("sign in")
              || s.contains("confirm your age") {
        WebMediaError::AuthRequired
    } else if s.contains("not available in your country")
              || (s.contains("video unavailable") && s.contains("country")) {
        WebMediaError::RegionUnavailable { country: None }
    } else if s.contains("video unavailable") || s.contains("video not found") || s.contains("does not exist") {
        WebMediaError::DeletedOrNotFound
    } else if s.contains("network") || s.contains("timed out") || s.contains("connection") {
        WebMediaError::NetworkError(stderr.lines().last().unwrap_or("").trim().to_string())
    } else {
        let tail: String = stderr.chars().rev().take(500).collect::<String>().chars().rev().collect();
        WebMediaError::YtDlpCrashed { exit_code, stderr_tail: tail }
    }
}
```

- [ ] **Step 3: Add `fetch_metadata` method**

```rust
impl YtDlpHandle {
    pub async fn fetch_metadata(&self, url: &str) -> Result<WebMediaMetadata, WebMediaError> {
        if !self.is_available() { return Err(WebMediaError::YtDlpNotFound); }
        let out = tokio::process::Command::new(&self.binary)
            .args(["--dump-json", "--no-playlist", "--no-warnings", url])
            .output().await
            .map_err(|e| WebMediaError::NetworkError(e.to_string()))?;
        if !out.status.success() {
            return Err(classify_stderr(&String::from_utf8_lossy(&out.stderr), out.status.code().unwrap_or(-1)));
        }
        parse_metadata(&String::from_utf8_lossy(&out.stdout), url)
    }
}
```

- [ ] **Step 4: Fixture-driven tests**

```rust
#[cfg(test)]
mod parse_tests {
    use super::*;

    const YT_FIXTURE: &str = include_str!("web_media_fixtures/youtube_video.json");

    #[test]
    fn parses_youtube_fixture() {
        let m = parse_metadata(YT_FIXTURE, "https://www.youtube.com/watch?v=test").unwrap();
        assert!(!m.title.is_empty());
        assert!(!m.source_id.is_empty());
        assert!(m.platform.contains("youtube"));
    }

    #[test]
    fn classifies_auth_required() {
        let e = classify_stderr("ERROR: Private video. Sign in to watch.", 1);
        assert!(matches!(e, WebMediaError::AuthRequired));
    }

    #[test]
    fn classifies_unsupported() {
        let e = classify_stderr("ERROR: Unsupported URL: file://localhost/x", 1);
        assert!(matches!(e, WebMediaError::Unsupported(_)));
    }

    #[test]
    fn classifies_deleted() {
        let e = classify_stderr("ERROR: Video unavailable. This video is not available.", 1);
        assert!(matches!(e, WebMediaError::DeletedOrNotFound));
    }
}
```

- [ ] **Step 5: Run + Commit**

```
cd src-tauri && cargo test --lib import::web_media
git add src-tauri/src/import/
git commit -m "feat(w7): metadata fetch + stderr error classification

Fixture-driven parser tests; classify_stderr maps yt-dlp messages to
typed WebMediaError variants."
```

---

## Task 12: web_media.rs — playlist enumeration

**Files:**
- Modify: `src-tauri/src/import/web_media.rs`
- Create: `src-tauri/src/import/web_media_fixtures/youtube_playlist.json`

- [ ] **Step 1: Add types + parser**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PlaylistEntry {
    pub url: String,
    pub source_id: String,
    pub title: String,
    pub duration_seconds: Option<f64>,
    pub thumbnail_url: Option<String>,
    pub channel: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PlaylistEnvelope {
    pub playlist_url: String,
    pub playlist_title: String,
    pub channel: Option<String>,
    pub entries: Vec<PlaylistEntry>,
}

pub fn parse_playlist(json: &str, url: &str) -> Result<PlaylistEnvelope, WebMediaError> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| WebMediaError::YtDlpCrashed { exit_code: 0, stderr_tail: e.to_string() })?;
    let playlist_title = v["title"].as_str().unwrap_or("Untitled playlist").to_string();
    let channel = v["uploader"].as_str().or_else(|| v["channel"].as_str()).map(|s| s.to_string());
    let entries = v["entries"].as_array().map(|arr| {
        arr.iter().filter_map(|e| {
            let id = e["id"].as_str()?.to_string();
            let title = e["title"].as_str().unwrap_or("Untitled").to_string();
            let entry_url = e["url"].as_str().or_else(|| e["webpage_url"].as_str())
                .unwrap_or(&id).to_string();
            Some(PlaylistEntry {
                url: entry_url, source_id: id, title,
                duration_seconds: e["duration"].as_f64(),
                thumbnail_url: e["thumbnail"].as_str().map(|s| s.to_string()),
                channel: e["channel"].as_str().or_else(|| e["uploader"].as_str()).map(|s| s.to_string()),
            })
        }).collect()
    }).unwrap_or_default();
    Ok(PlaylistEnvelope { playlist_url: url.to_string(), playlist_title, channel, entries })
}
```

- [ ] **Step 2: Add `fetch_playlist_entries` method**

```rust
impl YtDlpHandle {
    pub async fn fetch_playlist_entries(&self, url: &str) -> Result<PlaylistEnvelope, WebMediaError> {
        if !self.is_available() { return Err(WebMediaError::YtDlpNotFound); }
        let out = tokio::process::Command::new(&self.binary)
            .args(["--flat-playlist", "--dump-single-json", "--no-warnings", url])
            .output().await
            .map_err(|e| WebMediaError::NetworkError(e.to_string()))?;
        if !out.status.success() {
            return Err(classify_stderr(&String::from_utf8_lossy(&out.stderr), out.status.code().unwrap_or(-1)));
        }
        parse_playlist(&String::from_utf8_lossy(&out.stdout), url)
    }
}
```

- [ ] **Step 3: Fixture test**

```rust
#[test]
fn parses_youtube_playlist_fixture() {
    let json = include_str!("web_media_fixtures/youtube_playlist.json");
    let p = parse_playlist(json, "https://www.youtube.com/playlist?list=PLxyz").unwrap();
    assert!(!p.playlist_title.is_empty());
    assert!(!p.entries.is_empty());
}
```

- [ ] **Step 4: Run + Commit**

```
cd src-tauri && cargo test --lib import::web_media
git add src-tauri/src/import/
git commit -m "feat(w7): playlist enumeration via --flat-playlist"
```

---

## Task 13: web_media.rs — download with progress + cancellation

**Files:**
- Modify: `src-tauri/src/import/web_media.rs`
- Modify: `src-tauri/Cargo.toml` (add `libc` if not transitive)

- [ ] **Step 1: Format opts + artefacts struct + progress struct**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WebMediaFormat {
    Mp3Audio,
    Mp4Video { max_height: u32 },
}

impl Default for WebMediaFormat {
    fn default() -> Self { WebMediaFormat::Mp3Audio }
}

#[derive(Debug, Clone)]
pub struct MediaArtefacts {
    pub audio_path: Option<PathBuf>,
    pub video_path: Option<PathBuf>,
    pub thumbnail_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct DownloadProgress {
    pub bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_human: Option<String>,
    pub eta_human: Option<String>,
}
```

- [ ] **Step 2: yt-dlp progress line parser**

```rust
/// Parse yt-dlp progress lines, e.g.
/// `[download]   12.3% of   40.00MiB at  2.10MiB/s ETA 00:14`
pub fn parse_progress_line(line: &str) -> Option<DownloadProgress> {
    if !line.contains("[download]") { return None; }
    let mut total_bytes: Option<u64> = None;
    let mut speed_human: Option<String> = None;
    let mut eta_human: Option<String> = None;
    let mut percent: Option<f64> = None;

    if let Some(idx) = line.find('%') {
        let pre: String = line[..idx].chars().rev()
            .take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        let pre: String = pre.chars().rev().collect();
        percent = pre.parse::<f64>().ok();
    }
    if let Some(of_idx) = line.find(" of ") {
        let after = &line[of_idx + 4..];
        let token: String = after.chars().take_while(|c| !c.is_whitespace()).collect();
        total_bytes = parse_size_token(&token);
    }
    if let Some(at_idx) = line.find(" at ") {
        let after = &line[at_idx + 4..];
        let speed: String = after.split_whitespace().next().unwrap_or("").to_string();
        if !speed.is_empty() { speed_human = Some(speed); }
    }
    if let Some(eta_idx) = line.find(" ETA ") {
        let token: String = line[eta_idx + 5..].chars().take_while(|c| !c.is_whitespace()).collect();
        if !token.is_empty() { eta_human = Some(token); }
    }
    let bytes = match (percent, total_bytes) {
        (Some(p), Some(t)) => ((p / 100.0) * t as f64) as u64,
        _ => 0,
    };
    Some(DownloadProgress { bytes, total_bytes, speed_human, eta_human })
}

fn parse_size_token(s: &str) -> Option<u64> {
    let s = s.trim();
    let (num_part, suffix): (String, String) = s.chars().partition(|c| c.is_ascii_digit() || *c == '.');
    let n: f64 = num_part.parse().ok()?;
    let mult: f64 = match suffix.to_ascii_uppercase().trim() {
        "B" => 1.0,
        "KIB" | "K" => 1024.0,
        "MIB" | "M" => 1024.0 * 1024.0,
        "GIB" | "G" => 1024.0 * 1024.0 * 1024.0,
        "TIB" | "T" => 1024.0_f64.powi(4),
        _ => return None,
    };
    Some((n * mult) as u64)
}

#[cfg(test)]
mod progress_tests {
    use super::*;

    #[test]
    fn parses_typical_line() {
        let p = parse_progress_line("[download]   12.3% of   40.00MiB at  2.10MiB/s ETA 00:14").unwrap();
        assert_eq!(p.total_bytes, Some(40 * 1024 * 1024));
        assert_eq!(p.eta_human.as_deref(), Some("00:14"));
    }

    #[test]
    fn ignores_non_progress_lines() {
        assert!(parse_progress_line("[info] something").is_none());
    }
}
```

- [ ] **Step 3: Download method with process group spawn**

The download method spawns yt-dlp with `tokio::process::Command`. To make cancellation kill the whole subprocess tree (yt-dlp + ffmpeg + http children), the spawn must place the child in its own process group.

**On Unix:** use `std::os::unix::process::CommandExt` and call `setsid` from libc inside the pre-spawn callback hook (the standard `pre_exec` API on `Command`). This makes the child the session/group leader. Cancellation then sends `SIGTERM` to the group via `libc::killpg`.

**On Windows:** set the `CREATE_NEW_PROCESS_GROUP` creation flag (0x00000200) via `std::os::windows::process::CommandExt::creation_flags`. Cancellation kills via Job Object or `TerminateProcess` on the leader.

```rust
use tokio::io::{AsyncBufReadExt, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

impl YtDlpHandle {
    pub async fn download_audio(
        &self, url: &str, target_dir: &Path,
        on_progress: impl Fn(DownloadProgress) + Send + Sync + 'static,
        cancel: Arc<AtomicBool>,
    ) -> Result<MediaArtefacts, WebMediaError> {
        if !self.is_available() { return Err(WebMediaError::YtDlpNotFound); }
        std::fs::create_dir_all(target_dir).map_err(|e| WebMediaError::FfmpegFailed(e.to_string()))?;

        let out_template = target_dir.join("audio.%(ext)s");
        let thumb_template = target_dir.join("thumbnail.%(ext)s");

        let mut cmd = tokio::process::Command::new(&self.binary);
        cmd.args([
            "-x", "--audio-format", "mp3", "--audio-quality", "2",
            "--write-thumbnail", "--convert-thumbnails", "jpg",
            "--no-playlist", "--newline",
            "--sleep-interval", "1", "--max-sleep-interval", "3",
            "-o", out_template.to_str().unwrap(),
            "-o", &format!("thumbnail:{}", thumb_template.display()),
            url,
        ]);
        cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());

        // Configure process-group leadership so cancel can kill the tree.
        // Unix: pre-spawn callback invokes libc::setsid (see std::os::unix::process::CommandExt).
        // Windows: CREATE_NEW_PROCESS_GROUP flag.
        configure_process_group(&mut cmd);

        let mut child = cmd.spawn().map_err(|e| WebMediaError::YtDlpCrashed {
            exit_code: -1, stderr_tail: e.to_string()
        })?;
        let pid = child.id();

        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_buf = String::new();

        let cancel_clone = cancel.clone();
        let progress_task = tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                if cancel_clone.load(Ordering::Relaxed) { break; }
                if let Some(p) = parse_progress_line(&line) { on_progress(p); }
            }
        });

        let cancel_watch = cancel.clone();
        let cancel_kill = tokio::spawn(async move {
            while !cancel_watch.load(Ordering::Relaxed) {
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            kill_process_group(pid);
        });

        let status = child.wait().await.map_err(|e| WebMediaError::YtDlpCrashed {
            exit_code: -1, stderr_tail: e.to_string()
        })?;
        let _ = progress_task.await;
        cancel_kill.abort();

        if let Some(mut e) = child.stderr.take() {
            use tokio::io::AsyncReadExt;
            let _ = e.read_to_string(&mut stderr_buf).await;
        }

        if cancel.load(Ordering::Relaxed) {
            return Err(WebMediaError::IntegrityCheckFailed); // surfaced as Cancelled in worker
        }
        if !status.success() {
            return Err(classify_stderr(&stderr_buf, status.code().unwrap_or(-1)));
        }

        let audio_path = find_one_with_prefix(target_dir, "audio.")?;
        let thumbnail_path = find_one_with_prefix(target_dir, "thumbnail.").ok();
        Ok(MediaArtefacts { audio_path: Some(audio_path), video_path: None, thumbnail_path })
    }
}

fn find_one_with_prefix(dir: &Path, prefix: &str) -> Result<PathBuf, WebMediaError> {
    for entry in std::fs::read_dir(dir).map_err(|e| WebMediaError::FfmpegFailed(e.to_string()))? {
        let entry = entry.map_err(|e| WebMediaError::FfmpegFailed(e.to_string()))?;
        if entry.file_name().to_string_lossy().starts_with(prefix) { return Ok(entry.path()); }
    }
    Err(WebMediaError::IntegrityCheckFailed)
}

#[cfg(unix)]
fn configure_process_group(cmd: &mut tokio::process::Command) {
    use std::os::unix::process::CommandExt as UnixCommandExt;
    unsafe {
        cmd.pre_exec(|| { libc::setsid(); Ok(()) });
    }
}

#[cfg(windows)]
fn configure_process_group(cmd: &mut tokio::process::Command) {
    use std::os::windows::process::CommandExt as WinCommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
}

#[cfg(unix)]
fn kill_process_group(pid: Option<u32>) {
    unsafe { if let Some(p) = pid { libc::killpg(p as i32, libc::SIGTERM); } }
}

#[cfg(windows)]
fn kill_process_group(_pid: Option<u32>) {
    // On Windows, killing via process-group requires a Job Object or sending CTRL_BREAK_EVENT.
    // For v1 we rely on tokio's Child::start_kill via the worker layer if needed.
}
```

(Note: the `pre_exec` callback in `configure_process_group` is the standard `std::os::unix::process::CommandExt::pre_exec` API. This is the only way to call `setsid` between fork and the new program image starting on Unix.)

- [ ] **Step 4: Run + Commit**

```
cd src-tauri && cargo test --lib import::web_media
git add src-tauri/src/import/web_media.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(w7): yt-dlp download with progress parsing + cancellation

Spawns child in its own process group (Unix setsid via pre_exec hook,
Windows CREATE_NEW_PROCESS_GROUP) so cancellation kills the whole tree.
Progress events parsed from stdout 'newline' format. Audio + thumbnail
artefacts located by prefix scan since yt-dlp may pick the extension."
```

---

## Task 14: web_media.rs — integrity verification

**Files:**
- Modify: `src-tauri/src/import/web_media.rs`

- [ ] **Step 1: Add verification function**

```rust
pub fn verify_artefacts(artefacts: &MediaArtefacts) -> Result<(), WebMediaError> {
    let Some(audio) = &artefacts.audio_path else { return Err(WebMediaError::IntegrityCheckFailed); };
    if !audio.exists() { return Err(WebMediaError::IntegrityCheckFailed); }
    let meta = std::fs::metadata(audio).map_err(|_| WebMediaError::IntegrityCheckFailed)?;
    if meta.len() < 1024 { return Err(WebMediaError::IntegrityCheckFailed); }

    use std::io::Read;
    let mut buf = [0u8; 4];
    let mut f = std::fs::File::open(audio).map_err(|_| WebMediaError::IntegrityCheckFailed)?;
    f.read_exact(&mut buf).map_err(|_| WebMediaError::IntegrityCheckFailed)?;
    let is_id3 = &buf[..3] == b"ID3";
    let is_mpeg_sync = buf[0] == 0xFF && (buf[1] & 0xE0) == 0xE0;
    if !is_id3 && !is_mpeg_sync { return Err(WebMediaError::IntegrityCheckFailed); }
    Ok(())
}
```

- [ ] **Step 2: Tests**

```rust
#[cfg(test)]
mod verify_tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn rejects_too_small() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("audio.mp3");
        std::fs::write(&p, b"tiny").unwrap();
        let r = verify_artefacts(&MediaArtefacts {
            audio_path: Some(p), video_path: None, thumbnail_path: None,
        });
        assert!(matches!(r, Err(WebMediaError::IntegrityCheckFailed)));
    }

    #[test]
    fn accepts_id3_header() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("audio.mp3");
        let mut data = b"ID3".to_vec();
        data.resize(2048, 0);
        std::fs::write(&p, &data).unwrap();
        let r = verify_artefacts(&MediaArtefacts {
            audio_path: Some(p), video_path: None, thumbnail_path: None,
        });
        assert!(r.is_ok());
    }
}
```

- [ ] **Step 3: Run + Commit**

```
cd src-tauri && cargo test --lib import::web_media::verify_tests
git add src-tauri/src/import/web_media.rs
git commit -m "feat(w7): integrity verification (size + ID3/MPEG sync magic bytes)"
```

---

## Task 15: ImportQueueService — enqueue_urls

**Files:**
- Modify: `src-tauri/src/import/web_media.rs` (add opts types)
- Modify: `src-tauri/src/import/mod.rs`

- [ ] **Step 1: Define opts types in `web_media.rs`**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AlreadyImportedHit {
    pub node_id: String,
    pub imported_at: String,
    pub vault_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PlaylistSource {
    pub title: String,
    pub url: String,
    pub index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WebMediaImportOpts {
    pub keep_media: bool,
    pub format: WebMediaFormat,
    pub parent_folder_node_id: Option<String>,
    pub playlist_source: Option<PlaylistSource>,
}

impl Default for WebMediaImportOpts {
    fn default() -> Self {
        Self { keep_media: true, format: WebMediaFormat::default(), parent_folder_node_id: None, playlist_source: None }
    }
}
```

Re-export from `mod.rs`: `pub use web_media::{WebMediaImportOpts, WebMediaFormat, PlaylistSource, AlreadyImportedHit, PlaylistEnvelope, PlaylistEntry, DownloadProgress, MediaArtefacts};`

- [ ] **Step 2: Add `enqueue_urls` to `ImportQueueService`**

```rust
impl ImportQueueService {
    pub async fn enqueue_urls(
        &self, urls: Vec<String>, opts: WebMediaImportOpts,
    ) -> Result<Vec<String>, String> {
        let mut ids = Vec::with_capacity(urls.len());
        for url in urls {
            let job_id = uuid::Uuid::now_v7().to_string();
            let job = ImportJob {
                // Match the actual ImportJob shape — fill from the existing struct.
                id: job_id.clone(),
                kind: ImportJobKind::WebMedia,
                state: ImportJobState::Queued,
                source_path: url.clone(),
                file_name: url.clone(),
                message: None,
                note_id: None,
                progress: 0.0,
                segment_index: 0,
                segment_count: 0,
                web_meta: None,
                web_opts: Some(opts.clone()),
                download_bytes: None,
                download_total_bytes: None,
                download_speed_human: None,
                cancel_flag: Arc::new(AtomicBool::new(false)),
                // ... any other existing fields, default values ...
            };
            self.persist_and_enqueue(job).await?;
            ids.push(job_id);
        }
        Ok(ids)
    }
}
```

You'll need to add `web_opts: Option<WebMediaImportOpts>` and `cancel_flag: Arc<AtomicBool>` to the in-memory `ImportJob` struct (if not present), and update DB schema if the queue is persisted (likely a JSON column or new fields — read existing persistence code first).

- [ ] **Step 3: Test**

```rust
#[tokio::test]
async fn enqueue_urls_creates_one_job_per_url() {
    let svc = test_service().await;
    let opts = WebMediaImportOpts::default();
    let ids = svc.enqueue_urls(
        vec!["https://a.example".into(), "https://b.example".into()],
        opts,
    ).await.unwrap();
    assert_eq!(ids.len(), 2);
    let snap = svc.snapshot().await;
    assert!(snap.jobs.iter().all(|j| j.kind == ImportJobKind::WebMedia));
}
```

(You'll need a `test_service()` helper — check if one already exists in `mod.rs` test module; if not, add a minimal in-memory variant.)

- [ ] **Step 4: Run + Commit**

```
cd src-tauri && cargo test --lib import
git add src-tauri/src/import/
git commit -m "feat(w7): ImportQueueService::enqueue_urls

One WebMedia job per URL, persisted with web_opts payload."
```

---

## Task 16: Worker — handle FetchingMeta state

**Files:**
- Modify: `src-tauri/src/import/mod.rs` (worker loop)

- [ ] **Step 1: Locate the worker dispatch**

In `mod.rs`, find the worker function that switches on `job.state` and `job.kind`. You'll be adding a new arm.

- [ ] **Step 2: Add WebMedia handling**

```rust
async fn process_job(&self, job: &mut ImportJob) -> Result<(), String> {
    match (job.kind, job.state) {
        (ImportJobKind::WebMedia, ImportJobState::Queued) => {
            self.transition(job, ImportJobState::FetchingMeta, None).await;
            self.handle_fetching_meta(job).await
        }
        (ImportJobKind::WebMedia, ImportJobState::FetchingMeta) => {
            self.handle_fetching_meta(job).await
        }
        (ImportJobKind::WebMedia, ImportJobState::Downloading) => {
            self.handle_downloading(job).await
        }
        // ... existing arms (Audio, Video, etc.) unchanged
        _ => self.process_existing(job).await,
    }
}

async fn handle_fetching_meta(&self, job: &mut ImportJob) -> Result<(), String> {
    let app = self.app_handle.clone();
    let bin = crate::plugin::yt_dlp::binary_path(&app)?;
    let handle = web_media::YtDlpHandle::new(bin);
    if !handle.is_available() {
        return self.fail_job(job, web_media::WebMediaError::YtDlpNotFound).await;
    }

    let url = job.source_path.clone();
    match handle.fetch_metadata(&url).await {
        Ok(meta) => {
            job.web_meta = Some(meta.clone());
            if meta.is_live {
                return self.fail_job(job, web_media::WebMediaError::LiveStream).await;
            }
            if let Some(d) = meta.duration_seconds {
                let limit = self.settings_max_duration_seconds(); // Task 23
                if d > limit {
                    return self.fail_job(job, web_media::WebMediaError::DurationExceedsLimit {
                        duration_seconds: d, limit_seconds: limit
                    }).await;
                }
            }
            self.transition(job, ImportJobState::Downloading, None).await;
            Ok(())
        }
        Err(e) => self.fail_job(job, e).await,
    }
}
```

`fail_job` is a helper that maps `WebMediaError` → user-facing message → transitions to `Error`.

- [ ] **Step 3: Build**

```
cd src-tauri && cargo build
```

- [ ] **Step 4: Commit**

```
git add src-tauri/src/import/mod.rs
git commit -m "feat(w7): worker handles FetchingMeta state for WebMedia jobs"
```

---

## Task 17: Already-imported detection

**Files:**
- Modify: `src-tauri/src/managers/workspace/workspace_manager.rs`
- Modify: `src-tauri/src/import/mod.rs`

- [ ] **Step 1: Add lookup helper in `workspace_manager.rs`**

```rust
impl WorkspaceManager {
    pub async fn find_node_by_source_id(&self, source_id: &str)
        -> Result<Option<AlreadyImportedHit>, String>
    {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, vault_rel_path, json_extract(frontmatter_json, '$.imported_at')
             FROM workspace_nodes
             WHERE json_extract(frontmatter_json, '$.source_id') = ?1
               AND deleted_at IS NULL
             LIMIT 1"
        ).map_err(|e| e.to_string())?;
        let mut rows = stmt.query([source_id]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let id: String = row.get(0).map_err(|e| e.to_string())?;
            let path: String = row.get(1).map_err(|e| e.to_string())?;
            let imported_at: Option<String> = row.get(2).ok();
            return Ok(Some(AlreadyImportedHit {
                node_id: id,
                imported_at: imported_at.unwrap_or_default(),
                vault_path: path,
            }));
        }
        Ok(None)
    }
}
```

(Adapt SQL to actual schema. If frontmatter is not stored as JSON in DB, denormalize `source_id` into a dedicated indexed column via a migration.)

- [ ] **Step 2: Wire into FetchingMeta handler**

In `handle_fetching_meta`, after parsing meta:

```rust
if let Some(hit) = self.workspace_manager.find_node_by_source_id(&meta.source_id).await? {
    // Bulk paste: skip silently. Preview flow returns the hit via fetch_url_metadata (Task 19).
    self.transition_to_skipped_already_imported(job, hit).await?;
    return Ok(());
}
```

- [ ] **Step 3: Test**

```rust
#[tokio::test]
async fn skips_when_source_id_already_imported() {
    let svc = test_service().await;
    svc.workspace_manager.insert_test_node_with_frontmatter("abc123").await.unwrap();
    let _ids = svc.enqueue_urls(vec!["https://example.com/v/abc123".into()], Default::default()).await.unwrap();
    // run worker once; assert job ends in skipped/done state, no fresh import
}
```

- [ ] **Step 4: Commit**

```
git add src-tauri/src/import/ src-tauri/src/managers/workspace/
git commit -m "feat(w7): already-imported detection by source_id"
```

---

## Task 18: Worker — handle Downloading state + plugin uninstall integration

**Files:**
- Modify: `src-tauri/src/import/mod.rs`
- Modify: `src-tauri/src/commands/yt_dlp_plugin.rs`

- [ ] **Step 1: Implement `handle_downloading`**

```rust
async fn handle_downloading(&self, job: &mut ImportJob) -> Result<(), String> {
    let app = self.app_handle.clone();
    let bin = crate::plugin::yt_dlp::binary_path(&app)?;
    let handle = web_media::YtDlpHandle::new(bin);

    let node_id = job.draft_node_id.clone().unwrap_or_else(|| uuid::Uuid::now_v7().to_string());
    job.draft_node_id = Some(node_id.clone());

    let media_dir = self.vault_root()?.join(".handy-media").join("web").join(&node_id);
    let cancel = job.cancel_flag.clone();
    let job_id = job.id.clone();
    let app_for_emit = self.app_handle.clone();

    let on_progress = move |p: web_media::DownloadProgress| {
        let _ = app_for_emit.emit("import-queue-job-progress", serde_json::json!({
            "id": job_id, "bytes": p.bytes, "total": p.total_bytes,
            "speed": p.speed_human, "eta": p.eta_human,
        }));
    };

    let url = job.source_path.clone();
    let result = handle.download_audio(&url, &media_dir, on_progress, cancel.clone()).await;

    if cancel.load(Ordering::Relaxed) {
        let _ = std::fs::remove_dir_all(&media_dir);
        self.transition(job, ImportJobState::Cancelled, Some("Cancelled by user".into())).await;
        return Ok(());
    }

    match result {
        Ok(artefacts) => {
            if let Err(e) = web_media::verify_artefacts(&artefacts) {
                let _ = std::fs::remove_dir_all(&media_dir);
                return self.fail_job(job, e).await;
            }
            job.local_audio_path = artefacts.audio_path.clone();
            job.media_dir = Some(media_dir.clone());
            self.transition(job, ImportJobState::Preparing, None).await;
            Ok(())
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&media_dir);
            self.fail_job(job, e).await
        }
    }
}
```

- [ ] **Step 2: Wire `local_audio_path` + `media_dir` into existing Audio pipeline entry**

In `handle_preparing` (or whichever existing function moves Audio jobs from `Preparing` → `Segmenting`), check `if job.kind == WebMedia { use job.local_audio_path }` instead of `job.source_path` for the audio file location.

- [ ] **Step 3: Plugin-uninstall cancels active jobs**

Add `cancel_all_web_media_jobs` to `ImportQueueService`:

```rust
impl ImportQueueService {
    pub async fn cancel_all_web_media_jobs(&self) -> Result<(), String> {
        let snap = self.snapshot().await;
        for job in snap.jobs {
            if job.kind == ImportJobKind::WebMedia
                && matches!(job.state,
                    ImportJobState::Queued | ImportJobState::FetchingMeta
                    | ImportJobState::Downloading | ImportJobState::Preparing) {
                let _ = self.cancel_job(job.id).await;
            }
        }
        Ok(())
    }
}
```

Wire into uninstall command:

```rust
#[tauri::command]
#[specta::specta]
pub async fn uninstall_yt_dlp_plugin(
    app: AppHandle,
    queue: tauri::State<'_, crate::import::ImportQueueService>,
) -> Result<(), String> {
    queue.cancel_all_web_media_jobs().await?;
    yt_dlp::uninstall(&app)
}
```

- [ ] **Step 4: Run + Commit**

```
cd src-tauri && cargo build
cd src-tauri && cargo test --lib
git add src-tauri/src/
git commit -m "feat(w7): worker downloads media and hands off to existing Audio pipeline

Per-node sidecar dir at .handy-media/web/<node-id>/ created here.
Cancel cleans up dir and child processes. Plugin uninstall cancels
all active WebMedia jobs first."
```

---

## Task 19: Tauri commands for URL imports

**Files:**
- Create: `src-tauri/src/commands/url_import.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement commands**

```rust
//! Tauri commands for URL-driven media imports.
use crate::import::{
    web_media::{
        WebMediaMetadata, WebMediaImportOpts, AlreadyImportedHit,
        PlaylistEnvelope, YtDlpHandle,
    },
    ImportQueueService,
};
use crate::plugin::yt_dlp;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UrlMetadataResult {
    #[serde(flatten)]
    pub meta: WebMediaMetadata,
    pub already_imported: Option<AlreadyImportedHit>,
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_url_metadata(
    app: AppHandle,
    queue: State<'_, ImportQueueService>,
    url: String,
) -> Result<UrlMetadataResult, String> {
    let bin = yt_dlp::binary_path(&app)?;
    let handle = YtDlpHandle::new(bin);
    let meta = handle.fetch_metadata(&url).await.map_err(|e| e.to_string())?;
    let already_imported = queue.workspace_manager()
        .find_node_by_source_id(&meta.source_id).await?;
    Ok(UrlMetadataResult { meta, already_imported })
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_playlist_entries(
    app: AppHandle, url: String,
) -> Result<PlaylistEnvelope, String> {
    let bin = yt_dlp::binary_path(&app)?;
    let handle = YtDlpHandle::new(bin);
    handle.fetch_playlist_entries(&url).await.map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn enqueue_import_urls(
    queue: State<'_, ImportQueueService>,
    urls: Vec<String>, opts: WebMediaImportOpts,
) -> Result<Vec<String>, String> {
    queue.enqueue_urls(urls, opts).await
}

#[tauri::command]
#[specta::specta]
pub async fn pause_import_queue(queue: State<'_, ImportQueueService>) -> Result<(), String> {
    queue.pause().await
}

#[tauri::command]
#[specta::specta]
pub async fn resume_import_queue(queue: State<'_, ImportQueueService>) -> Result<(), String> {
    queue.resume().await
}

#[tauri::command]
#[specta::specta]
pub async fn import_queue_pause_state(queue: State<'_, ImportQueueService>) -> Result<bool, String> {
    Ok(queue.is_paused().await)
}
```

Add `pause` / `resume` / `is_paused` methods to `ImportQueueService` — atomic bool, worker checks it before picking next job.

- [ ] **Step 2: Register in `lib.rs`**

Add the six new commands to `tauri::generate_handler![...]` and to the specta export.

- [ ] **Step 3: Build & verify bindings**

```
bun run build
grep -E "fetchUrlMetadata|enqueueImportUrls|pauseImportQueue" src/bindings.ts
```

- [ ] **Step 4: Commit**

```
git add src-tauri/src/ src/bindings.ts
git commit -m "feat(w7): Tauri commands for URL imports + queue control

fetch_url_metadata, fetch_playlist_entries, enqueue_import_urls,
pause_import_queue, resume_import_queue, import_queue_pause_state."
```

---

## Task 20: Vault write — frontmatter + ::web_clip directive + sidecar

**Files:**
- Modify: `src-tauri/src/import/mod.rs` (Finalizing path for WebMedia jobs)

- [ ] **Step 1: Build the frontmatter + body for WebMedia**

Inside whichever function handles `Finalizing` for the existing Audio path, branch on `job.kind == WebMedia`:

```rust
fn build_web_media_document(
    job: &ImportJob, transcript_paragraphs: &[String],
) -> Result<(serde_yaml::Value, String), String> {
    let meta = job.web_meta.as_ref().ok_or("missing web_meta")?;
    let opts = job.web_opts.as_ref().cloned().unwrap_or_default();
    let node_id = job.draft_node_id.as_ref().ok_or("missing draft_node_id")?;

    let mut fm = serde_yaml::Mapping::new();
    fm.insert("id".into(), node_id.clone().into());
    fm.insert("title".into(), meta.title.clone().into());
    fm.insert("source_url".into(), meta.url.clone().into());
    fm.insert("source_id".into(), meta.source_id.clone().into());
    fm.insert("source_platform".into(), meta.platform.clone().into());
    if let Some(c) = &meta.channel { fm.insert("source_channel".into(), c.clone().into()); }
    if let Some(d) = meta.duration_seconds {
        fm.insert("source_duration_seconds".into(), (d as i64).into());
    }
    if let Some(p) = &meta.published_at {
        fm.insert("source_published_at".into(), p.clone().into());
    }
    fm.insert("media_dir".into(), format!(".handy-media/web/{}/", node_id).into());
    fm.insert("imported_at".into(), chrono::Utc::now().to_rfc3339().into());
    fm.insert("imported_via".into(), "web_media".into());
    fm.insert("media_kept".into(), opts.keep_media.into());
    if let Some(ps) = &opts.playlist_source {
        let mut pmap = serde_yaml::Mapping::new();
        pmap.insert("title".into(), ps.title.clone().into());
        pmap.insert("url".into(), ps.url.clone().into());
        pmap.insert("index".into(), (ps.index as i64).into());
        fm.insert("playlist_source".into(), pmap.into());
    }

    let directive = format!(
        "::web_clip{{url=\"{}\" thumb=\".handy-media/web/{}/thumbnail.jpg\" platform=\"{}\"}}\n\n",
        meta.url, node_id, meta.platform,
    );
    let body = format!("{}{}", directive, transcript_paragraphs.join("\n\n"));

    Ok((serde_yaml::Value::Mapping(fm), body))
}
```

- [ ] **Step 2: Write `segments.json` sidecar before Finalizing**

```rust
fn write_segments_json(media_dir: &Path, segments: &[(u64, u64, String)]) -> Result<(), String> {
    let json: Vec<serde_json::Value> = segments.iter().map(|(s, e, t)| {
        serde_json::json!({ "start_ms": s, "end_ms": e, "text": t })
    }).collect();
    let path = media_dir.join("segments.json");
    std::fs::write(&path, serde_json::to_vec_pretty(&json).unwrap()).map_err(|e| e.to_string())
}
```

Wire from the existing transcription pipeline — it produces segment timestamps internally; you route them through to disk for WebMedia jobs.

- [ ] **Step 3: Cleanup non-kept media**

After Done, if `opts.keep_media == false`:

```rust
if !opts.keep_media {
    if let Some(media_dir) = &job.media_dir {
        let _ = std::fs::remove_file(media_dir.join("audio.mp3"));
        // Keep thumbnail + segments.json (small, useful)
    }
}
```

- [ ] **Step 4: Tests**

```rust
#[test]
fn build_document_includes_required_frontmatter_keys() {
    let job = test_web_media_job_with_meta();
    let paragraphs = vec!["Hello.".into(), "World.".into()];
    let (fm, body) = build_web_media_document(&job, &paragraphs).unwrap();
    let m = fm.as_mapping().unwrap();
    for k in ["id", "title", "source_url", "source_id", "source_platform",
              "media_dir", "imported_at", "imported_via", "media_kept"] {
        assert!(m.contains_key(&serde_yaml::Value::String(k.into())), "missing key: {}", k);
    }
    assert!(body.starts_with("::web_clip{"));
    assert!(body.contains("Hello."));
}
```

- [ ] **Step 5: Run + Commit**

```
cd src-tauri && cargo test --lib import
git add src-tauri/src/import/mod.rs
git commit -m "feat(w7): vault write — frontmatter, ::web_clip directive, segments.json sidecar"
```

---

## Task 21: Boot recovery — stale jobs

**Files:**
- Modify: `src-tauri/src/import/mod.rs` (init / load path)

- [ ] **Step 1: On service init, scan + heal**

In `ImportQueueService::new` (wherever queue state is loaded from DB on startup):

```rust
async fn heal_interrupted_jobs(&self) -> Result<(), String> {
    let conn = self.db.lock().await;
    let stale_states = ["fetching_meta", "downloading", "preparing", "segmenting", "transcribing", "post_processing"];
    let placeholders = stale_states.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "UPDATE import_jobs SET state = 'error', message = 'Interrupted — retry' WHERE state IN ({})",
        placeholders
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let n = stmt.execute(rusqlite::params_from_iter(stale_states.iter())).map_err(|e| e.to_string())?;
    if n > 0 { log::info!("Healed {} interrupted import jobs on boot", n); }
    Ok(())
}
```

Call from service constructor.

- [ ] **Step 2: Test**

```rust
#[tokio::test]
async fn boot_marks_active_jobs_as_error() {
    let db = test_db_with_active_job(ImportJobState::Downloading).await;
    let svc = ImportQueueService::new(db).await.unwrap();
    let snap = svc.snapshot().await;
    assert!(snap.jobs.iter().any(|j| j.state == ImportJobState::Error
        && j.message.as_deref() == Some("Interrupted — retry")));
}
```

- [ ] **Step 3: Commit**

```
git add src-tauri/src/import/mod.rs
git commit -m "feat(w7): boot recovery marks interrupted jobs as Error with retry hint"
```

---

## Task 22: Onboarding — add Extensions step

**Files:**
- Modify: `src-tauri/src/commands/onboarding.rs` (or wherever `OnboardingStep` lives)

- [ ] **Step 1: Add the variant**

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum OnboardingStep {
    Mic, Accessibility, Models, Vault,
    Extensions,    // NEW — W7
    Done,
}
```

No row migration: existing `Done` rows stay `Done`; existing in-flight rows naturally pick up the new step.

- [ ] **Step 2: Update next-step logic**

If there's a `next_step()` helper, ensure `Vault → Extensions → Done`.

- [ ] **Step 3: Test**

```rust
#[test]
fn extensions_follows_vault() {
    assert_eq!(OnboardingStep::Vault.next(), Some(OnboardingStep::Extensions));
    assert_eq!(OnboardingStep::Extensions.next(), Some(OnboardingStep::Done));
}
```

- [ ] **Step 4: Build + Commit**

```
bun run build
grep extensions src/bindings.ts
git add src-tauri/src/commands/onboarding.rs src/bindings.ts
git commit -m "feat(w7): add OnboardingStep::Extensions between Vault and Done"
```

---

## Task 23: Settings additions

**Files:**
- Modify: `src-tauri/src/settings.rs` (or wherever the settings struct lives)

- [ ] **Step 1: Add fields**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WebImportSettings {
    pub default_parent_folder_id: Option<String>,
    pub default_format: web_media::WebMediaFormat,
    pub default_keep_media: bool,
    pub max_duration_seconds: u32,
    pub media_cleanup_after_days: u32,
    pub concurrent_downloads: u32,
    pub concurrent_meta_fetches: u32,
    pub politeness_sleep_min: u32,
    pub politeness_sleep_max: u32,
    pub yt_dlp_auto_check_updates: bool,
}

impl Default for WebImportSettings {
    fn default() -> Self {
        Self {
            default_parent_folder_id: None,
            default_format: web_media::WebMediaFormat::Mp3Audio,
            default_keep_media: true,
            max_duration_seconds: 14_400,
            media_cleanup_after_days: 0,
            concurrent_downloads: 2,
            concurrent_meta_fetches: 4,
            politeness_sleep_min: 1,
            politeness_sleep_max: 3,
            yt_dlp_auto_check_updates: true,
        }
    }
}
```

Add `web_import: WebImportSettings` (with `#[serde(default)]`) to the parent settings struct.

- [ ] **Step 2: Test default round-trip**

```rust
#[test]
fn web_import_settings_round_trip() {
    let s = WebImportSettings::default();
    let json = serde_json::to_string(&s).unwrap();
    let back: WebImportSettings = serde_json::from_str(&json).unwrap();
    assert!(back.default_keep_media);
    assert_eq!(back.max_duration_seconds, 14_400);
}
```

- [ ] **Step 3: Build + Commit**

```
bun run build
git add src-tauri/src/settings.rs src/bindings.ts
git commit -m "feat(w7): WebImportSettings — defaults + persistence"
```

---

## Task 24: Frontend — useImportQueue hook

**Files:**
- Create: `src/hooks/useImportQueue.ts`

- [ ] **Step 1: Hook**

```typescript
import { useEffect, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { commands } from '../bindings';
import type { ImportQueueSnapshot } from '../bindings';

export function useImportQueue() {
  const [snapshot, setSnapshot] = useState<ImportQueueSnapshot | null>(null);
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(async () => {
    const snap = await commands.getImportQueue();
    setSnapshot(snap);
    setPaused(await commands.importQueuePauseState());
  }, []);

  useEffect(() => {
    refresh();
    const unlistenP = listen('import-queue-updated', () => { refresh(); });
    return () => { unlistenP.then(u => u()); };
  }, [refresh]);

  const cancel = useCallback(async (jobId: string) => {
    await commands.cancelImportJob(jobId);
    refresh();
  }, [refresh]);

  const pause = useCallback(async () => {
    await commands.pauseImportQueue();
    setPaused(true);
  }, []);

  const resume = useCallback(async () => {
    await commands.resumeImportQueue();
    setPaused(false);
  }, []);

  return { jobs: snapshot?.jobs ?? [], paused, cancel, pause, resume, refresh };
}
```

- [ ] **Step 2: Vitest with mocks**

`src/hooks/__tests__/useImportQueue.test.ts`:

```typescript
import { renderHook, waitFor } from '@testing-library/react';
import { useImportQueue } from '../useImportQueue';
import { vi } from 'vitest';

vi.mock('../../bindings', () => ({
  commands: {
    getImportQueue: vi.fn().mockResolvedValue({ jobs: [] }),
    importQueuePauseState: vi.fn().mockResolvedValue(false),
    cancelImportJob: vi.fn().mockResolvedValue(undefined),
    pauseImportQueue: vi.fn().mockResolvedValue(undefined),
    resumeImportQueue: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

test('returns empty snapshot initially', async () => {
  const { result } = renderHook(() => useImportQueue());
  await waitFor(() => expect(result.current.jobs).toEqual([]));
});
```

- [ ] **Step 3: Run + Commit**

```
bunx vitest run src/hooks/__tests__/useImportQueue
git add src/hooks/
git commit -m "feat(w7): useImportQueue hook"
```

---

## Task 25: Frontend — useYtDlpPlugin hook

**Files:**
- Create: `src/hooks/useYtDlpPlugin.ts`

- [ ] **Step 1: Hook**

```typescript
import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { commands } from '../bindings';
import type { PluginStatus, UpdateCheckResult, InstallProgress } from '../bindings';

export function useYtDlpPlugin() {
  const [status, setStatus] = useState<PluginStatus | null>(null);
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null);
  const [installing, setInstalling] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await commands.ytDlpPluginStatus());
  }, []);

  useEffect(() => {
    refresh();
    const offState = listen('plugin-state-changed', () => refresh());
    const offProg = listen<InstallProgress>('plugin-install-progress', e => setInstallProgress(e.payload));
    return () => { offState.then(u => u()); offProg.then(u => u()); };
  }, [refresh]);

  const install = useCallback(async () => {
    setInstalling(true); setInstallProgress(null);
    try { await commands.installYtDlpPlugin(); }
    finally { setInstalling(false); refresh(); }
  }, [refresh]);

  const checkUpdate = useCallback(async (): Promise<UpdateCheckResult> => {
    const r = await commands.checkYtDlpUpdate();
    refresh();
    return r;
  }, [refresh]);

  const uninstall = useCallback(async () => {
    await commands.uninstallYtDlpPlugin();
    refresh();
  }, [refresh]);

  return { status, installProgress, installing, install, checkUpdate, uninstall, refresh };
}
```

- [ ] **Step 2: Run + Commit**

```
bunx vitest run src/hooks
git add src/hooks/useYtDlpPlugin.ts
git commit -m "feat(w7): useYtDlpPlugin hook"
```

---

## Task 26: ImportView rewrite — scaffold + queue wire-up

**Files:**
- Modify: `src/components/ImportView.tsx` (full rewrite, currently dormant mock)
- Create: `src/styles/import.css`

- [ ] **Step 1: Replace mocked data with hooks; keep layout shell**

```typescript
import { useImportQueue } from '../hooks/useImportQueue';
import { useYtDlpPlugin } from '../hooks/useYtDlpPlugin';
import { Upload } from 'lucide-react';
import './../styles/import.css';

export function ImportView() {
  const { jobs, paused, cancel, pause, resume } = useImportQueue();
  const plugin = useYtDlpPlugin();

  const processing = jobs.filter(j => !['done', 'error', 'cancelled'].includes(j.state));
  const completed = jobs.filter(j => ['done', 'error', 'cancelled'].includes(j.state));

  return (
    <div className="heros-page-container import-view">
      <header className="import-view__header">
        <div className="import-view__icon"><Upload size={32} /></div>
        <h1>Intelligence Ingestion</h1>
        <p>Bring external knowledge in. Indexed and embedded locally.</p>
      </header>
      <div className="import-view__grid">
        <section className="import-view__left heros-glass-card">
          {/* URL input — Task 27; file dropzone — keep current; source chips dormant */}
        </section>
        <div className="import-view__right">
          <ProcessingPanel jobs={processing} paused={paused} pause={pause} resume={resume} cancel={cancel} />
          <CompletedPanel jobs={completed} />
        </div>
      </div>
    </div>
  );
}
```

`ProcessingPanel` and `CompletedPanel` are local components in the same file initially; extract later if needed.

- [ ] **Step 2: `import.css` with token-only styles** (Rule 12 + 18)

```css
.import-view { padding: var(--space-8); max-width: 1200px; margin: 0 auto; height: 100%; display: flex; flex-direction: column; }
.import-view__header { text-align: center; margin-bottom: var(--space-12); }
.import-view__icon { width: 64px; height: 64px; border-radius: var(--radius-lg); background: var(--heros-brand); margin: 0 auto var(--space-6) auto; display: flex; align-items: center; justify-content: center; }
.import-view__grid { flex: 1; display: grid; grid-template-columns: 1fr 1.6fr; gap: var(--space-5); min-height: 0; }
.import-view__left { padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-4); height: fit-content; }
.import-view__right { display: flex; flex-direction: column; gap: var(--space-1); min-height: 0; }
/* No raw px/hex (Rule 12). 64px icon size is acceptable as a fixed UI element; everything else through tokens. */
```

- [ ] **Step 3: Build + Commit**

```
bun run build
git add src/components/ImportView.tsx src/styles/import.css
git commit -m "feat(w7): ImportView wired to real queue (URL input lands next task)"
```

---

## Task 27: ImportView — URL input with auto-detect (1 vs N)

**Files:**
- Modify: `src/components/ImportView.tsx`

- [ ] **Step 1: URL detection logic + input section**

```typescript
export function detectUrls(text: string): string[] {
  return Array.from(new Set(
    text.split(/[\s\n]+/)
      .map(s => s.trim())
      .filter(s => /^https?:\/\/\S+\.\S+/.test(s))
  ));
}

function UrlInputSection({ onSingle, onBulk, plugin }: {
  onSingle: (url: string) => void;
  onBulk: (urls: string[]) => void;
  plugin: ReturnType<typeof useYtDlpPlugin>;
}) {
  const [text, setText] = useState('');
  const urls = useMemo(() => detectUrls(text), [text]);
  const count = urls.length;

  if (!plugin.status?.installed) {
    return <PluginMissingBanner plugin={plugin} />;
  }

  return (
    <div className="url-input">
      <textarea
        className="url-input__textarea"
        placeholder="Paste a URL — YouTube, podcasts, social platforms, 1000+ sites"
        value={text}
        onChange={e => setText(e.target.value)}
        rows={text.includes('\n') ? Math.min(text.split('\n').length, 8) : 1}
      />
      <div className="url-input__controls">
        <FormatPicker />
        <KeepMediaToggle />
        <button
          className="heros-btn heros-btn-brand"
          disabled={count === 0}
          onClick={() => count === 1 ? onSingle(urls[0]) : onBulk(urls)}
        >
          {count === 0 ? 'Paste a URL' : count === 1 ? 'Preview' : `Enqueue ${count} URLs`}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Tests for detection logic**

```typescript
import { detectUrls } from '../ImportView';

test('detects single URL', () => {
  expect(detectUrls('https://youtube.com/watch?v=x')).toEqual(['https://youtube.com/watch?v=x']);
});
test('detects newline-separated URLs', () => {
  expect(detectUrls('https://a.example/x\nhttps://b.example/y')).toHaveLength(2);
});
test('dedupes URLs', () => {
  const urls = detectUrls('https://a.example/x\nhttps://a.example/x');
  expect(urls).toHaveLength(1);
});
test('rejects malformed', () => {
  expect(detectUrls('not a url\nhttps://valid.example/x')).toEqual(['https://valid.example/x']);
});
```

- [ ] **Step 3: Run + Commit**

```
bunx vitest run
git add src/components/ImportView.tsx src/components/__tests__/ImportView.test.tsx
git commit -m "feat(w7): URL input with auto-detect 1-vs-N URLs"
```

---

## Task 28: ImportView — single-URL preview flow

**Files:**
- Modify: `src/components/ImportView.tsx`

- [ ] **Step 1: Preview state machine + components**

```typescript
type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; meta: WebMediaMetadata; alreadyImported?: AlreadyImportedHit }
  | { kind: 'playlist'; envelope: PlaylistEnvelope }
  | { kind: 'live' }
  | { kind: 'error'; message: string };

function PreviewSection({ url, format, keepMedia, parentFolderId, onCommit }: { ... }) {
  const [state, setState] = useState<PreviewState>({ kind: 'idle' });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setState({ kind: 'loading' });
    const t = setTimeout(async () => {
      try {
        const result = await commands.fetchUrlMetadata(url);
        if (cancelled) return;
        if (result.is_live) { setState({ kind: 'live' }); return; }
        // Detect playlist by URL pattern (yt-dlp metadata returns first video for playlist URLs by default)
        if (/[?&]list=|playlist\?list=/.test(url)) {
          const env = await commands.fetchPlaylistEntries(url);
          setState({ kind: 'playlist', envelope: env });
          return;
        }
        setState({ kind: 'ready', meta: result, alreadyImported: result.already_imported ?? undefined });
      } catch (e: any) {
        if (!cancelled) setState({ kind: 'error', message: String(e) });
      }
    }, 400);  // debounce
    return () => { cancelled = true; clearTimeout(t); };
  }, [url]);

  if (state.kind === 'loading') return <PreviewSkeleton />;
  if (state.kind === 'error') return <PreviewError message={state.message} />;
  if (state.kind === 'live') return <PreviewLive />;
  if (state.kind === 'playlist') return <PreviewPlaylist envelope={state.envelope} onCommit={onCommit} />;
  if (state.kind === 'ready')
    return <PreviewCard meta={state.meta} alreadyImported={state.alreadyImported}
                       format={format} keepMedia={keepMedia}
                       parentFolderId={parentFolderId} onCommit={onCommit} />;
  return null;
}

function PreviewCard({ meta, alreadyImported, onCommit }) {
  if (alreadyImported) {
    return (
      <div className="preview-card preview-card--already">
        <span>Already imported on {alreadyImported.imported_at}</span>
        <button onClick={() => navigateToNote(alreadyImported.node_id)}>Open note</button>
        <button onClick={onCommit}>Import anyway</button>
      </div>
    );
  }
  return (
    <div className="preview-card">
      {meta.thumbnail_url && <img src={meta.thumbnail_url} alt="" className="preview-card__thumb" />}
      <div className="preview-card__body">
        <h3>{meta.title}</h3>
        <p>{meta.channel} · {formatDuration(meta.duration_seconds)} · {meta.platform}</p>
        <button className="heros-btn heros-btn-brand" onClick={onCommit}>Import →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire commit**

```typescript
async function commitSingle(url: string, opts: WebMediaImportOpts) {
  await commands.enqueueImportUrls([url], opts);
  // queue refresh happens via event listener
}
```

- [ ] **Step 3: Commit**

```
bun run build
git add src/components/ImportView.tsx src/styles/import.css
git commit -m "feat(w7): single-URL preview flow with metadata card"
```

---

## Task 29: ImportView — bulk paste + plugin-missing banner

**Files:**
- Modify: `src/components/ImportView.tsx`

- [ ] **Step 1: Bulk handler**

```typescript
async function commitBulk(urls: string[], opts: WebMediaImportOpts) {
  await commands.enqueueImportUrls(urls, opts);
  toast.success(`${urls.length} URLs enqueued`);
}
```

- [ ] **Step 2: Plugin-missing banner**

```typescript
function PluginMissingBanner({ plugin }: { plugin: ReturnType<typeof useYtDlpPlugin> }) {
  if (plugin.installing) {
    const p = plugin.installProgress;
    let label = 'Preparing…';
    if (p?.phase === 'downloading') {
      const pct = p.total ? ((p.bytes / p.total) * 100).toFixed(0) : '?';
      label = `Downloading… ${pct}%`;
    } else if (p?.phase === 'verifying') label = 'Verifying…';
    else if (p?.phase === 'finalizing') label = 'Installing…';
    return <div className="plugin-banner">{label}</div>;
  }
  return (
    <div className="plugin-banner">
      <Download size={20} />
      <div>
        <strong>Media downloader not installed</strong>
        <p>~12 MB · Required for URL imports</p>
      </div>
      <button className="heros-btn heros-btn-brand" onClick={plugin.install}>Install</button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```
git add src/components/ImportView.tsx src/styles/import.css
git commit -m "feat(w7): bulk URL paste + plugin-missing banner"
```

---

## Task 30: PlaylistSelectorModal

**Files:**
- Create: `src/components/PlaylistSelectorModal.tsx`

- [ ] **Step 1: Component**

```typescript
import { useState, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PlaylistEnvelope, PlaylistEntry } from '../bindings';

export function PlaylistSelectorModal({
  envelope, onCancel, onCommit,
}: {
  envelope: PlaylistEnvelope;
  onCancel: () => void;
  onCommit: (selectedEntries: PlaylistEntry[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(envelope.entries.map(e => e.source_id))   // all selected by default
  );
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() =>
    envelope.entries.filter(e => e.title.toLowerCase().includes(filter.toLowerCase())),
    [envelope.entries, filter]
  );

  const selectAll = () => setSelected(new Set(envelope.entries.map(e => e.source_id)));
  const selectNone = () => setSelected(new Set());
  const invert = () => setSelected(s => {
    const next = new Set<string>();
    for (const e of envelope.entries) if (!s.has(e.source_id)) next.add(e.source_id);
    return next;
  });
  const toggle = (id: string) => setSelected(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  const handleCommit = () => {
    onCommit(envelope.entries.filter(e => selected.has(e.source_id)));
  };

  return (
    <div className="playlist-modal" role="dialog">
      <div className="playlist-modal__panel heros-glass-panel">
        <header className="playlist-modal__header">
          <div>
            <h2>{envelope.playlist_title}</h2>
            <p>{envelope.channel} · {envelope.entries.length} videos</p>
          </div>
          <button onClick={onCancel}>✕</button>
        </header>
        <div className="playlist-modal__toolbar">
          <button onClick={selectAll}>Select all</button>
          <button onClick={selectNone}>Select none</button>
          <button onClick={invert}>Invert</button>
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter…" />
        </div>
        <div className="playlist-modal__list" ref={parentRef}>
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map(v => {
              const e = filtered[v.index];
              return (
                <div key={e.source_id} className="playlist-row"
                     style={{ position: 'absolute', top: 0, left: 0, right: 0,
                              transform: `translateY(${v.start}px)`, height: v.size }}>
                  <input type="checkbox" checked={selected.has(e.source_id)} onChange={() => toggle(e.source_id)} />
                  {e.thumbnail_url && <img src={e.thumbnail_url} alt="" />}
                  <div>
                    <div>{e.title}</div>
                    <small>{e.channel} · {formatDuration(e.duration_seconds)}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <footer className="playlist-modal__footer">
          <button onClick={onCancel}>Cancel</button>
          <button className="heros-btn heros-btn-brand" disabled={selected.size === 0} onClick={handleCommit}>
            Import {selected.size} videos →
          </button>
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire commit handler in ImportView**

```typescript
async function commitPlaylist(envelope: PlaylistEnvelope, sel: PlaylistEntry[], opts: WebMediaImportOpts) {
  for (let index = 0; index < sel.length; index++) {
    const e = sel[index];
    await commands.enqueueImportUrls([e.url], {
      ...opts,
      playlist_source: { title: envelope.playlist_title, url: envelope.playlist_url, index },
    });
  }
  toast.success(`${sel.length} videos enqueued`);
}
```

- [ ] **Step 3: Build + Commit**

```
bunx vitest run
bun run build
git add src/components/PlaylistSelectorModal.tsx src/styles/import.css
git commit -m "feat(w7): PlaylistSelectorModal with virtualized multi-select"
```

---

## Task 31: Queue row UI + global controls

**Files:**
- Modify: `src/components/ImportView.tsx`

- [ ] **Step 1: Per-state row rendering**

```typescript
function QueueRow({ job, onCancel, onRetry }: { ... }) {
  const thumb = job.web_meta?.thumbnail_url;
  return (
    <div className="queue-row">
      <div className="queue-row__icon">
        {thumb ? <img src={thumb} /> : <PlatformIcon platform={job.web_meta?.platform} />}
      </div>
      <div className="queue-row__body">
        <div>{job.web_meta?.title ?? job.file_name}</div>
        <small>{renderSubtitle(job)}</small>
      </div>
      <div className="queue-row__right">{renderRight(job, onCancel, onRetry)}</div>
    </div>
  );
}

function renderSubtitle(job: ImportJobDto): string {
  switch (job.state) {
    case 'queued': return 'Queued';
    case 'fetching_meta': return 'Fetching metadata…';
    case 'downloading': {
      const b = job.download_bytes ?? 0;
      const t = job.download_total_bytes;
      return `${formatBytes(b)}${t ? ` / ${formatBytes(t)}` : ''} · ${job.download_speed_human ?? ''}`;
    }
    case 'preparing': case 'segmenting': return 'Preparing audio…';
    case 'transcribing': return job.message ?? `Transcribing · ${job.segment_index} / ${job.segment_count}`;
    case 'post_processing': case 'finalizing': return 'Finalizing…';
    case 'done': return job.note_id ? 'Saved' : 'Done';
    case 'error': return job.message ?? 'Error';
    case 'cancelled': return 'Cancelled';
    default: return job.state;
  }
}

function renderRight(job: ImportJobDto, onCancel: () => void, onRetry: () => void) {
  if (job.state === 'error' || job.state === 'cancelled') {
    return <><button onClick={onRetry}>Retry</button><button onClick={onCancel}>Dismiss</button></>;
  }
  if (job.state === 'done') {
    return <button onClick={() => navigateToNote(job.note_id!)}>Open</button>;
  }
  return <ProgressBar value={job.progress} cancel={onCancel} />;
}
```

- [ ] **Step 2: Global queue controls**

```typescript
<div className="queue-controls">
  <button onClick={paused ? resume : pause}>{paused ? '▶ Resume queue' : '⏸ Pause queue'}</button>
  <button onClick={clearCompleted}>Clear completed</button>
  <span>active {processing.length} · queued {queued.length} · done today {doneToday.length}</span>
</div>
```

- [ ] **Step 3: Commit**

```
git add src/components/ImportView.tsx src/styles/import.css
git commit -m "feat(w7): queue row state rendering + global controls"
```

---

## Task 32: Settings → Extensions view

**Files:**
- Create: `src/components/SettingsExtensionsView.tsx`
- Modify: `src/components/SettingsView.tsx` (add sidebar entry)

- [ ] **Step 1: New view**

```typescript
import { useState } from 'react';
import { Download } from 'lucide-react';
import { useYtDlpPlugin } from '../hooks/useYtDlpPlugin';
import type { UpdateCheckResult } from '../bindings';

export function SettingsExtensionsView() {
  const plugin = useYtDlpPlugin();
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);

  return (
    <div className="settings-extensions">
      <h2>Extensions</h2>
      <div className="extension-card heros-glass-panel">
        <Download size={32} />
        <div>
          <h3>Media downloader (yt-dlp)</h3>
          <p>{plugin.status?.installed
            ? `Installed · v${plugin.status.version} · Last checked ${formatRelative(plugin.status.last_checked_at)}`
            : 'Not installed · 12 MB'}</p>
          <p>Enables URL imports from YouTube, podcasts, social platforms, 1000+ sites.</p>
          <div className="extension-card__actions">
            {plugin.status?.installed ? (
              <>
                <button onClick={async () => setUpdateCheck(await plugin.checkUpdate())}>Check for update</button>
                <button onClick={plugin.uninstall}>Uninstall</button>
              </>
            ) : (
              <button className="heros-btn heros-btn-brand" onClick={plugin.install} disabled={plugin.installing}>
                {plugin.installing ? 'Installing…' : 'Install (12 MB)'}
              </button>
            )}
          </div>
          {updateCheck?.update_available && (
            <p className="update-available">Update available: v{updateCheck.latest}</p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire sidebar entry in SettingsView**

Add an "Extensions" item alongside existing sections (Appearance, Audio devices, Models, etc.) that renders `<SettingsExtensionsView />`.

- [ ] **Step 3: Commit**

```
git add src/components/SettingsExtensionsView.tsx src/components/SettingsView.tsx src/styles/
git commit -m "feat(w7): Settings → Extensions view (yt-dlp plugin management)"
```

---

## Task 33: Onboarding extensions step

**Files:**
- Create: `src/components/OnboardingStepExtensions.tsx`
- Modify: `src/components/OnboardingOverlay.tsx`

- [ ] **Step 1: New step component**

```typescript
import { useState } from 'react';
import { useYtDlpPlugin } from '../hooks/useYtDlpPlugin';
import { OnboardingStepFrame } from './OnboardingStepFrame';

export function OnboardingStepExtensions({ onComplete }: { onComplete: () => void }) {
  const plugin = useYtDlpPlugin();
  const [installSelected, setInstallSelected] = useState(false);

  const handleNext = async () => {
    if (installSelected) {
      try { await plugin.install(); }
      catch { /* surface but allow continue */ }
    }
    onComplete();
  };

  return (
    <OnboardingStepFrame title="Optional extensions"
                         subtitle="Add extra capabilities. Install now or later from Settings.">
      <label className="extension-option">
        <input type="checkbox" checked={installSelected} onChange={e => setInstallSelected(e.target.checked)} />
        <div>
          <strong>Media downloader</strong> (12 MB)
          <p>Import from URLs — YouTube, podcasts, social platforms, 1000+ sites</p>
        </div>
      </label>
      <div className="onboarding-actions">
        <button onClick={onComplete}>Skip for now</button>
        <button className="heros-btn heros-btn-brand" onClick={handleNext} disabled={plugin.installing}>
          {plugin.installing ? 'Installing…' : (installSelected ? 'Install selected' : 'Continue')}
        </button>
      </div>
    </OnboardingStepFrame>
  );
}
```

- [ ] **Step 2: Slot into OnboardingOverlay**

In the overlay's step switch, add `'extensions'` case rendering `<OnboardingStepExtensions onComplete={() => completeStep('extensions')} />`. Verify `completeStep` advances `Vault → Extensions → Done` correctly via the backend enum.

- [ ] **Step 3: Commit**

```
bun run build
git add src/components/OnboardingStepExtensions.tsx src/components/OnboardingOverlay.tsx
git commit -m "feat(w7): onboarding extensions step (optional, skippable)"
```

---

## Task 34: End-to-end manual verification

**Files:** none — verification only

- [ ] **Step 1: Cold start in `bun run tauri dev`**

Verify: app boots, ImportView renders, "Media downloader not installed" banner visible.

- [ ] **Step 2: Install plugin**

Click Install → progress shown → success → URL input replaces banner. Verify `<app_data>/handy/extensions/yt-dlp/` populated with binary, `version.txt`, `installed_at.txt`, `checksum.sha256`.

- [ ] **Step 3: Single URL import**

Paste a known-public CC-licensed YouTube URL → preview card with thumbnail, title, channel, duration → click Import → row appears in Processing → states progress through `FetchingMeta → Downloading → Preparing → Transcribing → Done`. Open the resulting note. Verify:
- Frontmatter has all required keys (id, title, source_url, source_id, source_platform, source_channel, source_duration_seconds, source_published_at, media_dir, imported_at, imported_via, media_kept)
- `::web_clip{...}` directive present
- Audio plays via `convertFileSrc(.handy-media/web/<id>/audio.mp3)`
- `segments.json` exists alongside

- [ ] **Step 4: Bulk URL import**

Paste 3 different URLs separated by newlines → button reads "Enqueue 3 URLs" → click → all 3 queued, no preview card. Verify all complete.

- [ ] **Step 5: Playlist URL import**

Paste a playlist URL → "Choose videos…" appears → click → modal opens with all entries selected → uncheck two → "Import N videos" → those land as separate jobs with `playlist_source` in frontmatter.

- [ ] **Step 6: Cancel mid-download**

Start an import, cancel during Downloading → row moves to Cancelled → verify `.handy-media/web/<id>/` is gone.

- [ ] **Step 7: Already-imported detection**

Re-paste a URL already imported → preview shows "Already imported on Y → [Open note] / [Import anyway]".

- [ ] **Step 8: Mic quiescence**

Start mic recording → enqueue a URL → URL transcription should pause at "Waiting for mic session to end…" → stop mic → URL transcription resumes.

- [ ] **Step 9: Boot recovery**

Mid-import, kill the app process. Restart. Stale job should show as Error with "Interrupted — retry."

- [ ] **Step 10: Plugin uninstall with active jobs**

Enqueue 2 jobs, then uninstall plugin from Settings. Confirm dialog → both jobs cancel → extension dir gone.

- [ ] **Step 11: Onboarding flow**

Reset onboarding state in dev tools (or fresh app data) → walk through onboarding → verify Extensions step appears between Vault and Done → check the box → install completes inline → onboarding finishes.

- [ ] **Step 12: Final smoke**

```
cd src-tauri && cargo test --lib
bunx vitest run
bun run build
```

All green. No commit (verification task).

---

## Self-Review

After implementing all tasks, re-read the spec and confirm:

- [ ] Every spec section has a corresponding task (skim §3-§16; map each to a task above)
- [ ] No `TBD` / `TODO` / `placeholder` strings in the implemented code
- [ ] Every Tauri command listed in spec §6 is registered in `lib.rs`
- [ ] Every settings key in spec §14 exists in `WebImportSettings`
- [ ] Every error variant in spec §11 is mapped from real yt-dlp output via `classify_stderr`
- [ ] All 16 edge cases in spec §12 are handled or have matching test fixtures
- [ ] Forward-compat hooks in spec §13 all present (`segments.json`, `::web_clip{...}`, frontmatter shape, `OnboardingStep::Extensions`, `.handy-media/<source-type>/<node-id>/`)
- [ ] DoD checklist from spec §16 satisfied

Run the full test suite one final time. If anything fails, do not declare W7 complete.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-24-w7-url-media-import.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints for review.

**Which approach?**
