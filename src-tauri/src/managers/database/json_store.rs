//! Vault-portable `.db.json` format — serialization, atomic write, read.
//! No async, no database connection. Pure I/O.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

pub const FORMAT_VERSION: u32 = 1;

// ------------------------------------------------------------------ //
//  Snapshot types
// ------------------------------------------------------------------ //

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DatabaseSnapshot {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub fields: Vec<FieldSnapshot>,
    pub rows: Vec<RowSnapshot>,
    /// Key: "{row_id}:{field_id}"  Value: serialized CellData
    pub cells: HashMap<String, serde_json::Value>,
    pub views: Vec<ViewSnapshot>,
    pub templates: Vec<TemplateEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FieldSnapshot {
    pub id: String,
    pub name: String,
    pub field_type: String,
    pub is_primary: bool,
    pub position: i64,
    pub type_option: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RowSnapshot {
    pub id: String,
    pub position: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ViewSnapshot {
    pub id: String,
    pub name: String,
    pub view_type: String,
    pub config: serde_json::Value,
}

#[derive(Serialize, Deserialize, Clone, Debug, specta::Type)]
pub struct TemplateColumn {
    pub name: String,
    pub color: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, specta::Type)]
pub struct TemplateEntry {
    pub id: String,
    pub name: String,
    pub columns: Vec<TemplateColumn>,
}

// ------------------------------------------------------------------ //
//  File operations
// ------------------------------------------------------------------ //

/// Atomically write snapshot to `path` (write temp → rename).
pub fn write_atomic(path: &Path, snapshot: &DatabaseSnapshot) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let tmp = path.with_extension("db.json.tmp");
    let json = serde_json::to_string_pretty(snapshot)
        .context("Failed to serialize DatabaseSnapshot")?;
    std::fs::write(&tmp, &json).context("Failed to write temp JSON")?;
    std::fs::rename(&tmp, path).context("Failed to rename temp to final")?;
    Ok(())
}

/// Deserialize a snapshot from `path`.
pub fn read(path: &Path) -> Result<DatabaseSnapshot> {
    let bytes = std::fs::read(path).context("Failed to read JSON file")?;
    serde_json::from_slice(&bytes).context("Failed to parse DatabaseSnapshot JSON")
}