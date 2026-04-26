//! Template types crossing the Tauri boundary. Originally part of a richer
//! `<vault>/<id>.db.json` snapshot writer; that legacy machinery was retired
//! in W4 when databases moved to `databases/<slug>/database.md` +
//! `rows/<id>.md`. The template types live on because frontend code still
//! consumes them via Tauri commands (`get_database_templates`, etc.).

use serde::{Deserialize, Serialize};

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
