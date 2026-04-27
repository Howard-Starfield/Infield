# Image Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users embed images in notes via paste, drag-and-drop, and a `/image` slash command, with bytes saved to `<vault>/attachments/YYYY/MM/<name>-<uuid8>.<ext>` and references in plain markdown `![alt|width](path)`.

**Architecture:** Three insert vectors (paste / drop / slash) share one `imageInsert` helper that posts bytes to a new `save_attachment` Rust command, inserts a `pending://<id>` placeholder while writing, swaps to the real path on success, and pauses autosave during the pending window. Inline rendering is a CodeMirror 6 widget added to the existing `livePreviewPlugin`, with hover-revealed corner handles that rewrite the source line on resize.

**Tech Stack:** Rust + Tauri (`save_attachment` command, `infer` crate for magic-byte sniffing); CodeMirror 6 (`@codemirror/lang-markdown` + GFM, `@codemirror/view` widgets, `@codemirror/state` state fields); existing autosave + live-preview infrastructure.

**Reference spec:** [docs/superpowers/specs/2026-04-26-image-import-design.md](../specs/2026-04-26-image-import-design.md). Read it before starting Task 1.

**Operational rule (from user feedback memory):** **Never run destructive git or filesystem ops without asking the user.** This includes `git reset --hard`, `git checkout .`, `git restore .`, `git stash drop`, `git clean -f`, `git branch -D`, force-push, or deleting/overwriting files outside this plan's scope. The user keeps unrelated uncommitted work in the same tree across multiple parallel projects. If a task fails, surface the failure and ask before reverting anything.

---

## Task 1: Add `infer` crate to Cargo.toml

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the dependency**

Locate the `[dependencies]` section in `src-tauri/Cargo.toml` and add this line alongside other crate entries:

```toml
infer = "0.16"
```

- [ ] **Step 2: Verify the manifest builds**

Run:
```bash
cd src-tauri && cargo check
```

Expected: completes successfully (may take several minutes the first time as it downloads `infer`). No new errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(image-import): add infer crate for magic-byte sniffing"
```

---

## Task 2: Implement `sanitize_filename` (TDD)

**Files:**
- Create: `src-tauri/src/commands/attachments.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Create the module file with the function and tests**

Create `src-tauri/src/commands/attachments.rs`:

```rust
use chrono::Local;
use unicode_normalization::UnicodeNormalization;

const MAX_BASENAME_LEN: usize = 80;

/// Sanitize a user-supplied filename or generate a paste-mode fallback.
///
/// - `None` → generates `pasted-YYYYMMDD-HHMMSS` from local time.
/// - `Some(name)` → NFC-normalizes, strips the file extension if present,
///   strips control chars, replaces Windows-illegal chars and internal
///   whitespace with `-`, strips leading/trailing whitespace and dots,
///   truncates to 80 chars, and falls back to "image" if the result is empty.
pub fn sanitize_filename(preferred: Option<&str>) -> String {
    let name = match preferred {
        None => {
            return Local::now().format("pasted-%Y%m%d-%H%M%S").to_string();
        }
        Some(s) => s,
    };

    let normalized: String = name.nfc().collect();

    // Strip extension (we re-attach the canonical one for the validated MIME).
    let stem = match normalized.rsplit_once('.') {
        Some((stem, _)) if !stem.is_empty() => stem.to_string(),
        _ => normalized,
    };

    // Pre-trim before mapping so leading/trailing whitespace doesn't
    // become leading/trailing '-'.
    let pre_trimmed = stem.trim_matches(|c: char| c.is_whitespace() || c == '.');

    // CRITICAL ORDERING: map whitespace → '-' BEFORE filtering control
    // chars. `\t` and `\n` are control chars in Rust (`is_control()`
    // returns true), so a control-filter first would silently delete
    // tabs and newlines instead of replacing them with '-'. The test
    // `replaces_internal_whitespace_with_dash` covers this.
    let cleaned: String = pre_trimmed
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_whitespace() => '-',
            c => c,
        })
        .filter(|c| !c.is_control())
        .collect();

    let trimmed: String = cleaned
        .trim_matches(|c: char| c.is_whitespace() || c == '.')
        .to_string();

    let truncated: String = trimmed.chars().take(MAX_BASENAME_LEN).collect();

    if truncated.is_empty() {
        "image".to_string()
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paste_mode_returns_timestamp_prefix() {
        let out = sanitize_filename(None);
        assert!(out.starts_with("pasted-"));
        // Format: pasted-YYYYMMDD-HHMMSS = 7 + 8 + 1 + 6 = 22 chars
        assert_eq!(out.len(), 22);
    }

    #[test]
    fn strips_extension() {
        assert_eq!(sanitize_filename(Some("foo.png")), "foo");
        assert_eq!(sanitize_filename(Some("a.b.c.jpg")), "a.b.c");
    }

    #[test]
    fn replaces_windows_illegal_chars_with_dash() {
        assert_eq!(sanitize_filename(Some("a/b\\c:d*e?f.png")), "a-b-c-d-e-f");
    }

    #[test]
    fn replaces_internal_whitespace_with_dash() {
        assert_eq!(sanitize_filename(Some("my sketch.png")), "my-sketch");
        assert_eq!(sanitize_filename(Some("a\tb\nc.png")), "a-b-c");
    }

    #[test]
    fn strips_control_chars() {
        let input = "foo\x01bar\x1f.png";
        assert_eq!(sanitize_filename(Some(input)), "foobar");
    }

    #[test]
    fn strips_leading_and_trailing_dots_and_whitespace() {
        assert_eq!(sanitize_filename(Some("  ..foo..  .png")), "foo");
    }

    #[test]
    fn truncates_long_names_to_80_chars() {
        let long = "a".repeat(120) + ".png";
        let out = sanitize_filename(Some(&long));
        assert_eq!(out.chars().count(), 80);
    }

    #[test]
    fn empty_falls_back_to_image() {
        assert_eq!(sanitize_filename(Some("")), "image");
        assert_eq!(sanitize_filename(Some("...")), "image");
        assert_eq!(sanitize_filename(Some("   ")), "image");
    }

    #[test]
    fn nfc_normalizes_combining_marks() {
        // "é" composed (U+00E9) vs decomposed (U+0065 U+0301).
        let decomposed = "e\u{0301}.png";
        let out = sanitize_filename(Some(decomposed));
        assert_eq!(out, "\u{00E9}");
    }
}
```

Add the module to `src-tauri/src/commands/mod.rs`. Find the existing `pub mod` declarations and append:

```rust
pub mod attachments;
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd src-tauri && cargo test --lib commands::attachments::tests
```

Expected: all 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/attachments.rs src-tauri/src/commands/mod.rs
git commit -m "feat(image-import): add sanitize_filename helper with TDD"
```

---

## Task 3: Implement MIME validation + magic-byte sniffing (TDD)

**Files:**
- Modify: `src-tauri/src/commands/attachments.rs`

- [ ] **Step 1: Add validation function with tests**

Append to `src-tauri/src/commands/attachments.rs` (above the existing `#[cfg(test)] mod tests`):

```rust
const ALLOWED_MIMES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/svg+xml",
];

/// Validate that the claimed MIME is whitelisted AND the bytes' magic-bytes
/// match. Returns the canonical extension on success.
pub fn validate_mime(claimed: &str, bytes: &[u8]) -> Result<&'static str, String> {
    if !ALLOWED_MIMES.contains(&claimed) {
        return Err(format!("unsupported mime: {}", claimed));
    }

    // SVG: infer doesn't detect SVG. Sniff manually — must start with
    // either an XML declaration or an <svg root tag, ignoring leading
    // whitespace and an optional UTF-8 BOM.
    if claimed == "image/svg+xml" {
        let head = strip_leading(bytes);
        if head.starts_with(b"<?xml") || head.starts_with(b"<svg") {
            return Ok("svg");
        }
        return Err(format!(
            "file contents do not match claimed mime: {}",
            claimed
        ));
    }

    let detected = infer::get(bytes).map(|t| t.mime_type()).unwrap_or("");
    if detected != claimed {
        return Err(format!(
            "file contents do not match claimed mime: {}",
            claimed
        ));
    }

    Ok(canonical_ext(claimed))
}

fn canonical_ext(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/avif" => "avif",
        "image/svg+xml" => "svg",
        _ => unreachable!("validate_mime gates this"),
    }
}

fn strip_leading(bytes: &[u8]) -> &[u8] {
    let mut b = if bytes.starts_with(b"\xEF\xBB\xBF") {
        &bytes[3..]
    } else {
        bytes
    };
    while let Some((first, rest)) = b.split_first() {
        if first.is_ascii_whitespace() {
            b = rest;
        } else {
            break;
        }
    }
    b
}
```

Add tests inside the existing `mod tests`:

```rust
    /// Minimal PNG signature: 8-byte magic + IHDR chunk header.
    fn fake_png_bytes() -> Vec<u8> {
        let mut v = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        v.extend_from_slice(&[0x00, 0x00, 0x00, 0x0D]);
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&[0; 13]);
        v
    }

    /// Minimal JPEG signature: SOI marker + JFIF filler.
    fn fake_jpeg_bytes() -> Vec<u8> {
        vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, b'J', b'F', b'I', b'F', 0]
    }

    #[test]
    fn rejects_non_whitelisted_mime() {
        let bytes = fake_png_bytes();
        let err = validate_mime("application/pdf", &bytes).unwrap_err();
        assert!(err.contains("unsupported mime"));
    }

    #[test]
    fn accepts_png_with_matching_bytes() {
        let bytes = fake_png_bytes();
        assert_eq!(validate_mime("image/png", &bytes).unwrap(), "png");
    }

    #[test]
    fn accepts_jpeg_with_matching_bytes() {
        let bytes = fake_jpeg_bytes();
        assert_eq!(validate_mime("image/jpeg", &bytes).unwrap(), "jpg");
    }

    #[test]
    fn rejects_png_claim_with_jpeg_bytes() {
        let bytes = fake_jpeg_bytes();
        let err = validate_mime("image/png", &bytes).unwrap_err();
        assert!(err.contains("file contents do not match"));
    }

    #[test]
    fn accepts_svg_with_xml_declaration() {
        let bytes = b"<?xml version=\"1.0\"?><svg></svg>";
        assert_eq!(validate_mime("image/svg+xml", bytes).unwrap(), "svg");
    }

    #[test]
    fn accepts_svg_with_bare_root_tag() {
        let bytes = b"<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        assert_eq!(validate_mime("image/svg+xml", bytes).unwrap(), "svg");
    }

    #[test]
    fn accepts_svg_with_bom_and_whitespace() {
        let bytes = b"\xEF\xBB\xBF\n  <svg></svg>";
        assert_eq!(validate_mime("image/svg+xml", bytes).unwrap(), "svg");
    }

    #[test]
    fn rejects_svg_claim_with_html_payload() {
        let bytes = b"<html><body>nope</body></html>";
        let err = validate_mime("image/svg+xml", bytes).unwrap_err();
        assert!(err.contains("file contents do not match"));
    }
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd src-tauri && cargo test --lib commands::attachments::tests
```

Expected: all tests pass (9 from Task 2 + 8 new).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/attachments.rs
git commit -m "feat(image-import): add validate_mime with magic-byte sniffing"
```

---

## Task 4: Implement size cap + path computation (TDD)

**Files:**
- Modify: `src-tauri/src/commands/attachments.rs`

- [ ] **Step 1: Add functions and tests**

Append to `src-tauri/src/commands/attachments.rs`:

```rust
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;

pub fn check_size_cap(bytes_len: usize) -> Result<(), String> {
    if bytes_len > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "image exceeds 25MB cap (got {} bytes)",
            bytes_len
        ));
    }
    Ok(())
}

/// Compute the absolute disk path and the vault-relative path string for a
/// new attachment. Uses local time for the YYYY/MM segment.
///
/// Returns (absolute_path, vault_rel_with_forward_slashes).
pub fn compute_attachment_path(
    vault_root: &Path,
    safe_basename: &str,
    canonical_ext: &str,
) -> (PathBuf, String) {
    let now = chrono::Local::now();
    let year = now.format("%Y").to_string();
    let month = now.format("%m").to_string();
    let uuid8 = &Uuid::new_v4().simple().to_string()[..8];

    let filename = format!("{}-{}.{}", safe_basename, uuid8, canonical_ext);
    let abs = vault_root
        .join("attachments")
        .join(&year)
        .join(&month)
        .join(&filename);
    let rel = format!("attachments/{}/{}/{}", year, month, filename);
    (abs, rel)
}
```

Add tests inside `mod tests`:

```rust
    #[test]
    fn size_cap_accepts_under_limit() {
        assert!(check_size_cap(1024).is_ok());
        assert!(check_size_cap(MAX_ATTACHMENT_BYTES).is_ok());
    }

    #[test]
    fn size_cap_rejects_over_limit() {
        let err = check_size_cap(MAX_ATTACHMENT_BYTES + 1).unwrap_err();
        assert!(err.contains("exceeds 25MB cap"));
    }

    #[test]
    fn computes_path_with_year_month_and_uuid_suffix() {
        let root = std::path::Path::new("/tmp/vault");
        let (abs, rel) = compute_attachment_path(root, "foo", "png");
        let abs_str = abs.to_string_lossy().to_string();
        assert!(abs_str.contains("attachments"));
        assert!(abs_str.ends_with(".png"));
        let filename = abs.file_name().unwrap().to_string_lossy().to_string();
        assert!(filename.starts_with("foo-"));
        assert_eq!(filename.len(), "foo-".len() + 8 + ".png".len());
        assert!(rel.starts_with("attachments/"));
        assert!(rel.ends_with(".png"));
        assert!(!rel.contains('\\'));
    }

    #[test]
    fn rel_path_year_and_month_match_abs_path() {
        let root = std::path::Path::new("/tmp/vault");
        let (abs, rel) = compute_attachment_path(root, "x", "png");
        let parts: Vec<&str> = rel.split('/').collect();
        let year = parts[1];
        let month = parts[2];
        let abs_str = abs.to_string_lossy().replace('\\', "/");
        assert!(abs_str.contains(&format!("attachments/{}/{}/", year, month)));
    }
```

- [ ] **Step 2: Run tests — verify they pass**

```bash
cd src-tauri && cargo test --lib commands::attachments::tests
```

Expected: all tests pass (17 from prior tasks + 4 new = 21).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/attachments.rs
git commit -m "feat(image-import): add size cap + path computation helpers"
```

---

## Task 5: Implement `save_attachment` Tauri command

**Files:**
- Modify: `src-tauri/src/commands/attachments.rs`

- [ ] **Step 1: Add the Tauri command**

Look at `src-tauri/src/commands/workspace_nodes.rs` for the existing pattern of command imports. Match those.

Append to `src-tauri/src/commands/attachments.rs`:

```rust
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use tauri::AppHandle;

use crate::app_identity::resolve_vault_root;

#[derive(Serialize, Deserialize, Type, Debug)]
pub struct SaveAttachmentInput {
    pub source_node_id: String,
    pub bytes: Vec<u8>,
    pub mime: String,
    pub preferred_name: Option<String>,
}

#[derive(Serialize, Deserialize, Type, Debug)]
pub struct SaveAttachmentOutput {
    /// Vault-relative path with forward slashes.
    /// e.g. "attachments/2026/04/foo-a3b9c2f1.png"
    pub vault_rel_path: String,
    /// Sanitized basename without UUID8 suffix or extension. e.g. "foo"
    pub display_name: String,
    pub bytes_written: u64,
}

#[tauri::command]
#[specta::specta]
pub async fn save_attachment(
    app: AppHandle,
    input: SaveAttachmentInput,
) -> Result<SaveAttachmentOutput, String> {
    let ext = validate_mime(&input.mime, &input.bytes)?;
    check_size_cap(input.bytes.len())?;
    let safe = sanitize_filename(input.preferred_name.as_deref());

    let vault_root = resolve_vault_root(&app);
    if !vault_root.exists() {
        // VaultLock::acquire creates this in production, but be defensive.
        fs::create_dir_all(&vault_root)
            .map_err(|e| format!("vault not initialized: {}", e))?;
    }
    let (abs_path, rel_path) = compute_attachment_path(&vault_root, &safe, ext);

    if let Some(parent) = abs_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to write attachment: {}", e))?;
    }

    // Atomic write: temp + rename. Target never exists (UUID disambiguator),
    // so Windows rename is fine.
    let tmp_path = abs_path.with_extension(format!("{}.tmp", ext));
    fs::write(&tmp_path, &input.bytes)
        .map_err(|e| format!("failed to write attachment: {}", e))?;
    fs::rename(&tmp_path, &abs_path)
        .map_err(|e| format!("failed to write attachment: {}", e))?;

    Ok(SaveAttachmentOutput {
        vault_rel_path: rel_path,
        display_name: safe,
        bytes_written: input.bytes.len() as u64,
    })
}

// Note: we don't unit-test `save_attachment` itself because it requires a
// full Tauri AppHandle. The pure helpers it composes — sanitize_filename,
// validate_mime, check_size_cap, compute_attachment_path — are all covered
// above. End-to-end behaviour is covered by the manual verification in Task 22.
```

- [ ] **Step 2: Verify the crate builds**

```bash
cd src-tauri && cargo build --lib
```

Expected: builds successfully. There will be an unused-warning for `save_attachment` until Task 6 registers it.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/attachments.rs
git commit -m "feat(image-import): implement save_attachment Tauri command"
```

---

## Task 6: Register `save_attachment` in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add to `collect_commands![...]`**

Open `src-tauri/src/lib.rs` and find the `collect_commands![` block (around line 690). Add this line alongside other `commands::...` entries:

```rust
            commands::attachments::save_attachment,
```

- [ ] **Step 2: Build and verify Tauri bindings regenerate**

```bash
cd src-tauri && cargo build --lib
```

Expected: builds successfully. Specta's bindings exporter writes to `src/bindings.ts`, which now includes `saveAttachment`.

Verify by searching:
```bash
grep -n "saveAttachment" C:/AI_knowledge_workspace/Handy-main/src/bindings.ts
```

Expected: at least one match.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs src/bindings.ts
git commit -m "feat(image-import): register save_attachment command in invoke handler"
```

---

## Task 7: ~~Extend tree-scanner ignore rule~~ — **SKIPPED (architecturally unnecessary)**

**Status: not implemented. Skip this task entirely. No code changes. No commit.**

### Why it was skipped (decided 2026-04-26 during execution)

This task was based on a wrong assumption about the architecture. The plan assumed a boot-time filesystem scanner exists in `WorkspaceManager` that walks the vault and populates `workspace_nodes`, with an ignore predicate alongside `.git/` / `.DS_Store` / etc. (per Rule 13a). It was supposed to be extended to skip `<vault>/attachments/`.

**That predicate doesn't exist.** Verified during execution:

```bash
grep -rn "starts_with..\\.\\|DS_Store\|Thumbs.db" src-tauri/src/
# (no boot-time scanner found; Rule 13a's ignore list is referenced in
#  vault-write paths for cloud-sync defensiveness, not in tree population)
```

The tree is **DB-driven, not filesystem-scanned**:
- `workspace_nodes` table is durable across restarts
- The only filesystem-walking code is `import_markdown_folder` in `workspace_manager.rs:3300` — a one-shot user-triggered import command, not a boot scanner
- Tree state is loaded via SQL from the DB on boot, not by walking disk

Since `save_attachment` (Task 5) writes image bytes directly to disk and never inserts a row into `workspace_nodes`, image files **cannot appear in the in-app tree by construction**. The exclusion is automatic.

### Edge case noted but deferred

If a user runs `import_markdown_folder` pointed at their own vault root, the existing markdown-only filter will skip the `.png` files but the `attachments/`, `attachments/2026/`, `attachments/04/` directories themselves would become folder-nodes (clutter). This is a rare workflow; defer the fix as a 4-line patch in a future polish phase. Not blocking image-import.

### Proper home for this work

W10 (Vault Reconcile, designed 2026-04-26) introduces a boot-time vault scanner for the wiped-DB case. That scanner WILL need to skip `attachments/` — the vault-root-scoped ignore rule belongs there, not here. See [`docs/superpowers/specs/2026-04-26-vault-reconcile-design.md`](../specs/2026-04-26-vault-reconcile-design.md) §6.

### What to do for this task

**Nothing.** Move on to Task 8.

---

## Task 8: Implement `parseImageMarkdown` regex helper (TDD)

**Files:**
- Create: `src/editor/imageMarkdown.ts`
- Create: `src/editor/__tests__/imageMarkdown.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/editor/__tests__/imageMarkdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseImageMarkdown } from '../imageMarkdown'

describe('parseImageMarkdown', () => {
  it('parses bare image syntax', () => {
    const r = parseImageMarkdown('![cat](pets/cat.png)')
    expect(r).toEqual({ alt: 'cat', path: 'pets/cat.png', width: null, height: null })
  })

  it('parses image with width', () => {
    const r = parseImageMarkdown('![cat|400](pets/cat.png)')
    expect(r).toEqual({ alt: 'cat', path: 'pets/cat.png', width: 400, height: null })
  })

  it('parses image with width and height', () => {
    const r = parseImageMarkdown('![cat|400x300](pets/cat.png)')
    expect(r).toEqual({ alt: 'cat', path: 'pets/cat.png', width: 400, height: 300 })
  })

  it('parses image with empty alt', () => {
    const r = parseImageMarkdown('![](pets/cat.png)')
    expect(r).toEqual({ alt: '', path: 'pets/cat.png', width: null, height: null })
  })

  it('parses pending placeholder', () => {
    const r = parseImageMarkdown('![Saving image…](pending://abc12345)')
    expect(r).toEqual({ alt: 'Saving image…', path: 'pending://abc12345', width: null, height: null })
  })

  it('returns null for malformed input', () => {
    expect(parseImageMarkdown('![alt(no-bracket.png)')).toBeNull()
    expect(parseImageMarkdown('not an image')).toBeNull()
    expect(parseImageMarkdown('[link](path)')).toBeNull()
  })

  it('ignores trailing whitespace in width', () => {
    const r = parseImageMarkdown('![cat| 400 ](pets/cat.png)')
    expect(r?.width).toBe(400)
  })

  it('handles spaces in alt text', () => {
    const r = parseImageMarkdown('![my cat photo|200](cat.png)')
    expect(r?.alt).toBe('my cat photo')
    expect(r?.width).toBe(200)
  })
})
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
bunx vitest run src/editor/__tests__/imageMarkdown.test.ts
```

Expected: FAIL — `parseImageMarkdown` not defined.

- [ ] **Step 3: Implement the parser**

Create `src/editor/imageMarkdown.ts`:

```ts
export interface ParsedImage {
  alt: string
  path: string
  width: number | null
  height: number | null
}

/**
 * Parse a markdown image expression into its parts. Accepts the canonical
 * `![alt](path)` form plus the Obsidian dimension extensions:
 *   - `![alt|400](path)` — width only
 *   - `![alt|400x300](path)` — width + height
 *
 * Returns null for any malformed input. The widget caller falls back to
 * default rendering when null.
 */
export function parseImageMarkdown(source: string): ParsedImage | null {
  const m = source.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
  if (!m) return null
  const altRaw = m[1]
  const path = m[2].trim()

  const pipeIdx = altRaw.lastIndexOf('|')
  if (pipeIdx === -1) {
    return { alt: altRaw, path, width: null, height: null }
  }

  const alt = altRaw.slice(0, pipeIdx)
  const sizePart = altRaw.slice(pipeIdx + 1).trim()
  const sizeMatch = sizePart.match(/^(\d+)(?:x(\d+))?$/)
  if (!sizeMatch) {
    return { alt: altRaw, path, width: null, height: null }
  }

  const width = parseInt(sizeMatch[1], 10)
  const height = sizeMatch[2] != null ? parseInt(sizeMatch[2], 10) : null
  return { alt, path, width, height }
}
```

- [ ] **Step 4: Run the tests — verify they pass**

```bash
bunx vitest run src/editor/__tests__/imageMarkdown.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/imageMarkdown.ts src/editor/__tests__/imageMarkdown.test.ts
git commit -m "feat(image-import): add parseImageMarkdown helper with TDD"
```

---

## Task 9: Implement `PendingImageWidget`

**Files:**
- Modify: `src/editor/livePreviewWidgets.ts`
- Create: `src/editor/__tests__/imageWidgets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/editor/__tests__/imageWidgets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PendingImageWidget } from '../livePreviewWidgets'

describe('PendingImageWidget', () => {
  it('renders a span with spinner aria-label', () => {
    const w = new PendingImageWidget('abc123')
    const dom = w.toDOM()
    expect(dom.tagName).toBe('SPAN')
    expect(dom.classList.contains('cm-md-image-pending')).toBe(true)
    const spinner = dom.querySelector('.cm-md-image-spinner')
    expect(spinner).not.toBeNull()
    expect(spinner?.getAttribute('aria-label')).toBe('Saving image')
  })

  it('eq returns true for same tempId, false for different', () => {
    const a = new PendingImageWidget('abc123')
    const b = new PendingImageWidget('abc123')
    const c = new PendingImageWidget('xyz789')
    expect(a.eq(b)).toBe(true)
    expect(a.eq(c)).toBe(false)
  })

  it('ignoreEvent returns true (static element)', () => {
    expect(new PendingImageWidget('abc').ignoreEvent()).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
bunx vitest run src/editor/__tests__/imageWidgets.test.ts
```

Expected: FAIL — `PendingImageWidget` not exported.

- [ ] **Step 3: Add the widget**

Append to `src/editor/livePreviewWidgets.ts`:

```ts
/**
 * `PendingImageWidget` renders a spinner placeholder while a freshly pasted
 * image is being written to the vault. The source markdown reads
 * `![Saving image…](pending://<tempId>)`; the live-preview decorator detects
 * the `pending://` scheme and replaces the source span with this widget.
 *
 * Static — pointer events are ignored. The autosave plugin's `pending://`
 * substring guard keeps the placeholder text from being written to disk.
 */
export class PendingImageWidget extends WidgetType {
  constructor(readonly tempId: string) {
    super()
  }

  eq(other: PendingImageWidget): boolean {
    return this.tempId === other.tempId
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-md-image-pending'
    const spinner = document.createElement('span')
    spinner.className = 'cm-md-image-spinner'
    spinner.setAttribute('aria-label', 'Saving image')
    el.appendChild(spinner)
    return el
  }

  ignoreEvent(): boolean {
    return true
  }
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
bunx vitest run src/editor/__tests__/imageWidgets.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/livePreviewWidgets.ts src/editor/__tests__/imageWidgets.test.ts
git commit -m "feat(image-import): add PendingImageWidget"
```

---

## Task 10: Implement `ImageWidget` with `sourcePath` field

**Files:**
- Modify: `src/editor/livePreviewWidgets.ts`
- Modify: `src/editor/__tests__/imageWidgets.test.ts`

Note: `ImageWidget` carries a `sourcePath` field from day one because the resize handler in Task 12 needs the original vault-relative path to rewrite the source line.

- [ ] **Step 1: Write the failing test**

Append to `src/editor/__tests__/imageWidgets.test.ts`:

```ts
import { ImageWidget } from '../livePreviewWidgets'

describe('ImageWidget', () => {
  it('renders an img with src/alt/loading/decoding attributes', () => {
    const w = new ImageWidget(
      'asset://localhost/foo.png',
      'a cat',
      400,
      null,
      0,
      30,
      'attachments/2026/04/foo.png',
    )
    const dom = w.toDOM(null as any)
    expect(dom.classList.contains('cm-md-image-wrap')).toBe(true)
    const img = dom.querySelector('img')!
    expect(img.src).toBe('asset://localhost/foo.png')
    expect(img.alt).toBe('a cat')
    expect(img.getAttribute('loading')).toBe('lazy')
    expect(img.getAttribute('decoding')).toBe('async')
    expect(img.width).toBe(400)
  })

  it('omits width when null', () => {
    const w = new ImageWidget(
      'asset://x.png', '', null, null, 0, 10,
      'attachments/x.png',
    )
    const img = w.toDOM(null as any).querySelector('img')!
    expect(img.hasAttribute('width')).toBe(false)
  })

  it('renders both resize handles', () => {
    const w = new ImageWidget(
      'asset://x.png', '', 200, null, 0, 10,
      'attachments/x.png',
    )
    const handles = w.toDOM(null as any).querySelectorAll('.cm-md-image-handle')
    expect(handles.length).toBe(2)
  })

  it('eq is true only when every field matches', () => {
    const a = new ImageWidget('asset://x.png', 'a', 100, null, 0, 10, 'p.png')
    const b = new ImageWidget('asset://x.png', 'a', 100, null, 0, 10, 'p.png')
    const c = new ImageWidget('asset://x.png', 'a', 200, null, 0, 10, 'p.png')
    expect(a.eq(b)).toBe(true)
    expect(a.eq(c)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
bunx vitest run src/editor/__tests__/imageWidgets.test.ts
```

Expected: FAIL — `ImageWidget` not exported.

- [ ] **Step 3: Implement the widget**

Append to `src/editor/livePreviewWidgets.ts`:

```ts
/**
 * `ImageWidget` replaces a `![alt|w](path)` source span with a real <img>
 * element wrapped in a span carrying hover-revealed corner handles for
 * resizing. On pointer-up after a resize drag, the wrapper dispatches a CM6
 * transaction rewriting `widget.sourceFrom..sourceTo` with the new `|width`
 * value, persisting via autosave.
 *
 * `sourcePath` carries the original vault-relative path from the markdown
 * source so the resize handler can rewrite the source line without
 * round-tripping through the asset URL.
 */
export class ImageWidget extends WidgetType {
  constructor(
    /** Result of `convertFileSrc(absolutePath)` — Tauri asset:// scheme. */
    readonly absSrc: string,
    /** Alt text from the markdown source. May be empty. */
    readonly alt: string,
    /** Width from `|width` syntax, or null for natural size. */
    readonly width: number | null,
    /** Height from `|wxh` syntax, or null. */
    readonly height: number | null,
    /** Doc offset of the leading `!` in the source span. */
    readonly sourceFrom: number,
    /** Doc offset one past the closing `)` in the source span. */
    readonly sourceTo: number,
    /** Original vault-relative path from the markdown source. */
    readonly sourcePath: string,
  ) {
    super()
  }

  eq(other: ImageWidget): boolean {
    return (
      this.absSrc === other.absSrc &&
      this.alt === other.alt &&
      this.width === other.width &&
      this.height === other.height &&
      this.sourceFrom === other.sourceFrom &&
      this.sourceTo === other.sourceTo &&
      this.sourcePath === other.sourcePath
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image-wrap'
    if (this.width != null) wrap.style.width = `${this.width}px`

    const img = document.createElement('img')
    img.className = 'cm-md-image'
    img.src = this.absSrc
    img.alt = this.alt
    img.setAttribute('loading', 'lazy')
    img.setAttribute('decoding', 'async')
    if (this.width != null) img.width = this.width
    if (this.height != null) img.height = this.height

    const handleR = makeResizeHandle('right', view, this)
    const handleBR = makeResizeHandle('bottom-right', view, this)

    wrap.appendChild(img)
    wrap.appendChild(handleR)
    wrap.appendChild(handleBR)
    return wrap
  }

  ignoreEvent(e: Event): boolean {
    if (
      e.target instanceof HTMLElement &&
      e.target.classList.contains('cm-md-image-handle')
    ) {
      return false
    }
    return true
  }
}

/** Stub — replaced in Task 12 with the real pointer-driven resize logic. */
function makeResizeHandle(
  variant: 'right' | 'bottom-right',
  _view: EditorView,
  _widget: ImageWidget,
): HTMLElement {
  const el = document.createElement('span')
  el.className = `cm-md-image-handle cm-md-image-handle--${variant}`
  return el
}
```

Confirm `EditorView` is already imported at the top of the file from `@codemirror/view` (it should be, per the existing widget classes). If not, add the import.

- [ ] **Step 4: Run the test — verify it passes**

```bash
bunx vitest run src/editor/__tests__/imageWidgets.test.ts
```

Expected: 4 new tests pass + 3 from Task 9 = 7 total.

- [ ] **Step 5: Commit**

```bash
git add src/editor/livePreviewWidgets.ts src/editor/__tests__/imageWidgets.test.ts
git commit -m "feat(image-import): add ImageWidget with sourcePath field"
```

---

## Task 11: Wire image branches into livePreview.ts decoration builder

**Files:**
- Modify: `src/editor/livePreview.ts`
- Modify: `src/editor/__tests__/livePreview.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/editor/__tests__/livePreview.test.ts`:

```ts
import { ImageWidget, PendingImageWidget } from '../livePreviewWidgets'

const collectReplaces = (
  state: EditorState,
): Array<{ from: number; to: number; widget: unknown }> => {
  const set = buildLivePreviewDecorations(state)
  const out: Array<{ from: number; to: number; widget: unknown }> = []
  set.between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { widget?: unknown }
    if (spec.widget) out.push({ from, to, widget: spec.widget })
  })
  return out
}

describe('Live Preview: Image widgets', () => {
  it('replaces a markdown image with ImageWidget when caret is off-line', () => {
    const doc = '![cat](attachments/2026/04/cat.png)\nplain'
    const state = mkState(doc, doc.length)
    const replaces = collectReplaces(state)
    const found = replaces.find((r) => r.widget instanceof ImageWidget)
    expect(found).toBeDefined()
    expect(found!.from).toBe(0)
    expect(found!.to).toBe('![cat](attachments/2026/04/cat.png)'.length)
  })

  it('shows source (no widget) when caret is on the image line', () => {
    const doc = '![cat](attachments/cat.png)'
    const state = mkState(doc, 5)
    const replaces = collectReplaces(state)
    const found = replaces.find((r) => r.widget instanceof ImageWidget)
    expect(found).toBeUndefined()
  })

  it('replaces a pending:// link with PendingImageWidget', () => {
    const doc = '![Saving image…](pending://abc12345)\nplain'
    const state = mkState(doc, doc.length)
    const replaces = collectReplaces(state)
    const pending = replaces.find((r) => r.widget instanceof PendingImageWidget)
    expect(pending).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
bunx vitest run src/editor/__tests__/livePreview.test.ts
```

Expected: 3 new tests fail; existing tests still pass.

- [ ] **Step 3: Add a vault-root facet and the Image branch**

In `src/editor/livePreview.ts`, after the existing imports, add:

```ts
import { Facet } from '@codemirror/state'
import { convertFileSrc } from '@tauri-apps/api/core'
import { ImageWidget, PendingImageWidget } from './livePreviewWidgets'
import { parseImageMarkdown } from './imageMarkdown'

/**
 * Facet supplying the absolute vault root path. The Image-widget decoration
 * uses this to resolve vault-relative image paths into absolute file paths
 * for Tauri's asset protocol. MarkdownEditor populates this when it builds
 * the editor extensions (Task 19).
 */
export const vaultRootFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
})
```

Inside `buildLivePreviewDecorations`, find the `// ── Link: [text](url) ──` branch and add a new branch BEFORE it:

```ts
      // ── Image: ![alt|w](path) ──────────────────────────────────
      if (node.name === 'Image') {
        const text = state.doc.sliceString(node.from, node.to)
        const parsed = parseImageMarkdown(text)
        if (!parsed) return
        const onCaretLine = nodeOverlapsLines(node, state, caretLines)
        if (onCaretLine) return

        if (parsed.path.startsWith('pending://')) {
          const tempId = parsed.path.slice('pending://'.length)
          builder.add(
            node.from,
            node.to,
            Decoration.replace({ widget: new PendingImageWidget(tempId) }),
          )
          return
        }

        const vaultRoot = state.facet(vaultRootFacet)
        const absPath = vaultRoot ? `${vaultRoot}/${parsed.path}` : parsed.path
        builder.add(
          node.from,
          node.to,
          Decoration.replace({
            widget: new ImageWidget(
              convertFileSrc(absPath),
              parsed.alt,
              parsed.width,
              parsed.height,
              node.from,
              node.to,
              parsed.path,
            ),
          }),
        )
        return
      }
```

The test helper `mkState` doesn't supply `vaultRootFacet`; the decorator falls back to `parsed.path` directly. The tests assert widget *type*, not src content.

- [ ] **Step 4: Run the tests — verify they pass**

```bash
bunx vitest run src/editor/__tests__/livePreview.test.ts
```

Expected: 3 new tests pass + existing pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/livePreview.ts src/editor/__tests__/livePreview.test.ts
git commit -m "feat(image-import): wire ImageWidget + PendingImageWidget into livePreview"
```

---

## Task 12: Implement resize-handle pointer interaction

**Files:**
- Modify: `src/editor/livePreviewWidgets.ts`

- [ ] **Step 1: Replace the stub `makeResizeHandle`**

In `src/editor/livePreviewWidgets.ts`, replace the stub `makeResizeHandle` with the full version:

```ts
/**
 * Build a resize handle for an ImageWidget. On pointer-down it captures the
 * pointer; pointer-move applies a live width to the wrapper inline style
 * (no transactions during drag — 60fps); pointer-up dispatches one CM6
 * transaction that rewrites the source span with the new width.
 */
function makeResizeHandle(
  variant: 'right' | 'bottom-right',
  view: EditorView,
  widget: ImageWidget,
): HTMLElement {
  const el = document.createElement('span')
  el.className = `cm-md-image-handle cm-md-image-handle--${variant}`

  const MIN_WIDTH = 80
  let active = false
  let startX = 0
  let startWidth = 0
  let wrapper: HTMLElement | null = null

  el.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    wrapper = el.closest('.cm-md-image-wrap') as HTMLElement | null
    if (!wrapper) return
    active = true
    startX = e.clientX
    startWidth = wrapper.getBoundingClientRect().width
    el.setPointerCapture(e.pointerId)
  })

  el.addEventListener('pointermove', (e: PointerEvent) => {
    if (!active || !wrapper) return
    const delta = e.clientX - startX
    const editorWidth =
      wrapper.parentElement?.getBoundingClientRect().width ?? Infinity
    const newWidth = Math.max(
      MIN_WIDTH,
      Math.min(startWidth + delta, editorWidth),
    )
    wrapper.style.width = `${Math.round(newWidth)}px`
  })

  const finish = (e: PointerEvent) => {
    if (!active || !wrapper) return
    active = false
    try {
      el.releasePointerCapture(e.pointerId)
    } catch {
      // pointer already released
    }
    const newWidth = Math.round(wrapper.getBoundingClientRect().width)
    const insert = `![${widget.alt}|${newWidth}](${widget.sourcePath})`
    view.dispatch({
      changes: { from: widget.sourceFrom, to: widget.sourceTo, insert },
      userEvent: 'input.imageresize',
    })
  }
  el.addEventListener('pointerup', finish)
  el.addEventListener('pointercancel', finish)

  return el
}
```

- [ ] **Step 2: Verify the build**

```bash
bun run build
```

Expected: zero new errors.

- [ ] **Step 3: Run all editor tests**

```bash
bunx vitest run src/editor/__tests__/
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/editor/livePreviewWidgets.ts
git commit -m "feat(image-import): implement resize-handle pointer interaction"
```

---

## Task 13: Add CSS for image widgets

**Files:**
- Modify: `src/styles/notes.css`

- [ ] **Step 1: Append image-widget classes**

Append to `src/styles/notes.css`:

```css
/* ── Image embeds (Task 13) ───────────────────────────────────── */

.cm-md-image-wrap {
  position: relative;
  display: inline-block;
  max-width: 100%;
  margin: var(--space-2) 0;
}

.cm-md-image {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-container);
  box-shadow: var(--shadow-sm);
}

.cm-md-image-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--surface-container);
  border: 1px solid var(--heros-rim);
  border-radius: 50%;
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 2;
}

.cm-md-image-handle--right {
  right: -6px;
  top: 50%;
  transform: translateY(-50%);
  cursor: ew-resize;
}

.cm-md-image-handle--bottom-right {
  bottom: -6px;
  right: -6px;
  cursor: nwse-resize;
}

.cm-md-image-wrap:hover .cm-md-image-handle {
  opacity: 0.85;
}

.cm-md-image-pending {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 80px;
  min-height: 80px;
  padding: var(--space-3);
  border-radius: var(--radius-container);
  background: var(--surface-container);
  border: 1px dashed var(--heros-rim);
  margin: var(--space-2) 0;
}

.cm-md-image-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--heros-rim);
  border-top-color: var(--heros-brand);
  border-radius: 50%;
  animation: cm-md-image-spin 800ms linear infinite;
}

@keyframes cm-md-image-spin {
  to { transform: rotate(360deg); }
}
```

All values via tokens (Rule 12).

- [ ] **Step 2: Verify the build succeeds**

```bash
bun run build
```

Expected: zero new errors.

- [ ] **Step 3: Commit**

```bash
git add src/styles/notes.css
git commit -m "feat(image-import): add CSS for image widgets and pending placeholder"
```

---

## Task 14: Implement `nodeIdFacet` for slash-command context

**Files:**
- Create: `src/editor/nodeIdFacet.ts`

- [ ] **Step 1: Create the facet module**

Create `src/editor/nodeIdFacet.ts`:

```ts
import { Facet } from '@codemirror/state'

/**
 * Facet supplying the active workspace-node UUID to every CM6 extension
 * mounted in MarkdownEditor. Used by slash commands and other view-level
 * extensions that need to know which node owns the document.
 *
 * MarkdownEditor populates via `nodeIdFacet.of(nodeId)` when it builds the
 * extensions array per node (Task 19).
 */
export const nodeIdFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? '',
})
```

- [ ] **Step 2: Verify the module compiles**

```bash
bun run build
```

Expected: zero new errors.

- [ ] **Step 3: Commit**

```bash
git add src/editor/nodeIdFacet.ts
git commit -m "feat(image-import): add nodeIdFacet for slash-command context"
```

---

## Task 15: Implement `imageInsert` shared helper

**Files:**
- Create: `src/editor/imageInsert.ts`
- Create: `src/editor/__tests__/imageInsert.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/editor/__tests__/imageInsert.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { GFM } from '@lezer/markdown'

vi.mock('../../bindings', () => ({
  commands: {
    saveAttachment: vi.fn(),
  },
}))

import { commands } from '../../bindings'
import { insertImage } from '../imageInsert'

const mkView = (initialDoc = ''): EditorView => {
  const state = EditorState.create({
    doc: initialDoc,
    extensions: [markdown({ base: markdownLanguage, extensions: [GFM] })],
  })
  const parent = document.createElement('div')
  return new EditorView({ state, parent })
}

describe('insertImage', () => {
  beforeEach(() => {
    vi.mocked(commands.saveAttachment).mockReset()
  })

  it('inserts placeholder, then swaps to real path on success (paste case)', async () => {
    vi.mocked(commands.saveAttachment).mockResolvedValue({
      status: 'ok',
      data: {
        vault_rel_path: 'attachments/2026/04/foo-abc12345.png',
        display_name: 'foo',
        bytes_written: 100,
      },
    })

    const view = mkView('hello\n')
    await insertImage(
      { view, nodeId: 'node-1', insertAt: 6 },
      new Uint8Array([0x89, 0x50, 0x4E, 0x47]),
      'image/png',
      null,
    )

    const doc = view.state.doc.toString()
    expect(doc).toContain('![](attachments/2026/04/foo-abc12345.png)')
    expect(doc).not.toContain('pending://')
  })

  it('uses display_name as alt for drop case', async () => {
    vi.mocked(commands.saveAttachment).mockResolvedValue({
      status: 'ok',
      data: {
        vault_rel_path: 'attachments/2026/04/sketch-abc12345.png',
        display_name: 'sketch',
        bytes_written: 100,
      },
    })

    const view = mkView('hello\n')
    await insertImage(
      { view, nodeId: 'node-1', insertAt: 6 },
      new Uint8Array([0x89, 0x50, 0x4E, 0x47]),
      'image/png',
      'sketch.png',
    )

    expect(view.state.doc.toString()).toContain(
      '![sketch](attachments/2026/04/sketch-abc12345.png)',
    )
  })

  it('removes placeholder line on save failure', async () => {
    vi.mocked(commands.saveAttachment).mockResolvedValue({
      status: 'error',
      error: 'image exceeds 25MB cap',
    })

    const view = mkView('hello\n')
    await insertImage(
      { view, nodeId: 'node-1', insertAt: 6 },
      new Uint8Array([0xFF]),
      'image/png',
      null,
    )

    const doc = view.state.doc.toString()
    expect(doc).not.toContain('pending://')
    expect(doc).not.toContain('Saving image')
    expect(doc.trimEnd()).toBe('hello')
  })
})
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
bunx vitest run src/editor/__tests__/imageInsert.test.ts
```

Expected: FAIL — `insertImage` not defined.

- [ ] **Step 3: Implement the helper**

Create `src/editor/imageInsert.ts`:

```ts
import type { EditorView } from '@codemirror/view'
import { commands } from '../bindings'
import { toast } from 'sonner'

export interface ImageInsertContext {
  view: EditorView
  nodeId: string
  /** Doc offset where the placeholder line should be inserted. */
  insertAt: number
}

const PLACEHOLDER_PREFIX = '\n![Saving image…](pending://'
const PLACEHOLDER_SUFFIX = ')\n'

const newTempId = (): string =>
  crypto.randomUUID().replace(/-/g, '').slice(0, 8)

/**
 * Insert an image at `ctx.insertAt`. Three vectors share this code:
 *   - Paste plugin (preferredName = null → empty alt)
 *   - Drop plugin (preferredName = file.name → display_name alt)
 *   - Slash command (preferredName = picked file basename → display_name alt)
 *
 * Sequence: placeholder line → await Rust write → swap to real path or
 * remove on failure. Autosave is paused for the doc while `pending://` is
 * present (see autosavePlugin guard), so the placeholder bytes never reach
 * disk.
 */
export async function insertImage(
  ctx: ImageInsertContext,
  bytes: Uint8Array,
  mime: string,
  preferredName: string | null,
): Promise<void> {
  const tempId = newTempId()
  const placeholder = `${PLACEHOLDER_PREFIX}${tempId}${PLACEHOLDER_SUFFIX}`

  ctx.view.dispatch({
    changes: { from: ctx.insertAt, insert: placeholder },
    userEvent: 'input.imageinsert',
  })

  const res = await commands.saveAttachment({
    source_node_id: ctx.nodeId,
    bytes: Array.from(bytes),
    mime,
    preferred_name: preferredName,
  })

  // Find the placeholder by tempId — it may have moved if the user kept typing.
  const docText = ctx.view.state.doc.toString()
  const needle = `pending://${tempId}`
  const idx = docText.indexOf(needle)
  if (idx === -1) {
    if (res.status === 'error') {
      toast.error('Image save failed', { description: res.error })
    }
    return
  }
  // Locate the surrounding line.
  const lineStart = docText.lastIndexOf('\n', idx) + 1
  const lineEnd = docText.indexOf('\n', idx)
  const trueEnd = lineEnd === -1 ? docText.length : lineEnd + 1

  if (res.status === 'error') {
    ctx.view.dispatch({
      changes: { from: lineStart - 1, to: trueEnd, insert: '' },
      userEvent: 'input.imageinsert',
    })
    toast.error('Image save failed', { description: res.error })
    return
  }

  const alt = preferredName === null ? '' : res.data.display_name
  const real = `![${alt}](${res.data.vault_rel_path})`

  ctx.view.dispatch({
    changes: {
      from: lineStart,
      to: lineEnd === -1 ? docText.length : lineEnd,
      insert: real,
    },
    userEvent: 'input.imageinsert',
  })
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
bunx vitest run src/editor/__tests__/imageInsert.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/imageInsert.ts src/editor/__tests__/imageInsert.test.ts
git commit -m "feat(image-import): add imageInsert shared helper with TDD"
```

---

## Task 16: Implement autosave pause guard for `pending://`

**Files:**
- Modify: `src/editor/autosavePlugin.ts`
- Modify: `src/editor/__tests__/autosavePlugin.test.ts`

- [ ] **Step 1: Write the failing test**

Open `src/editor/__tests__/autosavePlugin.test.ts` and append:

```ts
describe('autosavePlugin: pending:// pause guard', () => {
  it('does NOT call saver.schedule when doc contains pending://', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const saver = createDebouncedSaver(onSave, 10)
    const dirtyChange = vi.fn()

    const state = EditorState.create({
      doc: '![Saving image…](pending://abc123)\n',
      extensions: [autosavePlugin(saver, dirtyChange)],
    })
    const view = new EditorView({ state, parent: document.createElement('div') })

    view.dispatch({
      changes: { from: view.state.doc.length, insert: 'x' },
      userEvent: 'input.type',
    })

    await new Promise((r) => setTimeout(r, 30))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('calls saver.schedule once doc no longer contains pending://', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const saver = createDebouncedSaver(onSave, 10)
    const dirtyChange = vi.fn()

    const state = EditorState.create({
      doc: '![](attachments/2026/04/foo.png)\n',
      extensions: [autosavePlugin(saver, dirtyChange)],
    })
    const view = new EditorView({ state, parent: document.createElement('div') })

    view.dispatch({
      changes: { from: view.state.doc.length, insert: 'x' },
      userEvent: 'input.type',
    })

    await new Promise((r) => setTimeout(r, 30))
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})
```

If the test file doesn't already have the imports (`EditorState`, `EditorView`, `vi`, `createDebouncedSaver`, `autosavePlugin`), add them.

- [ ] **Step 2: Run the tests — verify the new ones fail**

```bash
bunx vitest run src/editor/__tests__/autosavePlugin.test.ts
```

Expected: first new test fails; existing tests still pass.

- [ ] **Step 3: Add the guard to autosavePlugin**

Modify `src/editor/autosavePlugin.ts`. Replace the `update` method body inside `autosavePlugin`:

```ts
      update(u: ViewUpdate) {
        if (!u.docChanged) return
        const userEdit = u.transactions.some(
          (tr) =>
            tr.isUserEvent('input') ||
            tr.isUserEvent('delete') ||
            tr.isUserEvent('move'),
        )
        if (!userEdit) return
        // Pause while a pending:// placeholder is in the doc — imageInsert
        // resolves it and dirty-marks again, resuming autosave naturally.
        const body = u.state.doc.toString()
        if (body.includes('pending://')) return
        onDirtyChange(true)
        saver.schedule(body)
      }
```

- [ ] **Step 4: Run the tests — verify all pass**

```bash
bunx vitest run src/editor/__tests__/autosavePlugin.test.ts
```

Expected: both new tests pass + existing pass.

- [ ] **Step 5: Commit**

```bash
git add src/editor/autosavePlugin.ts src/editor/__tests__/autosavePlugin.test.ts
git commit -m "feat(image-import): pause autosave while pending:// placeholder is in doc"
```

---

## Task 17: Implement paste + drop handler plugin

**Files:**
- Create: `src/editor/imagePastePlugin.ts`

- [ ] **Step 1: Create the plugin module**

Create `src/editor/imagePastePlugin.ts`:

```ts
import { EditorView } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { insertImage } from './imageInsert'
import { nodeIdFacet } from './nodeIdFacet'

/**
 * Returns true if the doc position lies inside a fenced code block. We
 * fall through to default text paste in that case so users can paste
 * literal `![](...)` source into code samples without us swallowing it.
 */
function isInsideCodeBlock(view: EditorView, pos: number): boolean {
  const tree = syntaxTree(view.state)
  let node: import('@lezer/common').SyntaxNode | null = tree.resolveInner(pos, 1)
  while (node) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock') return true
    node = node.parent
  }
  return false
}

async function handleImageFile(
  view: EditorView,
  file: File,
  insertAt: number,
  preferredName: string | null,
): Promise<void> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  const nodeId = view.state.facet(nodeIdFacet)
  await insertImage(
    { view, nodeId, insertAt },
    bytes,
    file.type,
    preferredName,
  )
}

/**
 * EditorView extension that intercepts clipboard image bytes and dropped
 * image files, routing them through the imageInsert pipeline.
 *
 * - Paste: image clipboard items win over coexisting text payloads
 *   (screenshot tools commonly put both PNG bytes and a path string on the
 *   clipboard).
 * - Drop: image files trigger insert at the drop position; non-image drops
 *   fall through to CM6's default handler.
 */
export const imagePastePlugin = EditorView.domEventHandlers({
  paste(e, view) {
    const items = e.clipboardData?.items
    if (!items) return false
    if (isInsideCodeBlock(view, view.state.selection.main.head)) return false

    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const file = it.getAsFile()
        if (!file) continue
        e.preventDefault()
        const insertAt = view.state.selection.main.head
        void handleImageFile(view, file, insertAt, null)
        return true
      }
    }
    return false
  },

  drop(e, view) {
    const files = e.dataTransfer?.files
    if (!files || files.length === 0) return false
    const imageFiles = Array.from(files).filter((f) =>
      f.type.startsWith('image/'),
    )
    if (imageFiles.length === 0) return false

    e.preventDefault()
    e.stopPropagation()

    const insertAt =
      view.posAtCoords({ x: e.clientX, y: e.clientY }) ??
      view.state.selection.main.head

    if (isInsideCodeBlock(view, insertAt)) return false

    void (async () => {
      let cursor = insertAt
      for (const file of imageFiles) {
        await handleImageFile(view, file, cursor, file.name)
        cursor = view.state.selection.main.head
      }
    })()
    return true
  },
})
```

- [ ] **Step 2: Verify the module compiles**

```bash
bun run build
```

Expected: zero new errors.

- [ ] **Step 3: Commit**

```bash
git add src/editor/imagePastePlugin.ts
git commit -m "feat(image-import): add paste + drop handlers for image files"
```

---

## Task 18: Implement `/image` slash command

**Files:**
- Create: `src/editor/commands/image.ts`
- Modify: `src/editor/slashCommands.ts`

- [ ] **Step 1: Create the slash command**

Create `src/editor/commands/image.ts`:

```ts
import type { SlashCommand } from '../slashCommands'
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'
import { insertImage } from '../imageInsert'
import { nodeIdFacet } from '../nodeIdFacet'
import { toast } from 'sonner'

const EXT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

const mimeFromPath = (path: string): string | null => {
  const dotIdx = path.lastIndexOf('.')
  if (dotIdx === -1) return null
  const ext = path.slice(dotIdx + 1).toLowerCase()
  return EXT_TO_MIME[ext] ?? null
}

const basename = (path: string): string => {
  const sepIdx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return sepIdx === -1 ? path : path.slice(sepIdx + 1)
}

export const imageCommand: SlashCommand = {
  id: 'image',
  label: 'Image',
  aliases: ['image', 'img', 'picture'],
  description: 'Insert an image from your computer',
  category: 'handy',
  run: async (view, from, to) => {
    view.dispatch({ changes: { from, to, insert: '' } })

    const selected = await open({
      multiple: false,
      filters: [
        {
          name: 'Image',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'],
        },
      ],
    })
    if (!selected) return

    const path =
      typeof selected === 'string'
        ? selected
        : Array.isArray(selected) && selected.length > 0
          ? typeof selected[0] === 'string'
            ? selected[0]
            : (selected[0] as { path: string }).path
          : null
    if (!path) return

    const mime = mimeFromPath(path)
    if (!mime) {
      toast.error('Unsupported image type')
      return
    }

    let bytes: Uint8Array
    try {
      bytes = await readFile(path)
    } catch (err) {
      toast.error('Could not read file', { description: String(err) })
      return
    }

    const nodeId = view.state.facet(nodeIdFacet)
    await insertImage(
      { view, nodeId, insertAt: from },
      bytes,
      mime,
      basename(path),
    )
  },
}
```

- [ ] **Step 2: Register in `allSlashCommands`**

Open `src/editor/slashCommands.ts`. Add the import at the top:

```ts
import { imageCommand } from './commands/image'
```

Find the `allSlashCommands` array and add `imageCommand`:

```ts
export const allSlashCommands: SlashCommand[] = [
  ...tier1SlashCommands,
  imageCommand,
  linkCommand,
  todayCommand,
]
```

- [ ] **Step 3: Verify Tauri capabilities**

Look for the capabilities config:

```bash
ls C:/AI_knowledge_workspace/Handy-main/src-tauri/capabilities/
```

Open the relevant capability JSON. Check for `dialog` and `fs` permissions:
- `"dialog:default"` or `"dialog:allow-open"` (already in use elsewhere)
- An `fs:allow-read-file` permission scoped to where the user picks from

If `fs:allow-read-file` is missing, add it. If the existing `fs` capabilities don't allow arbitrary user-picked paths, scope it to `$HOME/**` or surface to the user as a manual config step.

Also check `package.json` for `@tauri-apps/plugin-fs`. If not present, install:

```bash
bun add @tauri-apps/plugin-fs
```

And verify `@tauri-apps/plugin-dialog` is also present.

- [ ] **Step 4: Verify build**

```bash
bun run build
```

Expected: zero new errors.

- [ ] **Step 5: Commit**

```bash
git add src/editor/commands/image.ts src/editor/slashCommands.ts
# include capability + package changes if you made them:
git add src-tauri/capabilities/ package.json bun.lockb 2>/dev/null
git commit -m "feat(image-import): add /image slash command with file picker"
```

---

## Task 19: Wire paste/drop plugin + facets into MarkdownEditor.tsx

**Files:**
- Modify: `src/components/MarkdownEditor.tsx`

- [ ] **Step 1: Import the new pieces**

At the top of `src/components/MarkdownEditor.tsx`, add to the existing imports:

```ts
import { imagePastePlugin } from '../editor/imagePastePlugin'
import { nodeIdFacet } from '../editor/nodeIdFacet'
import { vaultRootFacet } from '../editor/livePreview'
```

`commands` is already imported.

- [ ] **Step 2: Plumb the vault root**

Search the existing commands for one that returns the vault root (or app data dir):

```bash
grep -n "get_app_dir_path\|get_vault\|appDirPath\|vaultRoot" C:/AI_knowledge_workspace/Handy-main/src/bindings.ts
```

Add a state hook near the top of the `MarkdownEditor` component:

```ts
  const [vaultRoot, setVaultRoot] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await commands.getAppDirPath()  // adjust to actual binding
      if (!cancelled && res.status === 'ok') {
        setVaultRoot(res.data)
      }
    })()
    return () => { cancelled = true }
  }, [])
```

If no command returns the vault root, add a tiny `get_vault_root` command in `src-tauri/src/commands/attachments.rs` that wraps `resolve_vault_root(&app)` and returns the path as a `String`. Register it in `lib.rs` alongside `save_attachment`. (Don't add unless needed.)

- [ ] **Step 3: Add the new extensions to the editor build**

Inside the `useEffect` block that builds the CM6 view (around line 178), add to the `extensions` array as the FIRST entries:

```ts
      const extensions = [
        nodeIdFacet.of(nodeId),
        vaultRootFacet.of(vaultRoot),
        imagePastePlugin,
        tooltips({ parent: document.body }),
        // … existing extensions unchanged …
      ]
```

The two facet `.of(...)` entries push values into their respective facets. `imagePastePlugin` is a domEventHandlers extension and needs no `.of(...)`.

- [ ] **Step 4: Re-rebuild on vault root change**

Update the `useEffect` dep array to include `vaultRoot`:

```ts
  }, [nodeId, vaultRoot])
```

This means the editor view rebuilds once when the vault root resolves on boot. Single rebuild per session, transparent to the user.

- [ ] **Step 5: Verify the build**

```bash
bun run build
```

Expected: zero new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/MarkdownEditor.tsx
# if you added a get_vault_root command, include those files too:
git add src-tauri/src/commands/attachments.rs src-tauri/src/lib.rs src/bindings.ts 2>/dev/null
git commit -m "feat(image-import): wire paste/drop plugin and facets into MarkdownEditor"
```

---

## Task 20: HTML `<img>` and wikilink-image read tolerance

**Files:**
- Modify: `src/editor/livePreview.ts`
- Modify: `src/editor/__tests__/livePreview.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/editor/__tests__/livePreview.test.ts`:

```ts
describe('Live Preview: image read tolerance', () => {
  it('renders <img> HTML tag as ImageWidget', () => {
    const doc = '<img src="attachments/foo.png" alt="cat" width="200">\nplain'
    const state = mkState(doc, doc.length)
    const replaces = collectReplaces(state)
    const found = replaces.find((r) => r.widget instanceof ImageWidget)
    expect(found).toBeDefined()
  })

  it('renders Obsidian wikilink-image ![[foo.png]] as ImageWidget', () => {
    const doc = '![[attachments/foo.png]]\nplain'
    const state = mkState(doc, doc.length)
    const replaces = collectReplaces(state)
    const found = replaces.find((r) => r.widget instanceof ImageWidget)
    expect(found).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
bunx vitest run src/editor/__tests__/livePreview.test.ts
```

Expected: 2 new tests fail.

- [ ] **Step 3: Refactor `buildLivePreviewDecorations` to support out-of-order ranges**

The wikilink-image regex pass runs as a flat scan over the doc text and produces ranges that may interleave with tree-iter ranges in unpredictable order. `RangeSetBuilder` requires monotonically increasing `from` order. Refactor the function to collect all decorations into an array, then sort and add:

In `src/editor/livePreview.ts`, restructure `buildLivePreviewDecorations` so every existing `builder.add(from, to, deco)` call inside the `tree.iterate` callback becomes a push into a local array:

```ts
export function buildLivePreviewDecorations(
  state: EditorState,
): DecorationSet {
  const decos: Array<{ from: number; to: number; deco: Decoration }> = []
  const tree: Tree = syntaxTree(state)
  const caretLines = computeCaretLines(state)

  let inFencedCode = 0

  tree.iterate({
    enter(node: SyntaxNode) {
      // Replace all `builder.add(a, b, d)` calls below with
      //   `decos.push({ from: a, to: b, deco: d })`.
      // The branch logic stays identical otherwise.
      // ... existing logic, edited as above ...
    },
    leave(node: SyntaxNode) {
      if (node.name === 'FencedCode') inFencedCode--
    },
  })

  // … HTML <img> and wikilink-image passes go here, also pushing to decos …

  decos.sort((a, b) => a.from - b.from || a.to - b.to)
  const builder = new RangeSetBuilder<Decoration>()
  for (const d of decos) {
    builder.add(d.from, d.to, d.deco)
  }
  return builder.finish()
}
```

This is a mechanical edit — go through every `builder.add(...)` in the existing file and convert it. Confirm tests still pass after the refactor (no behavioural change yet) before moving on.

```bash
bunx vitest run src/editor/__tests__/livePreview.test.ts
```

Expected: existing tests still pass; the 2 new tests still fail (no read-tolerance branches yet).

- [ ] **Step 4: Add the HTML `<img>` branch**

In the `tree.iterate` callback, add this branch BEFORE the `Image` branch:

```ts
      if (node.name === 'HTMLBlock' || node.name === 'HTMLTag') {
        const text = state.doc.sliceString(node.from, node.to).trim()
        const m = text.match(
          /^<img\s+[^>]*src=["']([^"']+)["'][^>]*?(?:alt=["']([^"']*)["'])?[^>]*?(?:width=["']?(\d+)["']?)?[^>]*\/?\s*>$/i,
        )
        if (m) {
          const onCaretLine = nodeOverlapsLines(node, state, caretLines)
          if (onCaretLine) return
          const path = m[1]
          const alt = m[2] ?? ''
          const width = m[3] ? parseInt(m[3], 10) : null
          const vaultRoot = state.facet(vaultRootFacet)
          const absPath = vaultRoot ? `${vaultRoot}/${path}` : path
          decos.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({
              widget: new ImageWidget(
                convertFileSrc(absPath),
                alt,
                width,
                null,
                node.from,
                node.to,
                path,
              ),
            }),
          })
          return
        }
      }
```

- [ ] **Step 5: Add the wikilink-image regex pass**

After the `tree.iterate` block (and before the sort + builder), add:

```ts
  // Obsidian wikilink-image: ![[path.ext]] — Lezer doesn't natively
  // recognize this; flat-scan the doc text.
  const wikilinkImageRe =
    /!\[\[([^\]]+\.(?:png|jpe?g|gif|webp|avif|svg))\]\]/gi
  const docText = state.doc.toString()
  for (const m of docText.matchAll(wikilinkImageRe)) {
    const from = m.index ?? 0
    const to = from + m[0].length
    const fromLine = state.doc.lineAt(from).number
    const toLine = state.doc.lineAt(to).number
    let onCaretLine = false
    for (let n = fromLine; n <= toLine; n++) {
      if (caretLines.has(n)) { onCaretLine = true; break }
    }
    if (onCaretLine) continue
    const path = m[1]
    const vaultRoot = state.facet(vaultRootFacet)
    const absPath = vaultRoot ? `${vaultRoot}/${path}` : path
    decos.push({
      from,
      to,
      deco: Decoration.replace({
        widget: new ImageWidget(
          convertFileSrc(absPath),
          '',
          null,
          null,
          from,
          to,
          path,
        ),
      }),
    })
  }
```

- [ ] **Step 6: Run the tests — verify all pass**

```bash
bunx vitest run src/editor/__tests__/livePreview.test.ts src/editor/__tests__/imageWidgets.test.ts
```

Expected: all pass — 2 new + everything from prior tasks.

- [ ] **Step 7: Commit**

```bash
git add src/editor/livePreview.ts src/editor/__tests__/livePreview.test.ts
git commit -m "feat(image-import): accept HTML <img> and wikilink-image on read"
```

---

## Task 21: Verify full test suite + production build

**Files:** none

- [ ] **Step 1: Run all frontend tests**

```bash
cd C:/AI_knowledge_workspace/Handy-main && bunx vitest run
```

Expected: all tests pass (existing + ~25 new).

- [ ] **Step 2: Run all Rust tests**

```bash
cd src-tauri && cargo test --lib
```

Expected: all tests pass (125 baseline + new tests from Tasks 2-4 + 7).

- [ ] **Step 3: Production build**

```bash
cd C:/AI_knowledge_workspace/Handy-main && bun run build
```

Expected: zero new errors. Bundle valid.

- [ ] **Step 4: Type check**

```bash
bunx tsc --noEmit
```

Expected: zero new errors.

If anything fails: surface the failure to the user and ask before reverting any files. Per the operational rule at the top of this plan, never `git reset` or `git restore` without explicit confirmation.

---

## Task 22: End-to-end manual verification

**Files:** none — purely runtime verification. **No commit.**

- [ ] **Step 1: Boot the app**

```bash
cd C:/AI_knowledge_workspace/Handy-main && bun run tauri dev
```

Wait for the window. Open or create a note.

- [ ] **Step 2: Paste a screenshot**

- Take a screenshot (PrtSc on Windows, Cmd+Shift+4 on macOS)
- Click into the editor body
- Press Cmd/Ctrl+V

**Expected:**
- Spinner widget appears within 100ms
- Resolves within ~1s on a typical SSD
- Final render shows the image at natural size with `max-width: 100%` clamping
- Markdown source (visible when caret enters the line) reads `![](attachments/2026/04/pasted-YYYYMMDD-HHMMSS-XXXXXXXX.png)`
- The file exists at that path on disk
- A clean save (no `pending://`) lands in the vault `.md` after the swap

- [ ] **Step 3: Drop an image file**

- Open Finder/Explorer, locate any PNG or JPEG file
- Drag onto the editor body

**Expected:**
- Image inserts at the drop position
- Markdown source reads `![<sanitized-name>](attachments/2026/04/<sanitized-name>-XXXXXXXX.<ext>)`
- File on disk has the expected name + suffix

- [ ] **Step 4: Use the `/image` slash command**

- Type `/image` at a line start
- Pick a file from the dialog

**Expected:**
- Image inserts at the caret
- Same path/source pattern as drop

- [ ] **Step 5: Resize via corner handles**

- Hover over an inserted image
- Two handles fade in (right edge + bottom-right corner)
- Drag the right handle leftward

**Expected:**
- Image width shrinks live during the drag (no transactions yet — pure CSS)
- On release, the markdown source updates from `![](path)` to `![|<width>](path)`
- Autosave fires shortly after; vault `.md` reflects the new width

- [ ] **Step 6: Reject oversized image**

- Find or create a >25MB image
- Try to paste/drop/insert it

**Expected:**
- Spinner appears briefly
- Toast error: "Image save failed — image exceeds 25MB cap (got <bytes> bytes)"
- Placeholder line is removed; doc returns to the pre-paste state

- [ ] **Step 7: Vault visibility check**

- Open Finder/Explorer at `<app_data>/infield-vault/`
- Confirm `attachments/` folder is visible (not hidden)
- Open the in-app workspace tree
- Confirm `attachments` does NOT appear as a tree node

- [ ] **Step 8: Obsidian round-trip**

- Open the same vault directory in Obsidian
- Open the doc that contains the image
- **Expected:** image renders inline at the same width
- In Obsidian, resize the image (drag a corner)
- Switch back to Infield, open the same doc
- **Expected:** the new width is reflected (Infield's `get_node` mtime check on tab-switch should pick up the change; confirm the conflict banner does or does not fire — both are acceptable, but document which)

- [ ] **Step 9: Delete-doc-keeps-image check**

- Create a doc with an image
- Move the doc to trash (Delete key on the tree)
- **Expected:** the image file at `attachments/...` REMAINS on disk (no auto-delete)

- [ ] **Step 10: Document results**

If any expectation fails, surface to the user. Do not revert any code.

If all 9 checks pass, the feature is verified end-to-end.

---

## Self-Review

**Spec coverage:** Each numbered section of the spec maps to at least one task.
- §1 goal → all tasks
- §2 non-goals → not implemented (correctly)
- §3 architecture → Tasks 5+15+19
- §4 storage → Tasks 4+5+7
- §5 syntax → Tasks 8+11+20
- §6 Rust command → Tasks 2-6
- §7 frontend pipelines → Tasks 14+15+17+18+19
- §8 widgets → Tasks 9-12
- §9 autosave → Task 16
- §10 tree-ignore → Task 7
- §11 edge cases → covered across handlers (paste fence-block, drop non-image, save-failure)
- §12 perf → CSS + `loading="lazy"` in Tasks 10+13
- §13 files → all touched
- §14 DoD → Tasks 21+22
- §15 OOS → not implemented

**Placeholder scan:** No "TBD"/"TODO"/"implement later". Every step has actual code or commands.

**Type consistency:** `ImageWidget` carries `sourcePath` from Task 10 onward — every test and call site (Tasks 11, 12, 20) uses the 7-arg constructor. `SaveAttachmentInput` / `SaveAttachmentOutput` shapes match between Rust (Task 5) and TypeScript test mocks (Task 15). `nodeIdFacet` and `vaultRootFacet` consumed only where defined.

**Known unknowns flagged for execution:**
- Task 7: existing tree-scanner predicate name + signature (worker greps to find)
- Task 18: existence of `@tauri-apps/plugin-fs` and necessary fs capability (worker checks + adds if needed)
- Task 19: existing command for "get vault root" — worker greps; adds a tiny new command if none exists

These are explicit and resolved at execution time, not unspecified work.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-image-import.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a 22-task plan because each subagent has clean context and you only review the diffs that matter.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review. Slower but you see every tool call.

**Which approach?**
