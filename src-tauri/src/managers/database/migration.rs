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

    Ok(report)
}
