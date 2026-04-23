pub mod board;
pub mod calendar;
pub mod format;
pub mod import;
pub mod table;

use std::path::PathBuf;
use serde_json::Value;
use format::parse_fields;

use crate::managers::workspace::WorkspaceManager;

/// Orchestrates vault export for all database layouts.
/// Does not hold any database connection — all reads go through WorkspaceManager.
pub struct VaultManager {
    pub vault_root: PathBuf,
}

impl VaultManager {
    pub fn new(vault_root: PathBuf) -> Self {
        // Ensure the databases directory exists
        let _ = std::fs::create_dir_all(vault_root.join("databases"));
        Self { vault_root }
    }

    /// Export one database to the vault. Dispatches to table/board/calendar based on
    /// the primary view layout. Returns all written paths (relative to vault_root).
    pub async fn export_database(
        &self,
        db_id: &str,
        workspace_manager: &WorkspaceManager,
    ) -> Result<Vec<PathBuf>, String> {
        let db = workspace_manager
            .get_node(db_id)
            .await?
            .ok_or_else(|| format!("Database '{}' not found", db_id))?;

        if db.node_type != "database" {
            return Err(format!("Node '{}' is not a database", db_id));
        }

        // Fetch children (rows) sorted by position
        let mut rows = workspace_manager.get_node_children(db_id).await?;
        rows.retain(|r| r.node_type == "row" && r.deleted_at.is_none());
        rows.sort_by(|a, b| a.position.partial_cmp(&b.position).unwrap_or(std::cmp::Ordering::Equal));

        // Primary view
        let views = workspace_manager.get_node_views(db_id).await?;
        let primary_view = views.first();

        let layout = primary_view.map(|v| v.layout.as_str()).unwrap_or("grid");
        let view_options: Value = primary_view
            .map(|v| serde_json::from_str(&v.view_options).unwrap_or(Value::Object(serde_json::Map::new())))
            .unwrap_or(Value::Object(serde_json::Map::new()));

        match layout {
            "board" => {
                let group_field_id = resolve_board_group_field_id(&view_options, &db.properties)?;
                let export = board::export_board(&db, &rows, primary_view, &group_field_id, &self.vault_root)?;
                let mut paths = vec![export.board_file_path];
                paths.extend(export.card_paths);
                Ok(paths)
            }
            "calendar" => {
                let date_field_id = resolve_calendar_date_field_id(&view_options, &db.properties)?;
                let path =
                    calendar::export_calendar(&db, &rows, primary_view, &date_field_id, &self.vault_root)?;
                Ok(vec![path])
            }
            // grid, chart, or any other layout → table CSV
            _ => {
                let path = table::export_table(&db, &rows, primary_view, &self.vault_root)?;
                Ok(vec![path])
            }
        }
    }

    /// Write (or overwrite) the card file for a single board row.
    ///
    /// Called after any mutation to a board row (cell edit, rename, body edit,
    /// column move). Fetches the row + parent database from SQLite, derives the
    /// card file path, and writes it atomically via temp+rename.
    ///
    /// Returns the vault-root-relative card path on success, or `Err` when the
    /// row's parent is not a board database (caller can safely ignore that case).
    pub async fn write_card_for_row(
        &self,
        row_id: &str,
        workspace_manager: &WorkspaceManager,
    ) -> Result<String, String> {
        let row = workspace_manager
            .get_node(row_id)
            .await?
            .ok_or_else(|| format!("Row '{}' not found", row_id))?;

        if row.node_type != "row" {
            return Err(format!("Node '{}' is not a row", row_id));
        }

        let db_id = row.parent_id.as_deref()
            .ok_or("Row has no parent database")?;

        let db = workspace_manager
            .get_node(db_id)
            .await?
            .ok_or_else(|| format!("Parent database '{}' not found", db_id))?;

        if db.node_type != "database" {
            return Err(format!("Parent '{}' is not a database", db_id));
        }

        // Only write cards for board-layout databases.
        let views = workspace_manager.get_node_views(db_id).await?;
        let primary_view = views.first();
        let layout = primary_view.map(|v| v.layout.as_str()).unwrap_or("grid");
        if layout != "board" {
            return Err(format!("Database '{}' primary view is '{}', not board", db_id, layout));
        }

        let db_props: serde_json::Value = serde_json::from_str(&db.properties)
            .map_err(|e| format!("DB properties JSON error: {e}"))?;
        let field_visibility = table::view_field_visibility(primary_view);
        let all_fields = format::parse_fields(&db_props, &field_visibility);
        let export_fields: Vec<format::VaultField> =
            all_fields.into_iter().filter(|f| f.field_type != "protected").collect();

        // Find the board group field and the row's column option
        let view_options: serde_json::Value = primary_view
            .map(|v| serde_json::from_str(&v.view_options)
                .unwrap_or(serde_json::Value::Object(serde_json::Map::new())))
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

        let group_field_id = resolve_board_group_field_id(&view_options, &db.properties)
            .map_err(|e| format!("Cannot resolve board group field: {e}"))?;

        let group_field = export_fields.iter().find(|f| f.id == group_field_id);

        let (col_opt_id, col_opt_name) = if let Some(gf) = group_field {
            let row_props: serde_json::Value =
                serde_json::from_str(&row.properties).unwrap_or_default();
            let opt_id = row_props
                .get("cells")
                .and_then(|c| c.get(&group_field_id))
                .and_then(|cell| cell.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let opt_name = gf.options.iter()
                .find(|o| o.id == opt_id)
                .map(|o| o.name.clone())
                .unwrap_or_else(|| "Uncategorized".to_string());
            (opt_id, opt_name)
        } else {
            (String::new(), "Uncategorized".to_string())
        };

        let card_content = board::build_card_file(
            &row, &db, &col_opt_id, &col_opt_name, &export_fields,
        );

        let slug = format::slugify(&db.name);
        let rel_path = format!("databases/{}/cards/{}.md", slug, row.id);
        let abs_path = self.vault_root.join(&rel_path);
        if let Some(parent) = abs_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        // Atomic write: temp + rename
        let tmp = abs_path.with_file_name(format!(".tmp_{}", uuid::Uuid::new_v4()));
        std::fs::write(&tmp, &card_content)
            .map_err(|e| format!("Failed to write card temp file: {e}"))?;
        std::fs::rename(&tmp, &abs_path)
            .map_err(|e| {
                let _ = std::fs::remove_file(&tmp);
                format!("Failed to finalize card file: {e}")
            })?;

        Ok(rel_path)
    }

    /// Import one database from its vault file into SQLite via upsert.
    ///
    /// `vault_rel_path` is the path of the primary vault file relative to the
    /// vault root (e.g. `"databases/my-table.md"` or
    /// `"databases/my-board/board.md"`).  The file must already exist on disk.
    ///
    /// Fails atomically (Q2): any parse error returns `Err` without touching
    /// SQLite.  On success returns the number of rows upserted.
    pub async fn import_database_from_vault(
        &self,
        vault_rel_path: &str,
        workspace_manager: &WorkspaceManager,
    ) -> Result<usize, String> {
        let abs_path = self.vault_root.join(vault_rel_path);
        let import = import::parse_vault_database(&abs_path)
            .map_err(|e| format!("Import parse failed — {e}"))?;
        workspace_manager.upsert_database_from_import(import).await
    }

    /// Export ALL non-deleted databases in the workspace to the vault.
    pub async fn export_all_databases(
        &self,
        workspace_manager: &WorkspaceManager,
    ) -> Result<Vec<ExportedDatabase>, String> {
        let all_nodes = workspace_manager.get_all_workspace_nodes().await?;
        let databases: Vec<_> = all_nodes
            .into_iter()
            .filter(|n| n.node_type == "database" && n.deleted_at.is_none())
            .collect();

        let mut results: Vec<ExportedDatabase> = Vec::new();
        for db in databases {
            let db_id = db.id.clone();
            let db_name = db.name.clone();
            match self.export_database(&db_id, workspace_manager).await {
                Ok(paths) => results.push(ExportedDatabase {
                    id: db_id,
                    name: db_name,
                    paths,
                    error: None,
                }),
                Err(e) => {
                    log::warn!("[vault] Failed to export database '{}': {}", db_id, e);
                    results.push(ExportedDatabase {
                        id: db_id,
                        name: db_name,
                        paths: vec![],
                        error: Some(e),
                    });
                }
            }
        }
        Ok(results)
    }
}

#[derive(Debug, serde::Serialize, specta::Type)]
pub struct ExportedDatabase {
    pub id: String,
    pub name: String,
    pub paths: Vec<PathBuf>,
    pub error: Option<String>,
}

// ─── View option resolvers ────────────────────────────────────────────────────

/// Resolve the board grouping field ID from view_options, falling back to the first
/// `board`-type field in the database schema.
fn resolve_board_group_field_id(
    view_options: &Value,
    db_properties: &str,
) -> Result<String, String> {
    // Canonical key used by the frontend (BOARD_VIEW_GROUP_FIELD_OPTION_KEY)
    if let Some(id) = view_options
        .get("boardGroupFieldId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        return Ok(id.to_string());
    }

    // Fallback: first field with field_type == "board"
    let props: Value = serde_json::from_str(db_properties).map_err(|e| e.to_string())?;
    let fields = props
        .get("fields")
        .and_then(|v| v.as_array())
        .ok_or("database has no fields")?;
    for f in fields {
        let ft = f.get("field_type").and_then(|v| v.as_str()).unwrap_or("");
        if ft == "board" || ft == "single_select" {
            if let Some(id) = f.get("id").and_then(|v| v.as_str()) {
                return Ok(id.to_string());
            }
        }
    }
    Err("No board grouping field found in database schema".to_string())
}

/// Resolve the calendar date field ID from view_options, falling back to the first
/// date or date_time field in the database schema.
fn resolve_calendar_date_field_id(
    view_options: &Value,
    db_properties: &str,
) -> Result<String, String> {
    // Canonical key (CalendarView.tsx uses "date_field_id")
    if let Some(id) = view_options
        .get("date_field_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        return Ok(id.to_string());
    }
    // Legacy key
    if let Some(id) = view_options
        .get("calendarDateFieldId")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        return Ok(id.to_string());
    }

    // Fallback: first date or date_time field
    let props: Value = serde_json::from_str(db_properties).map_err(|e| e.to_string())?;
    let fields = props
        .get("fields")
        .and_then(|v| v.as_array())
        .ok_or("database has no fields")?;
    for f in fields {
        let ft = f.get("field_type").and_then(|v| v.as_str()).unwrap_or("");
        if ft == "date" || ft == "date_time" {
            if let Some(id) = f.get("id").and_then(|v| v.as_str()) {
                return Ok(id.to_string());
            }
        }
    }
    Err("No date field found in database schema for calendar export".to_string())
}
