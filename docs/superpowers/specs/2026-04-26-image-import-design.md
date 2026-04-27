# Image Import — Design

> **Phase**: extension to W2 Notes wiring · **Status**: design · **Author**: brainstormed 2026-04-26
>
> **Companions**: [PLAN.md](../../../PLAN.md) · [CLAUDE.md](../../../CLAUDE.md) Rules 10/13/14/22/23 · [W2 Notes spec](2026-04-23-w2-notes-wiring-design.md)

## 1. Goal

Let users embed images in notes the way they already do in Obsidian / Notion / AppFlowy:

- **Paste** a screenshot from the clipboard → image appears at the caret
- **Drag and drop** an image file from Finder/Explorer → image appears where dropped
- **Slash command `/image`** → file picker → image appears at the caret
- **Resize** by dragging a corner handle on the rendered image
- **Round-trip with Obsidian** — same vault opens cleanly in either app

Bytes land in the vault as plain files; the markdown body references them with vanilla `![alt|width](path)` syntax. No proprietary block model, no DB rows for images.

## 2. Non-goals (v1)

- **No CLIP/image-embedding pipeline.** Images are opaque bytes. Searchability comes from the alt text written in the markdown body, which `workspace_fts` and `vec_embeddings` already index.
- **No drag-to-reposition handle.** Cut/paste of the markdown line moves an image. Add a vertical drag handle in a polish phase if it becomes a real friction point.
- **No text-wrap-around-image (CSS float).** None of Obsidian/Notion/AppFlowy do this by default; we follow their precedent. Block-level only.
- **No side-by-side image galleries.** Non-standard markdown extension; deferred.
- **No content-hash deduplication.** Every paste writes a new file. Storage cleanup is a future GC sweep.
- **No `attachments` SQLite table.** Vault filesystem stays the source of truth for image bytes (Invariant #1).
- **No image-content search (CLIP).** Future work behind Rule 16/16a; deferred until LLM infra lands.
- **No `<img>` HTML emit.** We accept HTML on read but only emit `![alt|width](path)`.
- **No drag-from-browser (URL drop).** If a user drops a remote URL, fall through to default text-drop; we don't auto-download.
- **No automatic image conversion** (HEIC → JPEG, etc.). Reject unsupported formats with a toast; user converts.

## 3. Architecture overview

Four insertion points, one shared backend command, one shared insertion helper:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (CM6)                                 │
│                                                                             │
│  paste plugin ─┐                                                            │
│  drop plugin  ─┼──► imageInsert(view, bytes, mime, name) ──► dispatch CM6   │
│  /image cmd  ─┘    (1) insert pending://<id> placeholder                    │
│                    (2) await commands.saveAttachment(...)                   │
│                    (3) on resolve: swap pending:// → real path              │
│                    (4) on reject: remove placeholder + toast                │
│                                                                             │
│  livePreviewPlugin                                                          │
│   ├─ Image lezer node ─────► ImageWidget (renders <img>)                    │
│   ├─ pending:// link  ─────► PendingImageWidget (renders spinner)           │
│   └─ corner-handle drag ───► dispatch transaction rewriting │width          │
│                                                                             │
│  autosavePlugin                                                             │
│   └─ pause when doc contains pending:// (5-line guard)                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │ Tauri invoke
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        src-tauri/src/commands/                              │
│                                                                             │
│  attachments.rs ──► save_attachment(node_id, bytes, mime, preferred_name)   │
│   (1) validate MIME against whitelist                                       │
│   (2) magic-byte sniff (infer crate) — must match claimed MIME              │
│   (3) enforce 25MB size cap                                                 │
│   (4) sanitize preferred_name → safe_basename                               │
│   (5) compute path: <vault>/attachments/YYYY/MM/<name>-<uuid8>.<ext>        │
│   (6) atomic write: temp + fs::rename                                       │
│   (7) return { vault_rel_path, display_name, bytes_written }                │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
                  <vault>/attachments/2026/04/foo-a3b9c2f1.png
                  (visible to OS; skipped by tree scanner)
```

## 4. Storage layout

### 4.1 Path

```
<vault_root>/attachments/<YYYY>/<MM>/<sanitized-name>-<uuid8>.<ext>
```

- `<vault_root>` = canonical vault root from `resolve_vault_root()` ([src-tauri/src/app_identity.rs:14](../../../src-tauri/src/app_identity.rs))
- `<YYYY>/<MM>` keeps a single folder from accumulating thousands of files. Computed from local time at write.
- `<sanitized-name>` derived per §6.3.
- `<uuid8>` = first 8 hex chars of a fresh UUIDv4 — disambiguates same-name pastes within the same minute.
- `<ext>` = canonical extension for the validated MIME (`.png`, `.jpg`, `.gif`, `.webp`, `.avif`, `.svg`).

### 4.2 Folder visibility

`attachments/` is **not** dot-prefixed. The folder is fully visible to:

- Finder / Explorer / OS file managers
- iCloud / Dropbox / OneDrive sync clients
- Obsidian (which scans the vault by default)
- Any external tooling

It is **automatically absent** from the in-app workspace tree because the tree is **DB-driven, not filesystem-scanned**. The tree reads from `workspace_nodes` table rows; image files written by `save_attachment` never get a row inserted (per §4.3 — no DB row for images), so they cannot appear in the tree by construction.

**No ignore-list filter is needed.** This was originally planned (extending a `WorkspaceManager` ignore predicate alongside the existing `.git/` / `.DS_Store` rules per Rule 13a) but that predicate doesn't exist in this codebase — there is no boot-time filesystem scanner that walks the vault and populates `workspace_nodes`. The tree state is durable across restarts in SQLite.

(W10 — Vault Reconcile, designed separately at [docs/superpowers/specs/2026-04-26-vault-reconcile-design.md](2026-04-26-vault-reconcile-design.md) — will introduce a boot-time scanner for the wiped-DB case. **That** scanner will need to skip `attachments/`, and is the right place to apply the vault-root-scoped ignore rule. Out of scope for image-import.)

### 4.3 No DB row for images

Images live as filesystem-only artefacts. We do **not** insert rows into `workspace_nodes` for them. Rationale:

- They have no body to edit, no children, no properties → don't fit any of the existing `node_type` variants (Rule 11)
- Adding a new `node_type='attachment'` would fork tree, navigation, vault sync, and search logic for marginal benefit
- The markdown body already carries the reference; that's enough to find usages later

Garbage collection of orphan attachment files (image written, then markdown reference deleted) is **deferred** to a future sweep. Out of scope here.

## 5. Markdown syntax

### 5.1 Emit format (always)

```markdown
![alt text](attachments/2026/04/foo-a3b9c2f1.png)
![alt text|400](attachments/2026/04/foo-a3b9c2f1.png)
```

- No `|` → image renders at natural size, clamped by CSS `max-width: 100%; height: auto`
- `|400` → image renders at exactly 400px wide, height auto-scaled to preserve aspect ratio
- `|400x250` → both dimensions explicit (Obsidian extension; we accept on read but don't emit by default — corner-drag only adjusts width)

### 5.2 Read tolerance (Postel's law)

The live-preview widget recognises three input forms:

| Form | Where it comes from | Treatment |
|---|---|---|
| `![alt](path)` and `![alt\|w](path)` and `![alt\|wxh](path)` | Our emit; Obsidian; Logseq | Render via `ImageWidget` |
| `<img src="path" alt="..." width="..." />` | Pasted from CommonMark/HTML sources; Typora; GitHub | Render via `ImageWidget`; on next user-driven resize, emit gets rewritten to `\|width` form |
| `![[path]]` | Pasted from Obsidian wikilink-image mode | Render via `ImageWidget` (separate Lezer-bypass branch — Lezer treats this as our wikilink, so the widget detects the `.png/.jpg/...` extension and overrides) |

The widget never converts existing source on its own. Rewrites happen only when the user drags the resize handle, at which point the line is rewritten to the canonical `![alt|width](path)` form.

### 5.3 Path encoding

Markdown link path is **vault-relative without leading slash**:

```markdown
![sketch](attachments/2026/04/foo-a3b9c2f1.png)   ✓ what we emit
![sketch](/attachments/...)                       ✗ never
![sketch](../../attachments/...)                  ✗ never
```

Rationale:

- Survives doc moves with zero work — the path string never changes when `move_node` updates `vault_rel_path` for the document
- Obsidian resolves it correctly out of the box
- Matches the convention in this codebase (we treat the vault as a virtual root)

The widget resolves at render time:

```ts
const abs = `${vaultRoot}/${linkPath}`        // join, normalize, NFC
const src = convertFileSrc(abs)                // tauri asset:// scheme
img.src = src
```

GitHub viewing the raw markdown will show broken images for any doc not at vault root. Acceptable — the vault is not a publishing target.

### 5.4 Initial alt text

| Insert vector | Default alt |
|---|---|
| Paste from clipboard | empty (`![](...)`) — clipboard has no name |
| Drop file | sanitized filename minus UUID8 minus extension (`my-sketch`) |
| `/image` picker | sanitized filename minus UUID8 minus extension |

User can edit the alt text inline once the caret enters the image's line (live-preview shows source).

## 6. Rust command surface

### 6.1 New file

`src-tauri/src/commands/attachments.rs`

### 6.2 Command signature

```rust
#[derive(Serialize, Deserialize, Type)]
pub struct SaveAttachmentInput {
    /// UUID of the workspace node owning the paste/drop (informational; used
    /// for logging only — file path is computed from vault root, not the
    /// node's location).
    pub source_node_id: String,
    /// Raw image bytes from clipboard / DataTransfer / dialog read.
    pub bytes: Vec<u8>,
    /// MIME type as claimed by the source. Must match magic-byte sniff.
    pub mime: String,
    /// Optional original filename from drop / picker. None for clipboard paste.
    pub preferred_name: Option<String>,
}

#[derive(Serialize, Deserialize, Type)]
pub struct SaveAttachmentOutput {
    /// Vault-relative path with forward slashes, no leading slash.
    /// e.g. "attachments/2026/04/foo-a3b9c2f1.png"
    pub vault_rel_path: String,
    /// Sanitized basename without UUID8 suffix or extension.
    /// Suitable for default alt text. e.g. "foo"
    pub display_name: String,
    /// Bytes actually written to disk (post-validation).
    pub bytes_written: u64,
}

#[tauri::command]
#[specta::specta]
pub async fn save_attachment(
    state: State<'_, AppState>,
    input: SaveAttachmentInput,
) -> Result<SaveAttachmentOutput, String>;
```

Registered in `src-tauri/src/lib.rs` `collect_commands![...]` block alongside the workspace-node commands.

### 6.3 Validation pipeline

```
1. mime ∈ ALLOWED_MIMES
   └─ ALLOWED_MIMES = {image/png, image/jpeg, image/gif, image/webp,
                       image/avif, image/svg+xml}
   └─ on miss: return Err("unsupported mime: {mime}")

2. bytes.len() ≤ 25 * 1024 * 1024
   └─ on over: return Err("image exceeds 25MB cap")

3. infer::get(&bytes) — magic-byte sniff
   ├─ matches mime → proceed
   ├─ for SVG: bytes start with "<?xml" or "<svg" (infer doesn't handle SVG;
   │   manual check)
   └─ on mismatch: return Err("file contents do not match claimed mime: {mime}")

4. sanitize_filename(preferred_name) → safe_basename
   ├─ if preferred_name is None (clipboard paste): generate
   │   "pasted-YYYYMMDD-HHMMSS" from local time; skip rest of sanitization
   ├─ unicode NFC normalize
   ├─ strip the file extension if present (we re-attach the canonical
   │   extension for the validated MIME at step 5)
   ├─ pre-trim leading/trailing whitespace and dots
   ├─ map chars: Windows-illegal (/\:*?"<>|) AND whitespace → '-'
   │   (must run BEFORE the control-char filter; \t and \n are control
   │    chars in Rust, so filtering first would silently delete tabs
   │    and newlines instead of replacing them with '-')
   ├─ filter out remaining control chars (< 0x20)
   ├─ trim leading/trailing whitespace and dots again (cleans up edge
   │   cases like all-illegal-char input becoming "---")
   ├─ truncate to 80 chars
   └─ if empty: fall back to "image"

5. compute path:
   <vault>/attachments/<local_now.year>/<local_now.month:02>/<safe>-<uuid8>.<ext>

6. atomic write:
   tmp = path + ".tmp"
   fs::write(&tmp, &bytes)?
   fs::rename(&tmp, &path)?           // first write — target never exists,
                                      //   so Windows rename is fine

7. return { vault_rel_path, display_name, bytes_written }
```

Steps 1–3 short-circuit; on any rejection, no file touches the disk.

### 6.4 Error mapping

| Case | Returned `Err(...)` |
|---|---|
| Unknown MIME | `"unsupported mime: <mime>"` |
| Size cap | `"image exceeds 25MB cap (got <bytes> bytes)"` |
| Magic-byte mismatch | `"file contents do not match claimed mime: <mime>"` |
| IO failure (disk full, permissions) | `"failed to write attachment: <io error>"` |
| Vault root unreachable | `"vault not initialized"` |

Frontend toasts the message verbatim; no localization in v1 (all command errors in this codebase are English-only today).

## 7. Frontend insertion pipelines

### 7.1 Shared insertion helper

`src/editor/imageInsert.ts` (new)

```ts
export interface ImageInsertContext {
  view: EditorView
  nodeId: string
  insertAt: number      // doc offset where to insert
}

export async function insertImage(
  ctx: ImageInsertContext,
  bytes: Uint8Array,
  mime: string,
  preferredName: string | null,
): Promise<void>
```

Sequence:

1. Generate temp id: `tempId = crypto.randomUUID().slice(0, 8)`
2. Dispatch a transaction inserting `\n![Saving image…](pending://${tempId})\n` at `insertAt`
3. `await commands.saveAttachment({ source_node_id, bytes: Array.from(bytes), mime, preferred_name })`
4. Locate the placeholder line by searching for `pending://${tempId}` in the current doc (it may have moved if the user kept typing; CM6 transaction mapping handles this when we hold the position via a `StateField<{ tempId, mark: RangeSet<MarkDecoration> }>`)
5. **On success**: dispatch a transaction replacing the placeholder line with `![${alt}](${vault_rel_path})`, where `alt` is `''` for paste (caller passed `preferredName === null`) and `display_name` for drop/picker (caller passed a non-null name). Autosave resumes naturally on the next dirty mark.
6. **On error**: dispatch a transaction removing the placeholder line entirely; toast `Save failed — ${error}`

The state field tracking pending IDs lives in the same module so all three insert pipelines share it.

### 7.2 Paste pipeline

`src/editor/imagePastePlugin.ts` (new)

```ts
EditorView.domEventHandlers({
  paste(e, view) {
    const items = e.clipboardData?.items
    if (!items) return false
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        e.preventDefault()
        const file = it.getAsFile()
        if (!file) return true
        // bytes via file.arrayBuffer(); insert at caret
        void handlePaste(view, file)
        return true
      }
    }
    return false   // not an image — let CM6 handle text paste normally
  },
})
```

Decision: **image bytes win over coexisting text payload.** Screenshot tools commonly put both PNG bytes and a "PNG file path" string on the clipboard; users who paste a screenshot expect the image, not the path.

### 7.3 Drop pipeline

Same plugin, `drop` handler:

```ts
drop(e, view) {
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return false   // text drop — let CM6 handle
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
  if (imageFiles.length === 0) return false        // non-image files — let CM6 handle
  e.preventDefault()
  e.stopPropagation()
  // Compute drop position via view.posAtCoords({ x: e.clientX, y: e.clientY })
  // Insert each image sequentially at successive positions
  void handleDropList(view, imageFiles, e.clientX, e.clientY)
  return true
}
```

Critical: only `preventDefault()` when we're handling images. Text drops fall through to CM6's default text-paste behaviour.

### 7.4 Slash command

`src/editor/commands/image.ts` (new)

```ts
import { open } from '@tauri-apps/plugin-dialog'
import { readFile } from '@tauri-apps/plugin-fs'

export const imageCommand: SlashCommand = {
  id: 'image',
  label: 'Image',
  aliases: ['image', 'img', 'picture'],
  description: 'Insert an image from your computer',
  category: 'handy',
  run: async (view, from, to) => {
    // Remove the /image trigger text first
    view.dispatch({ changes: { from, to, insert: '' } })
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Image', extensions: ['png','jpg','jpeg','gif','webp','avif','svg'] }],
    })
    if (!selected) return
    const path = typeof selected === 'string' ? selected : selected[0]
    const bytes = await readFile(path)
    const mime = mimeFromExt(path)        // small lookup table
    const name = basename(path)
    await insertImage({ view, nodeId, insertAt: from }, bytes, mime, name)
  },
}
```

Added to `allSlashCommands` in [src/editor/slashCommands.ts](../../../src/editor/slashCommands.ts).

The `nodeId` available to the slash command runner is plumbed through the `MarkdownEditor` props by extending the `SlashCommand.run` signature with an optional context arg, or by putting `nodeId` into a CM6 facet. (Implementation detail — settle in the plan phase.)

**Tauri capability requirement**: this command depends on `@tauri-apps/plugin-dialog` (already used elsewhere) and `@tauri-apps/plugin-fs` `readFile`. Verify both are listed in `src-tauri/capabilities/*.json` and `package.json`; add an `fs:read-file` capability scoped to the user's filesystem if not already present. Plan phase confirms before implementation.

## 8. CM6 image widget

### 8.1 New widgets in `livePreviewWidgets.ts`

```ts
export class ImageWidget extends WidgetType {
  constructor(
    readonly absSrc: string,        // convertFileSrc result
    readonly alt: string,
    readonly width: number | null,
    readonly height: number | null,
    readonly sourceFrom: number,    // doc offset of `!`
    readonly sourceTo: number,      // doc offset after `)`
  ) { super() }

  eq(other: ImageWidget): boolean {
    return this.absSrc === other.absSrc
        && this.alt === other.alt
        && this.width === other.width
        && this.height === other.height
        && this.sourceFrom === other.sourceFrom
        && this.sourceTo === other.sourceTo
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-md-image-wrap'
    if (this.width != null) wrap.style.width = `${this.width}px`

    const img = document.createElement('img')
    img.className = 'cm-md-image'
    img.src = this.absSrc
    img.alt = this.alt
    img.loading = 'lazy'
    img.decoding = 'async'
    if (this.width != null) img.width = this.width
    if (this.height != null) img.height = this.height

    const handleR = makeResizeHandle('right', view, this)
    const handleBR = makeResizeHandle('bottom-right', view, this)

    wrap.append(img, handleR, handleBR)
    return wrap
  }

  ignoreEvent(e: Event): boolean {
    // Allow pointer events to reach the resize handles; ignore everything else
    return !(e.target instanceof HTMLElement && e.target.classList.contains('cm-md-image-handle'))
  }
}

export class PendingImageWidget extends WidgetType {
  constructor(readonly tempId: string) { super() }
  eq(other: PendingImageWidget): boolean { return this.tempId === other.tempId }
  toDOM(): HTMLElement {
    const el = document.createElement('span')
    el.className = 'cm-md-image-pending'
    const spinner = document.createElement('span')
    spinner.className = 'cm-md-image-spinner'
    spinner.setAttribute('aria-label', 'Saving image')
    el.appendChild(spinner)
    return el
  }
  ignoreEvent(): boolean { return true }
}
```

### 8.2 Decoration builder additions in `livePreview.ts`

Inside the existing `tree.iterate` enter callback, after the `Link` branch:

```ts
// ── Image: ![alt|w](path) ──────────────────────────────────────
if (node.name === 'Image') {
  const text = state.doc.sliceString(node.from, node.to)
  const parsed = parseImageMarkdown(text)        // small regex helper
  if (!parsed) return                             // malformed; let CM6 default
  const onCaretLine = nodeOverlapsLines(node, state, caretLines)
  if (onCaretLine) {
    // Editing mode — leave source visible, no widget
    return
  }
  if (parsed.path.startsWith('pending://')) {
    builder.add(node.from, node.to, Decoration.replace({
      widget: new PendingImageWidget(parsed.path.slice('pending://'.length)),
    }))
    return
  }
  const abs = resolveVaultRelative(parsed.path)   // injects via facet
  builder.add(node.from, node.to, Decoration.replace({
    widget: new ImageWidget(
      convertFileSrc(abs),
      parsed.alt,
      parsed.width ?? null,
      parsed.height ?? null,
      node.from,
      node.to,
    ),
  }))
  return
}
```

Plus a separate branch for HTML `<img>` (Lezer node `HTMLBlock` / `HTMLTag`) and one for wikilink-image (detected by extension on a wikilink span before the wikilink completion handler claims it).

### 8.3 Resize-handle interaction

Pointer-down on a `.cm-md-image-handle`:

1. Capture pointer (`setPointerCapture`)
2. Record `startX`, `startWidth = wrapper.getBoundingClientRect().width`
3. On `pointermove`: `newWidth = clamp(startWidth + (e.clientX - startX), 80, editorWidth)`. Apply to wrapper inline style for live feedback. Don't dispatch CM6 transactions yet — too noisy.
4. On `pointerup`: `releasePointerCapture`. Dispatch a single CM6 transaction that rewrites `widget.sourceFrom..sourceTo` from `![alt|<old>](path)` to `![alt|<round(newWidth)>](path)`.
5. Autosave's debounce picks up the change and persists.

Resize granularity is free-form (1px). Width stored as integer pixels. No height adjustment in v1 — height auto-scales to preserve aspect ratio.

**`|wxh` source on resize**: if the source already had `![alt|400x250](path)` (Obsidian dual-dimension form, accepted on read per §5.2), the rewrite drops the height and emits `![alt|<newWidth>](path)`. Aspect ratio is preserved by the natural image dimensions; the explicit height was redundant once width is set. Documented as expected behaviour, not a regression.

### 8.4 CSS

`src/styles/notes.css` additions:

```css
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
  cursor: ew-resize;
}
.cm-md-image-handle--bottom-right { cursor: nwse-resize; bottom: -6px; right: -6px; }
.cm-md-image-handle--right { right: -6px; top: 50%; transform: translateY(-50%); }
.cm-md-image-wrap:hover .cm-md-image-handle { opacity: 0.8; }

.cm-md-image-pending {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 80px;
  min-height: 80px;
  border-radius: var(--radius-container);
  background: var(--surface-container);
  border: 1px dashed var(--heros-rim);
}
.cm-md-image-spinner {
  width: 24px; height: 24px;
  border: 2px solid var(--heros-rim);
  border-top-color: var(--heros-brand);
  border-radius: 50%;
  animation: cm-md-spinner 800ms linear infinite;
}
@keyframes cm-md-spinner { to { transform: rotate(360deg); } }
```

All values via tokens (Rule 12).

## 9. Autosave coordination

`src/editor/autosavePlugin.ts` is extended with one guard:

```ts
function hasPendingPlaceholder(view: EditorView): boolean {
  // Cheap: V8 substring search; sub-millisecond for typical doc sizes
  return view.state.doc.toString().includes('pending://')
}

// Inside the existing scheduling logic:
if (hasPendingPlaceholder(view)) {
  // Don't schedule autosave; the imageInsert pipeline will dirty-mark again
  // after the placeholder is replaced with the real path.
  return
}
```

Five lines. Once the placeholder is replaced, the next document change re-schedules the saver normally.

The string-match `'pending://'` is unambiguous — `pending://` won't appear in user-typed content unless they're being adversarial, and even then the worst case is "autosave is paused until they delete that string."

## 10. Ignore rule for the tree scanner

In `WorkspaceManager` (file walk that hydrates `workspace_nodes`), extend the existing ignore predicate:

```rust
fn is_ignored_dir(parent: &Path, name: &str, vault_root: &Path) -> bool {
    if name.starts_with('.') { return true }                  // existing
    if name.eq_ignore_ascii_case("Thumbs.db") { return true } // existing
    // … existing rules (Rule 13a) …

    // New: skip <vault>/attachments/ but only at the vault root.
    if parent == vault_root && name == "attachments" { return true }

    false
}
```

Locality matters: the rule applies **only to the literal `<vault>/attachments/` directory**, not to any descendant folder a user happens to name `attachments`.

## 11. Edge cases and decisions

| Case | Decision |
|---|---|
| Clipboard has both PNG bytes and a text path string | Image wins; we `preventDefault()` and skip the text branch |
| User drops a non-image file | Plugin returns `false`, CM6 handles text drop normally |
| User drops a remote URL | Plugin returns `false`, CM6 inserts the URL as text; no auto-download |
| User pastes into a fenced code block | Detect via Lezer `FencedCode` ancestor; fall through to default text paste so the user gets the literal `![](...)` source |
| User undoes after a successful insert | Standard CM6 undo reverts the editor text; the file stays on disk. Orphans accumulate; a future GC sweep cleans them. Same as Obsidian. |
| `save_attachment` rejects (size/mime/disk) | Placeholder line is removed; toast shows the Rust error verbatim. No partial state. |
| User closes the tab while upload is pending | Pending placeholder line is in the editor's in-memory doc, autosave is paused, so on tab close the unfinished line is discarded. The Rust write may still complete and leave an orphan file — acceptable; future GC. |
| Image file disappears between save and render | `<img>` shows browser-default broken-image icon; alt text remains visible. No app crash, no data loss. |
| Cloud sync delays an image arriving on this device | Same broken-image fallback. Refresh / focus event re-resolves once the file materialises. Aligned with Rule 14's no-watcher policy. |
| Same `preferred_name` pasted twice in the same minute | UUID8 disambiguator means filenames never collide. |
| User edits the markdown body in Obsidian while we're open | Rule 13 conflict guard catches it on next autosave; user resolves via existing banner. Image references that Obsidian wrote (`![](attachments/...)` or `![[...]]`) render correctly via the read-tolerance rules in §5.2. |

## 12. Performance

| Path | Target |
|---|---|
| Paste of a 2MB PNG → markdown link inserted | < 250ms (mostly Rust write + asset-protocol first paint) |
| Live-preview rebuild on caret move in a doc with 50 images | < 16ms (existing decoration builder budget) |
| Initial paint of a doc with 50 images | < 200ms (lazy-loading does most of the work) |
| Resize drag — frame rate during pointermove | 60fps (no transactions during drag, only on pointerup) |

Lazy loading + async decode (`loading="lazy" decoding="async"`) keep memory bounded for image-heavy docs.

## 13. Files affected

### New files
- `src-tauri/src/commands/attachments.rs` — `save_attachment` command + validation helpers
- `src/editor/imageInsert.ts` — shared insertion helper + pending-id state field
- `src/editor/imagePastePlugin.ts` — paste + drop DOM handlers
- `src/editor/commands/image.ts` — `/image` slash command

### Modified files
- `src-tauri/src/lib.rs` — register `save_attachment` and `get_vault_root` in `collect_commands![...]`
- `src-tauri/src/commands/mod.rs` — `pub mod attachments;`
- `src-tauri/Cargo.toml` — add `infer = "0.16"` dependency
- `src-tauri/capabilities/default.json` — extend `fs:scope` to allow `$HOME`/`$DESKTOP`/`$DOCUMENT`/`$DOWNLOAD`/`$PICTURE` paths (so the `/image` slash command can `readFile` user-picked images)
- `src/editor/slashIcons.ts` — register `Image` lucide icon for the `/image` menu entry

(`workspace_manager.rs` ignore-predicate change removed — see §4.2; not needed because the tree is DB-driven, not filesystem-scanned.)
- `src/editor/livePreview.ts` — add `Image` / HTML-img / wikilink-image branches; add `pending://` widget branch
- `src/editor/livePreviewWidgets.ts` — add `ImageWidget` + `PendingImageWidget`
- `src/editor/autosavePlugin.ts` — 5-line `hasPendingPlaceholder` guard
- `src/editor/slashCommands.ts` — add `imageCommand` to `allSlashCommands`
- `src/components/MarkdownEditor.tsx` — register the new paste/drop plugin in the extensions array; pass `nodeId` into the slash-command context (small plumbing)
- `src/styles/notes.css` — new image-widget classes (§8.4)

### Untouched (intentionally)
- `src/bindings.ts` — auto-regenerated by specta on next `bun run tauri dev`
- `src-tauri/src/managers/workspace/vault/*` — vault writes for image bytes go through the new dedicated command, not through document-write paths

## 14. Definition of Done

1. `bun run build` passes with zero new errors
2. `bunx vitest run` — new tests covering: paste of valid PNG, paste with magic-byte mismatch, drop of non-image (fall-through), `/image` slash command, resize handle rewriting `|width`, autosave pause while `pending://` exists, widget render of HTML `<img>` and wikilink-image
3. `cargo test --lib` — new tests covering: `sanitize_filename` rules, MIME validation, magic-byte sniff, size cap, atomic write path
4. Manual verification in `bun run tauri dev`:
   - Paste a screenshot → image renders inline within ~1s; spinner visible briefly
   - Drag a PNG from Finder/Explorer → image inserts at drop position
   - `/image` → file picker → image inserts at caret
   - Hover an inserted image → corner handles appear; drag → width persists in source after release
   - Open the same vault in Obsidian → images render at the same widths
   - Soft-delete a doc that references an image → image file remains on disk (not removed)
5. Performance targets in §12 met on a 50-image stress doc
6. No new hardcoded colour/radius/shadow literals — all via tokens (Rule 12)
7. New components in flat `src/components/` (none in this design — all editor work is under `src/editor/`)
8. The extended workspace tree-ignore rule is unit-tested (vault-root scoping)

## 15. Out-of-scope (deferred)

- Drag-handle to reposition image lines vertically
- Side-by-side image galleries / multi-image rows
- Per-image alt-text editor UI (it's editable inline by entering the line — sufficient for v1)
- Text wrap around floated images
- Animated GIF playback control (browser handles autoplay; pause-on-hover is polish)
- Content-hash deduplication
- Garbage collection of orphan attachment files
- HEIC / BMP / TIFF support
- CLIP image-content embedding for visual search
- A dedicated "Attachments" view (browse all images in vault, find unused, replace globally)
- Image annotation / drawing / cropping

Each is independently scoped and can land in a future polish phase without disturbing this design.
