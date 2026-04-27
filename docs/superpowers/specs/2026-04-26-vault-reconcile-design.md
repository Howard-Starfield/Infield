# Vault Reconcile — Design Stub

> **Phase**: W10 (proposed) · **Status**: design stub — captured during image-import implementation 2026-04-26 · **Author**: brainstormed mid-stream when the user noticed wiped-DB does not repopulate from vault
>
> **This is a stub, not a final spec.** Captures the architectural decision (frontmatter is the source of node identity, two-tier reconcile is the shape) so we don't have to re-derive it later. A proper spec runs through the full brainstorm flow when this phase is scheduled.

---

## 1. Goal

Honor Invariant #1 ("the vault is source of truth") at boot time. When the vault contains `.md` files but `workspace_nodes` is empty (or drifted), reconstruct the index from disk so the user sees their notes. Today, a wiped DB or a fresh install with an existing vault produces an empty tree — a direct contradiction of Invariant #1.

## 2. Non-goals (v1)

- **No live filesystem watcher.** Rule 14 still applies. Reconcile happens at boot + on explicit user action, not continuously.
- **No automatic deletion of DB rows whose vault file disappeared.** Soft-mark as orphan; let the user decide. Cloud-sync delays are real.
- **No conflict resolution UI for duplicate frontmatter `id` collisions.** First-encountered wins; second is logged as an issue. Rare, deferred.
- **No multi-vault reconciliation.** Single active vault.

## 3. Why this is tractable

Every `.md` file in the vault carries full identity in YAML frontmatter (verified at [src-tauri/src/managers/workspace/workspace_manager.rs:1732](../../../src-tauri/src/managers/workspace/workspace_manager.rs)):

```
---
id: <uuid>
parent_id: <uuid or "null">
title: ...
icon: ...
created_at: <rfc3339>
updated_at: <rfc3339>
properties_json: '...'
vault_version: 1
---
<body>
```

UUIDs are stable across wipe → reconstruct cycles. Wikilinks (`node://uuid`) keep working. The parent-child tree is recoverable from the `parent_id` field. No information loss on rebuild.

## 4. Architecture — two-tier reconcile

```
boot
  ├─ count rows in workspace_nodes WHERE deleted_at IS NULL
  │
  ├─ if 0  → FULL SCAN
  │           wiped-DB / fresh-install / restored-backup case
  │           walk vault, parse frontmatter, INSERT preserving all fields
  │
  └─ if >0 → DRIFT CHECK
              cheap stat-hash comparison
              ├─ hash matches stored sentinel → trust DB, no walk
              └─ hash differs → reconcile only the drifted subset
```

**Stat-hash sentinel:** A small `vault_index_meta` table stores a hash of the vault tree's stat metadata (file paths + mtimes + sizes for every `.md` file under the vault root, excluding ignored dirs). Computed cheaply with no file body reads. Hash mismatch = something changed externally.

## 5. Reconcile rules

| Vault state | DB state | Action |
|---|---|---|
| `.md` file present, frontmatter has `id` | No row matches that `id` | INSERT row from frontmatter — body, parent_id, title, icon, timestamps, properties all preserved |
| `.md` file present, frontmatter parse-fail or no `id` | n/a | Log warning, surface in "Vault issues" panel, skip |
| `.md` file present, mtime > stored DB `updated_at` | Row exists for that `id` | Mark `body_dirty=true`; next `get_node` re-reads body from disk |
| `.md` file present, frontmatter `id` matches existing row but `vault_rel_path` differs | Row exists | Update `vault_rel_path` (file was moved externally) |
| Two `.md` files share the same frontmatter `id` | Row exists for that `id` | Log conflict; first-encountered wins; second surfaces in "Vault issues" panel |
| DB row exists, vault file missing | n/a | **Soft-mark as orphan** (do NOT delete row, do NOT delete data). Surface in "Vault issues" panel. Cloud-sync can be slow; user decides. |

## 6. Skipped during scan

Existing Rule 13a ignore list, plus image-import's `attachments/`:
- Hidden dirs (`.git/`, `.handy/`, anything starting with `.`)
- `attachments/` at vault root (image-import storage)
- Cloud-sync detritus: `*.icloud`, `*.tmp`, `* (conflict *).md`, `*.conflicted.md`
- Windows system files: `Thumbs.db`, `desktop.ini`
- Non-markdown files (only `.md` / `.markdown` / `.mdx` are considered)

## 7. Files affected (rough sketch)

### New files
- `src-tauri/src/managers/vault_reconcile.rs` — full-scan + drift-check + reconcile pipeline (~250 lines)
- Migration adding `vault_index_meta` table (id, vault_stat_hash, last_reconciled_at)

### Modified files
- `src-tauri/src/lib.rs` — call reconcile on boot, after `VaultLock::acquire` and `WorkspaceManager::new`, before window show
- `src-tauri/src/managers/workspace/workspace_manager.rs` — expose helpers for INSERT-preserving-uuid path
- Frontend: a "Vault issues" surface (small banner or settings page) for orphan rows + parse-failures + id collisions

## 8. Performance targets

| Path | Target |
|---|---|
| Stat-hash compute on warm boot, 1k nodes | < 50ms |
| Full scan + insert on cold boot, 1k nodes | < 1s |
| Full scan + insert, 10k nodes | < 4s |
| Drift reconcile, 50 changed files out of 10k | < 200ms |

## 9. Open questions for the proper spec round

- **Stat-hash algorithm**: blake3 of sorted `(rel_path, mtime, size)` tuples? Cheap, deterministic, salt-free. Or simpler — count + sum-of-mtimes? Robustness vs speed tradeoff.
- **Body-dirty vs eager re-read**: when an mtime drift is detected, do we re-read the body immediately or lazily? Lazy is safer (one large file shouldn't block boot); eager catches issues earlier.
- **Orphan UX**: a small banner ("3 notes are missing from your vault — review") vs a Settings page entry vs both? How prominent?
- **Boot blocking**: does the user see the LoadingScreen until reconcile completes, or do we show the (stale) tree immediately and reconcile in the background? Eager-block is correct for empty-DB; background is correct for drift-check.
- **Reconcile during cloud-sync materialization**: an `.icloud` placeholder file appears as zero bytes. Sniff and skip; don't try to parse frontmatter from a zero-byte file (it'd register as parse-fail). Tie to Rule 13a's `+3s` cloud-sync grace.

## 10. Trigger conditions

This phase becomes urgent when:
- A user actually loses confidence ("did my notes get deleted?") after a DB wipe — **already happened to Howard 2026-04-26, the trigger event**
- Multi-device sync is enabled (cloud-sync of vault between two installs of the app) — gates on this design
- Importing an existing vault from a backup is a documented user workflow — currently doesn't work cleanly

## 11. Sequencing

**Does NOT block image-import (currently in flight).** Image-import works correctly in the steady-state case (DB has rows, files match). Vault reconcile makes the system more robust to wipe/drift but isn't a prerequisite.

**Recommended order:** finish image-import → land vault reconcile next (W10) → revisit any dependent work.

## 12. To do before promoting to a real spec

- Run through `superpowers:brainstorming` flow:
  - Stat-hash algorithm decision (one round of clarifying questions)
  - Orphan UX shape
  - Boot-blocking decision
- Verify frontmatter `id` is present in every node type that lives as `.md` (rows, calendar entries, board items — confirm format.rs / database_md.rs / row writer all emit `id`)
- Confirm migration ordering for `vault_index_meta` table (after Phase A migrations)
- Estimate test surface (unit + integration); plan for a 1k-file fixture vault for benchmarks
