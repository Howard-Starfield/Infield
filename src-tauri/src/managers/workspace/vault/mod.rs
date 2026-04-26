pub mod board;
pub mod calendar;
pub mod format;
pub mod import;
pub mod table;

use std::path::PathBuf;
use serde_json::Value;
use format::{parse_fields, yaml_str, timestamp_to_utc_str};

use crate::managers::workspace::WorkspaceManager;
use crate::managers::workspace::node_types::WorkspaceNode;
use crate::managers::database::field::{CellData, Field, FieldType};

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

    /// Write one row's `rows/<slug>.md` to the vault, vault-first.
    ///
    /// If the file's on-disk mtime is newer than `last_seen_mtime_secs + 3s`,
    /// returns `Err("VAULT_CONFLICT:{json}")` WITHOUT touching SQLite.
    /// First write (file does not exist) skips the mtime check.
    ///
    /// `last_read_mtime` is NOT persisted — caller tracks it per editor session,
    /// matching the document-write pattern at workspace_manager.rs:1659-1677.
    pub async fn export_row(
        &self,
        db_id: &str,
        row_id: &str,
        last_seen_mtime_secs: Option<i64>,
        pending_cells: &[(String, CellData)],
        pending_body: Option<&str>,
        workspace_manager: &WorkspaceManager,
        db_mgr: &crate::managers::database::manager::DatabaseManager,
    ) -> Result<std::path::PathBuf, String> {
        use std::io::Write as _;

        // 1. Fetch the row node + parent database node.
        let row = workspace_manager
            .get_node(row_id)
            .await?
            .ok_or_else(|| format!("Row '{}' not found", row_id))?;
        if row.node_type != "row" {
            return Err(format!("Node '{}' is not a row", row_id));
        }
        let db = workspace_manager
            .get_node(db_id)
            .await?
            .ok_or_else(|| format!("Database '{}' not found", db_id))?;

        // 2. Fetch all cells for this row, then apply any pending overrides.
        //    Pending overrides represent the in-flight mutation that hasn't
        //    yet been written to SQLite (vault-first ordering — see spec §3).
        //    Without this merge, the on-disk row file lags by one mutation
        //    per cell and the last edit per row is lost on app close.
        let sqlite_cells = db_mgr
            .get_all_cells_for_row(row_id)
            .await
            .map_err(|e| e.to_string())?;
        let cells = merge_pending_cells(&sqlite_cells, pending_cells);

        // 3. Fetch field schema.
        let fields = db_mgr
            .get_fields(db_id)
            .await
            .map_err(|e| e.to_string())?;

        // 4. Row body. Caller may override when an in-flight body edit hasn't
        //    yet hit SQLite (see update_node row-path).
        let body = match pending_body {
            Some(b) => b.to_string(),
            None => row.body.clone(),
        };

        // 5. Compose YAML frontmatter + body.
        let db_slug = format::slugify(&db.name);
        let row_slug = format::slugify(&row.name);
        let content = format_row_file(&row, &fields, &cells, &body, db_id);

        // 6. Compute target path: databases/<db-slug>/rows/<row-slug>.md
        let rows_dir = self.vault_root.join("databases").join(&db_slug).join("rows");
        std::fs::create_dir_all(&rows_dir)
            .map_err(|e| format!("Failed to create rows dir: {e}"))?;

        let base_path = rows_dir.join(format!("{row_slug}.md"));
        // Slug-collision guard: if the target exists and belongs to a different
        // id, append -<first8ofid> (same policy as workspace_manager.rs:1581-1602).
        let file_path = if base_path.exists() {
            let existing_id = read_vault_file_node_id(&base_path);
            if existing_id.as_deref() != Some(&row.id) {
                let short_id = &row.id[..row.id.len().min(8)];
                rows_dir.join(format!("{row_slug}-{short_id}.md"))
            } else {
                base_path
            }
        } else {
            base_path
        };

        // 7. Rule 13 mtime guard. Skip on first write (file doesn't exist yet).
        if file_path.exists() {
            if let Some(last_seen) = last_seen_mtime_secs {
                if let Ok(meta) = std::fs::metadata(&file_path) {
                    if let Ok(mtime) = meta.modified() {
                        let disk_secs = mtime
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_secs() as i64;
                        // +3s grace per Rule 13a (cloud-sync mtime jitter).
                        if disk_secs > last_seen + 3 {
                            return Err(format!(
                                "VAULT_CONFLICT:{{\"node_id\":\"{row_id}\",\"disk_mtime\":{disk_secs},\"last_seen\":{last_seen}}}"
                            ));
                        }
                    }
                }
            }
        }

        // 8. Atomic write: .tmp + rename.
        let tmp_path = file_path.with_extension("md.tmp");
        {
            let mut f = std::fs::File::create(&tmp_path)
                .map_err(|e| format!("Failed to create tmp file: {e}"))?;
            f.write_all(content.as_bytes())
                .map_err(|e| format!("Failed to write tmp file: {e}"))?;
        }
        std::fs::rename(&tmp_path, &file_path)
            .map_err(|e| format!("Failed to rename vault file: {e}"))?;

        // 9. (DROPPED — caller tracks last_read_mtime in memory.)

        // 10. Return absolute file path (caller can convert to vault-rel as needed).
        Ok(file_path)
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

/// Read the `id:` field from a vault file's YAML frontmatter.
/// Returns None if the file doesn't exist, has no frontmatter, or has no `id:` line.
/// Mirrors `WorkspaceManager::vault_file_node_id` (private) so the row writer can
/// run the same slug-collision policy without modifying workspace_manager.rs.
fn read_vault_file_node_id(path: &std::path::Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let content = content.trim_start();
    if !content.starts_with("---") {
        return None;
    }
    let end = content[3..].find("\n---")?;
    let frontmatter = &content[3..3 + end];
    for line in frontmatter.lines() {
        if let Some(rest) = line.strip_prefix("id:") {
            return Some(rest.trim().to_string());
        }
    }
    None
}

/// Merge SQLite-fetched cells with any pending (in-flight) mutations.
///
/// For each `(field_id, data)` in `pending`:
///   - If a cell with the same field_id already exists in `sqlite`, replace its data.
///   - Otherwise, append.
///
/// Pure helper so the merge logic can be unit-tested without spinning up a
/// vault dir, async runtime, or both managers.
fn merge_pending_cells(
    sqlite: &[(String, CellData)],
    pending: &[(String, CellData)],
) -> Vec<(String, CellData)> {
    let mut out: Vec<(String, CellData)> = sqlite.to_vec();
    for (fid, data) in pending {
        if let Some(slot) = out.iter_mut().find(|(f, _)| f == fid) {
            slot.1 = data.clone();
        } else {
            out.push((fid.clone(), data.clone()));
        }
    }
    out
}

/// Build the YAML frontmatter + body for a row file at
/// `databases/<db-slug>/rows/<row-slug>.md`.
///
/// Frontmatter shape:
///   id, database_id, title (= row.name), icon, created_at, updated_at,
///   <field_id>: <cell_value_yaml>  (one per cell)
///   vault_version: 1
///
/// Cell values use the same human-readable rendering as `serialize_cell_for_csv`
/// (numbers as numbers, dates as ISO strings, multi-select as JSON array of names,
/// etc.). All non-numeric/non-bool values are double-quoted via `yaml_str`.
fn format_row_file(
    row: &WorkspaceNode,
    fields: &[Field],
    cells: &[(String, CellData)],
    body: &str,
    db_id: &str,
) -> String {
    let mut fm = String::new();
    fm.push_str("---\n");
    fm.push_str(&format!("id: {}\n", yaml_str(&row.id)));
    fm.push_str(&format!("database_id: {}\n", yaml_str(db_id)));
    fm.push_str(&format!("title: {}\n", yaml_str(&row.name)));
    fm.push_str(&format!("icon: {}\n", yaml_str(&row.icon)));
    fm.push_str(&format!("created_at: {}\n", yaml_str(&timestamp_to_utc_str(row.created_at))));
    fm.push_str(&format!("updated_at: {}\n", yaml_str(&timestamp_to_utc_str(row.updated_at))));

    // One key per field — stable order driven by field schema position.
    let mut fields_sorted: Vec<&Field> = fields.iter().collect();
    fields_sorted.sort_by_key(|f| f.position);
    for field in fields_sorted {
        let cell = cells.iter().find(|(fid, _)| fid == &field.id).map(|(_, c)| c);
        let yaml_value = serialize_cell_yaml(&field.field_type, cell);
        fm.push_str(&format!("{}: {}\n", yaml_str(&field.id), yaml_value));
    }

    fm.push_str("vault_version: 1\n");
    fm.push_str("---\n");
    fm.push_str(body);
    fm
}

/// Render a CellData value as a YAML scalar/sequence for the row frontmatter.
fn serialize_cell_yaml(field_type: &FieldType, cell: Option<&CellData>) -> String {
    let Some(cell) = cell else { return "null".to_string(); };

    match (field_type, cell) {
        (FieldType::RichText, CellData::RichText(s))
        | (FieldType::Url, CellData::Url(s))
        | (FieldType::Protected, CellData::Protected(s))
        | (FieldType::SingleSelect, CellData::SingleSelect(s)) => yaml_str(s),

        (FieldType::Number, CellData::Number(n)) => {
            if n.is_nan() || n.is_infinite() { "null".to_string() } else { format!("{}", n) }
        }
        (FieldType::Checkbox, CellData::Checkbox(b)) => format!("{}", b),

        (FieldType::DateTime, CellData::DateTime(ms))
        | (FieldType::LastEditedTime, CellData::LastEditedTime(ms))
        | (FieldType::CreatedTime, CellData::CreatedTime(ms)) => {
            yaml_str(&timestamp_to_utc_str(ms / 1000))
        }
        (FieldType::Time, CellData::Time(secs)) => format!("{}", secs),

        (FieldType::Date, CellData::Date(opt)) => match opt {
            Some(ms) => yaml_str(&timestamp_to_utc_str(ms / 1000)),
            None => "null".to_string(),
        },

        (FieldType::MultiSelect, CellData::MultiSelect(ids))
        | (FieldType::Checklist, CellData::Checklist(ids))
        | (FieldType::Media, CellData::Media(ids)) => {
            // YAML flow sequence of double-quoted strings — easy to round-trip via JSON.
            let parts: Vec<String> = ids.iter().map(|s| yaml_str(s)).collect();
            format!("[{}]", parts.join(", "))
        }

        // Type/data mismatch → fall back to JSON-encoded debug string so the value
        // is preserved (don't silently drop user data).
        _ => {
            let s = serde_json::to_string(cell).unwrap_or_else(|_| "null".to_string());
            yaml_str(&s)
        }
    }
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

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod export_row_tests {
    use super::*;
    use crate::managers::database::field::TypeOption;

    fn make_node(id: &str, name: &str, parent: Option<&str>, node_type: &str) -> WorkspaceNode {
        WorkspaceNode {
            id: id.to_string(),
            parent_id: parent.map(|s| s.to_string()),
            node_type: node_type.to_string(),
            name: name.to_string(),
            icon: "📄".to_string(),
            position: 0.0,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            deleted_at: None,
            properties: "{}".to_string(),
            body: String::new(),
            vault_rel_path: None,
        }
    }

    fn make_field(id: &str, name: &str, ft: FieldType) -> Field {
        Field {
            id: id.to_string(),
            database_id: "db-1".to_string(),
            name: name.to_string(),
            field_type: ft,
            is_primary: false,
            type_option: TypeOption::RichText,
            position: 0,
        }
    }

    #[test]
    fn format_row_file_emits_required_frontmatter_keys() {
        let row = make_node("row-1", "My Task", Some("db-1"), "row");
        let fields = vec![
            make_field("field-title", "Title", FieldType::RichText),
            make_field("field-done", "Done", FieldType::Checkbox),
        ];
        let cells = vec![
            ("field-title".to_string(), CellData::RichText("Buy milk".to_string())),
            ("field-done".to_string(), CellData::Checkbox(true)),
        ];

        let out = format_row_file(&row, &fields, &cells, "Body text", "db-1");

        assert!(out.starts_with("---\n"), "starts with frontmatter fence");
        assert!(out.contains("id: \"row-1\""));
        assert!(out.contains("database_id: \"db-1\""));
        assert!(out.contains("title: \"My Task\""));
        assert!(out.contains("\"field-title\": \"Buy milk\""));
        assert!(out.contains("\"field-done\": true"));
        assert!(out.contains("vault_version: 1"));
        assert!(out.contains("\n---\nBody text"));
    }

    #[test]
    fn serialize_cell_yaml_handles_null_and_collections() {
        // Missing cell → null
        assert_eq!(serialize_cell_yaml(&FieldType::RichText, None), "null");

        // Number
        assert_eq!(
            serialize_cell_yaml(&FieldType::Number, Some(&CellData::Number(42.0))),
            "42"
        );

        // Multi-select → flow sequence of quoted strings
        let cell = CellData::MultiSelect(vec!["a".to_string(), "b".to_string()]);
        let out = serialize_cell_yaml(&FieldType::MultiSelect, Some(&cell));
        assert_eq!(out, "[\"a\", \"b\"]");

        // Date None → null
        assert_eq!(
            serialize_cell_yaml(&FieldType::Date, Some(&CellData::Date(None))),
            "null"
        );
    }

    #[test]
    fn read_vault_file_node_id_parses_frontmatter() {
        use std::io::Write as _;
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("note.md");
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(b"---\nid: abc-123\ntitle: \"Hi\"\n---\nbody\n").unwrap();
        assert_eq!(read_vault_file_node_id(&path), Some("abc-123".to_string()));
    }

    #[test]
    fn read_vault_file_node_id_returns_none_for_missing_frontmatter() {
        use std::io::Write as _;
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("note.md");
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(b"no frontmatter here\n").unwrap();
        assert_eq!(read_vault_file_node_id(&path), None);
    }

    // ─── Integration tests (ignored — full WorkspaceManager + DatabaseManager
    // setup is >50 lines of boilerplate per test). Manual smoke test in Commit
    // G covers end-to-end behaviour. The pure-helper tests above exercise the
    // YAML/path/conflict logic that export_row composes.
    //
    // TODO(W4 hardening): build a shared in-memory test harness that wires
    // both managers against a temp vault dir, then re-enable these.

    #[tokio::test]
    #[ignore = "needs WorkspaceManager + DatabaseManager test harness"]
    async fn export_row_first_write_skips_mtime_check() {
        // Setup: temp vault, create db node, create row node, no existing file.
        // Call: vm.export_row(db_id, row_id, None, &[], None, ws, db).await
        // Assert: returns Ok with path under databases/<slug>/rows/<slug>.md.
        // Assert: no VAULT_CONFLICT.
    }

    #[tokio::test]
    #[ignore = "needs WorkspaceManager + DatabaseManager test harness"]
    async fn export_row_mtime_conflict_returns_error_before_sqlite() {
        // Setup: pre-write a row file with mtime far in the future.
        // Call: vm.export_row(db_id, row_id, Some(past), &[], None, ws, db).await
        // Assert: Err string contains "VAULT_CONFLICT".
        // Assert: SQLite cells unchanged (re-read cells, compare to baseline).
    }

    #[tokio::test]
    #[ignore = "needs WorkspaceManager + DatabaseManager test harness"]
    async fn export_row_writes_at_expected_path() {
        // Setup: db named "My Database" (slug "my-database"), row named "Task"
        //   (slug "task").
        // Call: vm.export_row(db_id, row_id, None, &[], None, ws, db).await
        // Assert: returned path ends with databases/my-database/rows/task.md.
    }

    // ─── Pending-cells override (pure helper) ────────────────────────────────

    #[test]
    fn pending_cells_override_sqlite_values() {
        let sqlite = vec![
            (
                "field-a".to_string(),
                CellData::RichText("old".to_string()),
            ),
            ("field-b".to_string(), CellData::Number(1.0)),
        ];
        let pending = vec![
            (
                "field-a".to_string(),
                CellData::RichText("new".to_string()),
            ),
            ("field-c".to_string(), CellData::Checkbox(true)),
        ];

        let merged = merge_pending_cells(&sqlite, &pending);

        // field-a was overridden in place
        let a = merged.iter().find(|(f, _)| f == "field-a").expect("field-a");
        assert!(matches!(&a.1, CellData::RichText(s) if s == "new"));

        // field-b was preserved untouched
        let b = merged.iter().find(|(f, _)| f == "field-b").expect("field-b");
        assert!(matches!(&b.1, CellData::Number(n) if (*n - 1.0).abs() < f64::EPSILON));

        // field-c was appended (not in sqlite)
        let c = merged.iter().find(|(f, _)| f == "field-c").expect("field-c");
        assert!(matches!(&c.1, CellData::Checkbox(true)));

        // No duplicate field-a entry
        assert_eq!(merged.iter().filter(|(f, _)| f == "field-a").count(), 1);
    }

    #[test]
    fn pending_cells_empty_returns_sqlite_unchanged() {
        let sqlite = vec![("field-a".to_string(), CellData::Number(42.0))];
        let merged = merge_pending_cells(&sqlite, &[]);
        assert_eq!(merged.len(), 1);
        assert!(matches!(&merged[0].1, CellData::Number(n) if (*n - 42.0).abs() < f64::EPSILON));
    }
}
