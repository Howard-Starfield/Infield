//! Tracks the active interview workspace document for the current session.
//!
//! Mirrors `VoiceSessionManager` for voice memos. One active interview
//! session at a time — the frontend gates starting a second session.

use std::sync::Mutex;

#[derive(Clone, Debug)]
pub struct InterviewMeta {
    pub workspace_doc_id: String,
    pub session_id: String,
    pub participant_name: String,
    pub started_at_ms: i64,
}

pub struct InterviewSessionManager {
    active: Mutex<Option<InterviewMeta>>,
}

impl InterviewSessionManager {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(None),
        }
    }

    pub fn get(&self) -> Option<InterviewMeta> {
        self.active.lock().ok().and_then(|g| g.clone())
    }

    pub fn is_active(&self) -> bool {
        self.active.lock().ok().map_or(false, |g| g.is_some())
    }

    pub fn set(&self, meta: InterviewMeta) {
        if let Ok(mut guard) = self.active.lock() {
            *guard = Some(meta);
        }
    }

    pub fn take(&self) -> Option<InterviewMeta> {
        self.active.lock().ok().and_then(|mut g| g.take())
    }

    pub fn clear(&self) {
        if let Ok(mut guard) = self.active.lock() {
            *guard = None;
        }
    }
}

impl Default for InterviewSessionManager {
    fn default() -> Self {
        Self::new()
    }
}
