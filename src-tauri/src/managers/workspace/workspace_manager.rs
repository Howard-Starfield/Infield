use rusqlite::{Connection, OptionalExtension, params};
use rusqlite_migration::{Migrations, M};
use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::iter::once;
use std::sync::Arc;
use tokio::sync::Mutex;

use super::node_types::{NodeComment, NodeTemplate, NodeView, WorkspaceNode};
use crate::app_identity::resolve_vault_root;
use crate::managers::database::manager::DatabaseManager;
use crate::managers::embedding_worker::EmbeddingWorker;

use tauri::Emitter;
use tauri::Manager;

/// Holds both managers so a command can call migration on DatabaseManager
/// while using the WorkspaceManager's connection as the destination.
pub struct AppState {
    pub database_manager: Arc<DatabaseManager>,
    pub workspace_manager: Arc<WorkspaceManager>,
}

/// Markdown files for folder import: case-insensitive extension (Windows `Note.MD`),
/// plus `.markdown` / `.mdx` aligned with [`crate::import::ImportJobKind::Markdown`].
fn is_workspace_markdown_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| {
            ext.eq_ignore_ascii_case("md")
                || ext.eq_ignore_ascii_case("markdown")
                || ext.eq_ignore_ascii_case("mdx")
        })
}

pub struct WorkspaceManager {
    conn: Arc<Mutex<Connection>>,
    embedding_worker: Option<Arc<EmbeddingWorker>>,
    /// Cached root folder ids for well-known transcription containers (exact name match).
    transcription_folder_cache: Arc<Mutex<HashMap<String, String>>>,
}

// ─── Select Types ─────────────────────────────────────────────────────────────

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
#[specta(rename = "WorkspaceSelectColor")]
pub enum SelectColor {
    Purple,
    Pink,
    LightPink,
    Orange,
    Yellow,
    Lime,
    Green,
    Aqua,
    Blue,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
#[specta(rename = "WorkspaceSelectOption")]
pub struct SelectOption {
    pub id: String,
    pub name: String,
    pub color: SelectColor,
}

/// Serialized default for new `single_select` / `multi_select` columns (`type_option` is stored as a JSON string).
fn default_workspace_select_type_option_string() -> String {
    serde_json::json!({ "options": Vec::<serde_json::Value>::new() }).to_string()
}

/// Parse `field["type_option"]` for select-option CRUD.
/// Historically some paths stored `""` or `{}`, which makes `serde_json::from_str("")` fail with EOF.
fn parse_workspace_select_type_option(field: &serde_json::Value) -> Result<serde_json::Value, String> {
    let mut type_option = match field.get("type_option") {
        None => return Err("Field has no type_option".to_string()),
        Some(v) if v.is_null() => serde_json::json!({ "options": [] }),
        Some(serde_json::Value::Object(obj)) if obj.is_empty() => serde_json::json!({ "options": [] }),
        Some(serde_json::Value::Object(_)) => field.get("type_option").unwrap().clone(),
        Some(serde_json::Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                serde_json::json!({ "options": [] })
            } else {
                serde_json::from_str(t).map_err(|e| e.to_string())?
            }
        }
        Some(_) => return Err("Field has invalid type_option".to_string()),
    };
    if !type_option
        .get("options")
        .map(|v| v.is_array())
        .unwrap_or(false)
    {
        let obj = type_option
            .as_object_mut()
            .ok_or_else(|| "type_option must be a JSON object".to_string())?;
        obj.insert("options".to_string(), serde_json::json!([]));
    }
    Ok(type_option)
}

/// Next monotonic `position` when appending a field (0, 1, 2, …).
fn next_workspace_field_position(fields: &[serde_json::Value]) -> i64 {
    let mut max: i64 = -1;
    for f in fields {
        let p = f
            .get("position")
            .and_then(|v| v.as_i64())
            .or_else(|| f.get("position").and_then(|v| v.as_f64()).map(|x| x as i64));
        if let Some(pi) = p {
            if pi > max {
                max = pi;
            }
        }
    }
    max.saturating_add(1)
}

/// Format a date string "YYYY-MM-DD" into a human-readable display name like "April 13, 2026".
fn format_date_for_display(date: &str) -> String {
    let parts: Vec<i32> = date
        .split('-')
        .filter_map(|s| s.parse().ok())
        .collect();

    if parts.len() != 3 {
        return date.to_string();
    }

    let [year, month, day] = [parts[0], parts[1], parts[2]];
    let month_names = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];
    let month_name = month_names.get((month - 1) as usize).unwrap_or(&"Unknown");
    format!("{} {}, {}", month_name, day, year)
}

/// Apply the canonical `workspace.db` PRAGMA block to `conn`. Both the
/// main `WorkspaceManager` connection in `lib.rs` and the `EmbeddingWorker`
/// background connection MUST use identical settings — mismatched
/// `journal_mode` / `synchronous` / `busy_timeout` across connections
/// causes WAL integrity issues under concurrent read+write.
///
/// Returns on first hard failure (busy_timeout / foreign_keys). Pragma
/// updates for cache/tempstore/journal are `let _ =` best-effort — SQLite
/// silently accepts unknown pragmas on some builds; we don't want a missing
/// optimization to crash boot.
pub(crate) fn apply_workspace_conn_pragmas(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| anyhow::anyhow!("busy_timeout: {e}"))?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    let _ = conn.pragma_update(None, "cache_size", "-32000");
    let _ = conn.pragma_update(None, "temp_store", "MEMORY");
    // Required for REFERENCES ... ON DELETE CASCADE in workspace_nodes.
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| anyhow::anyhow!("foreign_keys: {e}"))?;
    Ok(())
}

// ─── Select Option Helpers ────────────────────────────────────────────────────

impl WorkspaceManager {
    fn get_field_select_options(
        &self,
        conn: &rusqlite::Connection,
        database_id: &str,
        field_id: &str,
    ) -> Result<(String, Vec<SelectOption>), String> {
        let node = self.get_node_internal(conn, database_id)?
            .ok_or_else(|| "Database not found".to_string())?;

        let props: serde_json::Value = serde_json::from_str(&node.properties)
            .map_err(|e| e.to_string())?;

        let fields = props.get("fields")
            .ok_or_else(|| "No fields in database properties".to_string())?
            .as_array()
            .ok_or_else(|| "Fields is not an array".to_string())?;

        let field = fields.iter()
            .find(|f| f.get("id").and_then(|v| v.as_str()) == Some(field_id))
            .ok_or_else(|| "Field not found".to_string())?;

        let type_option = parse_workspace_select_type_option(field)?;

        let options_json = type_option.get("options")
            .ok_or_else(|| "No options in type_option".to_string())?
            .as_array()
            .ok_or_else(|| "options is not an array".to_string())?;

        let options: Vec<SelectOption> = options_json.iter().map(|opt| {
            let id = opt.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let name = opt.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let color_str = opt.get("color").and_then(|v| v.as_str()).unwrap_or("purple");
            let color = match color_str {
                "purple" => SelectColor::Purple,
                "pink" => SelectColor::Pink,
                "light_pink" => SelectColor::LightPink,
                "orange" => SelectColor::Orange,
                "yellow" => SelectColor::Yellow,
                "lime" => SelectColor::Lime,
                "green" => SelectColor::Green,
                "aqua" => SelectColor::Aqua,
                "blue" => SelectColor::Blue,
                _ => SelectColor::Purple,
            };
            SelectOption { id, name, color }
        }).collect();

        let type_option_canonical =
            serde_json::to_string(&type_option).map_err(|e| e.to_string())?;
        Ok((type_option_canonical, options))
    }

    fn set_field_select_options(
        &self,
        conn: &rusqlite::Connection,
        database_id: &str,
        field_id: &str,
        options: Vec<SelectOption>,
    ) -> Result<(), String> {
        let node = self.get_node_internal(conn, database_id)?
            .ok_or_else(|| "Database not found".to_string())?;

        let mut props: serde_json::Value = serde_json::from_str(&node.properties)
            .map_err(|e| e.to_string())?;

        let fields = props.get_mut("fields")
            .ok_or_else(|| "No fields in database properties".to_string())?
            .as_array_mut()
            .ok_or_else(|| "Fields is not an array".to_string())?;

        let field = fields.iter_mut()
            .find(|f| f.get("id").and_then(|v| v.as_str()) == Some(field_id))
            .ok_or_else(|| "Field not found".to_string())?;

        let mut type_option = parse_workspace_select_type_option(field)?;

        let options_json: Vec<serde_json::Value> = options.iter().map(|opt| {
            let color_str = match opt.color {
                SelectColor::Purple => "purple",
                SelectColor::Pink => "pink",
                SelectColor::LightPink => "light_pink",
                SelectColor::Orange => "orange",
                SelectColor::Yellow => "yellow",
                SelectColor::Lime => "lime",
                SelectColor::Green => "green",
                SelectColor::Aqua => "aqua",
                SelectColor::Blue => "blue",
            };
            serde_json::json!({
                "id": opt.id,
                "name": opt.name,
                "color": color_str,
            })
        }).collect();

        type_option["options"] = serde_json::json!(options_json);
        field["type_option"] = serde_json::json!(type_option.to_string());

        let now = chrono::Utc::now().timestamp();
        let new_props_str = serde_json::to_string(&props).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE workspace_nodes SET properties = ?, updated_at = ? WHERE id = ?",
            rusqlite::params![new_props_str, now, database_id],
        ).map_err(|e| e.to_string())?;

        Ok(())
    }

    // ─── Select Option CRUD ────────────────────────────────────────────────────

    pub async fn create_select_option(
        &self,
        database_id: &str,
        field_id: &str,
        name: &str,
    ) -> Result<SelectOption, String> {
        let colors = [
            SelectColor::Purple, SelectColor::Pink, SelectColor::LightPink,
            SelectColor::Orange, SelectColor::Yellow, SelectColor::Lime,
            SelectColor::Green, SelectColor::Aqua, SelectColor::Blue,
        ];

        let conn = self.conn.lock().await;
        let (_type_option_str, mut options) = self.get_field_select_options(&conn, database_id, field_id)?;

        let color = colors[options.len() % colors.len()].clone();
        let new_option = SelectOption {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            color,
        };

        options.push(new_option.clone());
        self.set_field_select_options(&conn, database_id, field_id, options)?;

        Ok(new_option)
    }

    pub async fn rename_select_option(
        &self,
        database_id: &str,
        field_id: &str,
        option_id: &str,
        name: &str,
    ) -> Result<SelectOption, String> {
        let conn = self.conn.lock().await;
        let (_type_option_str, mut options) = self.get_field_select_options(&conn, database_id, field_id)?;

        let opt = options.iter_mut()
            .find(|o| o.id == option_id)
            .ok_or_else(|| "Option not found".to_string())?;

        opt.name = name.to_string();
        let updated = opt.clone();

        self.set_field_select_options(&conn, database_id, field_id, options)?;
        Ok(updated)
    }

    pub async fn update_select_option_color(
        &self,
        database_id: &str,
        field_id: &str,
        option_id: &str,
        color: SelectColor,
    ) -> Result<SelectOption, String> {
        let conn = self.conn.lock().await;
        let (_type_option_str, mut options) = self.get_field_select_options(&conn, database_id, field_id)?;

        let opt = options.iter_mut()
            .find(|o| o.id == option_id)
            .ok_or_else(|| "Option not found".to_string())?;

        opt.color = color;
        let updated = opt.clone();

        self.set_field_select_options(&conn, database_id, field_id, options)?;
        Ok(updated)
    }

    pub async fn delete_select_option(
        &self,
        database_id: &str,
        field_id: &str,
        option_id: &str,
    ) -> Result<(), String> {
        {
            // Scope the lock so it's released before the async get_node_children call
            let conn = self.conn.lock().await;
            let (_type_option_str, mut options) = self.get_field_select_options(&conn, database_id, field_id)?;

            let original_len = options.len();
            options.retain(|o| o.id != option_id);

            if options.len() == original_len {
                return Err("Option not found".to_string());
            }

            self.set_field_select_options(&conn, database_id, field_id, options)?;
        } // conn lock released here

        // Null out cells in all row children under this database that reference this option_id
        let rows = self.get_node_children(database_id).await?;
        for row in rows {
            if row.node_type == "row" {
                let mut props: serde_json::Value = serde_json::from_str(&row.properties)
                    .map_err(|e| e.to_string())?;

                if let Some(cells) = props.get_mut("cells").and_then(|v| v.as_object_mut()) {
                    if let Some(cell) = cells.get_mut(field_id) {
                        if cell.get("value").and_then(|v| v.as_str()) == Some(option_id) {
                            cell["value"] = serde_json::Value::Null;
                        }
                    }
                }

                let now = chrono::Utc::now().timestamp();
                let new_props_str = serde_json::to_string(&props).map_err(|e| e.to_string())?;
                let conn = self.conn.lock().await;
                conn.execute(
                    "UPDATE workspace_nodes SET properties = ?, updated_at = ? WHERE id = ?",
                    rusqlite::params![new_props_str, now, row.id],
                ).map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    }

    pub async fn reorder_select_options(
        &self,
        database_id: &str,
        field_id: &str,
        option_ids: Vec<String>,
    ) -> Result<Vec<SelectOption>, String> {
        let conn = self.conn.lock().await;
        let (_type_option_str, mut all_options) = self.get_field_select_options(&conn, database_id, field_id)?;

        let mut reordered: Vec<SelectOption> = Vec::new();
        for id in &option_ids {
            if let Some(opt) = all_options.iter().find(|o| &o.id == id) {
                reordered.push(opt.clone());
            }
        }

        // Append any options not in option_ids
        for opt in &all_options {
            if !option_ids.contains(&opt.id) {
                reordered.push(opt.clone());
            }
        }

        self.set_field_select_options(&conn, database_id, field_id, reordered.clone())?;
        Ok(reordered)
    }

    // ─── Cell Helpers ─────────────────────────────────────────────────────────

    /// Flatten a cell JSON `value` into plain text for FTS / embeddings.
    fn cell_value_to_search_fragment(val: &serde_json::Value) -> Option<String> {
        match val {
            serde_json::Value::Null => None,
            serde_json::Value::String(s) => {
                let t = s.trim();
                if t.is_empty() {
                    None
                } else {
                    Some(t.to_string())
                }
            }
            serde_json::Value::Number(n) => Some(n.to_string()),
            serde_json::Value::Bool(b) => Some(b.to_string()),
            serde_json::Value::Array(a) => {
                let parts: Vec<String> = a
                    .iter()
                    .filter_map(Self::cell_value_to_search_fragment)
                    .collect();
                if parts.is_empty() {
                    None
                } else {
                    Some(parts.join(" "))
                }
            }
            serde_json::Value::Object(map) => {
                if let Some(s) = map.get("text").and_then(|v| v.as_str()) {
                    let t = s.trim();
                    if !t.is_empty() {
                        return Some(t.to_string());
                    }
                }
                if let Some(s) = map.get("label").and_then(|v| v.as_str()) {
                    let t = s.trim();
                    if !t.is_empty() {
                        return Some(t.to_string());
                    }
                }
                if let Some(s) = map.get("url").and_then(|v| v.as_str()) {
                    let t = s.trim();
                    if !t.is_empty() {
                        return Some(t.to_string());
                    }
                }
                let mut acc: Vec<String> = Vec::new();
                for v in map.values() {
                    if let Some(s) = Self::cell_value_to_search_fragment(v) {
                        acc.push(s);
                    }
                }
                if acc.is_empty() {
                    None
                } else {
                    Some(acc.join(" "))
                }
            }
        }
    }

    fn row_cells_flat_text(properties_json: &str) -> String {
        let Ok(props) = serde_json::from_str::<serde_json::Value>(properties_json) else {
            return String::new();
        };
        let Some(cells) = props.get("cells").and_then(|c| c.as_object()) else {
            return String::new();
        };
        let mut parts: Vec<String> = Vec::new();
        for cell in cells.values() {
            if let Some(val) = cell.get("value") {
                if let Some(s) = Self::cell_value_to_search_fragment(val) {
                    parts.push(s);
                }
            }
        }
        parts.join(" ")
    }

    /// Field-aware plaintext for a single cell: resolves select IDs to labels,
    /// flattens checklist items, extracts media names, etc. Falls back to the
    /// generic flattener for unknown / plain types.
    fn flatten_cell_typed(
        cell: &serde_json::Value,
        field_type: &str,
        options: &HashMap<String, String>,
    ) -> Option<String> {
        let value = cell.get("value")?;
        match field_type {
            // Skip — "true"/"false" strewn through every row is noise.
            "checkbox" => None,
            "single_select" | "board" => {
                let id = value.as_str()?.trim();
                if id.is_empty() { return None; }
                Some(options.get(id).cloned().unwrap_or_else(|| id.to_string()))
            }
            "multi_select" => {
                let arr = value.as_array()?;
                let labels: Vec<String> = arr
                    .iter()
                    .filter_map(|v| v.as_str())
                    .map(|id| options.get(id).cloned().unwrap_or_else(|| id.to_string()))
                    .filter(|s| !s.is_empty())
                    .collect();
                if labels.is_empty() { None } else { Some(labels.join(" ")) }
            }
            "checklist" => {
                let arr = value.as_array()?;
                let items: Vec<String> = arr
                    .iter()
                    .filter_map(|v| v.get("text").and_then(|t| t.as_str()))
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
                if items.is_empty() { None } else { Some(items.join(" ")) }
            }
            "media" => {
                if let Some(arr) = value.as_array() {
                    let parts: Vec<String> = arr
                        .iter()
                        .filter_map(|v| {
                            v.get("name")
                                .or_else(|| v.get("url"))
                                .or_else(|| v.get("alt"))
                                .and_then(|t| t.as_str())
                        })
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    if parts.is_empty() { None } else { Some(parts.join(" ")) }
                } else {
                    Self::cell_value_to_search_fragment(value)
                }
            }
            // Sensitive — don't index.
            "protected" => None,
            _ => Self::cell_value_to_search_fragment(value),
        }
    }

    /// Build `field_id → (name, type, option_id→label)` for a row's parent database.
    /// Returns empty map if the row is orphaned or the parent is not a database.
    async fn build_row_field_context(
        &self,
        row: &WorkspaceNode,
    ) -> HashMap<String, (String, String, HashMap<String, String>)> {
        let mut map: HashMap<String, (String, String, HashMap<String, String>)> = HashMap::new();
        let Some(parent_id) = row.parent_id.as_ref() else { return map; };
        let parent = match self.get_node(parent_id).await {
            Ok(Some(n)) => n,
            _ => return map,
        };
        if parent.node_type != "database" { return map; }
        let Ok(props) = serde_json::from_str::<serde_json::Value>(&parent.properties) else { return map; };
        let Some(fields) = props.get("fields").and_then(|v| v.as_array()) else { return map; };
        for f in fields {
            let Some(fid) = f.get("id").and_then(|v| v.as_str()) else { continue; };
            let name = f.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let field_type = f.get("field_type").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let mut options: HashMap<String, String> = HashMap::new();
            if matches!(field_type.as_str(), "single_select" | "board" | "multi_select") {
                if let Ok(type_option) = parse_workspace_select_type_option(f) {
                    if let Some(opts) = type_option.get("options").and_then(|v| v.as_array()) {
                        for opt in opts {
                            let oid = opt.get("id").and_then(|v| v.as_str()).unwrap_or("");
                            let oname = opt.get("name").and_then(|v| v.as_str()).unwrap_or("");
                            if !oid.is_empty() {
                                options.insert(oid.to_string(), oname.to_string());
                            }
                        }
                    }
                }
            }
            map.insert(fid.to_string(), (name, field_type, options));
        }
        map
    }

    /// Name + field-aware flattened cells + row body. Used for BOTH FTS body
    /// and embedding plaintext so keyword and semantic search see the same
    /// content (industry-standard: Notion-style per-field extraction including
    /// select labels, checklist items, media filenames).
    pub(crate) async fn build_row_indexable_text(&self, row: &WorkspaceNode) -> String {
        let field_ctx = self.build_row_field_context(row).await;
        let mut parts: Vec<String> = Vec::new();
        let n = row.name.trim();
        if !n.is_empty() { parts.push(n.to_string()); }

        if let Ok(props) = serde_json::from_str::<serde_json::Value>(&row.properties) {
            if let Some(cells) = props.get("cells").and_then(|c| c.as_object()) {
                for (field_id, cell) in cells {
                    let fragment = if let Some((fname, ftype, opts)) = field_ctx.get(field_id) {
                        Self::flatten_cell_typed(cell, ftype, opts).map(|v| {
                            if fname.trim().is_empty() {
                                v
                            } else {
                                format!("{}: {}", fname.trim(), v)
                            }
                        })
                    } else {
                        cell.get("value").and_then(Self::cell_value_to_search_fragment)
                    };
                    if let Some(f) = fragment {
                        parts.push(f);
                    }
                }
            }
        }

        let b = row.body.trim();
        if !b.is_empty() { parts.push(b.to_string()); }
        parts.join(" ")
    }

    async fn refresh_row_search_index(&self, row_id: &str) -> Result<(), String> {
        let node = self
            .get_node(row_id)
            .await?
            .ok_or_else(|| "Row not found".to_string())?;
        let rich = self.build_row_indexable_text(&node).await;
        {
            let conn = self.conn.lock().await;
            if node.deleted_at.is_some() {
                Self::delete_workspace_fts_row(&conn, &node.id)?;
            } else {
                Self::replace_workspace_fts_row(&conn, &node.id, &node.name, &rich)?;
            }
        }
        if node.deleted_at.is_none() {
            if Self::should_queue_workspace_indexing() {
                if let Some(w) = &self.embedding_worker {
                    w.enqueue_index(row_id.to_string(), rich);
                }
            }
        }
        Ok(())
    }

    /// Returns (node_id, plaintext) for every live document/row/database in the workspace.
    /// Used by the global reindex command so the vector store covers ALL searchable
    /// content, not just legacy notes.
    pub async fn all_workspace_index_summaries(&self) -> Result<Vec<(String, String)>, String> {
        let ids: Vec<(String, String)> = {
            let conn = self.conn.lock().await;
            let mut stmt = conn
                .prepare(
                    "SELECT id, node_type FROM workspace_nodes \
                     WHERE deleted_at IS NULL AND node_type IN ('row','document','database')",
                )
                .map_err(|e| e.to_string())?;
            let iter = stmt
                .query_map([], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            let mut out = Vec::new();
            for r in iter {
                if let Ok(pair) = r {
                    out.push(pair);
                }
            }
            out
        };

        let mut results: Vec<(String, String)> = Vec::with_capacity(ids.len());
        for (id, node_type) in ids {
            let Ok(Some(node)) = self.get_node(&id).await else { continue; };
            let plain = if node_type == "row" {
                self.build_row_indexable_text(&node).await
            } else if node_type == "database" {
                node.name.clone()
            } else {
                format!("{} {}", node.name, node.body)
            };
            if !plain.trim().is_empty() {
                results.push((id, plain));
            }
        }
        Ok(results)
    }

    pub async fn get_cell(
        &self,
        row_id: &str,
        field_id: &str,
    ) -> Result<Option<serde_json::Value>, String> {
        let conn = self.conn.lock().await;
        let node = self.get_node_internal(&conn, row_id)?
            .ok_or_else(|| "Row not found".to_string())?;

        let props: serde_json::Value = serde_json::from_str(&node.properties)
            .map_err(|e| e.to_string())?;

        let cells = props.get("cells")
            .ok_or_else(|| "No cells in row properties".to_string())?
            .as_object()
            .ok_or_else(|| "cells is not an object".to_string())?;

        Ok(cells.get(field_id).cloned())
    }

    pub async fn update_cell(
        &self,
        row_id: &str,
        field_id: &str,
        cell_type: &str,
        value: serde_json::Value,
        cell_extras: Option<serde_json::Value>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().await;
        let node = self.get_node_internal(&conn, row_id)?
            .ok_or_else(|| "Row not found".to_string())?;

        let mut props: serde_json::Value = serde_json::from_str(&node.properties)
            .map_err(|e| e.to_string())?;

        if !props.get("cells").map(|v| v.is_object()).unwrap_or(false) {
            props["cells"] = serde_json::Value::Object(serde_json::Map::new());
        }
        let cells = props["cells"].as_object_mut()
            .ok_or("cells is not an object after upsert")?;

        let mut cell = serde_json::json!({
            "type": cell_type,
            "value": value,
        });

        if let Some(ex) = cell_extras {
            if let Some(f) = ex.get("formula") {
                if f.is_null() {
                    let _ = cell.as_object_mut().unwrap().remove("formula");
                } else if let Some(s) = f.as_str() {
                    if s.is_empty() {
                        let _ = cell.as_object_mut().unwrap().remove("formula");
                    } else {
                        cell["formula"] = serde_json::json!(s);
                    }
                }
            }
            if let Some(e) = ex.get("evalError") {
                if e.is_null() {
                    let _ = cell.as_object_mut().unwrap().remove("evalError");
                } else if let Some(s) = e.as_str() {
                    if s.is_empty() {
                        let _ = cell.as_object_mut().unwrap().remove("evalError");
                    } else {
                        cell["evalError"] = serde_json::json!(s);
                    }
                }
            }
        }

        cells.insert(field_id.to_string(), cell);

        let now = chrono::Utc::now().timestamp();
        let new_props_str = serde_json::to_string(&props).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE workspace_nodes SET properties = ?, updated_at = ? WHERE id = ?",
            rusqlite::params![new_props_str, now, row_id],
        ).map_err(|e| e.to_string())?;

        drop(conn);
        self.refresh_row_search_index(row_id).await
    }

    pub async fn create_row_in_group(
        &self,
        database_id: &str,
        field_id: &str,
        option_id: &str,
        name: &str,
    ) -> Result<WorkspaceNode, String> {
        let db_node = self
            .get_node(database_id)
            .await?
            .ok_or_else(|| "Database not found".to_string())?;
        let db_props: serde_json::Value = serde_json::from_str(&db_node.properties)
            .map_err(|e| e.to_string())?;
        let primary_rich_text_id: Option<String> = db_props
            .get("fields")
            .and_then(|v| v.as_array())
            .and_then(|fields| {
                fields.iter().find_map(|f| {
                    if f.get("is_primary").and_then(|v| v.as_bool()) != Some(true) {
                        return None;
                    }
                    let ft = f.get("field_type").and_then(|v| v.as_str()).unwrap_or("");
                    if ft != "rich_text" {
                        return None;
                    }
                    f.get("id").and_then(|v| v.as_str()).map(|s| s.to_string())
                })
            });

        let node = self.create_node(Some(database_id.to_string()), "row", name, "📄").await?;

        self.update_cell(
            &node.id,
            field_id,
            "single_select",
            serde_json::json!(option_id),
            None,
        )
        .await?;

        if let Some(pid) = primary_rich_text_id {
            if pid != field_id {
                self.update_cell(
                    &node.id,
                    &pid,
                    "rich_text",
                    serde_json::json!(name),
                    None,
                )
                .await?;
            }
        }

        // Re-fetch the node to get updated properties
        self.get_node(&node.id)
            .await?
            .ok_or_else(|| "Row not found after creation".to_string())
    }

    // ─── Field CRUD ─────────────────────────────────────────────────────────────

    pub async fn add_single_select_field(&self, database_id: &str, field_name: &str) -> Result<WorkspaceNode, String> {
        let node = self.get_node(database_id).await?
            .ok_or_else(|| "Database not found".to_string())?;
        let props: serde_json::Value = serde_json::from_str(&node.properties)
            .map_err(|e| e.to_string())?;
        let mut fields = props.get("fields")
            .and_then(|v| v.as_array())
            .map(|arr| arr.clone())
            .unwrap_or_default();
        let pos = next_workspace_field_position(&fields);
        let new_field = serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "database_id": database_id,
            "name": field_name,
            "field_type": "board",
            "is_primary": false,
            "type_option": default_workspace_select_type_option_string(),
            "position": pos
        });
        fields.push(new_field);
        let updated_props = serde_json::json!({ "fields": fields });
        self.update_node(database_id, &node.name, &node.icon, &updated_props.to_string(), &node.body).await
    }

    pub async fn add_field(&self, database_id: &str, field_name: &str, field_type: &str) -> Result<WorkspaceNode, String> {
        let node = self.get_node(database_id).await?
            .ok_or_else(|| "Database not found".to_string())?;
        let props: serde_json::Value = serde_json::from_str(&node.properties)
            .map_err(|e| e.to_string())?;
        let mut fields = props.get("fields")
            .and_then(|v| v.as_array())
            .map(|arr| arr.clone())
            .unwrap_or_default();
        let type_option_init = if matches!(field_type, "single_select" | "board" | "multi_select") {
            default_workspace_select_type_option_string()
        } else {
            String::new()
        };
        let pos = next_workspace_field_position(&fields);
        let new_field = serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "database_id": database_id,
            "name": field_name,
            "field_type": field_type,
            "is_primary": false,
            "type_option": type_option_init,
            "position": pos
        });
        fields.push(new_field);
        let updated_props = serde_json::json!({ "fields": fields });
        self.update_node(database_id, &node.name, &node.icon, &updated_props.to_string(), &node.body).await
    }

    pub async fn rename_field(&self, database_id: &str, field_id: &str, name: &str) -> Result<WorkspaceNode, String> {
        let node = self.get_node(database_id).await?
            .ok_or_else(|| "Database not found".to_string())?;
        let props: serde_json::Value = serde_json::from_str(&node.properties)
            .map_err(|e| e.to_string())?;
        let mut fields = props.get("fields")
            .and_then(|v| v.as_array())
            .map(|arr| arr.clone())
            .unwrap_or_default();
        for field in fields.iter_mut() {
            if field.get("id").and_then(|v| v.as_str()) == Some(field_id) {
                field["name"] = serde_json::json!(name);
                break;
            }
        }
        let updated_props = serde_json::json!({ "fields": fields });
        self.update_node(database_id, &node.name, &node.icon, &updated_props.to_string(), &node.body).await
    }

    /// Allowed `field_type` values for workspace database columns (aligned with app catalog).
    fn is_allowed_workspace_field_type(field_type: &str) -> bool {
        matches!(
            field_type,
            "rich_text"
                | "number"
                | "date_time"
                | "single_select"
                | "board"
                | "multi_select"
                | "checkbox"
                | "url"
                | "checklist"
                | "last_edited_time"
                | "created_time"
                | "time"
                | "media"
                | "date"
                | "protected"
        )
    }

    /// Change an existing field's type. Primary column must stay `rich_text`. Resets `type_option` when switching.
    pub async fn set_field_type(
        &self,
        database_id: &str,
        field_id: &str,
        field_type: &str,
    ) -> Result<WorkspaceNode, String> {
        if !Self::is_allowed_workspace_field_type(field_type) {
            return Err(format!("Unsupported field_type: {field_type}"));
        }
        let node = self
            .get_node(database_id)
            .await?
            .ok_or_else(|| "Database not found".to_string())?;
        let props: serde_json::Value =
            serde_json::from_str(&node.properties).map_err(|e| e.to_string())?;
        let mut fields = props
            .get("fields")
            .and_then(|v| v.as_array())
            .map(|arr| arr.clone())
            .unwrap_or_default();
        let mut found = false;
        for field in fields.iter_mut() {
            if field.get("id").and_then(|v| v.as_str()) != Some(field_id) {
                continue;
            }
            found = true;
            let is_primary = field
                .get("is_primary")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if is_primary && field_type != "rich_text" {
                return Err("Primary column must remain rich_text".to_string());
            }
            if let Some(obj) = field.as_object_mut() {
                obj.insert("field_type".to_string(), serde_json::json!(field_type));
                // Match add_field default; clears select options / number format from prior type.
                let type_option_reset = if matches!(field_type, "single_select" | "board" | "multi_select") {
                    serde_json::json!(default_workspace_select_type_option_string())
                } else {
                    serde_json::json!("")
                };
                obj.insert("type_option".to_string(), type_option_reset);
            }
            break;
        }
        if !found {
            return Err("Field not found".to_string());
        }
        let updated_props = serde_json::json!({ "fields": fields });
        self
            .update_node(
                database_id,
                &node.name,
                &node.icon,
                &updated_props.to_string(),
                &node.body,
            )
            .await
    }

    pub async fn set_field_group(
        &self,
        database_id: &str,
        field_id: &str,
        group: &str,
    ) -> Result<WorkspaceNode, String> {
        let node = self
            .get_node(database_id)
            .await?
            .ok_or_else(|| "Database not found".to_string())?;
        let props: serde_json::Value = serde_json::from_str(&node.properties).map_err(|e| e.to_string())?;
        let mut fields = props
            .get("fields")
            .and_then(|v| v.as_array())
            .map(|arr| arr.clone())
            .unwrap_or_default();
        for field in fields.iter_mut() {
            if field.get("id").and_then(|v| v.as_str()) == Some(field_id) {
                if let Some(obj) = field.as_object_mut() {
                    if group.trim().is_empty() {
                        obj.remove("group");
                    } else {
                        obj.insert("group".to_string(), serde_json::json!(group.trim()));
                    }
                }
                break;
            }
        }
        let updated_props = serde_json::json!({ "fields": fields });
        self.update_node(
            database_id,
            &node.name,
            &node.icon,
            &updated_props.to_string(),
            &node.body,
        )
        .await
    }

    pub async fn rename_field_group(
        &self,
        database_id: &str,
        old_name: &str,
        new_name: &str,
    ) -> Result<WorkspaceNode, String> {
        let node = self
            .get_node(database_id)
            .await?
            .ok_or_else(|| "Database not found".to_string())?;
        let props: serde_json::Value = serde_json::from_str(&node.properties).map_err(|e| e.to_string())?;
        let mut fields = props
            .get("fields")
            .and_then(|v| v.as_array())
            .map(|arr| arr.clone())
            .unwrap_or_default();
        for field in fields.iter_mut() {
            let matches_old = field
                .get("group")
                .and_then(|v| v.as_str())
                .map(|g| g == old_name)
                .unwrap_or(false);
            if matches_old {
                if let Some(obj) = field.as_object_mut() {
                    if new_name.trim().is_empty() {
                        obj.remove("group");
                    } else {
                        obj.insert("group".to_string(), serde_json::json!(new_name.trim()));
                    }
                }
            }
        }
        let updated_props = serde_json::json!({ "fields": fields });
        self.update_node(
            database_id,
            &node.name,
            &node.icon,
            &updated_props.to_string(),
            &node.body,
        )
        .await
    }

    pub async fn delete_field(&self, database_id: &str, field_id: &str) -> Result<WorkspaceNode, String> {
        let node = self.get_node(database_id).await?
            .ok_or_else(|| "Database not found".to_string())?;
        let props: serde_json::Value = serde_json::from_str(&node.properties)
            .map_err(|e| e.to_string())?;
        let fields: Vec<serde_json::Value> = props.get("fields")
            .and_then(|v| v.as_array())
            .map(|arr| arr.clone())
            .unwrap_or_default()
            .into_iter()
            .filter(|f| f.get("id").and_then(|v| v.as_str()) != Some(field_id))
            .collect();
        let updated_props = serde_json::json!({ "fields": fields });
        self.update_node(database_id, &node.name, &node.icon, &updated_props.to_string(), &node.body).await
    }

    // ─── User Preferences ───────────────────────────────────────────────────────

    pub async fn get_user_preference(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare("SELECT value FROM user_preferences WHERE key = ?1")
            .map_err(|e| e.to_string())?;
        let result: Option<String> = stmt.query_row(params![key], |row| row.get(0)).ok();
        Ok(result)
    }

    pub async fn set_user_preference(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.clone();
        let conn_locked = conn.lock().await;
        conn_locked.execute(
            "INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?1, ?2)",
            params![key, value],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─── Backlinks ───────────────────────────────────────────────────────────────

    pub async fn get_backlinks(&self, target_id: &str) -> Result<Vec<WorkspaceNode>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT wn.id, wn.parent_id, wn.node_type, wn.name, wn.icon, wn.position,
                    wn.created_at, wn.updated_at, wn.deleted_at, wn.properties, wn.body, wn.vault_rel_path
             FROM page_links pl
             JOIN workspace_nodes wn ON wn.id = pl.source_node_id
             WHERE pl.target_node_id = ?1 AND wn.deleted_at IS NULL",
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![target_id], |row| {
            Ok(WorkspaceNode {
                id: row.get(0)?, parent_id: row.get(1)?, node_type: row.get(2)?,
                name: row.get(3)?, icon: row.get(4)?, position: row.get(5)?,
                created_at: row.get(6)?, updated_at: row.get(7)?, deleted_at: row.get(8)?,
                properties: row.get(9)?, body: row.get(10)?, vault_rel_path: row.get(11)?,
            })
        }).map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub async fn propagate_rename(&self, target_id: &str, old_name: &str, new_name: &str) -> Result<usize, String> {
        let backlinks = self.get_backlinks(target_id).await?;
        let old_pattern = format!("[{}](node://{})", old_name, target_id);
        let new_pattern = format!("[{}](node://{})", new_name, target_id);
        let mut updated = 0;
        for source in backlinks {
            if source.body.contains(&old_pattern) {
                let new_body = source.body.replace(&old_pattern, &new_pattern);
                self.update_node(&source.id, &source.name, &source.icon, &source.properties, &new_body).await?;
                updated += 1;
            }
        }
        Ok(updated)
    }

    // ─── Constructor & Accessors ───────────────────────────────────────────────

    /// Atomically upsert a database and all its rows parsed from a vault file.
    /// All SQL writes happen inside a single `BEGIN IMMEDIATE` transaction so
    /// either the entire import succeeds or SQLite state is untouched (Q2).
    pub async fn upsert_database_from_import(
        &self,
        import: super::vault::import::DatabaseImport,
    ) -> Result<usize, String> {
        let now = chrono::Utc::now().timestamp();
        let row_count = import.rows.len();

        // Collect IDs before moving `import` into the closure
        let db_id = import.db_id.clone();
        let all_ids: Vec<String> = std::iter::once(db_id.clone())
            .chain(import.rows.iter().map(|r| r.id.clone()))
            .collect();

        {
            let conn = self.conn.lock().await;

            // Fail fast on begin so we don't partially execute on a locked DB.
            conn.execute_batch("BEGIN IMMEDIATE")
                .map_err(|e| format!("Import begin failed: {e}"))?;

            let result: Result<(), rusqlite::Error> = (|| {
                let db_created = if import.db_created_at_secs > 0 { import.db_created_at_secs } else { now };
                let db_updated = if import.db_updated_at_secs > 0 { import.db_updated_at_secs } else { now };

                conn.execute(
                    "INSERT INTO workspace_nodes
                       (id, parent_id, node_type, name, icon, position,
                        created_at, updated_at, properties, body, vault_rel_path)
                     VALUES (?1, NULL, 'database', ?2, ?3, 1.0, ?4, ?5, ?6, '', ?7)
                     ON CONFLICT(id) DO UPDATE SET
                       name         = excluded.name,
                       icon         = excluded.icon,
                       properties   = excluded.properties,
                       updated_at   = excluded.updated_at,
                       vault_rel_path = excluded.vault_rel_path,
                       deleted_at   = NULL",
                    params![
                        &import.db_id, &import.db_name, &import.db_icon,
                        db_created, db_updated,
                        &import.db_properties_json,
                        &import.vault_rel_path,
                    ],
                )?;

                for row in &import.rows {
                    let r_created = if row.created_at_secs > 0 { row.created_at_secs } else { now };
                    let r_updated = if row.updated_at_secs > 0 { row.updated_at_secs } else { now };
                    conn.execute(
                        "INSERT INTO workspace_nodes
                           (id, parent_id, node_type, name, icon, position,
                            created_at, updated_at, properties, body)
                         VALUES (?1, ?2, 'row', ?3, '', ?4, ?5, ?6, ?7, '')
                         ON CONFLICT(id) DO UPDATE SET
                           name       = excluded.name,
                           properties = excluded.properties,
                           position   = excluded.position,
                           updated_at = excluded.updated_at,
                           deleted_at = NULL",
                        params![
                            &row.id, &import.db_id, &row.name,
                            row.position, r_created, r_updated,
                            &row.properties_json,
                        ],
                    )?;
                }
                Ok(())
            })();

            if let Err(e) = result {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(format!("Import transaction failed — {e}. SQLite state unchanged."));
            }
            conn.execute_batch("COMMIT")
                .map_err(|e| format!("Import commit failed: {e}"))?;
        }

        // Post-commit: sync FTS outside the lock (Rule: never hold lock across await)
        for id in &all_ids {
            if let Ok(Some(node)) = self.get_node(id).await {
                let _ = self.sync_node_fts(&node).await;
            }
        }

        Ok(row_count)
    }

    pub fn new(conn: Connection, embedding_worker: Arc<EmbeddingWorker>) -> Self {
        Self {
            conn: Arc::new(Mutex::new(conn)),
            embedding_worker: Some(embedding_worker),
            transcription_folder_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Test-only constructor: builds a WorkspaceManager backed by an in-memory
    /// SQLite connection with no embedding worker. Migrations are applied
    /// before returning. Used by unit tests that exercise pure-SQL helpers
    /// (`upsert_database_node`, `upsert_row_node`, `mark_node_deleted`, etc.)
    /// without standing up an EmbeddingWorker (which requires a tauri AppHandle).
    ///
    /// The caller MUST have already registered the sqlite-vec extension via
    /// `migration_tests::ensure_vec_extension()` before calling this. Putting
    /// the registration here triggered a Windows MSVC linker issue where the
    /// test binary failed to load with STATUS_ENTRYPOINT_NOT_FOUND when this
    /// function referenced `sqlite_vec::sqlite3_vec_init` from a non-test path.
    #[cfg(test)]
    pub fn new_in_memory() -> Result<Self, String> {
        let mut conn = Connection::open_in_memory()
            .map_err(|e| format!("open_in_memory failed: {e}"))?;
        Self::migrations()
            .to_latest(&mut conn)
            .map_err(|e| format!("migration failed: {e}"))?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            embedding_worker: None,
            transcription_folder_cache: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Insert or update a workspace_nodes row that mirrors a row in `database.db`.
    /// Single helper for both `node_type='database'` (databases) and `node_type='row'`
    /// (rows): pass `parent_id=None` + position=1.0 + an icon for databases, or
    /// `parent_id=Some(db_id)` + the row's position + empty icon for rows.
    /// Idempotent — safe to call on retry or during boot migration. For soft-delete,
    /// use `soft_delete_node` (cascades + cleans FTS + drops embeddings).
    pub async fn upsert_workspace_mirror_node(
        &self,
        node_id: &str,
        parent_id: Option<&str>,
        node_type: &str,
        name: &str,
        icon: &str,
        position: f64,
        properties_json: &str,
        vault_rel_path: &str,
    ) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO workspace_nodes
               (id, parent_id, node_type, name, icon, position,
                created_at, updated_at, properties, body, vault_rel_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, '', ?9)
             ON CONFLICT(id) DO UPDATE SET
               parent_id      = excluded.parent_id,
               name           = excluded.name,
               icon           = excluded.icon,
               position       = excluded.position,
               properties     = excluded.properties,
               updated_at     = excluded.updated_at,
               vault_rel_path = excluded.vault_rel_path,
               deleted_at     = NULL",
            params![node_id, parent_id, node_type, name, icon, position, now, properties_json, vault_rel_path],
        )
        .map_err(|e| format!("upsert_workspace_mirror_node failed: {e}"))?;
        Ok(())
    }

    /// Update the `name` column on a workspace_nodes row. Used by `update_cell`
    /// when a primary RichText field is edited so the mirror node's display
    /// name (visible in tree view + search) tracks the row's title. Idempotent
    /// — silently no-ops if `node_id` is not present.
    pub async fn update_workspace_mirror_name(
        &self,
        node_id: &str,
        name: &str,
    ) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE workspace_nodes SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, node_id],
        )
        .map_err(|e| format!("update_workspace_mirror_name failed: {e}"))?;
        Ok(())
    }

    /// Returns the vault root directory path, migrating the legacy Handy folder name on demand.
    pub fn vault_root(&self, app: &tauri::AppHandle) -> std::path::PathBuf {
        resolve_vault_root(app)
    }

    /// §4.7: Mirror the Windows embedding rate-limit gate from `notes.rs`.
    /// On Windows the sidecar embedding pipeline correlates with native crashes,
    /// so background indexing is disabled. Users can still trigger explicit reindex.
    fn should_queue_workspace_indexing() -> bool {
        #[cfg(target_os = "windows")]
        { return false; }
        #[cfg(not(target_os = "windows"))]
        { true }
    }

    /// §4.5: Idempotent DELETE from workspace_fts — only deletes if the row
    /// actually exists, preventing FTS5 shadow-table corruption from phantom deletes.
    fn delete_workspace_fts_row(conn: &Connection, node_id: &str) -> Result<(), String> {
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM workspace_fts WHERE node_id = ?1)",
                params![node_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if exists {
            conn.execute(
                "DELETE FROM workspace_fts WHERE node_id = ?1",
                params![node_id],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn replace_workspace_fts_row(
        conn: &Connection,
        node_id: &str,
        title: &str,
        body: &str,
    ) -> Result<(), String> {
        // BEGIN IMMEDIATE ensures the DELETE and INSERT land in the same FTS5 segment
        // so automerge cannot produce a malformed inverted index from cross-segment
        // rowid reuse. Using execute_batch so we stay on &Connection (not &mut).
        conn.execute_batch("BEGIN IMMEDIATE")
            .map_err(|e| e.to_string())?;

        let result = (|| -> Result<(), String> {
            Self::delete_workspace_fts_row(conn, node_id)?;
            conn.execute(
                "INSERT INTO workspace_fts (node_id, title, body) VALUES (?1, ?2, ?3)",
                params![node_id, title, body],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        })();

        match result {
            Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string()),
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    fn build_row_indexable_text_from_parts(name: &str, properties_json: &str, body: &str) -> String {
        let mut parts = Vec::new();
        let trimmed_name = name.trim();
        if !trimmed_name.is_empty() {
            parts.push(trimmed_name.to_string());
        }
        let flattened_cells = Self::row_cells_flat_text(properties_json);
        if !flattened_cells.trim().is_empty() {
            parts.push(flattened_cells);
        }
        let trimmed_body = body.trim();
        if !trimmed_body.is_empty() {
            parts.push(trimmed_body.to_string());
        }
        parts.join(" ")
    }

    /// §4.2: Run `PRAGMA quick_check` on the workspace DB and rebuild workspace_fts.
    /// Called once at startup after `ensure_workspace_fts_populated`.
    ///
    /// §4.2: Run `PRAGMA quick_check` on the workspace DB and REINDEX workspace_fts
    /// if corruption is detected. Called once at startup after `ensure_workspace_fts_populated`.
    pub fn probe_and_repair(&self) -> Result<(), String> {
        let mut conn = self.conn.blocking_lock();
        let check: String = conn
            .query_row("PRAGMA quick_check", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if check == "ok" {
            return Ok(());
        }
        log::warn!(
            "[workspace] quick_check failed: {}. Running REINDEX on all FTS tables.",
            check
        );

        // Attempt REINDEX on workspace_fts. If it fails, try a full rebuild.
        // Phase A Commit 3 dropped the `notes_fts` branch with NotesManager —
        // the legacy notes_fts table may still exist in old workspace.db
        // instances, but it's orphan and harmless (no writers, no readers).
        // A future cleanup commit can DROP it explicitly; for now it just
        // sits unused.
        if let Err(e) = conn.execute("REINDEX workspace_fts", []) {
            log::error!("[workspace] REINDEX workspace_fts failed: {}. Attempting rebuild.", e);
            self.rebuild_workspace_fts_locked(&mut conn)?;
        }
        Ok(())
    }

    /// §4.6: DESIGN INVARIANT — this function must NEVER touch the filesystem.
    /// It reads only from `workspace_nodes` and writes only to `workspace_fts`.
    /// Adding any vault file I/O here would create a cascade loop via the file
    /// watcher (watcher → reindex → rebuild → write vault → watcher → …).
    fn rebuild_workspace_fts_locked(&self, conn: &mut Connection) -> Result<(), String> {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM workspace_fts", [])
            .map_err(|e| e.to_string())?;
        let mut stmt = tx
            .prepare(
                "SELECT id, node_type, name, properties, body
                 FROM workspace_nodes
                 WHERE node_type IN ('document','row','database') AND deleted_at IS NULL",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let id: String = row.get(0).map_err(|e| e.to_string())?;
            let node_type: String = row.get(1).map_err(|e| e.to_string())?;
            let name: String = row.get(2).map_err(|e| e.to_string())?;
            let properties: String = row.get(3).map_err(|e| e.to_string())?;
            let body: String = row.get(4).map_err(|e| e.to_string())?;
            let body_for_fts = match node_type.as_str() {
                "row" => Self::build_row_indexable_text_from_parts(&name, &properties, &body),
                "document" => body,
                "database" => String::new(),
                _ => continue,
            };
            tx.execute(
                "INSERT INTO workspace_fts (node_id, title, body) VALUES (?1, ?2, ?3)",
                params![id, name, body_for_fts],
            )
            .map_err(|e| e.to_string())?;
        }
        drop(rows);
        drop(stmt);
        tx.commit().map_err(|e| e.to_string())
    }

    /// Slugify a name for use in a vault file path.
    ///
    /// Safety invariants (all cross-platform):
    ///   • NFC-normalized — macOS NFD input and Linux NFC input produce the same
    ///     slug, so the same `.md` file resolves on every OS.
    ///   • Lowercase — case-insensitive FS (macOS default, Windows) won't see
    ///     two different nodes collide on disk.
    ///   • No trailing `.` or space — Windows strips these at the FS layer and
    ///     would silently rename our file.
    ///   • Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
    ///     get a `-` suffix so `File::create("con.md")` doesn't fail.
    ///   • Length capped at 80 bytes — keeps deeply-nested paths comfortably
    ///     under Windows MAX_PATH (260) even before long-path support.
    ///   • Never empty — empty name collapses to "untitled" so we never try to
    ///     create a file named just `.md`.
    fn slugify(name: &str) -> String {
        use unicode_normalization::UnicodeNormalization;

        // 1. NFC-normalize first so the slug is byte-identical for
        //    visually-identical names regardless of input encoding.
        let normalized: String = name.nfc().collect();
        let s = normalized.trim();

        // 2. Keep Unicode letters/numbers only; everything else (including
        //    whitespace) becomes `-`.  Spaces-as-dashes keeps vault paths
        //    URL-safe and matches the database slugger — so `node://uuid`
        //    clicks and `databases/<slug>/` exports round-trip identically.
        let s: String = regex::Regex::new(r"[^\p{L}\p{N}]+")
            .map(|re| re.replace_all(s, "-").into_owned())
            .unwrap_or_else(|_| s.to_string());
        let s: String = regex::Regex::new(r"-+")
            .map(|re| re.replace_all(&s, "-").into_owned())
            .unwrap_or_else(|_| s.clone());

        // 3. Trim dashes, then lowercase.  Also strip trailing dots/spaces
        //    which Windows silently strips from filenames.
        let mut s = s.trim_matches(['-', '.', ' ']).to_lowercase();
        if s.is_empty() {
            s = "untitled".to_string();
        }

        // 4. Cap length by *bytes* so path assembly stays under MAX_PATH.
        //    Truncate on a char boundary — never split a multi-byte codepoint.
        const MAX_SLUG_BYTES: usize = 80;
        if s.len() > MAX_SLUG_BYTES {
            let mut cut = MAX_SLUG_BYTES;
            while !s.is_char_boundary(cut) && cut > 0 {
                cut -= 1;
            }
            s.truncate(cut);
            // Re-trim in case we cut mid-dash-run.
            s = s.trim_matches(['-', '.', ' ']).to_string();
            if s.is_empty() {
                s = "untitled".to_string();
            }
        }

        // 5. Windows reserved device names — case-insensitive.  Applies to the
        //    bare stem; we append a dash so `con` → `con-`, which Windows
        //    accepts.  Match is done against the whole slug (no embedded dots
        //    because we already stripped punctuation).
        const RESERVED: &[&str] = &[
            "con", "prn", "aux", "nul",
            "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
            "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
        ];
        if RESERVED.contains(&s.as_str()) {
            s.push('-');
        }

        s
    }

    /// Compute the vault-relative path for a node using its pre-fetched ancestor chain.
    /// Documents: `<slug-ancestor>/…/<slug-name>.md`
    /// Databases:  always returns None (databases have no vault file).
    ///
    /// `ancestor_chain` must be in root→leaf order (i.e. the direct parent is last).
    /// The caller is responsible for building this list via `get_ancestor_chain`.
    pub fn compute_vault_rel_path(
        &self,
        node: &WorkspaceNode,
        ancestor_chain: &[WorkspaceNode],
    ) -> Option<String> {
        if node.node_type == "database" {
            return None;
        }
        let mut segments: Vec<String> = ancestor_chain
            .iter()
            .map(|n| Self::slugify(&n.name))
            .collect();
        segments.push(Self::slugify(&node.name));
        Some(segments.join("/") + ".md")
    }

    /// Walk from `parent_id` up to the workspace root and return the ancestor
    /// chain in **root→leaf** order (i.e. the direct parent of `node` is last).
    /// Stops at root-level nodes (parent_id IS NULL) so the node itself is never
    /// included — that's the caller's responsibility.
    pub async fn get_ancestor_chain(
        &self,
        parent_id: Option<String>,
    ) -> Result<Vec<WorkspaceNode>, String> {
        let mut ancestors: Vec<WorkspaceNode> = Vec::new();
        let mut current = parent_id;
        // Safety cap: workspaces deeper than 64 levels are pathological.
        for _ in 0..64 {
            let pid = match current {
                Some(ref p) => p.clone(),
                None => break,
            };
            let conn = self.conn.lock().await;
            let Some(node) = self.get_node_internal(&conn, &pid)? else {
                break;
            };
            current = node.parent_id.clone();
            ancestors.push(node);
        }
        // ancestors is leaf→root; reverse to root→leaf
        ancestors.reverse();
        Ok(ancestors)
    }

    /// Read the `id:` field from a vault file's YAML frontmatter.
    /// Returns None if the file doesn't exist, has no frontmatter, or has no `id:` line.
    fn vault_file_node_id(path: &std::path::Path) -> Option<String> {
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

    /// Write a node's body + frontmatter to its vault file.
    /// Returns the written vault_rel_path on success.
    ///
    /// Uses an atomic temp-file + rename so a crash mid-write never leaves a
    /// corrupt/truncated file.
    ///
    /// `last_seen_mtime_secs`: Unix timestamp (seconds) recorded when the editor
    /// last read this node.  When `Some`, the Rule 13 conflict guard fires:
    /// if the file on disk has been modified after `last_seen_mtime_secs + 1s`,
    /// the write is rejected and `Err("VAULT_CONFLICT:{...}")` is returned so
    /// the frontend can show the reload/keep/diff dialog.  Pass `None` for
    /// create or move operations where the guard does not apply.
    pub async fn write_node_to_vault(
        &self,
        app: &tauri::AppHandle,
        node: &WorkspaceNode,
        last_seen_mtime_secs: Option<i64>,
    ) -> Result<String, String> {
        if node.node_type == "database" || node.deleted_at.is_some() {
            return Err("Cannot write database or deleted node to vault".to_string());
        }
        // Bug 2 fix: build the real ancestor chain so paths are nested correctly.
        let ancestor_chain = self.get_ancestor_chain(node.parent_id.clone()).await?;
        let base_rel_path = self.compute_vault_rel_path(node, &ancestor_chain)
            .ok_or_else(|| "Cannot compute vault path for node".to_string())?;
        let vault_root = self.vault_root(app);

        // Resolve path collision: if the target file exists and belongs to a different
        // node, append a short id suffix so the two notes don't overwrite each other.
        let rel_path = {
            let candidate = vault_root.join(&base_rel_path);
            if candidate.exists() {
                let existing_id = Self::vault_file_node_id(&candidate);
                // If the file exists but we can't determine the owner (None), or it belongs
                // to someone else, we MUST NOT overwrite it. Preserving potentially
                // corrupted or unreadable data is safer than wiping it.
                if existing_id.as_deref() != Some(&node.id) {
                    // Collision — use <slug>-<first 8 chars of node id>.md
                    let short_id = &node.id[..node.id.len().min(8)];
                    base_rel_path.strip_suffix(".md")
                        .map(|stem| format!("{stem}-{short_id}.md"))
                        .unwrap_or_else(|| format!("{base_rel_path}-{short_id}"))
                } else {
                    base_rel_path
                }
            } else {
                base_rel_path
            }
        };

        let file_path = vault_root.join(&rel_path);
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create vault directory: {e}"))?;
        }
        let frontmatter = format!(
            "---\nid: {}\nparent_id: {}\ntitle: {}\nicon: {}\ncreated_at: {}\nupdated_at: {}\nproperties_json: '{}'\nvault_version: 1\n---\n{}",
            node.id,
            node.parent_id.as_deref().unwrap_or("null"),
            node.name,
            node.icon,
            chrono::DateTime::from_timestamp(node.created_at, 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default(),
            chrono::DateTime::from_timestamp(node.updated_at, 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default(),
            node.properties,
            node.body,
        );
        // ─── ORDER MATTERS — DO NOT SWAP ────────────────────────────────────
        // 1) Idempotency fast-path: if disk already matches our proposed bytes,
        //    there is nothing to write and therefore nothing to conflict over.
        // 2) Rule 13 conflict guard: only AFTER establishing that we would
        //    actually overwrite something do we check whether that something
        //    was modified externally.
        //
        // Swapping these would show the user a spurious VAULT_CONFLICT dialog
        // whenever disk mtime is newer than last_seen but content is identical
        // (e.g. a sync tool touched the file, or another process wrote the
        // same bytes back).  That dialog is a destructive UX moment — we only
        // fire it when it represents a real data decision.
        // ────────────────────────────────────────────────────────────────────

        // (1) Idempotency fast-path: byte-equal = no-op.  Payoffs:
        //   • Zero vault churn when autosave fires repeatedly without real edits
        //     (cursor moves, selection changes that bubble to onChange).
        //   • mtime stays stable, so future Rule 13 guards won't false-fire
        //     from clock skew / FS granularity against a freshly-bumped mtime.
        //   • Cheap — 100KB `read` + `eq` is well under 1ms on SSD.
        //   • Suppresses false VAULT_CONFLICT when the external and in-memory
        //     bodies happen to converge on the same bytes.
        if file_path.exists() {
            if let Ok(existing) = std::fs::read(&file_path) {
                if existing == frontmatter.as_bytes() {
                    return Ok(rel_path);
                }
            }
        }

        // (2) Rule 13: External-edit conflict guard.
        // If the caller tracked when they last read this file, compare that
        // timestamp against the on-disk mtime.  If the file was modified after
        // last_seen + 1s (tolerance for FS granularity), reject the write and
        // return a structured error the frontend parses to show the conflict UI.
        if let (Some(last_seen_secs), true) = (last_seen_mtime_secs, file_path.exists()) {
            if let Ok(metadata) = std::fs::metadata(&file_path) {
                if let Ok(disk_mtime) = metadata.modified() {
                    use std::time::{Duration, UNIX_EPOCH};
                    let last_seen_time = UNIX_EPOCH
                        + Duration::from_secs(last_seen_secs.max(0) as u64);
                    if disk_mtime > last_seen_time + Duration::from_secs(1) {
                        let disk_secs = disk_mtime
                            .duration_since(UNIX_EPOCH)
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);
                        return Err(format!(
                            "VAULT_CONFLICT:{{\"node_id\":\"{}\",\"disk_mtime_secs\":{},\"last_seen_secs\":{}}}",
                            node.id, disk_secs, last_seen_secs
                        ));
                    }
                }
            }
        }

        // Atomic write via temp file + rename to prevent corrupt vault files on
        // crash mid-write.
        let temp_file = file_path.with_file_name(
            format!(".tmp_{}", uuid::Uuid::new_v4())
        );
        std::fs::write(&temp_file, &frontmatter)
            .map_err(|e| format!("Failed to write vault temp file: {e}"))?;
        std::fs::rename(&temp_file, &file_path)
            .map_err(|e| {
                // Best-effort cleanup of the temp file on rename failure.
                let _ = std::fs::remove_file(&temp_file);
                format!("Failed to finalize vault file: {e}")
            })?;
        Ok(rel_path)
    }

    /// Update `vault_rel_path` in the DB for a node after writing its vault file.
    pub async fn update_vault_rel_path(&self, node_id: &str, vault_rel_path: &str) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE workspace_nodes SET vault_rel_path = ?1 WHERE id = ?2",
            params![vault_rel_path, node_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Sync all workspace_nodes that lack a vault_rel_path to disk.
    /// Emits progress events via the Tauri event system.
    pub async fn sync_all_nodes_to_vault(&self, app: &tauri::AppHandle) -> Result<usize, String> {
        let nodes: Vec<WorkspaceNode> = {
            let conn = self.conn.lock().await;
            let mut stmt = conn
                .prepare(
                    "SELECT id, parent_id, node_type, name, icon, position, created_at,
                            updated_at, deleted_at, properties, body, vault_rel_path
                     FROM workspace_nodes
                     WHERE deleted_at IS NULL
                       AND node_type = 'document'",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(WorkspaceNode {
                        id: row.get(0)?,
                        parent_id: row.get(1)?,
                        node_type: row.get(2)?,
                        name: row.get(3)?,
                        icon: row.get(4)?,
                        position: row.get(5)?,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                        deleted_at: row.get(8)?,
                        properties: row.get(9)?,
                        body: row.get(10)?,
                        vault_rel_path: row.get(11)?,
                    })
                })
                .map_err(|e| e.to_string())?;
            rows.map(|r| r.map_err(|e| e.to_string()))
                .filter_map(|r| r.ok())
                .filter(|n: &WorkspaceNode| n.vault_rel_path.is_none() || n.vault_rel_path.as_ref().is_none())
                .collect()
        };
        let total = nodes.len();
        let mut synced = 0;
        for (i, node) in nodes.into_iter().enumerate() {
            match self.write_node_to_vault(app, &node, None).await {
                Ok(rel_path) => {
                    if let Err(e) = self.update_vault_rel_path(&node.id, &rel_path).await {
                        log::error!("Failed to update vault_rel_path for node {}: {}", node.id, e);
                    } else {
                        synced += 1;
                    }
                }
                Err(e) => {
                    log::error!("Failed to sync node {} to vault: {}", node.id, e);
                }
            }
            let _ = app.emit(
                "vault-sync-progress",
                serde_json::json!({ "current": i + 1, "total": total }),
            );
        }
        Ok(synced)
    }

    /// Find or create a root-level `document` used as a transcription folder (exact `name`).
    pub async fn ensure_transcription_folder(&self, app: &tauri::AppHandle, display_name: &str) -> Result<String, String> {
        // Cache may hold an id for a folder the user soft-deleted; `get_node` still returns that row.
        let cached_id = {
            let cache = self.transcription_folder_cache.lock().await;
            cache.get(display_name).cloned()
        };
        if let Some(ref id) = cached_id {
            if let Some(node) = self.get_node(id).await? {
                if node.deleted_at.is_none() {
                    return Ok(id.clone());
                }
            }
        }
        self.transcription_folder_cache
            .lock()
            .await
            .remove(display_name);

        let found: Option<String> = {
            let conn = self.conn.lock().await;
            let mut stmt = conn
                .prepare(
                    "SELECT id FROM workspace_nodes \
                     WHERE parent_id IS NULL AND deleted_at IS NULL \
                     AND node_type = 'document' AND name = ?1 LIMIT 1",
                )
                .map_err(|e| e.to_string())?;
            stmt.query_row(params![display_name], |row| row.get(0))
                .optional()
                .map_err(|e| e.to_string())?
        };

        let id = if let Some(id) = found {
            id
        } else {
            let node = self
                .create_node_raw(&None, "document", display_name, "", "", None)
                .await?;
            if let Err(e) = self.write_node_to_vault(app, &node, None).await {
                log::error!("Failed to write newly created transcription folder '{}' to vault: {}", display_name, e);
            }
            node.id
        };

        self.transcription_folder_cache
            .lock()
            .await
            .insert(display_name.to_string(), id.clone());
        Ok(id)
    }

    pub async fn create_document_child(
        &self,
        parent_id: &str,
        name: &str,
        icon: &str,
        body: &str,
    ) -> Result<WorkspaceNode, String> {
        self.create_node_raw(
            &Some(parent_id.to_string()),
            "document",
            name,
            icon,
            body,
            None,
        )
        .await
    }

    /// Create a document child with custom `properties` JSON (e.g. voice memo mirror metadata).
    pub async fn create_document_child_with_properties(
        &self,
        parent_id: &str,
        name: &str,
        icon: &str,
        body: &str,
        properties_json: &str,
    ) -> Result<WorkspaceNode, String> {
        self.create_node_raw(
            &Some(parent_id.to_string()),
            "document",
            name,
            icon,
            body,
            Some(properties_json),
        )
        .await
    }

    /// Workspace document whose `properties.voice_memo_mirror.note_id` matches the SQLite note id.
    pub async fn find_document_id_by_voice_memo_mirror_note_id(
        &self,
        note_id: &str,
    ) -> Result<Option<String>, String> {
        let needle = format!(r#""note_id":"{note_id}""#);
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id FROM workspace_nodes \
                 WHERE deleted_at IS NULL AND node_type = 'document' \
                 AND instr(properties, ?1) > 0 \
                 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        stmt.query_row(params![needle], |row| row.get(0))
            .optional()
            .map_err(|e| e.to_string())
    }

    /// Update document body + FTS only (no page-link rewrite, no embedding queue). For live transcripts.
    pub async fn update_node_body_persist_only(
        &self,
        id: &str,
        body: &str,
    ) -> Result<WorkspaceNode, String> {
        let now = chrono::Utc::now().timestamp();
        {
            let conn = self.conn.lock().await;
            conn.execute(
                "UPDATE workspace_nodes SET body = ?1, updated_at = ?2 WHERE id = ?3",
                params![body, now, id],
            )
            .map_err(|e| e.to_string())?;
        }

        let node = self
            .get_node(id)
            .await?
            .ok_or_else(|| "Node not found".to_string())?;

        if node.deleted_at.is_none() {
            self.sync_node_fts(&node).await?;
        }

        Ok(node)
    }

    /// Update `properties.voice_memo_mirror.audio_file_path` for a mirrored Mic Transcribe document.
    pub async fn update_voice_memo_mirror_audio_path(
        &self,
        node_id: &str,
        audio_file_path: Option<&str>,
    ) -> Result<(), String> {
        let node = self
            .get_node(node_id)
            .await?
            .ok_or_else(|| "Node not found".to_string())?;
        let mut props: serde_json::Value =
            serde_json::from_str(&node.properties).map_err(|e| e.to_string())?;
        let Some(mirror) = props.get_mut("voice_memo_mirror") else {
            return Ok(());
        };
        if mirror.is_null() {
            return Ok(());
        }
        if let Some(obj) = mirror.as_object_mut() {
            match audio_file_path {
                Some(p) if !p.trim().is_empty() => {
                    obj.insert("audio_file_path".to_string(), serde_json::json!(p));
                }
                Some(_) | None => {
                    obj.insert("audio_file_path".to_string(), serde_json::Value::Null);
                }
            }
        }
        let new_props = props.to_string();
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE workspace_nodes SET properties = ?1, updated_at = ?2 WHERE id = ?3",
            params![new_props, now, node_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Overwrite `properties` JSON for a node (no body / FTS / embed changes). Used by
    /// post-create patches (e.g. self-referencing voice_memo_mirror.note_id after the
    /// workspace id is known). Caller passes a pre-serialized JSON object.
    pub async fn update_node_properties(
        &self,
        id: &str,
        properties_json: &str,
    ) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE workspace_nodes SET properties = ?1, updated_at = ?2 WHERE id = ?3",
            params![properties_json, now, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Full search index: page links + vector embedding (call after capture ends or debounced idle).
    pub async fn finalize_node_search_index(&self, id: &str) -> Result<(), String> {
        let node = self
            .get_node(id)
            .await?
            .ok_or_else(|| "Node not found".to_string())?;
        if node.deleted_at.is_some() {
            return Ok(());
        }
        self.replace_page_links_for_source(id, &node.body, &node.node_type)
            .await?;
        if Self::should_queue_workspace_indexing() {
            if let Some(w) = &self.embedding_worker {
                w.enqueue_index(
                    node.id.clone(),
                    format!("{} {}", node.name, node.body),
                );
            }
        }
        Ok(())
    }

    /// Returns a reference to the underlying connection, for use by migration
    /// and other managers that need to read/write the workspace DB directly.
    pub fn conn(&self) -> &Arc<Mutex<Connection>> {
        &self.conn
    }

    pub fn migrate(&self) -> Result<(), rusqlite_migration::Error> {
        let mut conn = self.conn.blocking_lock();
        Self::migrations().to_latest(&mut conn)?;
        Ok(())
    }

    /// Construct the canonical migrations list. Exposed at crate scope so
    /// migration-correctness tests can apply the full vec to a fresh
    /// in-memory DB without spinning up a `WorkspaceManager` (which pulls
    /// in `EmbeddingWorker` + AppHandle-bound deps).
    pub(crate) fn migrations() -> Migrations<'static> {
        Migrations::new(vec![
            M::up(r#"
                CREATE TABLE IF NOT EXISTS workspace_nodes (
                    id TEXT PRIMARY KEY,
                    parent_id TEXT REFERENCES workspace_nodes(id) ON DELETE CASCADE,
                    node_type TEXT NOT NULL CHECK(node_type IN ('document','database','row')),
                    name TEXT NOT NULL,
                    icon TEXT NOT NULL DEFAULT '📄',
                    position INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    deleted_at INTEGER,
                    properties TEXT NOT NULL DEFAULT '{}',
                    body TEXT NOT NULL DEFAULT '[]'
                );

                CREATE TABLE IF NOT EXISTS node_views (
                    id TEXT PRIMARY KEY,
                    node_id TEXT NOT NULL REFERENCES workspace_nodes(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    layout TEXT NOT NULL CHECK(layout IN ('board','grid','calendar','list','table','gallery')),
                    position INTEGER NOT NULL DEFAULT 0,
                    color TEXT,
                    filters TEXT NOT NULL DEFAULT '[]',
                    sorts TEXT NOT NULL DEFAULT '[]',
                    view_options TEXT NOT NULL DEFAULT '{}',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS node_comments (
                    id TEXT PRIMARY KEY,
                    node_id TEXT NOT NULL REFERENCES workspace_nodes(id) ON DELETE CASCADE,
                    author TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS node_templates (
                    id TEXT PRIMARY KEY,
                    node_id TEXT NOT NULL REFERENCES workspace_nodes(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    template_data TEXT NOT NULL DEFAULT '{}',
                    position INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_wn_parent ON workspace_nodes(parent_id);
                CREATE INDEX IF NOT EXISTS idx_wn_node_type ON workspace_nodes(node_type);
                CREATE INDEX IF NOT EXISTS idx_nv_node ON node_views(node_id);
                CREATE INDEX IF NOT EXISTS idx_nc_node ON node_comments(node_id);
                CREATE INDEX IF NOT EXISTS idx_nt_node ON node_templates(node_id);
            "#),
            M::up(
                r#"
                PRAGMA foreign_keys = OFF;
                CREATE TABLE workspace_nodes_v2 (
                    id         TEXT PRIMARY KEY,
                    parent_id  TEXT REFERENCES workspace_nodes_v2(id) ON DELETE CASCADE,
                    node_type  TEXT NOT NULL CHECK(node_type IN ('document','database','row')),
                    name       TEXT NOT NULL,
                    icon       TEXT NOT NULL DEFAULT '📄',
                    position   REAL NOT NULL DEFAULT 0.0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    deleted_at INTEGER,
                    properties TEXT NOT NULL DEFAULT '{}',
                    body       TEXT NOT NULL DEFAULT ''
                );
                INSERT INTO workspace_nodes_v2 SELECT
                    id, parent_id, node_type, name, icon,
                    CAST(position AS REAL),
                    created_at, updated_at, deleted_at, properties,
                    ''
                FROM workspace_nodes;
                DROP TABLE workspace_nodes;
                ALTER TABLE workspace_nodes_v2 RENAME TO workspace_nodes;
                CREATE TABLE node_views_v2 (
                    id           TEXT PRIMARY KEY,
                    node_id      TEXT NOT NULL REFERENCES workspace_nodes(id) ON DELETE CASCADE,
                    name         TEXT NOT NULL,
                    layout       TEXT NOT NULL,
                    position     REAL NOT NULL DEFAULT 0.0,
                    color        TEXT,
                    filters      TEXT NOT NULL DEFAULT '[]',
                    sorts        TEXT NOT NULL DEFAULT '[]',
                    view_options TEXT NOT NULL DEFAULT '{}',
                    created_at   INTEGER NOT NULL,
                    updated_at   INTEGER NOT NULL
                );
                INSERT INTO node_views_v2 SELECT
                    id, node_id, name, layout,
                    CAST(position AS REAL),
                    color, filters, sorts, view_options, created_at, updated_at
                FROM node_views;
                DROP TABLE node_views;
                ALTER TABLE node_views_v2 RENAME TO node_views;
                CREATE TABLE IF NOT EXISTS page_links (
                  source_node_id TEXT NOT NULL
                    REFERENCES workspace_nodes(id) ON DELETE CASCADE,
                  target_node_id TEXT NOT NULL
                    REFERENCES workspace_nodes(id) ON DELETE CASCADE,
                  PRIMARY KEY (source_node_id, target_node_id)
                );
                CREATE INDEX IF NOT EXISTS idx_page_links_target ON page_links(target_node_id);
                CREATE VIRTUAL TABLE IF NOT EXISTS workspace_fts USING fts5(
                  node_id UNINDEXED,
                  title,
                  body
                );
                CREATE TABLE IF NOT EXISTS user_preferences (
                  key   TEXT PRIMARY KEY,
                  value TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_wn_parent ON workspace_nodes(parent_id);
                CREATE INDEX IF NOT EXISTS idx_wn_node_type ON workspace_nodes(node_type);
                CREATE INDEX IF NOT EXISTS idx_nv_node ON node_views(node_id);
                PRAGMA foreign_keys = ON;
            "#,
            ),
            M::up(
                r#"
                UPDATE node_views
                SET layout = 'grid',
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER)
                WHERE layout IN ('list', 'gallery');
            "#,
            ),
            M::up(
                r#"
                UPDATE node_views
                SET layout = 'grid',
                    updated_at = CAST(strftime('%s', 'now') AS INTEGER)
                WHERE layout = 'table';
            "#,
            ),
            M::up(
                r#"
                ALTER TABLE workspace_nodes ADD COLUMN vault_rel_path TEXT;
            "#,
            ),
            // Phase A — sqlite-vec in-DB vectors + backfill queue + Rule 19
            // model-provenance table. Depends on `sqlite_vec::sqlite3_auto_extension()`
            // being called before this migration runs (wired in lib.rs `run()`).
            // If vec0 isn't registered, `CREATE VIRTUAL TABLE ... USING vec0(...)`
            // errors at schema time and migration fails loud — desired behaviour.
            M::up(
                r#"
                -- vec0 virtual table: one row per (node, chunk) embedding.
                -- Schema finalized via spike (spikes/sqlite_vec_spike/):
                --   * node_id as partition key lets KNN queries pre-filter by
                --     node when we're scoping a search to a sub-tree later.
                --   * chunk_index is metadata (not indexed by vec0); queryable
                --     via ordinary SQL WHERE.
                --   * embedding float[384] matches bge-small-en-v1.5 output.
                --   * distance_metric=cosine matches BGE's recommended
                --     similarity metric.
                -- Implicit rowid is the PK (one node => many chunk rows).
                CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
                    node_id TEXT partition key,
                    chunk_index INTEGER,
                    embedding float[384] distance_metric=cosine
                );

                -- Rule 19: record the model identity alongside its vectors so
                -- boot-time comparison can detect a swap. Singleton table
                -- (CHECK id = 1). Populated by the embedding manager on first
                -- successful session load; stays empty until then so fresh
                -- installs pre-model-download don't pretend to have data.
                CREATE TABLE IF NOT EXISTS embedding_model_info (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    model_id TEXT NOT NULL,
                    dimension INTEGER NOT NULL,
                    model_hash TEXT NOT NULL
                );

                -- Durable work queue for the backfill pipeline. Survives
                -- crashes — on boot, any 'in_progress' rows flip to 'pending'
                -- so a crash mid-chunk resumes cleanly from the last batch.
                -- Rows are deleted on success (not kept as 'done' — the
                -- absence-of-row is the completion signal, and vec_embeddings
                -- is the authoritative "embedded?" query source).
                CREATE TABLE IF NOT EXISTS embed_backfill_queue (
                    node_id TEXT PRIMARY KEY,
                    chunk_index INTEGER NOT NULL DEFAULT 0,
                    state TEXT NOT NULL
                        CHECK (state IN ('pending', 'in_progress', 'error')),
                    attempts INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT,
                    enqueued_at INTEGER NOT NULL
                );
                -- Worker's hot query is
                -- `WHERE state = 'pending' ORDER BY enqueued_at LIMIT N`.
                -- Composite pre-orders the pending subset so LIMIT can
                -- short-circuit without an in-memory sort once the index
                -- range is exhausted.
                CREATE INDEX IF NOT EXISTS idx_ebq_state
                    ON embed_backfill_queue(state, enqueued_at);

                -- Seed the queue with every currently-embeddable node. On
                -- fresh install this is a no-op (zero workspace_nodes rows).
                -- On an upgrade install it enqueues the entire existing
                -- vault for backfill. Eligibility mirrors workspace_fts
                -- seeding: document, row, and database node types, excluding
                -- soft-deleted ones.
                INSERT OR IGNORE INTO embed_backfill_queue
                    (node_id, chunk_index, state, attempts, last_error, enqueued_at)
                SELECT
                    id,
                    0,
                    'pending',
                    0,
                    NULL,
                    CAST(strftime('%s', 'now') AS INTEGER)
                FROM workspace_nodes
                WHERE deleted_at IS NULL
                  AND node_type IN ('document', 'row', 'database');
            "#,
            ),
            // Phase B — onboarding state. Single-row table tracks the user's
            // progression through the 6-step Apple-style onboarding. Isolated
            // from `user_preferences` (D12) so partial-completion recovery on
            // crash has a clean shape and schema churn here doesn't ripple
            // through the pref-value loop.
            M::up(
                r#"
                CREATE TABLE IF NOT EXISTS onboarding_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    current_step TEXT NOT NULL
                        CHECK (current_step IN (
                            'welcome', 'theme', 'mic',
                            'accessibility', 'models', 'vault', 'extensions', 'done'
                        )),
                    mic_permission TEXT
                        CHECK (mic_permission IS NULL OR mic_permission IN (
                            'granted', 'denied', 'skipped'
                        )),
                    accessibility_permission TEXT
                        CHECK (accessibility_permission IS NULL OR accessibility_permission IN (
                            'granted', 'denied', 'skipped', 'not_applicable'
                        )),
                    models_downloaded TEXT,  -- JSON array of model ids
                    vault_root TEXT,
                    started_at INTEGER NOT NULL,
                    completed_at INTEGER
                );
            "#,
            ),
            M::up(r#"
                -- Rule 19: model identity for the cross-encoder reranker (W3).
                -- Singleton (CHECK id = 1). Populated by RerankerHandle on first
                -- successful session load. Mismatch on boot invalidates the
                -- in-memory rerank LRU (no persisted scores to delete).
                CREATE TABLE IF NOT EXISTS reranker_model_info (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    model_id TEXT NOT NULL,
                    model_hash TEXT NOT NULL
                );
            "#),
        ])
    }

    /// Populate `workspace_fts` when under-filled (e.g. immediately after migration 2).
    pub fn ensure_workspace_fts_populated(&self) -> Result<(), String> {
        let mut conn = self.conn.blocking_lock();
        let fts_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM workspace_fts", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let distinct_node_count: i64 = conn
            .query_row(
                "SELECT COUNT(DISTINCT node_id) FROM workspace_fts",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let eligible: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM workspace_nodes WHERE node_type IN ('document','row','database') AND deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if fts_count == eligible && distinct_node_count == eligible {
            return Ok(());
        }
        log::warn!(
            "Rebuilding workspace_fts (rows={}, distinct_nodes={}, eligible_nodes={})",
            fts_count,
            distinct_node_count,
            eligible
        );
        self.rebuild_workspace_fts_locked(&mut conn)
    }

    /// Re-index a single workspace node in the FTS table.
    /// Called by the vault file watcher when an external edit is detected.
    pub fn reindex_node_fts(&self, node_id: &str) -> Result<(), String> {
        let conn = self.conn.blocking_lock();
        let node: (String, String, String, String, String) = conn
            .query_row(
                "SELECT id, node_type, name, properties, body
                 FROM workspace_nodes
                 WHERE id = ?1 AND deleted_at IS NULL",
                params![node_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .map_err(|e| e.to_string())?;
        let body_for_fts = match node.1.as_str() {
            "row" => Self::build_row_indexable_text_from_parts(&node.2, &node.3, &node.4),
            "database" => String::new(),
            _ => node.4,
        };
        Self::replace_workspace_fts_row(&conn, &node.0, &node.2, &body_for_fts)
    }

    // ─── Node CRUD ─────────────────────────────────────────────────────────────

    pub async fn create_node(
        &self,
        parent_id: Option<String>,
        node_type: &str,
        name: &str,
        icon: &str,
    ) -> Result<WorkspaceNode, String> {
        self.create_node_raw(&parent_id, node_type, name, icon, "", None)
            .await
    }

    pub async fn get_node(&self, id: &str) -> Result<Option<WorkspaceNode>, String> {
        let conn = self.conn.lock().await;
        self.get_node_internal(&conn, id)
    }

    fn get_node_internal(&self, conn: &Connection, id: &str) -> Result<Option<WorkspaceNode>, String> {
        let mut stmt = conn
            .prepare("SELECT id, parent_id, node_type, name, icon, position, created_at, updated_at, deleted_at, properties, body, vault_rel_path FROM workspace_nodes WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        let mut rows = stmt.query(params![id]).map_err(|e| e.to_string())?;

        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            Ok(Some(WorkspaceNode {
                id: row.get(0).map_err(|e| e.to_string())?,
                parent_id: row.get(1).map_err(|e| e.to_string())?,
                node_type: row.get(2).map_err(|e| e.to_string())?,
                name: row.get(3).map_err(|e| e.to_string())?,
                icon: row.get(4).map_err(|e| e.to_string())?,
                position: row.get(5).map_err(|e| e.to_string())?,
                created_at: row.get(6).map_err(|e| e.to_string())?,
                updated_at: row.get(7).map_err(|e| e.to_string())?,
                deleted_at: row.get(8).map_err(|e| e.to_string())?,
                properties: row.get(9).map_err(|e| e.to_string())?,
                body: row.get(10).map_err(|e| e.to_string())?,
                vault_rel_path: row.get(11).map_err(|e| e.to_string())?,
            }))
        } else {
            Ok(None)
        }
    }

    pub async fn get_node_children(&self, parent_id: &str) -> Result<Vec<WorkspaceNode>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare("SELECT id, parent_id, node_type, name, icon, position, created_at, updated_at, deleted_at, properties, body, vault_rel_path FROM workspace_nodes WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY position")
            .map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![parent_id], |row| {
            Ok(WorkspaceNode {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                node_type: row.get(2)?,
                name: row.get(3)?,
                icon: row.get(4)?,
                position: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                deleted_at: row.get(8)?,
                properties: row.get(9)?,
                body: row.get(10)?,
                vault_rel_path: row.get(11)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub async fn get_root_nodes(&self) -> Result<Vec<WorkspaceNode>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare("SELECT id, parent_id, node_type, name, icon, position, created_at, updated_at, deleted_at, properties, body, vault_rel_path FROM workspace_nodes WHERE parent_id IS NULL AND deleted_at IS NULL ORDER BY position")
            .map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |row| {
            Ok(WorkspaceNode {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                node_type: row.get(2)?,
                name: row.get(3)?,
                icon: row.get(4)?,
                position: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                deleted_at: row.get(8)?,
                properties: row.get(9)?,
                body: row.get(10)?,
                vault_rel_path: row.get(11)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub async fn get_all_workspace_nodes(&self) -> Result<Vec<WorkspaceNode>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, parent_id, node_type, name, icon, position, created_at,
                        updated_at, deleted_at, properties, body, vault_rel_path
                 FROM workspace_nodes
                 WHERE deleted_at IS NULL
                 ORDER BY parent_id, position",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(WorkspaceNode {
                    id: row.get(0)?,
                    parent_id: row.get(1)?,
                    node_type: row.get(2)?,
                    name: row.get(3)?,
                    icon: row.get(4)?,
                    position: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                    deleted_at: row.get(8)?,
                    properties: row.get(9)?,
                    body: row.get(10)?,
                    vault_rel_path: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub async fn update_node(
        &self,
        id: &str,
        name: &str,
        icon: &str,
        properties: &str,
        body: &str,
    ) -> Result<WorkspaceNode, String> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.clone();

        {
            let conn_locked = conn.lock().await;
            conn_locked.execute(
                "UPDATE workspace_nodes SET name = ?1, icon = ?2, properties = ?3, body = ?4, updated_at = ?5 WHERE id = ?6",
                params![name, icon, properties, body, now, id],
            ).map_err(|e| e.to_string())?;
        }

        let node = self
            .get_node(id)
            .await?
            .ok_or_else(|| "Node not found".to_string())?;

        if node.deleted_at.is_none() {
            self.sync_node_fts(&node).await?;
            self.replace_page_links_for_source(id, body, &node.node_type)
                .await?;
            let index_blob = if node.node_type == "row" {
                self.build_row_indexable_text(&node).await
            } else {
                format!("{} {}", node.name, body)
            };
            if Self::should_queue_workspace_indexing() {
                if let Some(w) = &self.embedding_worker {
                    w.enqueue_index(node.id.clone(), index_blob);
                }
            }
        }

        Ok(node)
    }

    pub async fn sync_document_body_from_vault(
        &self,
        id: &str,
        body: &str,
    ) -> Result<Option<WorkspaceNode>, String> {
        let trimmed_body = body.trim().to_string();
        let maybe_updated = {
            let conn = self.conn.lock().await;
            let Some(existing) = self.get_node_internal(&conn, id)? else {
                return Ok(None);
            };
            if existing.node_type != "document"
                || existing.deleted_at.is_some()
                || existing.body.trim() == trimmed_body
            {
                return Ok(None);
            }

            let now = chrono::Utc::now().timestamp();
            conn.execute(
                "UPDATE workspace_nodes SET body = ?1, updated_at = ?2 WHERE id = ?3",
                params![trimmed_body, now, id],
            )
            .map_err(|e| e.to_string())?;
            self.get_node_internal(&conn, id)?
        };

        let Some(updated) = maybe_updated else {
            return Ok(None);
        };
        self.sync_node_fts(&updated).await?;
        self.replace_page_links_for_source(id, &updated.body, &updated.node_type)
            .await?;
        if Self::should_queue_workspace_indexing() {
            if let Some(w) = &self.embedding_worker {
                w.enqueue_index(
                    updated.id.clone(),
                    format!("{} {}", updated.name, updated.body),
                );
            }
        }
        Ok(Some(updated))
    }

    pub async fn soft_delete_node(&self, id: &str) -> Result<(), String> {
        let node = self
            .get_node(id)
            .await?
            .ok_or_else(|| "Node not found".to_string())?;
        if node.deleted_at.is_some() {
            return Ok(());
        }

        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.clone();
        let conn_locked = conn.lock().await;
        let descendant_ids = self.get_descendant_ids_internal(&conn_locked, id)?;
        let all_ids: Vec<String> = once(id.to_string())
            .chain(descendant_ids.into_iter())
            .collect();

        for nid in &all_ids {
            conn_locked
                .execute(
                    "UPDATE workspace_nodes SET deleted_at = ?1 WHERE id = ?2",
                    params![now, nid],
                )
                .map_err(|e| e.to_string())?;
        }
        for nid in &all_ids {
            Self::delete_workspace_fts_row(&conn_locked, nid)?;
        }
        drop(conn_locked);

        for nid in all_ids {
            if let Some(w) = &self.embedding_worker {
                w.enqueue_delete(nid);
            }
        }
        Ok(())
    }

    pub async fn restore_node(&self, id: &str) -> Result<WorkspaceNode, String> {
        let conn = self.conn.clone();
        let conn_locked = conn.lock().await;

        // Check if the node exists and is deleted
        let node = {
            let mut stmt = conn_locked
                .prepare("SELECT id, parent_id, deleted_at FROM workspace_nodes WHERE id = ?1")
                .map_err(|e| e.to_string())?;
            let mut rows = stmt.query(params![id]).map_err(|e| e.to_string())?;
            match rows.next().map_err(|e| e.to_string())? {
                Some(row) => {
                    let deleted_at: Option<i64> = row.get(2).map_err(|e| e.to_string())?;
                    if deleted_at.is_none() {
                        return Err("Node is not deleted".to_string());
                    }
                    let parent_id: Option<String> = row.get(1).map_err(|e| e.to_string())?;
                    (row.get::<_, String>(0).map_err(|e| e.to_string())?, parent_id)
                }
                None => return Err("Node not found".to_string()),
            }
        };

        // Check if parent is also deleted — if so, restore to root
        let final_parent_id = if let Some(ref pid) = node.1 {
            let mut check_stmt = conn_locked
                .prepare("SELECT deleted_at FROM workspace_nodes WHERE id = ?1")
                .map_err(|e| e.to_string())?;
            let mut rows = check_stmt.query(params![pid]).map_err(|e| e.to_string())?;
            let parent_deleted = rows.next().map_err(|e| e.to_string())?
                .and_then(|row| row.get::<_, Option<i64>>(0).ok())
                .flatten()
                .is_some();
            if parent_deleted { None } else { node.1.clone() }
        } else {
            None
        };

        // Restore: clear deleted_at and restore parent_id if needed
        conn_locked.execute(
            "UPDATE workspace_nodes SET deleted_at = NULL, parent_id = ?1 WHERE id = ?2",
            params![final_parent_id, id],
        ).map_err(|e| e.to_string())?;

        drop(conn_locked);
        let node = self
            .get_node(id)
            .await?
            .ok_or_else(|| "Node not found after restore".to_string())?;
        self.sync_node_fts(&node).await?;
        if Self::should_queue_workspace_indexing() {
            if let Some(w) = &self.embedding_worker {
                w.enqueue_index(
                    node.id.clone(),
                    format!("{} {}", node.name, node.body),
                );
            }
        }

        // Cascade-soft-deleted descendants share the subtree; bring them back with the parent.
        self.restore_soft_deleted_descendants(id).await?;

        Ok(node)
    }

    /// Clear `deleted_at` on descendants still trashed under `root_id`, then FTS + embedding queue.
    async fn restore_soft_deleted_descendants(&self, root_id: &str) -> Result<(), String> {
        let now = chrono::Utc::now().timestamp();
        let descendant_ids = {
            let conn = self.conn.lock().await;
            self.get_descendant_ids_internal(&conn, root_id)?
        };
        if descendant_ids.is_empty() {
            return Ok(());
        }

        {
            let conn_locked = self.conn.lock().await;
            for did in &descendant_ids {
                conn_locked
                    .execute(
                        "UPDATE workspace_nodes SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NOT NULL",
                        params![now, did],
                    )
                    .map_err(|e| e.to_string())?;
            }
        }

        for did in descendant_ids {
            let Some(n) = self.get_node(&did).await? else {
                continue;
            };
            if n.deleted_at.is_some() {
                continue;
            }
            self.sync_node_fts(&n).await?;
            if Self::should_queue_workspace_indexing() {
                if let Some(w) = &self.embedding_worker {
                    w.enqueue_index(
                        n.id.clone(),
                        format!("{} {}", n.name, n.body),
                    );
                }
            }
        }
        Ok(())
    }

    pub async fn permanent_delete_node(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.clone();
        let conn_locked = conn.lock().await;

        // Verify node exists and is deleted
        let mut stmt = conn_locked
            .prepare("SELECT deleted_at FROM workspace_nodes WHERE id = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![id]).map_err(|e| e.to_string())?;
        let deleted_at: Option<i64> = rows.next()
            .map_err(|e| e.to_string())?
            .map(|row| row.get(0).map_err(|e| e.to_string()))
            .transpose()?;
        if deleted_at.is_none() {
            return Err("Node must be in trash before permanent deletion".to_string());
        }

        // Delete workspace_fts entries for this node and all descendants
        let descendant_ids = self.get_descendant_ids_internal(&conn_locked, id)?;
        let all_ids: Vec<String> = std::iter::once(id.to_string())
            .chain(descendant_ids)
            .collect();
        for descendant_id in &all_ids {
            Self::delete_workspace_fts_row(&conn_locked, descendant_id)?;
            conn_locked.execute(
                "DELETE FROM page_links WHERE source_node_id = ?1 OR target_node_id = ?1",
                params![descendant_id],
            ).map_err(|e| e.to_string())?;
        }

        // Delete the node — cascade will handle children, views, etc.
        conn_locked.execute(
            "DELETE FROM workspace_nodes WHERE id = ?1",
            params![id],
        ).map_err(|e| e.to_string())?;

        Ok(())
    }

    /// Permanently delete every trashed subtree. Only "top-level" deleted nodes are enumerated
    /// (parent missing or not deleted); each `permanent_delete_node` cascades to descendants.
    pub async fn empty_trash(&self) -> Result<(), String> {
        let ids: Vec<String> = {
            let conn = self.conn.lock().await;
            let mut stmt = conn
                .prepare(
                    "SELECT n.id FROM workspace_nodes n
                     WHERE n.deleted_at IS NOT NULL
                     AND (
                       n.parent_id IS NULL
                       OR NOT EXISTS (
                         SELECT 1 FROM workspace_nodes p
                         WHERE p.id = n.parent_id AND p.deleted_at IS NOT NULL
                       )
                     )",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| row.get(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };

        for id in ids {
            self.permanent_delete_node(&id).await?;
        }
        Ok(())
    }

    /// Public wrapper for descendant id walk.  Returns all descendants (deep)
    /// of `id` in an unspecified order.  Used by cascade vault rewrites after
    /// a parent rename/move.
    pub async fn get_descendant_ids(&self, id: &str) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().await;
        self.get_descendant_ids_internal(&conn, id)
    }

    fn get_descendant_ids_internal(&self, conn: &rusqlite::Connection, id: &str) -> Result<Vec<String>, String> {
        let mut result = Vec::new();
        let mut stack = vec![id.to_string()];
        while let Some(current_id) = stack.pop() {
            let mut stmt = conn
                .prepare("SELECT id FROM workspace_nodes WHERE parent_id = ?1")
                .map_err(|e| e.to_string())?;
            let mut rows = stmt.query(params![current_id]).map_err(|e| e.to_string())?;
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let child_id: String = row.get(0).map_err(|e| e.to_string())?;
                result.push(child_id.clone());
                stack.push(child_id);
            }
        }
        Ok(result)
    }

    pub async fn get_deleted_nodes(&self) -> Result<Vec<WorkspaceNode>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare(
                "SELECT id, parent_id, node_type, name, icon, position, created_at, updated_at, deleted_at, properties, body, vault_rel_path
                 FROM workspace_nodes
                 WHERE deleted_at IS NOT NULL
                 ORDER BY deleted_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt.query_map([], |row| {
            Ok(WorkspaceNode {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                node_type: row.get(2)?,
                name: row.get(3)?,
                icon: row.get(4)?,
                position: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                deleted_at: row.get(8)?,
                properties: row.get(9)?,
                body: row.get(10)?,
                vault_rel_path: row.get(11)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut nodes = Vec::new();
        for row in rows {
            nodes.push(row.map_err(|e| e.to_string())?);
        }
        Ok(nodes)
    }

    pub async fn move_node(&self, id: &str, parent_id: Option<String>, position: f64) -> Result<WorkspaceNode, String> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.clone();
        {
            let conn_locked = conn.lock().await;
            conn_locked.execute(
                "UPDATE workspace_nodes SET parent_id = ?1, position = ?2, updated_at = ?3 WHERE id = ?4",
                params![parent_id, position, now, id],
            ).map_err(|e| e.to_string())?;
        }
        let updated_node = self.get_node(id)
            .await?
            .ok_or_else(|| "Node not found".to_string())?;

        // Bug 3 fix: sync FTS and embeddings after a move, since the parent changed.
        self.sync_node_fts(&updated_node).await?;

        if Self::should_queue_workspace_indexing() {
            if let Some(w) = &self.embedding_worker {
                w.enqueue_index(
                    updated_node.id.clone(),
                    format!("{} {}", updated_node.name, updated_node.body),
                );
            }
        }

        Ok(updated_node)
    }

    // ─── View CRUD ────────────────────────────────────────────────────────────

    pub async fn create_node_view(&self, node_id: &str, name: &str, layout: &str) -> Result<NodeView, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.clone();

        let max_pos: f64 = {
            let conn_locked = conn.lock().await;
            conn_locked.query_row(
                "SELECT COALESCE(MAX(position), -1.0) FROM node_views WHERE node_id = ?1",
                params![node_id],
                |row| row.get(0),
            ).map_err(|e| e.to_string())?
        };

        let conn_locked = conn.lock().await;
        conn_locked.execute(
            r#"INSERT INTO node_views
               (id, node_id, name, layout, position, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)"#,
            params![id, node_id, name, layout, max_pos + 1.0, now],
        ).map_err(|e| e.to_string())?;

        self.get_node_view_internal(&conn_locked, &id)
    }

    fn get_node_view_internal(&self, conn: &Connection, id: &str) -> Result<NodeView, String> {
        let mut stmt = conn
            .prepare("SELECT id, node_id, name, layout, position, color, filters, sorts, view_options, created_at, updated_at FROM node_views WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        let row = stmt.query_row(params![id], |row| {
            Ok(NodeView {
                id: row.get(0)?,
                node_id: row.get(1)?,
                name: row.get(2)?,
                layout: row.get(3)?,
                position: row.get(4)?,
                color: row.get(5)?,
                filters: row.get(6)?,
                sorts: row.get(7)?,
                view_options: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        }).map_err(|e| e.to_string())?;
        Ok(row)
    }

    pub async fn get_node_views(&self, node_id: &str) -> Result<Vec<NodeView>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare("SELECT id, node_id, name, layout, position, color, filters, sorts, view_options, created_at, updated_at FROM node_views WHERE node_id = ?1 ORDER BY position")
            .map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![node_id], |row| {
            Ok(NodeView {
                id: row.get(0)?,
                node_id: row.get(1)?,
                name: row.get(2)?,
                layout: row.get(3)?,
                position: row.get(4)?,
                color: row.get(5)?,
                filters: row.get(6)?,
                sorts: row.get(7)?,
                view_options: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub async fn update_node_view(
        &self,
        id: &str,
        name: &str,
        color: Option<&str>,
        filters: &str,
        sorts: &str,
        view_options: &str,
    ) -> Result<NodeView, String> {
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.clone();
        {
            let conn_locked = conn.lock().await;
            conn_locked.execute(
                "UPDATE node_views SET name = ?1, color = ?2, filters = ?3, sorts = ?4, view_options = ?5, updated_at = ?6 WHERE id = ?7",
                params![name, color, filters, sorts, view_options, now, id],
            ).map_err(|e| e.to_string())?;
        }
        let conn_locked = conn.lock().await;
        self.get_node_view_internal(&conn_locked, id)
    }

    pub async fn delete_node_view(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.clone();
        let conn_locked = conn.lock().await;
        conn_locked.execute("DELETE FROM node_views WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─── Comment CRUD ─────────────────────────────────────────────────────────

    pub async fn get_node_comments(&self, node_id: &str) -> Result<Vec<NodeComment>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare("SELECT id, node_id, author, content, created_at, updated_at FROM node_comments WHERE node_id = ?1 ORDER BY created_at")
            .map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![node_id], |row| {
            Ok(NodeComment {
                id: row.get(0)?,
                node_id: row.get(1)?,
                author: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub async fn add_comment(&self, node_id: &str, author: &str, content: &str) -> Result<NodeComment, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.clone();

        {
            let conn_locked = conn.lock().await;
            conn_locked.execute(
                r#"INSERT INTO node_comments (id, node_id, author, content, created_at, updated_at)
                   VALUES (?1, ?2, ?3, ?4, ?5, ?5)"#,
                params![id, node_id, author, content, now],
            ).map_err(|e| e.to_string())?;
        }

        let conn_locked = conn.lock().await;
        let mut stmt = conn_locked
            .prepare("SELECT id, node_id, author, content, created_at, updated_at FROM node_comments WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        let row = stmt.query_row(params![id], |row| {
            Ok(NodeComment {
                id: row.get(0)?,
                node_id: row.get(1)?,
                author: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;
        Ok(row)
    }

    pub async fn delete_comment(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.clone();
        let conn_locked = conn.lock().await;
        conn_locked.execute("DELETE FROM node_comments WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─── Template CRUD ────────────────────────────────────────────────────────

    pub async fn get_templates(&self, node_id: &str) -> Result<Vec<NodeTemplate>, String> {
        let conn = self.conn.lock().await;
        let mut stmt = conn
            .prepare("SELECT id, node_id, name, template_data, position, created_at FROM node_templates WHERE node_id = ?1 ORDER BY position")
            .map_err(|e| e.to_string())?;

        let rows = stmt.query_map(params![node_id], |row| {
            Ok(NodeTemplate {
                id: row.get(0)?,
                node_id: row.get(1)?,
                name: row.get(2)?,
                template_data: row.get(3)?,
                position: row.get(4)?,
                created_at: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| e.to_string())?);
        }
        Ok(result)
    }

    pub async fn create_template(&self, node_id: &str, name: &str, template_data: &str) -> Result<NodeTemplate, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.clone();

        let max_pos: i32 = {
            let conn_locked = conn.lock().await;
            conn_locked.query_row(
                "SELECT COALESCE(MAX(position), -1) FROM node_templates WHERE node_id = ?1",
                params![node_id],
                |row| row.get(0),
            ).map_err(|e| e.to_string())?
        };

        let conn_locked = conn.lock().await;
        conn_locked.execute(
            r#"INSERT INTO node_templates (id, node_id, name, template_data, position, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
            params![id, node_id, name, template_data, max_pos + 1, now],
        ).map_err(|e| e.to_string())?;

        let mut stmt = conn_locked
            .prepare("SELECT id, node_id, name, template_data, position, created_at FROM node_templates WHERE id = ?1")
            .map_err(|e| e.to_string())?;

        let row = stmt.query_row(params![id], |row| {
            Ok(NodeTemplate {
                id: row.get(0)?,
                node_id: row.get(1)?,
                name: row.get(2)?,
                template_data: row.get(3)?,
                position: row.get(4)?,
                created_at: row.get(5)?,
            })
        }).map_err(|e| e.to_string())?;
        Ok(row)
    }

    /// Get or create a daily note for the given date.
    /// Returns existing note if one with matching daily_date property exists and is not deleted.
    /// Creates a new document node with daily_date property if none exists.
    pub async fn get_or_create_daily_note(&self, date: &str) -> Result<WorkspaceNode, String> {
        let conn = self.conn.clone();

        // Scope 1: try to find an existing daily note
        {
            let conn_locked = conn.lock().await;
            let mut stmt = conn_locked.prepare(
                "SELECT id, parent_id, node_type, name, icon, position, created_at, updated_at, deleted_at, properties, body, vault_rel_path \
                 FROM workspace_nodes \
                 WHERE json_extract(properties, '$.daily_date') = ?1 AND deleted_at IS NULL \
                 LIMIT 1"
            ).map_err(|e| e.to_string())?;

            let existing: Option<WorkspaceNode> = stmt
                .query_row(params![date], |row| {
                    Ok(WorkspaceNode {
                        id: row.get(0)?,
                        parent_id: row.get(1)?,
                        node_type: row.get(2)?,
                        name: row.get(3)?,
                        icon: row.get(4)?,
                        position: row.get(5)?,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                        deleted_at: row.get(8)?,
                        properties: row.get(9)?,
                        body: row.get(10)?,
                        vault_rel_path: row.get(11)?,
                    })
                })
                .ok();

            if let Some(node) = existing {
                return Ok(node);
            }
        }

        // Not found — create a new one
        let name = format_date_for_display(date);
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();
        let properties = serde_json::json!({ "daily_date": date }).to_string();

        // Scope 2: insert the new node
        {
            let conn_locked = conn.lock().await;
            conn_locked.execute(
                r#"INSERT INTO workspace_nodes
                   (id, parent_id, node_type, name, icon, position, created_at, updated_at, properties, body)
                   VALUES (?1, NULL, 'document', ?2, '📅', 0, ?3, ?3, ?4, '')"#,
                params![id, name, now, properties],
            ).map_err(|e| e.to_string())?;
        }

        // Scope 3: fetch the newly created node
        let conn = self.conn.clone();
        let conn_locked = conn.lock().await;
        let mut stmt = conn_locked.prepare(
            "SELECT id, parent_id, node_type, name, icon, position, created_at, updated_at, deleted_at, properties, body, vault_rel_path \
             FROM workspace_nodes WHERE id = ?1"
        ).map_err(|e| e.to_string())?;

        stmt.query_row(params![id], |row| {
            Ok(WorkspaceNode {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                node_type: row.get(2)?,
                name: row.get(3)?,
                icon: row.get(4)?,
                position: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
                deleted_at: row.get(8)?,
                properties: row.get(9)?,
                body: row.get(10)?,
                vault_rel_path: row.get(11)?,
            })
        }).map_err(|e| e.to_string())
    }

    // ─── Import / Export ───────────────────────────────────────────────────────

    /// Recursively import a markdown folder.
    /// Each `.md` / `.markdown` / `.mdx` file (any common letter case) becomes a document node.
    /// Subdirectories become parent nodes.
    pub async fn import_markdown_folder(&self, dir_path: &str) -> Result<Vec<WorkspaceNode>, String> {
        use walkdir::WalkDir;

        let mut created_nodes = Vec::new();
        let mut parent_stack: Vec<String> = Vec::new();
        let mut last_path: Option<std::path::PathBuf> = None;

        for entry in WalkDir::new(dir_path)
            .sort_by(|a, b| a.path().cmp(b.path()))
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            if path == std::path::Path::new(dir_path) {
                continue;
            }

            // Pop directories back to our parent level
            if let Some(ref last) = last_path {
                if path.is_dir() && !path.starts_with(last) {
                    while parent_stack.len() >= path.components().count().saturating_sub(1) {
                        parent_stack.pop();
                    }
                }
            }

            let parent_id = parent_stack.last().cloned();

            if path.is_dir() {
                // Create a document node for the directory (as a container)
                let name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Folder")
                    .to_string();
                let node = self
                    .create_node_raw(&parent_id, "document", &name, "📁", "", None)
                    .await?;
                parent_stack.push(node.id.clone());
                created_nodes.push(node);
            } else if is_workspace_markdown_file(path) {
                // Read markdown content
                let content = std::fs::read_to_string(path)
                    .map_err(|e| format!("Failed to read file {:?}: {}", path, e))?;
                let name = path.file_stem()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Untitled")
                    .to_string();
                let node = self
                    .create_node_raw(&parent_id, "document", &name, "📄", &content, None)
                    .await?;
                created_nodes.push(node);
            }

            last_path = Some(path.to_path_buf());
        }

        Ok(created_nodes)
    }

    /// Import a CSV file as a database.
    /// First row = field names (all text type).
    /// Subsequent rows = row nodes under the database.
    pub async fn import_csv(&self, file_path: &str) -> Result<WorkspaceNode, String> {
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(true)
            .from_path(file_path)
            .map_err(|e| format!("Failed to open CSV: {}", e))?;

        let headers: Vec<String> = reader.headers()
            .map_err(|e| format!("Failed to read CSV headers: {}", e))?
            .iter()
            .map(|s| s.to_string())
            .collect();

        // Create database node
        let file_stem = std::path::Path::new(file_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Imported Database")
            .to_string();

        let database = self
            .create_node_raw(&None, "database", &file_stem, "🗃️", "", None)
            .await?;

        // Build fields array in properties
        let fields: Vec<serde_json::Value> = headers.iter().map(|name| {
            serde_json::json!({
                "id": uuid::Uuid::new_v4().to_string(),
                "name": name,
                "type": "text",
                "type_option": serde_json::json!({
                    "placeholder": "",
                    "width": 200
                }).to_string()
            })
        }).collect();

        let properties = serde_json::json!({
            "fields": fields
        }).to_string();

        // Update database with fields
        {
            let conn = self.conn.lock().await;
            conn.execute(
                "UPDATE workspace_nodes SET properties = ?1 WHERE id = ?2",
                rusqlite::params![properties, database.id],
            ).map_err(|e| e.to_string())?;
        }

        // Create default Grid view (Glide data grid)
        let _view = self.create_node_view(&database.id, "Grid", "grid").await?;

        // Read data rows and create row nodes
        for result in reader.records() {
            let record = result.map_err(|e| format!("Failed to read CSV row: {}", e))?;
            let values: Vec<String> = record.iter().map(|s| s.to_string()).collect();

            // Create a row node
            let row_name = values.first().cloned().unwrap_or_else(|| "Row".to_string());
            let row = self
                .create_node_raw(&Some(database.id.clone()), "row", &row_name, "▸", "", None)
                .await?;

            // Set cell values for each field
            for (i, value) in values.iter().enumerate() {
                if i < headers.len() {
                    let field_id = &fields[i]["id"].as_str().unwrap();
                    self.update_cell_raw(&row.id, field_id, "text", value).await?;
                }
            }
            self.refresh_row_search_index(&row.id).await?;
        }

        // Return the database node
        self.get_node(&database.id).await?.ok_or_else(|| "Database not found".to_string())
    }

    /// Export a document node as a markdown file.
    /// Replaces node://uuid links with [[Display Title]] wikilinks.
    pub async fn export_markdown(&self, node_id: &str, file_path: &str) -> Result<(), String> {
        let node = self.get_node(node_id)
            .await?
            .ok_or_else(|| "Node not found".to_string())?;

        if node.node_type != "document" {
            return Err("Only document nodes can be exported as markdown".to_string());
        }

        let mut content = node.body.clone();

        // Replace node://uuid with [[Display Title]]
        let node_uuid_re = regex::Regex::new(r"node://([0-9a-f-]{36})")
            .map_err(|e| e.to_string())?;

        // Find all node:// references and replace with [[name]]
        let mut search_start = 0;
        while let Some(caps) = node_uuid_re.captures(&content[search_start..]) {
            let full_match = caps.get(0).unwrap();
            let uuid = caps.get(1).unwrap().as_str();

            // Look up the target node's name
            if let Ok(Some(target_node)) = self.get_node(uuid).await {
                let replacement = format!("[[{}]]", target_node.name);
                let full_range = search_start + full_match.start()..search_start + full_match.end();
                content = format!("{}{}{}",
                    &content[..full_range.start],
                    replacement,
                    &content[full_range.end..]
                );
                search_start = full_range.start + replacement.len();
            } else {
                // Node not found, leave as-is but advance
                search_start += full_match.end();
            }
        }

        std::fs::write(file_path, content)
            .map_err(|e| format!("Failed to write file: {}", e))?;

        Ok(())
    }

    /// Export a database view as CSV.
    pub async fn export_csv(&self, node_id: &str, view_id: &str, file_path: &str) -> Result<(), String> {
        let node = self.get_node(node_id)
            .await?
            .ok_or_else(|| "Database not found".to_string())?;

        if node.node_type != "database" {
            return Err("Only database nodes can be exported as CSV".to_string());
        }

        // Get fields from database properties
        let props: serde_json::Value = serde_json::from_str(&node.properties)
            .map_err(|e| e.to_string())?;
        let fields = props.get("fields")
            .and_then(|f| f.as_array())
            .ok_or_else(|| "No fields found".to_string())?;

        // Get rows
        let rows = self.get_node_children(node_id).await?;

        // Write CSV
        let mut writer = csv::Writer::from_path(file_path)
            .map_err(|e| format!("Failed to create CSV writer: {}", e))?;

        // Write header
        let header: Vec<String> = fields.iter()
            .map(|f| f.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string())
            .collect();
        writer.write_record(&header)
            .map_err(|e| format!("Failed to write CSV header: {}", e))?;

        // Write rows
        for row in rows {
            let mut record: Vec<String> = Vec::new();
            for field in fields.iter() {
                let field_id = field.get("id").and_then(|id| id.as_str()).unwrap_or("");
                let cell = self.get_cell(&row.id, field_id).await?;
                let value = match cell {
                    Some(serde_json::Value::String(s)) => s,
                    Some(v) => v.to_string(),
                    None => String::new(),
                };
                record.push(value);
            }
            writer.write_record(&record)
                .map_err(|e| format!("Failed to write CSV row: {}", e))?;
        }

        writer.flush().map_err(|e| format!("Failed to flush CSV: {}", e))?;

        Ok(())
    }

    // ─── Internal helpers ───────────────────────────────────────────────────────

    /// Create a node with raw body (not managed, no FTS sync).
    async fn create_node_raw(
        &self,
        parent_id: &Option<String>,
        node_type: &str,
        name: &str,
        icon: &str,
        body: &str,
        document_properties_override: Option<&str>,
    ) -> Result<WorkspaceNode, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.clone();

        // Get max position among siblings
        let max_pos: f64 = {
            let conn_locked = conn.lock().await;
            match parent_id {
                Some(pid) => conn_locked.query_row(
                    "SELECT COALESCE(MAX(position), -1.0) FROM workspace_nodes WHERE parent_id = ?1 AND deleted_at IS NULL",
                    params![pid],
                    |row| row.get(0),
                ).unwrap_or(-1.0),
                None => conn_locked.query_row(
                    "SELECT COALESCE(MAX(position), -1.0) FROM workspace_nodes WHERE parent_id IS NULL AND deleted_at IS NULL",
                    params![],
                    |row| row.get(0),
                ).unwrap_or(-1.0),
            }
        };

        let conn_locked = conn.lock().await;

        // Row: empty cells. Database: default primary rich_text field (UI expects `fields` array).
        let properties = if node_type == "row" {
            r#"{"cells":{}}"#.to_string()
        } else if node_type == "database" {
            let board_id = uuid::Uuid::new_v4().to_string();
            let title_id = uuid::Uuid::new_v4().to_string();
            let content_id = uuid::Uuid::new_v4().to_string();
            let board_type_opt = default_workspace_select_type_option_string();
            serde_json::json!({
                "fields": [
                    {
                        "id": board_id,
                        "database_id": id,
                        "name": "board",
                        "field_type": "board",
                        "is_primary": false,
                        "type_option": board_type_opt,
                        "position": 0
                    },
                    {
                        "id": title_id,
                        "database_id": id,
                        "name": "card_title",
                        "field_type": "rich_text",
                        "is_primary": true,
                        "type_option": {},
                        "position": 1
                    },
                    {
                        "id": content_id,
                        "database_id": id,
                        "name": "card_content",
                        "field_type": "rich_text",
                        "is_primary": false,
                        "type_option": {},
                        "position": 2
                    }
                ]
            })
            .to_string()
        } else if node_type == "document" {
            match document_properties_override {
                Some(s) if !s.trim().is_empty() => s.to_string(),
                _ => "{}".to_string(),
            }
        } else {
            "{}".to_string()
        };

        conn_locked.execute(
            r#"INSERT INTO workspace_nodes
               (id, parent_id, node_type, name, icon, position, created_at, updated_at, properties, body)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9)"#,
            params![id, parent_id, node_type, name, icon, max_pos + 1.0, now, properties, body],
        ).map_err(|e| e.to_string())?;

        let node = self.get_node_internal(&conn_locked, &id)?
            .ok_or_else(|| "Node not found".to_string())?;

        // Sync FTS and trigger embedding
        drop(conn_locked);
        self.sync_node_fts(&node).await?;
        let index_blob = if node_type == "row" {
            self.build_row_indexable_text(&node).await
        } else {
            format!("{} {}", name, body)
        };
        if Self::should_queue_workspace_indexing() {
            if let Some(w) = &self.embedding_worker {
                w.enqueue_index(node.id.clone(), index_blob);
            }
        }

        Ok(node)
    }

    /// Update a cell value (internal, stores in row's properties JSON).
    async fn update_cell_raw(
        &self,
        row_id: &str,
        field_id: &str,
        cell_type: &str,
        value: &str,
    ) -> Result<(), String> {
        let conn = self.conn.clone();
        let conn_locked = conn.lock().await;

        let node = self.get_node_internal(&conn_locked, row_id)?
            .ok_or_else(|| "Row not found".to_string())?;

        let mut props: serde_json::Value = serde_json::from_str(&node.properties)
            .map_err(|e| e.to_string())?;

        // Ensure cells object exists
        if !props.get("cells").and_then(|v| v.as_object()).is_some() {
            props["cells"] = serde_json::json!({});
        }

        let cells = props.get_mut("cells")
            .unwrap()
            .as_object_mut()
            .unwrap();

        cells.insert(field_id.to_string(), serde_json::json!({
            "type": cell_type,
            "value": value,
        }));

        let now = chrono::Utc::now().timestamp();
        let new_props_str = serde_json::to_string(&props).map_err(|e| e.to_string())?;
        conn_locked.execute(
            "UPDATE workspace_nodes SET properties = ?, updated_at = ? WHERE id = ?",
            rusqlite::params![new_props_str, now, row_id],
        ).map_err(|e| e.to_string())?;

        Ok(())
    }

    /// Sync a node to workspace_fts.
    async fn sync_node_fts(&self, node: &WorkspaceNode) -> Result<(), String> {
        if node.deleted_at.is_some() {
            let conn = self.conn.lock().await;
            Self::delete_workspace_fts_row(&conn, &node.id)?;
            return Ok(());
        }
        if node.node_type == "row" || node.node_type == "document" {
            let body_for_fts: String = if node.node_type == "row" {
                self.build_row_indexable_text(node).await
            } else if node.body.is_empty() {
                String::new()
            } else {
                node.body.clone()
            };
            let conn = self.conn.lock().await;
            Self::replace_workspace_fts_row(&conn, &node.id, &node.name, &body_for_fts)?;
        } else if node.node_type == "database" {
            let conn = self.conn.lock().await;
            Self::replace_workspace_fts_row(&conn, &node.id, &node.name, "")?;
        }
        Ok(())
    }

    fn extract_node_link_targets(body: &str) -> Vec<String> {
        let re = Regex::new(r"node://([0-9a-fA-F-]{36})").unwrap();
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for cap in re.captures_iter(body) {
            if let Some(m) = cap.get(1) {
                let id = m.as_str().to_string();
                if seen.insert(id.clone()) {
                    out.push(id);
                }
            }
        }
        out
    }

    async fn replace_page_links_for_source(
        &self,
        source_id: &str,
        body: &str,
        node_type: &str,
    ) -> Result<(), String> {
        if node_type != "document" && node_type != "row" {
            return Ok(());
        }
        let targets = Self::extract_node_link_targets(body);
        let conn = self.conn.lock().await;
        conn.execute(
            "DELETE FROM page_links WHERE source_node_id = ?1",
            params![source_id],
        )
        .map_err(|e| e.to_string())?;
        for tid in targets {
            if tid == source_id {
                continue;
            }
            if self.get_node_internal(&conn, &tid)?.is_some() {
                conn.execute(
                    "INSERT OR REPLACE INTO page_links (source_node_id, target_node_id) VALUES (?1, ?2)",
                    params![source_id, tid],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    // ── W7: Already-imported detection ────────────────────────────────────────

    /// Look up a workspace node by its web-media `source_id` (the platform-specific
    /// video/audio ID returned by yt-dlp, e.g. "dQw4w9WgXcQ" for YouTube).
    ///
    /// # Current implementation: stub returning Ok(None)
    ///
    /// The `workspace_nodes` table stores `properties TEXT NOT NULL DEFAULT '{}'`
    /// which holds database field metadata — it is NOT a generic per-node JSON bag.
    /// The `source_id` field lives in `WebMediaMetadata` (in-memory) and is written
    /// into the vault markdown frontmatter (`properties_json` key) but is NOT indexed
    /// in SQLite, making a `json_extract` query impractical without a migration.
    ///
    /// # TODO (Task 17 follow-up): add a dedicated indexed column
    ///
    /// Add a migration:
    /// ```sql
    /// ALTER TABLE workspace_nodes ADD COLUMN web_source_id TEXT;
    /// CREATE INDEX IF NOT EXISTS idx_workspace_nodes_web_source_id
    ///     ON workspace_nodes (web_source_id) WHERE web_source_id IS NOT NULL;
    /// ```
    /// Then write `web_source_id` when creating/finalizing a WebMedia node (Task 18),
    /// and implement this method as:
    /// ```sql
    /// SELECT id, vault_rel_path, created_at
    /// FROM workspace_nodes
    /// WHERE web_source_id = ?1 AND deleted_at IS NULL
    /// LIMIT 1
    /// ```
    /// Deferred to avoid conflicting with W3 parallel schema work. Task 34 E2E
    /// verification will catch any duplicate-import escapes in the interim.
    pub async fn find_node_by_source_id(
        &self,
        _source_id: &str,
    ) -> Result<Option<crate::import::AlreadyImportedHit>, String> {
        Ok(None)
    }
}

#[cfg(test)]
mod slugify_tests {
    use super::WorkspaceManager;

    // Helper to keep call sites readable.
    fn s(name: &str) -> String {
        WorkspaceManager::slugify(name)
    }

    #[test]
    fn basic_ascii() {
        assert_eq!(s("My Note"), "my-note");
        assert_eq!(s("Hello, World!"), "hello-world");
    }

    #[test]
    fn empty_and_whitespace_collapse_to_untitled() {
        assert_eq!(s(""), "untitled");
        assert_eq!(s("   "), "untitled");
        assert_eq!(s("---"), "untitled");
        assert_eq!(s("!!!"), "untitled");
    }

    #[test]
    fn case_canonicalised_for_case_insensitive_fs() {
        // Two differently-cased names MUST produce the same slug so macOS/Windows
        // don't silently overwrite one with the other.
        assert_eq!(s("Projects"), s("projects"));
        assert_eq!(s("READme"), s("readme"));
    }

    #[test]
    fn windows_reserved_names_are_suffixed() {
        // Bare device names would crash `File::create` on Windows.
        assert_eq!(s("con"), "con-");
        assert_eq!(s("CON"), "con-");
        assert_eq!(s("prn"), "prn-");
        assert_eq!(s("nul"), "nul-");
        assert_eq!(s("com1"), "com1-");
        assert_eq!(s("LPT9"), "lpt9-");
        // Non-bare uses are safe: "conference" has `con` as a prefix only.
        assert_eq!(s("conference"), "conference");
        assert_eq!(s("connect"), "connect");
    }

    #[test]
    fn trailing_dot_and_space_are_stripped() {
        // Windows strips trailing `.` / ` ` at the FS layer — strip them first
        // so we know the filename we ask for matches the one we get.
        assert_eq!(s("My Note."), "my-note");
        assert_eq!(s("My Note "), "my-note");
        assert_eq!(s("My Note . . ."), "my-note");
    }

    #[test]
    fn unicode_nfc_canonicalised() {
        // NFD ("e" + combining acute) and NFC (é, single codepoint) must slug
        // to the same bytes, otherwise macOS (NFD) and Linux (NFC) see two
        // different filenames for the same user-typed name.
        let nfd = "Cafe\u{0301}";          // C a f e + combining acute
        let nfc = "Caf\u{00E9}";           // C a f é
        assert_eq!(s(nfd), s(nfc));
        assert_eq!(s(nfc), "café");
    }

    #[test]
    fn length_is_bounded_and_char_boundary_safe() {
        // 200 ASCII chars → 80 bytes.
        let long = "a".repeat(200);
        assert!(s(&long).len() <= 80);
        // 200 é chars (2 bytes each in UTF-8) → must not split a codepoint.
        let unicode_long: String = std::iter::repeat('é').take(200).collect();
        let out = s(&unicode_long);
        assert!(out.len() <= 80);
        // The output must be valid UTF-8 (char_indices iterates cleanly).
        let _ = out.chars().count();
    }

    #[test]
    fn punctuation_and_whitespace_collapse() {
        assert_eq!(s("a    b"), "a-b");
        assert_eq!(s("a---b"), "a-b");
        assert_eq!(s(" a - b "), "a-b");
    }

    #[test]
    fn reserved_after_truncation_also_suffixed() {
        // A name that truncates down to exactly a reserved stem must still be
        // suffixed — otherwise length-cap would produce an unsafe slug.
        let mut long = "con".to_string();
        long.push_str(&"-padding".repeat(20)); // pushes over 80 chars
        let out = s(&long);
        // After truncation + re-trim, if the stem happens to be "con",
        // the suffix rule applies.  Either way, the output must not be a
        // bare reserved name.
        const RESERVED_STEMS: &[&str] = &["con", "prn", "aux", "nul"];
        assert!(!RESERVED_STEMS.contains(&out.as_str()));
    }
}

#[cfg(test)]
mod migration_tests {
    //! Migration-layer tests. Apply the canonical migration vec to a fresh
    //! in-memory DB (via `WorkspaceManager::migrations()`) and verify the
    //! Phase A tables come up correctly, vec_embeddings accepts inserts,
    //! and the backfill queue is populated from existing workspace_nodes.
    //!
    //! The `sqlite_vec::sqlite3_auto_extension` FFI call must happen before
    //! any `Connection::open`, so we gate it behind a `Once` to keep these
    //! tests parallel-safe when run alongside the rest of the suite.
    use super::WorkspaceManager;
    use std::sync::Once;

    static VEC_INIT: Once = Once::new();
    fn ensure_vec_extension() {
        VEC_INIT.call_once(|| unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        });
    }

    /// Applying the full migration vec to a fresh in-memory DB must succeed.
    /// This catches mistakes like: vec0 DDL getting rejected by
    /// rusqlite_migration's wrapping tx, or a FK / CHECK violation in the
    /// seed INSERT.
    #[test]
    fn phase_a_migration_applies_cleanly() {
        ensure_vec_extension();
        let mut conn = rusqlite::Connection::open_in_memory().expect("open mem");
        WorkspaceManager::migrations()
            .to_latest(&mut conn)
            .expect("phase A migration applies");

        // Sanity — each new table exists and is queryable.
        let vec_count: i64 = conn
            .query_row("SELECT count(*) FROM vec_embeddings", [], |r| r.get(0))
            .expect("vec_embeddings queryable");
        assert_eq!(vec_count, 0);
        let mi_count: i64 = conn
            .query_row("SELECT count(*) FROM embedding_model_info", [], |r| {
                r.get(0)
            })
            .expect("embedding_model_info queryable");
        assert_eq!(mi_count, 0);
        let queue_count: i64 = conn
            .query_row("SELECT count(*) FROM embed_backfill_queue", [], |r| {
                r.get(0)
            })
            .expect("embed_backfill_queue queryable");
        assert_eq!(queue_count, 0); // fresh install — no workspace_nodes to seed
    }

    /// After migration, `vec_embeddings` must accept an INSERT of a 384d
    /// vector and return it via a KNN query — proves the dimension column
    /// type + the cosine distance metric are correctly parsed, AND that
    /// partition-key `node_id` + metadata `chunk_index` match the spike's
    /// refined schema.
    #[test]
    fn vec_embeddings_accepts_384d_insert_and_knn() {
        use zerocopy::IntoBytes;
        ensure_vec_extension();
        let mut conn = rusqlite::Connection::open_in_memory().expect("open mem");
        WorkspaceManager::migrations()
            .to_latest(&mut conn)
            .expect("migrate");

        let mut v = vec![0.0_f32; 384];
        v[0] = 1.0;
        conn.execute(
            "INSERT INTO vec_embeddings(rowid, node_id, chunk_index, embedding)
             VALUES (?, ?, ?, ?)",
            rusqlite::params![1_i64, "node-A", 0_i64, v.as_slice().as_bytes()],
        )
        .expect("insert 384d vector");

        let query_bytes: Vec<u8> = v.as_slice().as_bytes().to_vec();
        let (found_id, distance): (String, f64) = conn
            .query_row(
                "SELECT node_id, distance
                 FROM vec_embeddings
                 WHERE embedding MATCH ?
                   AND k = 1",
                [query_bytes],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("knn query");
        assert_eq!(found_id, "node-A");
        assert!(distance < 1e-5, "identity distance near zero");
    }

    /// The seed INSERT at migration time must enqueue every embeddable
    /// workspace_node (document, row, database — excluding soft-deleted).
    /// This simulates an "upgrade install" by populating workspace_nodes
    /// BEFORE running the Phase A migration alone, then verifying the
    /// queue matches.
    #[test]
    fn backfill_queue_seeded_from_existing_embeddable_nodes() {
        ensure_vec_extension();
        let mut conn = rusqlite::Connection::open_in_memory().expect("open mem");

        // Apply everything up to (but not including) the Phase A migration
        // by building a smaller Migrations list. Easiest path: re-use
        // `migrations()` but roll back Phase A by deleting the three tables
        // after full application, insert rows, then manually replay the
        // Phase A SEED statement. Cleaner: manually apply pre-Phase-A
        // migrations. But since `Migrations` doesn't expose its inner vec,
        // we take a pragmatic shortcut — apply everything, WIPE our three
        // Phase A tables, seed workspace_nodes, re-run the seed SELECT.
        WorkspaceManager::migrations()
            .to_latest(&mut conn)
            .expect("migrate");
        // Wipe Phase A tables so we can observe the seed afresh.
        conn.execute_batch(
            "DROP TABLE IF EXISTS vec_embeddings;
             DROP TABLE IF EXISTS embedding_model_info;
             DROP TABLE IF EXISTS embed_backfill_queue;",
        )
        .expect("drop phase A tables");

        // Insert representative workspace nodes covering every eligibility
        // branch: included (doc, row, db); excluded (soft-deleted, unknown
        // node_type never appears because CHECK constraint forbids).
        let now: i64 = 1_700_000_000;
        conn.execute_batch(&format!(
            r#"
            INSERT INTO workspace_nodes
                (id, parent_id, node_type, name, icon, position,
                 created_at, updated_at, deleted_at, properties, body, vault_rel_path)
            VALUES
                ('doc-1',     NULL, 'document', 'Doc 1',  '📄', 0.0, {now}, {now}, NULL, '{{}}', '', NULL),
                ('doc-2-del', NULL, 'document', 'Trashed','📄', 0.0, {now}, {now}, {now}, '{{}}', '', NULL),
                ('db-1',      NULL, 'database', 'DB 1',   '📊', 0.0, {now}, {now}, NULL, '{{}}', '', NULL),
                ('row-1',     'db-1', 'row',    'Row 1',  '📄', 0.0, {now}, {now}, NULL, '{{}}', '', NULL);
        "#
        ))
        .expect("seed workspace_nodes");

        // Re-create the three Phase A tables + run the seed INSERT the same
        // way the migration does.
        conn.execute_batch(
            r#"
            CREATE VIRTUAL TABLE vec_embeddings USING vec0(
                node_id TEXT partition key,
                chunk_index INTEGER,
                embedding float[384] distance_metric=cosine
            );
            CREATE TABLE embedding_model_info (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                model_id TEXT NOT NULL,
                dimension INTEGER NOT NULL,
                model_hash TEXT NOT NULL
            );
            CREATE TABLE embed_backfill_queue (
                node_id TEXT PRIMARY KEY,
                chunk_index INTEGER NOT NULL DEFAULT 0,
                state TEXT NOT NULL
                    CHECK (state IN ('pending', 'in_progress', 'error')),
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                enqueued_at INTEGER NOT NULL
            );
            INSERT OR IGNORE INTO embed_backfill_queue
                (node_id, chunk_index, state, attempts, last_error, enqueued_at)
            SELECT
                id, 0, 'pending', 0, NULL,
                CAST(strftime('%s', 'now') AS INTEGER)
            FROM workspace_nodes
            WHERE deleted_at IS NULL
              AND node_type IN ('document', 'row', 'database');
        "#,
        )
        .expect("phase A tables + seed");

        // Assert: exactly the 3 non-deleted embeddable nodes are queued.
        let mut ids: Vec<String> = conn
            .prepare("SELECT node_id FROM embed_backfill_queue ORDER BY node_id")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        ids.sort();
        assert_eq!(ids, vec!["db-1".to_string(), "doc-1".to_string(), "row-1".to_string()]);

        // All rows should be 'pending' + state constraint active.
        let pending: i64 = conn
            .query_row(
                "SELECT count(*) FROM embed_backfill_queue WHERE state = 'pending'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pending, 3);

        // CHECK constraint on state — bogus value should be rejected.
        let bad = conn.execute(
            "INSERT INTO embed_backfill_queue
               (node_id, state, enqueued_at) VALUES ('x', 'done', 1)",
            [],
        );
        assert!(bad.is_err(), "state CHECK constraint must reject 'done'");
    }

    // ─── Phase A stop-gate focused tests ──────────────────────────────────

    /// Stop gate item 5 — migration resumability / crash recovery.
    ///
    /// On a crash mid-embedding, some `embed_backfill_queue` rows can be
    /// left in `state='in_progress'`. Boot-time hygiene in
    /// `EmbeddingWorker::requeue_in_progress_on_boot` flips those back to
    /// `pending` so they get picked up again rather than stuck.
    ///
    /// We can't spin an EmbeddingWorker without an `AppHandle`, so the
    /// test replicates the exact SQL that method runs — single UPDATE on
    /// the queue — and asserts the behaviour.
    #[test]
    fn embed_backfill_queue_in_progress_rows_requeue_to_pending() {
        ensure_vec_extension();
        let mut conn = rusqlite::Connection::open_in_memory().expect("open mem");
        WorkspaceManager::migrations()
            .to_latest(&mut conn)
            .expect("migrate");

        // Seed three rows: one 'in_progress' (stuck), one 'pending' (fresh),
        // one 'error' (skipped, shouldn't be touched by the requeue).
        conn.execute_batch(
            "INSERT INTO embed_backfill_queue
                (node_id, chunk_index, state, attempts, last_error, enqueued_at)
              VALUES
                ('stuck',  0, 'in_progress', 2, NULL, 1),
                ('fresh',  0, 'pending',     0, NULL, 2),
                ('dead',   0, 'error',       3, 'empty body, skipped', 3);",
        )
        .expect("seed queue rows");

        // Mirrors EmbeddingWorker::requeue_in_progress_on_boot exactly.
        let n = conn
            .execute(
                "UPDATE embed_backfill_queue
                    SET state = 'pending',
                        last_error = NULL
                  WHERE state = 'in_progress'",
                [],
            )
            .expect("requeue UPDATE");
        assert_eq!(n, 1, "exactly one row should flip in_progress→pending");

        let states: Vec<(String, String)> = conn
            .prepare("SELECT node_id, state FROM embed_backfill_queue ORDER BY node_id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(
            states,
            vec![
                ("dead".to_string(), "error".to_string()),
                ("fresh".to_string(), "pending".to_string()),
                ("stuck".to_string(), "pending".to_string()),
            ],
            "error rows untouched; in_progress resurrected to pending"
        );
    }

    /// Stop gate item 6 — `.handy.lock` single-instance behaviour.
    ///
    /// `fs2::FileExt::try_lock_exclusive` on the same path from two
    /// `File` handles in the same process must allow the first and reject
    /// the second. Covers the Rule 15 / D11 invariant.
    #[test]
    fn handy_lock_rejects_second_acquirer() {
        use fs2::FileExt;
        use std::fs::OpenOptions;
        use tempfile::TempDir;

        let dir = TempDir::new().expect("tempdir");
        let lock_path = dir.path().join(".handy.lock");

        let first = OpenOptions::new()
            .create(true)
            .write(true)
            .open(&lock_path)
            .expect("open lock #1");
        first.try_lock_exclusive().expect("first acquirer holds lock");

        let second = OpenOptions::new()
            .create(true)
            .write(true)
            .open(&lock_path)
            .expect("open lock #2");
        let result = second.try_lock_exclusive();
        assert!(
            result.is_err(),
            "second acquirer must be rejected while first holds"
        );

        // Drop first → OS releases lock → next acquirer succeeds.
        drop(first);
        second
            .try_lock_exclusive()
            .expect("lock acquirable after first drops");
    }

    /// Stop gate item 4 — concurrent read-while-write on `vec_embeddings`.
    ///
    /// One thread streams INSERTs (a worker drain burst); another thread
    /// fires KNN queries against the partially-populated table. We assert
    /// neither deadlocks nor returns a SQL error. Latency targets are
    /// verified separately with real seed data (stop gate item 3); this
    /// test is about correctness under concurrency, not microseconds.
    #[test]
    fn vec_embeddings_concurrent_read_while_write() {
        use std::sync::Arc;
        use std::thread;
        use std::time::{Duration, Instant};
        use zerocopy::IntoBytes;

        ensure_vec_extension();
        let temp_path = {
            let dir = tempfile::TempDir::new().expect("tempdir");
            dir.path().join("concurrent.db")
            // dir drops here, temp path survives because we hold the PathBuf
        };
        // Recreate the parent — TempDir dropped above. Keep a persistent
        // on-disk DB (not `:memory:`) so two connections can share it via
        // WAL mode semantics.
        std::fs::create_dir_all(temp_path.parent().unwrap()).ok();

        let mut setup = rusqlite::Connection::open(&temp_path).expect("open setup conn");
        setup
            .busy_timeout(Duration::from_secs(5))
            .expect("busy_timeout");
        setup
            .pragma_update(None, "journal_mode", "WAL")
            .expect("WAL");
        WorkspaceManager::migrations()
            .to_latest(&mut setup)
            .expect("migrate");
        drop(setup);

        let path = Arc::new(temp_path);

        // Writer thread: inserts 500 vectors in 100 small batches so the
        // reader gets plenty of query opportunities across the stream.
        let write_path = path.clone();
        let writer = thread::spawn(move || -> rusqlite::Result<usize> {
            let conn = rusqlite::Connection::open(&*write_path)?;
            conn.busy_timeout(Duration::from_secs(5))?;
            conn.pragma_update(None, "journal_mode", "WAL")?;
            let mut total = 0;
            for batch in 0..100 {
                let tx = conn.unchecked_transaction()?;
                for i in 0..5 {
                    let rowid = (batch * 5 + i + 1) as i64;
                    let mut v = vec![0.0_f32; 384];
                    v[(rowid as usize) % 384] = 1.0;
                    tx.execute(
                        "INSERT INTO vec_embeddings(rowid, node_id, chunk_index, embedding)
                         VALUES (?, ?, 0, ?)",
                        rusqlite::params![
                            rowid,
                            format!("n-{rowid}"),
                            v.as_slice().as_bytes()
                        ],
                    )?;
                    total += 1;
                }
                tx.commit()?;
                // Small pause so the reader actually overlaps.
                thread::sleep(Duration::from_millis(1));
            }
            Ok(total)
        });

        // Reader thread: fires KNN queries for 2 seconds, counts how many
        // succeed.
        let read_path = path.clone();
        let reader = thread::spawn(move || -> rusqlite::Result<usize> {
            let conn = rusqlite::Connection::open(&*read_path)?;
            conn.busy_timeout(Duration::from_secs(5))?;
            let deadline = Instant::now() + Duration::from_millis(2_000);
            let mut q = vec![0.0_f32; 384];
            q[0] = 1.0;
            let q_bytes = q.as_slice().as_bytes().to_vec();
            let mut successful_queries = 0;
            while Instant::now() < deadline {
                let mut stmt = conn.prepare(
                    "SELECT node_id, distance
                       FROM vec_embeddings
                      WHERE embedding MATCH ?
                        AND k = 5
                      ORDER BY distance",
                )?;
                let _: Vec<(String, f64)> = stmt
                    .query_map([q_bytes.clone()], |r| Ok((r.get(0)?, r.get(1)?)))?
                    .collect::<Result<_, _>>()?;
                successful_queries += 1;
                thread::sleep(Duration::from_millis(5));
            }
            Ok(successful_queries)
        });

        let write_count = writer.join().expect("writer panicked").expect("write ok");
        let read_count = reader.join().expect("reader panicked").expect("read ok");

        assert_eq!(write_count, 500, "all writes committed");
        assert!(
            read_count > 0,
            "at least one KNN query should succeed during the write burst \
             (got {read_count})"
        );
        eprintln!(
            "concurrent: {} inserts, {} successful KNN queries",
            write_count, read_count
        );
    }

    /// Stop gate item 7 — model-missing FTS-only fallback.
    ///
    /// When `inference_handle.is_available() == false`,
    /// `SearchManager::hybrid_search_workspace` must still return FTS
    /// hits (semantic contributes 0 candidates, RRF merge degrades
    /// gracefully). The integration would require an AppHandle, so we
    /// verify the static invariant: the vec_embeddings SELECT path in
    /// SearchManager is gated on `is_available()` at the call site.
    ///
    /// This test asserts the DDL-level behaviour the caller relies on:
    /// a vec_embeddings query against an empty table returns zero rows
    /// without error, and workspace_fts queries work independently.
    #[test]
    fn fts_query_path_works_when_vec_embeddings_empty() {
        ensure_vec_extension();
        let mut conn = rusqlite::Connection::open_in_memory().expect("open mem");
        WorkspaceManager::migrations()
            .to_latest(&mut conn)
            .expect("migrate");

        let now: i64 = 1_700_000_000;
        conn.execute_batch(&format!(
            r#"
            INSERT INTO workspace_nodes
                (id, parent_id, node_type, name, icon, position,
                 created_at, updated_at, deleted_at, properties, body, vault_rel_path)
            VALUES
                ('doc-a', NULL, 'document', 'Coffee notes',   '📄', 0.0, {now}, {now}, NULL, '{{}}', 'espresso grind size', NULL),
                ('doc-b', NULL, 'document', 'Garden journal', '📄', 1.0, {now}, {now}, NULL, '{{}}', 'soil nitrogen mulch', NULL);
            INSERT INTO workspace_fts(node_id, title, body) VALUES
                ('doc-a', 'Coffee notes',   'espresso grind size'),
                ('doc-b', 'Garden journal', 'soil nitrogen mulch');
        "#
        ))
        .expect("seed workspace + fts");

        // FTS-only path works without any vec_embeddings rows.
        let fts_hits: Vec<(String, String)> = conn
            .prepare(
                "SELECT node_id, title
                   FROM workspace_fts
                  WHERE workspace_fts MATCH ?1
                  ORDER BY bm25(workspace_fts)",
            )
            .unwrap()
            .query_map(["espresso"], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(fts_hits, vec![("doc-a".to_string(), "Coffee notes".to_string())]);

        // vec_embeddings KNN against an empty table returns zero rows,
        // not an error. SearchManager's `workspace_semantic_search` also
        // short-circuits on `!inference_handle.is_available()`, but even
        // if that guard is bypassed the table itself degrades cleanly.
        use zerocopy::IntoBytes;
        let mut q = vec![0.0_f32; 384];
        q[0] = 1.0;
        let q_bytes: Vec<u8> = q.as_slice().as_bytes().to_vec();
        let vec_hits: Vec<String> = conn
            .prepare(
                "SELECT node_id
                   FROM vec_embeddings
                  WHERE embedding MATCH ?
                    AND k = 5
                  ORDER BY distance",
            )
            .unwrap()
            .query_map([q_bytes], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(vec_hits.len(), 0, "empty vec_embeddings returns zero rows, not an error");
    }

    /// Test the SQL emitted by `upsert_workspace_mirror_node` directly against an
    /// in-memory connection. Covers both the database (parent_id NULL) and row
    /// (parent_id set) variants in one round-trip, plus a re-upsert to verify
    /// ON CONFLICT updates the right columns. Tested SQL-direct because Windows
    /// MSVC fails to load test exes that materialise `Option<Arc<EmbeddingWorker>>`
    /// (STATUS_ENTRYPOINT_NOT_FOUND from tauri::AppHandle drop glue).
    #[test]
    fn upsert_workspace_mirror_node_sql_round_trips_database_and_row() {
        ensure_vec_extension();
        let mut conn = rusqlite::Connection::open_in_memory().expect("open mem");
        WorkspaceManager::migrations()
            .to_latest(&mut conn)
            .expect("migrate");

        let now: i64 = 1_700_000_000;
        let upsert_sql = "INSERT INTO workspace_nodes
               (id, parent_id, node_type, name, icon, position,
                created_at, updated_at, properties, body, vault_rel_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, '', ?9)
             ON CONFLICT(id) DO UPDATE SET
               parent_id      = excluded.parent_id,
               name           = excluded.name,
               icon           = excluded.icon,
               position       = excluded.position,
               properties     = excluded.properties,
               updated_at     = excluded.updated_at,
               vault_rel_path = excluded.vault_rel_path,
               deleted_at     = NULL";

        // Database: parent_id NULL, position 1.0, icon 📊
        conn.execute(
            upsert_sql,
            rusqlite::params![
                "db-1", Option::<&str>::None, "database", "Projects", "📊", 1.0_f64,
                now, "{}", "databases/projects/database.md",
            ],
        )
        .expect("upsert database");

        // Row: parent_id = db-1, position 0.0, empty icon
        conn.execute(
            upsert_sql,
            rusqlite::params![
                "row-1", Some("db-1"), "row", "Helix Q3 Retro", "", 0.0_f64,
                now, "{}", "databases/projects/rows/helix-q3-retro.md",
            ],
        )
        .expect("upsert row");

        let (db_type, db_parent, db_name): (String, Option<String>, String) = conn
            .query_row(
                "SELECT node_type, parent_id, name FROM workspace_nodes WHERE id = ?1",
                rusqlite::params!["db-1"],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("db row");
        assert_eq!(db_type, "database");
        assert!(db_parent.is_none());
        assert_eq!(db_name, "Projects");

        let (row_type, row_parent, row_name, row_position): (String, Option<String>, String, f64) =
            conn.query_row(
                "SELECT node_type, parent_id, name, position FROM workspace_nodes WHERE id = ?1",
                rusqlite::params!["row-1"],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("row exists");
        assert_eq!(row_type, "row");
        assert_eq!(row_parent.as_deref(), Some("db-1"));
        assert_eq!(row_name, "Helix Q3 Retro");
        assert_eq!(row_position, 0.0);

        // Re-upsert the row with a renamed primary cell — ON CONFLICT must
        // update name, position, and clear deleted_at.
        conn.execute(
            "UPDATE workspace_nodes SET deleted_at = ?1 WHERE id = ?2",
            rusqlite::params![now + 1, "row-1"],
        )
        .expect("simulate prior soft-delete");
        conn.execute(
            upsert_sql,
            rusqlite::params![
                "row-1", Some("db-1"), "row", "Renamed", "", 5.0_f64,
                now + 2, "{}", "databases/projects/rows/helix-q3-retro.md",
            ],
        )
        .expect("re-upsert row");
        let (after_name, after_position, after_deleted): (String, f64, Option<i64>) = conn
            .query_row(
                "SELECT name, position, deleted_at FROM workspace_nodes WHERE id = ?1",
                rusqlite::params!["row-1"],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("row exists after re-upsert");
        assert_eq!(after_name, "Renamed");
        assert_eq!(after_position, 5.0);
        assert!(after_deleted.is_none(), "ON CONFLICT must clear deleted_at");
    }

    /// Test the SQL emitted by `update_workspace_mirror_name`. SQL-direct because
    /// the Windows linker pitfall blocks `WorkspaceManager` instantiation in tests.
    #[test]
    fn update_workspace_mirror_name_sql_changes_name_and_updated_at() {
        ensure_vec_extension();
        let mut conn = rusqlite::Connection::open_in_memory().expect("open mem");
        WorkspaceManager::migrations()
            .to_latest(&mut conn)
            .expect("migrate");

        let now: i64 = 1_700_000_000;
        conn.execute(
            "INSERT INTO workspace_nodes
               (id, parent_id, node_type, name, icon, position,
                created_at, updated_at, properties, body, vault_rel_path)
             VALUES (?1, NULL, 'row', ?2, '', 0.0, ?3, ?3, '{}', '', ?4)",
            rusqlite::params!["row-1", "Old Title", now, "databases/p/rows/row-1.md"],
        )
        .expect("insert row node");

        // Mirror what `update_workspace_mirror_name` does.
        let later: i64 = now + 100;
        conn.execute(
            "UPDATE workspace_nodes SET name = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params!["New Title", later, "row-1"],
        )
        .expect("update name");

        let (name, updated_at): (String, i64) = conn
            .query_row(
                "SELECT name, updated_at FROM workspace_nodes WHERE id = ?1",
                rusqlite::params!["row-1"],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("row exists");
        assert_eq!(name, "New Title");
        assert_eq!(updated_at, later);
    }
}
