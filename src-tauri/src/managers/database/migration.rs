//! One-shot boot migration: backfills `workspace_nodes` mirrors for `databases`
//! rows that lack one, and sweeps orphan `<vault>/<id>.db.json` files (left
//! over from the retired `write_json` flow) into `<vault>/.handy/legacy-db-json/`.
//! Idempotent — safe to call on every boot, fast no-op when clean.

use std::sync::Arc;

use log::{info, warn};

use super::manager::DatabaseManager;
use crate::managers::workspace::vault::format::slugify;
use crate::managers::workspace::vault::VaultManager;
use crate::managers::workspace::workspace_manager::WorkspaceManager;

#[derive(Default, Debug)]
pub struct MigrationReport {
    pub mirrors_created: usize,
    pub row_mirrors_created: usize,
    pub legacy_files_moved: usize,
    /// Pre-W4-cleanup vault artifacts (inline-CSV `databases/<slug>.md`,
    /// `databases/<slug>/cards/`, `board.md`, `calendar.md`) moved to
    /// `<vault>/.handy/legacy-db-files/`.
    pub legacy_layout_files_moved: usize,
}

/// Run the W4 database-mirror migration. See module docs.
pub async fn run_database_mirror_migration(
    db_mgr: &Arc<DatabaseManager>,
    ws_mgr: &Arc<WorkspaceManager>,
    vm: &Arc<VaultManager>,
) -> Result<MigrationReport, String> {
    let mut report = MigrationReport::default();

    // 1. Backfill workspace_nodes mirrors for any database lacking one.
    let listed = db_mgr
        .list_databases(None)
        .await
        .map_err(|e| e.to_string())?;
    for (id, name, _icon, _count) in &listed {
        let need_mirror = ws_mgr
            .get_node(id)
            .await
            .map_err(|e| e.to_string())?
            .is_none();

        // Collision-aware slug. Computed once per database so the database
        // mirror and any row mirrors below stay in the same folder. Multiple
        // databases sharing a base slug (e.g. several "Untitled database"
        // entries) each get their own `<slug>-<short_id>` directory.
        let base_slug = slugify(name);
        let final_slug = crate::managers::workspace::vault::database_md::resolve_db_slug(
            vm.vault_root_path(),
            &base_slug,
            id,
        );

        if need_mirror {
            let vault_rel_path = format!("databases/{final_slug}/database.md");
            ws_mgr
                .upsert_workspace_mirror_node(
                    id, None, "database", name, "", 1.0, "{}", &vault_rel_path,
                )
                .await
                .map_err(|e| format!("backfill mirror for {id}: {e}"))?;
            // Best-effort: write database.md so the vault matches the new layout.
            // Failures are tolerable — vault drift recovers next boot.
            if let Err(e) = vm.export_database_md(id, ws_mgr, db_mgr).await {
                warn!("export_database_md during migration failed for '{id}': {e}");
            }
            report.mirrors_created += 1;
            info!("Migrated legacy database '{id}' ({name}) into workspace_nodes");
        }

        // Backfill row mirrors. For each row in db_rows lacking a mirror,
        // upsert one. Position uses iteration index — db_rows ORDER BY position
        // already returns them in the right order.
        let row_ids = db_mgr.get_rows(id).await.map_err(|e| e.to_string())?;
        for (idx, row_id) in row_ids.iter().enumerate() {
            let need_row_mirror = ws_mgr
                .get_node(row_id)
                .await
                .map_err(|e| e.to_string())?
                .is_none();

            if need_row_mirror {
                let row_slug = &row_id[..row_id.len().min(8)];
                let vault_rel_path = format!("databases/{final_slug}/rows/{row_slug}.md");
                ws_mgr
                    .upsert_workspace_mirror_node(
                        row_id, Some(id), "row", "", "", idx as f64, "{}", &vault_rel_path,
                    )
                    .await
                    .map_err(|e| format!("backfill row mirror for {row_id}: {e}"))?;
                report.row_mirrors_created += 1;
            }
        }
    }

    // 2. Sweep orphan `<vault>/<id>.db.json` files into the legacy folder.
    //    Per Invariant #2, never silent-delete; preserve for forensics.
    let vault_root = vm.vault_root_path();
    if let Ok(entries) = std::fs::read_dir(vault_root) {
        let legacy_dir = vault_root.join(".handy").join("legacy-db-json");
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(fname) = path.file_name().and_then(|n| n.to_str()) else { continue };
            if !fname.ends_with(".db.json") {
                continue;
            }
            // Cloud-sync defensiveness (Rule 14): skip 0-byte placeholders so
            // we don't move a file that hasn't materialised yet.
            if let Ok(meta) = std::fs::metadata(&path) {
                if meta.len() == 0 {
                    info!("Deferring legacy file '{fname}' (cloud-sync placeholder)");
                    continue;
                }
            }
            std::fs::create_dir_all(&legacy_dir).ok();
            let dest = legacy_dir.join(fname);
            match std::fs::rename(&path, &dest) {
                Ok(()) => {
                    report.legacy_files_moved += 1;
                    info!("Moved legacy '{fname}' to .handy/legacy-db-json/");
                }
                Err(e) => warn!("Could not move legacy file '{fname}': {e}"),
            }
        }
    }

    // 3. Quarantine pre-W4-cleanup vault layout artifacts. Data is already in
    //    database.db; these files are stale projections that the new importer
    //    won't read after Commit E. Per Invariant #2, move don't delete.
    quarantine_legacy_layout(vault_root, &mut report);

    Ok(report)
}

/// Sweep `<vault>/databases/` for pre-W4-cleanup layout artifacts and move
/// them into `<vault>/.handy/legacy-db-files/`. Idempotent — files already in
/// the legacy folder aren't double-moved; the legacy folder isn't created if
/// nothing matches.
///
/// What it moves:
/// - `databases/<slug>.md` (legacy inline-CSV table) when a sibling
///   `databases/<slug>/database.md` exists (means the database has been
///   re-exported under the new layout, so the flat file is stale).
/// - `databases/<slug>/cards/` (any contents — legacy board card directory)
/// - `databases/<slug>/board.md` (legacy board aggregate)
/// - `databases/<slug>/calendar.md` (legacy calendar aggregate)
fn quarantine_legacy_layout(vault_root: &std::path::Path, report: &mut MigrationReport) {
    let databases_dir = vault_root.join("databases");
    if !databases_dir.is_dir() {
        return;
    }
    let legacy_root = vault_root.join(".handy").join("legacy-db-files");

    let Ok(entries) = std::fs::read_dir(&databases_dir) else { return };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(fname) = path.file_name().and_then(|n| n.to_str()) else { continue };

        if path.is_file() && fname.ends_with(".md") {
            // Candidate: `databases/<slug>.md`. Only move when sibling
            // `databases/<slug>/database.md` exists — otherwise this is a
            // pre-cleanup database whose data hasn't been re-projected yet,
            // and quarantining would orphan it.
            let stem = fname.trim_end_matches(".md");
            let sibling_dir = databases_dir.join(stem);
            let new_layout_marker = sibling_dir.join("database.md");
            if !new_layout_marker.is_file() {
                continue;
            }
            move_to_legacy(&path, &legacy_root.join("databases").join(fname), report);
            continue;
        }

        if path.is_dir() {
            let cards_dir = path.join("cards");
            if cards_dir.is_dir() {
                let dest = legacy_root.join("databases").join(fname).join("cards");
                move_to_legacy(&cards_dir, &dest, report);
            }
            let board_md = path.join("board.md");
            if board_md.is_file() {
                let dest = legacy_root.join("databases").join(fname).join("board.md");
                move_to_legacy(&board_md, &dest, report);
            }
            let calendar_md = path.join("calendar.md");
            if calendar_md.is_file() {
                let dest = legacy_root.join("databases").join(fname).join("calendar.md");
                move_to_legacy(&calendar_md, &dest, report);
            }
        }
    }
}

fn move_to_legacy(
    src: &std::path::Path,
    dest: &std::path::Path,
    report: &mut MigrationReport,
) {
    // Cloud-sync defensiveness (Rule 14): skip 0-byte placeholders.
    if let Ok(meta) = std::fs::metadata(src) {
        if meta.is_file() && meta.len() == 0 {
            info!("Deferring legacy '{}' (cloud-sync placeholder)", src.display());
            return;
        }
    }
    // Idempotency: if a previous run already moved this, leave both alone —
    // never overwrite forensic snapshots.
    if dest.exists() {
        info!("Legacy '{}' already preserved at '{}'", src.display(), dest.display());
        return;
    }
    if let Some(parent) = dest.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            warn!("Could not create legacy dir '{}': {e}", parent.display());
            return;
        }
    }
    match std::fs::rename(src, dest) {
        Ok(()) => {
            report.legacy_layout_files_moved += 1;
            info!("Moved legacy '{}' to '{}'", src.display(), dest.display());
        }
        Err(e) => warn!("Could not move legacy '{}': {e}", src.display()),
    }
}

#[cfg(test)]
mod quarantine_tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn write(p: &std::path::Path, content: &str) {
        if let Some(parent) = p.parent() { fs::create_dir_all(parent).unwrap(); }
        fs::write(p, content).unwrap();
    }

    #[test]
    fn moves_inline_csv_when_sibling_directory_exists() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        // Legacy inline-CSV file alongside the new layout directory.
        write(&root.join("databases/foo.md"), "---\nid: db-1\n---\nlegacy");
        write(&root.join("databases/foo/database.md"), "---\nid: db-1\n---\nnew");

        let mut report = MigrationReport::default();
        quarantine_legacy_layout(root, &mut report);

        assert_eq!(report.legacy_layout_files_moved, 1);
        assert!(!root.join("databases/foo.md").exists());
        assert!(root.join(".handy/legacy-db-files/databases/foo.md").exists());
        // New layout untouched.
        assert!(root.join("databases/foo/database.md").exists());
    }

    #[test]
    fn skips_inline_csv_when_no_sibling_directory() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        // Legacy file with no migrated sibling — leave it alone (data not re-projected yet).
        write(&root.join("databases/orphan.md"), "---\nid: db-2\n---\nlegacy");

        let mut report = MigrationReport::default();
        quarantine_legacy_layout(root, &mut report);

        assert_eq!(report.legacy_layout_files_moved, 0);
        assert!(root.join("databases/orphan.md").exists());
    }

    #[test]
    fn moves_cards_dir_board_md_calendar_md() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&root.join("databases/foo/database.md"), "x");
        write(&root.join("databases/foo/cards/abc.md"), "card");
        write(&root.join("databases/foo/board.md"), "board");
        write(&root.join("databases/foo/calendar.md"), "cal");
        // A legitimate row should NOT be touched.
        write(&root.join("databases/foo/rows/row-12345678.md"), "row");

        let mut report = MigrationReport::default();
        quarantine_legacy_layout(root, &mut report);

        assert_eq!(report.legacy_layout_files_moved, 3);
        assert!(!root.join("databases/foo/cards").exists());
        assert!(!root.join("databases/foo/board.md").exists());
        assert!(!root.join("databases/foo/calendar.md").exists());
        // Row file preserved.
        assert!(root.join("databases/foo/rows/row-12345678.md").exists());
        // Quarantine destinations exist.
        assert!(root.join(".handy/legacy-db-files/databases/foo/cards/abc.md").exists());
        assert!(root.join(".handy/legacy-db-files/databases/foo/board.md").exists());
        assert!(root.join(".handy/legacy-db-files/databases/foo/calendar.md").exists());
    }

    #[test]
    fn idempotent_does_not_overwrite_existing_quarantine() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&root.join("databases/foo/database.md"), "x");
        write(&root.join("databases/foo/board.md"), "second-run");
        // Pretend a previous run already quarantined a different version.
        write(
            &root.join(".handy/legacy-db-files/databases/foo/board.md"),
            "first-run",
        );

        let mut report = MigrationReport::default();
        quarantine_legacy_layout(root, &mut report);

        assert_eq!(report.legacy_layout_files_moved, 0);
        // Source untouched (collision means already preserved).
        assert!(root.join("databases/foo/board.md").exists());
        // Existing quarantine preserved verbatim.
        assert_eq!(
            fs::read_to_string(root.join(".handy/legacy-db-files/databases/foo/board.md")).unwrap(),
            "first-run"
        );
    }

    #[test]
    fn no_databases_dir_is_silent_noop() {
        let tmp = TempDir::new().unwrap();
        let mut report = MigrationReport::default();
        quarantine_legacy_layout(tmp.path(), &mut report);
        assert_eq!(report.legacy_layout_files_moved, 0);
        assert!(!tmp.path().join(".handy").exists());
    }

    #[test]
    fn skips_zero_byte_cloud_sync_placeholder() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();
        write(&root.join("databases/foo/database.md"), "x");
        // 0-byte file — cloud-sync placeholder, don't move yet.
        write(&root.join("databases/foo/board.md"), "");

        let mut report = MigrationReport::default();
        quarantine_legacy_layout(root, &mut report);

        assert_eq!(report.legacy_layout_files_moved, 0);
        assert!(root.join("databases/foo/board.md").exists());
    }
}
