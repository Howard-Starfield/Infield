use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WorkspaceNode {
    pub id: String,
    pub parent_id: Option<String>,
    pub node_type: String, // "document" | "database" | "row"
    pub name: String,
    pub icon: String,
    pub position: f64,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub properties: String, // JSON — cell data for rows, field defs for databases
    pub body: String,       // Raw markdown for documents/rows
    #[serde(default)]
    pub vault_rel_path: Option<String>, // Vault file relative path, e.g. "projects/my-note.md"
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct NodeView {
    pub id: String,
    pub node_id: String,
    pub name: String,
    pub layout: String,     // "board" | "grid" | "calendar" | "chart" (legacy list/gallery/table migrated to grid)
    pub position: f64,
    pub color: Option<String>,
    pub filters: String,      // JSON array
    pub sorts: String,        // JSON array
    pub view_options: String, // JSON object
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct NodeComment {
    pub id: String,
    pub node_id: String,
    pub author: String,
    pub content: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct NodeTemplate {
    pub id: String,
    pub node_id: String,
    pub name: String,
    pub template_data: String, // JSON { field_id -> default_value }
    pub position: i32,
    pub created_at: i64,
}
