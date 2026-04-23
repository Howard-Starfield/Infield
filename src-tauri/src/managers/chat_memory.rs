use anyhow::{anyhow, Result};
use rusqlite::{params, Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use usearch::ffi::{IndexOptions, MetricKind, ScalarKind};
use usearch::Index;
use uuid::Uuid;

use crate::managers::chat_manager::ChatImageAttachment;

static MIGRATIONS: &[M] = &[
    M::up(
        "CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS memory_chunks (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );",
    ),
    M::up("ALTER TABLE chat_messages ADD COLUMN attachments_json TEXT;"),
    M::up("ALTER TABLE chat_messages ADD COLUMN document_context TEXT;"),
];

pub const SHORT_TERM_LIMIT: usize = 20;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChatMemoryMessage {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
    #[serde(default)]
    pub attachments: Option<Vec<ChatImageAttachment>>,
    /// Stitched `<document>...</document>` text for replay to the model (not shown as the main bubble body).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_context: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChatSession {
    pub id: String,
    pub title: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct MemoryChunk {
    pub id: String,
    pub session_id: String,
    pub content: String,
    pub created_at: i64,
    pub distance: f64,
}

fn make_memory_index_options(dimension: usize) -> IndexOptions {
    let mut opts = IndexOptions::default();
    opts.dimensions = dimension;
    opts.metric = MetricKind::Cos;
    opts.quantization = ScalarKind::F32;
    opts
}

pub struct ChatMemoryManager {
    conn: Arc<Mutex<Connection>>,
    memory_index: Arc<Mutex<Index>>,
    memory_index_path: PathBuf,
    dimension: usize,
}

impl ChatMemoryManager {
    pub fn new(app_handle: &tauri::AppHandle, dimension: usize) -> Result<Self> {
        let app_data_dir = crate::portable::app_data_dir(app_handle)?;
        Self::new_with_path(app_data_dir, dimension)
    }

    pub fn new_with_path(base_dir: PathBuf, dimension: usize) -> Result<Self> {
        std::fs::create_dir_all(&base_dir)?;
        let db_path = base_dir.join("chat.db");
        let memory_index_path = base_dir.join("memory.usearch");

        let mut conn = Connection::open(&db_path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        let migrations = Migrations::new(MIGRATIONS.to_vec());
        migrations.to_latest(&mut conn)?;

        let opts = make_memory_index_options(dimension);
        let memory_index = Index::new(&opts)?;
        if memory_index_path.exists() {
            memory_index.load(
                memory_index_path
                    .to_str()
                    .ok_or_else(|| anyhow!("non-UTF8 path"))?,
            )?;
        } else {
            memory_index.reserve(256)?;
            memory_index.save(
                memory_index_path
                    .to_str()
                    .ok_or_else(|| anyhow!("non-UTF8 path"))?,
            )?;
        }

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            memory_index: Arc::new(Mutex::new(memory_index)),
            memory_index_path,
            dimension,
        })
    }

    async fn save_memory_index(&self) -> Result<()> {
        let idx = self.memory_index.lock().await;
        idx.save(
            self.memory_index_path
                .to_str()
                .ok_or_else(|| anyhow!("non-UTF8 path"))?,
        )?;
        Ok(())
    }

    pub async fn new_session(&self, title: Option<&str>) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, title, now, now],
        )?;
        Ok(id)
    }

    pub async fn list_sessions(&self) -> Result<Vec<ChatSession>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, title, created_at, updated_at FROM chat_sessions ORDER BY updated_at DESC",
        )?;
        let sessions = stmt
            .query_map([], |r| {
                Ok(ChatSession {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    created_at: r.get(2)?,
                    updated_at: r.get(3)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(sessions)
    }

    pub async fn delete_session(&self, session_id: &str) -> Result<()> {
        // Delete memory chunks from usearch index
        let conn = self.conn.lock().await;
        let rowids: Vec<i64> = {
            let mut stmt = conn.prepare("SELECT rowid FROM memory_chunks WHERE session_id = ?1")?;
            let rows: Vec<i64> = stmt
                .query_map(params![session_id], |r| r.get(0))?
                .filter_map(|r| r.ok())
                .collect();
            rows
        };
        if !rowids.is_empty() {
            let idx = self.memory_index.lock().await;
            for &rowid in &rowids {
                let _ = idx.remove(rowid as u64);
            }
            drop(idx);
        }
        conn.execute(
            "DELETE FROM memory_chunks WHERE session_id = ?1",
            params![session_id],
        )?;
        conn.execute(
            "DELETE FROM chat_messages WHERE session_id = ?1",
            params![session_id],
        )?;
        conn.execute(
            "DELETE FROM chat_sessions WHERE id = ?1",
            params![session_id],
        )?;
        drop(conn);
        if !rowids.is_empty() {
            self.save_memory_index().await?;
        }
        Ok(())
    }

    pub async fn add_message(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        attachments: Option<Vec<ChatImageAttachment>>,
        document_context: Option<String>,
    ) -> Result<ChatMemoryMessage> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();
        let attachments_json: Option<String> = attachments
            .as_ref()
            .filter(|a| !a.is_empty())
            .map(|a| serde_json::to_string(a).unwrap_or_default());
        let doc_ctx = document_context
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO chat_messages (id, session_id, role, content, created_at, attachments_json, document_context) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, session_id, role, content, now, attachments_json, doc_ctx],
        )?;
        conn.execute(
            "UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2",
            params![now, session_id],
        )?;
        Ok(ChatMemoryMessage {
            id,
            session_id: session_id.to_owned(),
            role: role.to_owned(),
            content: content.to_owned(),
            created_at: now,
            attachments: attachments.filter(|a| !a.is_empty()),
            document_context: doc_ctx,
        })
    }

    pub async fn get_recent_messages(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<ChatMemoryMessage>> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, created_at, attachments_json, document_context FROM chat_messages WHERE session_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2",
        )?;
        let mut msgs: Vec<ChatMemoryMessage> = stmt
            .query_map(params![session_id, limit as i64], |r| {
                let attachments_json: Option<String> = r.get(5)?;
                let attachments = attachments_json.and_then(|s| serde_json::from_str(&s).ok());
                let document_context: Option<String> = r.get(6)?;
                Ok(ChatMemoryMessage {
                    id: r.get(0)?,
                    session_id: r.get(1)?,
                    role: r.get(2)?,
                    content: r.get(3)?,
                    created_at: r.get(4)?,
                    attachments,
                    document_context,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        msgs.reverse();
        Ok(msgs)
    }

    pub async fn store_memory(
        &self,
        session_id: &str,
        content: &str,
        embedding: Vec<f32>,
    ) -> Result<()> {
        if embedding.len() != self.dimension {
            return Err(anyhow!(
                "embedding dimension mismatch: expected {}, got {}",
                self.dimension,
                embedding.len()
            ));
        }
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp();
        let conn = self.conn.lock().await;
        conn.execute(
            "INSERT INTO memory_chunks (id, session_id, content, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, session_id, content, now],
        )?;
        let rowid = conn.last_insert_rowid();
        drop(conn);
        let idx = self.memory_index.lock().await;
        idx.add(rowid as u64, &embedding)?;
        drop(idx);
        self.save_memory_index().await?;
        Ok(())
    }

    pub async fn retrieve_relevant_memory(
        &self,
        query_embedding: &[f32],
        limit: usize,
    ) -> Result<Vec<MemoryChunk>> {
        if query_embedding.len() != self.dimension {
            return Err(anyhow!("query dimension mismatch"));
        }
        let idx = self.memory_index.lock().await;
        let count = idx.size();
        if count == 0 {
            return Ok(Vec::new());
        }
        let results = idx.search(query_embedding, limit.min(count))?;
        drop(idx);
        let conn = self.conn.lock().await;
        let mut output = Vec::with_capacity(limit);
        for i in 0..results.keys.len() {
            let rowid = results.keys[i] as i64;
            let distance = results.distances[i] as f64;
            let row = conn
                .query_row(
                    "SELECT id, session_id, content, created_at FROM memory_chunks WHERE rowid = ?1",
                    params![rowid],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, i64>(3)?,
                        ))
                    },
                )
                .optional()?;
            if let Some((id, session_id, content, created_at)) = row {
                output.push(MemoryChunk {
                    id,
                    session_id,
                    content,
                    created_at,
                    distance,
                });
            }
        }
        Ok(output)
    }

    /// Delete messages in a session older than `before_timestamp` (exclusive).
    pub async fn delete_messages_before(
        &self,
        session_id: &str,
        before_timestamp: i64,
    ) -> Result<usize> {
        let conn = self.conn.lock().await;
        let deleted = conn.execute(
            "DELETE FROM chat_messages WHERE session_id = ?1 AND created_at < ?2",
            params![session_id, before_timestamp],
        )?;
        Ok(deleted)
    }

    pub async fn message_count(&self, session_id: &str) -> Result<i64> {
        let conn = self.conn.lock().await;
        Ok(conn.query_row(
            "SELECT COUNT(*) FROM chat_messages WHERE session_id = ?1",
            params![session_id],
            |r| r.get(0),
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const TEST_DIM: usize = 32;

    fn make_manager(tmp: &TempDir) -> ChatMemoryManager {
        ChatMemoryManager::new_with_path(tmp.path().to_path_buf(), TEST_DIM).unwrap()
    }

    #[tokio::test]
    async fn add_messages_and_retrieve_recent() {
        let tmp = TempDir::new().unwrap();
        let mgr = make_manager(&tmp);
        let session_id = mgr.new_session(None).await.unwrap();
        mgr.add_message(&session_id, "user", "Hello, what is Rust?", None, None)
            .await
            .unwrap();
        mgr.add_message(&session_id, "assistant", "Rust is a systems language.", None, None)
            .await
            .unwrap();
        let msgs = mgr.get_recent_messages(&session_id, 10).await.unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].role, "user");
    }

    #[tokio::test]
    async fn store_and_retrieve_memory() {
        let tmp = TempDir::new().unwrap();
        let mgr = make_manager(&tmp);
        let session_id = mgr.new_session(None).await.unwrap();
        let embedding: Vec<f32> = vec![1.0_f32; TEST_DIM];
        mgr.store_memory(&session_id, "User is learning Rust", embedding.clone())
            .await
            .unwrap();
        let memories = mgr.retrieve_relevant_memory(&embedding, 5).await.unwrap();
        assert!(!memories.is_empty());
        assert!(memories[0].content.contains("Rust"));
    }

    #[tokio::test]
    async fn delete_session_clears_everything() {
        let tmp = TempDir::new().unwrap();
        let mgr = make_manager(&tmp);
        let sid = mgr.new_session(Some("Test")).await.unwrap();
        mgr.add_message(&sid, "user", "hi", None, None).await.unwrap();
        let emb: Vec<f32> = vec![1.0; TEST_DIM];
        mgr.store_memory(&sid, "memory", emb.clone()).await.unwrap();
        mgr.delete_session(&sid).await.unwrap();
        let sessions = mgr.list_sessions().await.unwrap();
        assert!(sessions.is_empty());
        let memories = mgr.retrieve_relevant_memory(&emb, 5).await.unwrap();
        assert!(memories.is_empty());
    }
}
