//! Phase B onboarding state manager.
//!
//! Reads/writes the singleton `onboarding_state` row created by the Phase B
//! migration (see `workspace_manager::migrations()`). Separated from
//! `WorkspaceManager` to keep workflow-state concerns out of the node/FTS/vec
//! surface.
//!
//! State shape and transitions live in
//! [`docs/architecture/entry-experience.md`](../../../docs/architecture/entry-experience.md);
//! this module is the durable storage behind the stage machine in
//! `src/entry/EntryContext.tsx`.

use std::sync::Arc;

use rusqlite::{Connection, OptionalExtension, params};
use tokio::sync::Mutex;

/// Phases of the 4-step Spotlight onboarding flow, plus `Done` terminal state.
///
/// String values match the DB CHECK constraint (a permissive superset that
/// also accepts legacy 'welcome'/'theme' values from pre-W0 dev runs — see
/// `get()` for the on-read self-heal). Keep this list and the
/// frontend's discriminated union in lockstep.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum OnboardingStep {
    Mic,
    Accessibility,
    Models,
    Vault,
    Extensions, // W7: browser-extension / yt-dlp install step
    Done,
}

impl OnboardingStep {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Mic => "mic",
            Self::Accessibility => "accessibility",
            Self::Models => "models",
            Self::Vault => "vault",
            Self::Extensions => "extensions",
            Self::Done => "done",
        }
    }

    /// Parses a step string. Legacy 'welcome' and 'theme' values from any
    /// pre-W0 dev run are coerced to `Mic` so the frontend never sees a
    /// step it doesn't know how to render. The on-read coercion in `get()`
    /// also patches the row so subsequent reads return 'mic' directly.
    fn from_str(s: &str) -> Result<Self, String> {
        Ok(match s {
            "mic" | "welcome" | "theme" => Self::Mic,
            "accessibility" => Self::Accessibility,
            "models" => Self::Models,
            "vault" => Self::Vault,
            "extensions" => Self::Extensions,
            "done" => Self::Done,
            other => return Err(format!("unknown onboarding step: {other}")),
        })
    }
}

/// Permission outcomes for mic and accessibility steps.
///
/// `NotApplicable` only applies to `accessibility_permission` on non-macOS
/// platforms (D13: step is skipped silently, but we record the skip reason
/// distinctly so a later telemetry / support flow can tell "user skipped" from
/// "platform doesn't need it").
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum PermissionState {
    Granted,
    Denied,
    Skipped,
    NotApplicable,
}

impl PermissionState {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Granted => "granted",
            Self::Denied => "denied",
            Self::Skipped => "skipped",
            Self::NotApplicable => "not_applicable",
        }
    }

    fn from_str(s: &str) -> Result<Self, String> {
        Ok(match s {
            "granted" => Self::Granted,
            "denied" => Self::Denied,
            "skipped" => Self::Skipped,
            "not_applicable" => Self::NotApplicable,
            other => return Err(format!("unknown permission state: {other}")),
        })
    }
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct OnboardingState {
    pub current_step: OnboardingStep,
    pub mic_permission: Option<PermissionState>,
    pub accessibility_permission: Option<PermissionState>,
    /// Model ids whose download has completed and hash-verified, e.g.
    /// `["whisper-base", "bge-small-en-v1.5"]`.
    pub models_downloaded: Vec<String>,
    pub vault_root: Option<String>,
    pub started_at: i64,
    pub completed_at: Option<i64>,
}

/// Partial update — every field is optional so the frontend can patch one
/// concern at a time. `None` means "don't touch"; explicit clearing is not
/// supported (never needed in the happy path — resetting goes through
/// `reset_onboarding` which `DELETE`s the row).
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct OnboardingStatePatch {
    pub current_step: Option<OnboardingStep>,
    pub mic_permission: Option<PermissionState>,
    pub accessibility_permission: Option<PermissionState>,
    pub models_downloaded: Option<Vec<String>>,
    pub vault_root: Option<String>,
    pub completed_at: Option<i64>,
}

pub struct OnboardingManager {
    conn: Arc<Mutex<Connection>>,
}

impl OnboardingManager {
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    /// Returns the current onboarding state. On fresh install or after a
    /// reset, lazily creates a row pointing at `welcome` — so the frontend
    /// never has to distinguish "not started" from "at welcome step". Any
    /// row in the table is authoritative.
    pub async fn get(&self) -> Result<OnboardingState, String> {
        let conn = self.conn.lock().await;
        let existing = conn
            .query_row(
                "SELECT current_step, mic_permission, accessibility_permission,
                        models_downloaded, vault_root, started_at, completed_at
                 FROM onboarding_state WHERE id = 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, Option<i64>>(6)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some((step, mic, acc, models_json, vault, started, completed)) = existing {
            let parsed_step = OnboardingStep::from_str(&step)?;
            // Legacy self-heal: if the row had 'welcome' or 'theme', coerce
            // it to 'mic' (parsed_step already reflects this) AND patch the
            // row in-place so we don't re-coerce on every read.
            if step == "welcome" || step == "theme" {
                conn.execute(
                    "UPDATE onboarding_state SET current_step = 'mic' WHERE id = 1",
                    [],
                )
                .map_err(|e| e.to_string())?;
            }
            return Ok(OnboardingState {
                current_step: parsed_step,
                mic_permission: mic
                    .map(|s| PermissionState::from_str(&s))
                    .transpose()?,
                accessibility_permission: acc
                    .map(|s| PermissionState::from_str(&s))
                    .transpose()?,
                models_downloaded: parse_models(models_json)?,
                vault_root: vault,
                started_at: started,
                completed_at: completed,
            });
        }

        // Row doesn't exist — create it at `mic` and return the seed.
        let now = now_unix();
        conn.execute(
            "INSERT INTO onboarding_state
                (id, current_step, started_at)
             VALUES (1, 'mic', ?1)",
            params![now],
        )
        .map_err(|e| e.to_string())?;

        Ok(OnboardingState {
            current_step: OnboardingStep::Mic,
            mic_permission: None,
            accessibility_permission: None,
            models_downloaded: Vec::new(),
            vault_root: None,
            started_at: now,
            completed_at: None,
        })
    }

    /// Applies a partial update. Ensures the row exists (via `get`) before
    /// patching so callers don't need to order operations carefully.
    pub async fn patch(&self, patch: OnboardingStatePatch) -> Result<OnboardingState, String> {
        // Ensure row exists. Drops the lock before acquiring it again for the
        // UPDATE below — Mutex re-entry would deadlock (Rule: never hold a
        // lock across another `.await` on the same lock).
        let _ = self.get().await?;

        let conn = self.conn.lock().await;
        if let Some(step) = &patch.current_step {
            conn.execute(
                "UPDATE onboarding_state SET current_step = ?1 WHERE id = 1",
                params![step.as_str()],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(mic) = &patch.mic_permission {
            conn.execute(
                "UPDATE onboarding_state SET mic_permission = ?1 WHERE id = 1",
                params![mic.as_str()],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(acc) = &patch.accessibility_permission {
            conn.execute(
                "UPDATE onboarding_state SET accessibility_permission = ?1 WHERE id = 1",
                params![acc.as_str()],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(models) = &patch.models_downloaded {
            let json = serde_json::to_string(models).map_err(|e| e.to_string())?;
            conn.execute(
                "UPDATE onboarding_state SET models_downloaded = ?1 WHERE id = 1",
                params![json],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(vault) = &patch.vault_root {
            conn.execute(
                "UPDATE onboarding_state SET vault_root = ?1 WHERE id = 1",
                params![vault],
            )
            .map_err(|e| e.to_string())?;
        }
        if let Some(completed) = patch.completed_at {
            conn.execute(
                "UPDATE onboarding_state SET completed_at = ?1 WHERE id = 1",
                params![completed],
            )
            .map_err(|e| e.to_string())?;
        }
        drop(conn);
        self.get().await
    }

    /// D16: wipes the onboarding row so next boot enters at `welcome`. Does
    /// NOT touch theme, vault, or downloaded models — reset is about the
    /// guided flow, not user data.
    pub async fn reset(&self) -> Result<(), String> {
        let conn = self.conn.lock().await;
        conn.execute("DELETE FROM onboarding_state", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn parse_models(json: Option<String>) -> Result<Vec<String>, String> {
    match json {
        None => Ok(Vec::new()),
        Some(s) if s.is_empty() => Ok(Vec::new()),
        Some(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
    }
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::managers::workspace::WorkspaceManager;
    use std::sync::Once;

    /// Phase A's migration creates a `vec0` virtual table, which needs
    /// `sqlite3_auto_extension` called before any `Connection::open`. Same
    /// pattern as `workspace_manager::tests::ensure_vec_extension`; duplicated
    /// here to keep this module self-contained (the other helper is inside a
    /// `#[cfg(test)] mod` and not exported).
    static VEC_INIT: Once = Once::new();
    fn ensure_vec_extension() {
        VEC_INIT.call_once(|| unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        });
    }

    fn fresh_conn() -> Connection {
        ensure_vec_extension();
        let mut conn = Connection::open_in_memory().expect("open mem db");
        WorkspaceManager::migrations()
            .to_latest(&mut conn)
            .expect("apply migrations");
        conn
    }

    fn manager() -> OnboardingManager {
        let conn = fresh_conn();
        OnboardingManager::new(Arc::new(Mutex::new(conn)))
    }

    #[tokio::test]
    async fn get_on_fresh_install_seeds_mic_row() {
        let m = manager();
        let state = m.get().await.expect("get");
        assert_eq!(state.current_step, OnboardingStep::Mic);
        assert!(state.mic_permission.is_none());
        assert!(state.vault_root.is_none());
        assert!(state.completed_at.is_none());
        assert!(state.models_downloaded.is_empty());
        assert!(state.started_at > 0);
    }

    #[tokio::test]
    async fn patch_advances_step_and_records_permission() {
        let m = manager();
        let _ = m.get().await.expect("seed");
        let patched = m
            .patch(OnboardingStatePatch {
                current_step: Some(OnboardingStep::Mic),
                mic_permission: Some(PermissionState::Granted),
                ..Default::default()
            })
            .await
            .expect("patch");
        assert_eq!(patched.current_step, OnboardingStep::Mic);
        assert_eq!(patched.mic_permission, Some(PermissionState::Granted));
    }

    #[tokio::test]
    async fn patch_models_roundtrips_through_json() {
        let m = manager();
        let _ = m.get().await.expect("seed");
        let patched = m
            .patch(OnboardingStatePatch {
                models_downloaded: Some(vec![
                    "whisper-base".to_string(),
                    "bge-small-en-v1.5".to_string(),
                ]),
                ..Default::default()
            })
            .await
            .expect("patch");
        assert_eq!(patched.models_downloaded.len(), 2);
        assert_eq!(patched.models_downloaded[0], "whisper-base");
    }

    #[tokio::test]
    async fn reset_wipes_row_next_get_reseeds_mic() {
        let m = manager();
        let _ = m
            .patch(OnboardingStatePatch {
                current_step: Some(OnboardingStep::Models),
                ..Default::default()
            })
            .await
            .expect("advance");
        m.reset().await.expect("reset");
        let state = m.get().await.expect("reseed");
        assert_eq!(state.current_step, OnboardingStep::Mic);
    }

    #[tokio::test]
    async fn legacy_welcome_row_self_heals_to_mic_on_read() {
        // Simulate a row written by pre-W0 code (when 'welcome' was the seed).
        ensure_vec_extension();
        let mut conn = Connection::open_in_memory().expect("open mem db");
        WorkspaceManager::migrations()
            .to_latest(&mut conn)
            .expect("apply migrations");
        conn.execute(
            "INSERT INTO onboarding_state (id, current_step, started_at)
             VALUES (1, 'welcome', 0)",
            [],
        )
        .expect("seed legacy row");
        let m = OnboardingManager::new(Arc::new(Mutex::new(conn)));
        // First read coerces + patches in-place.
        let s1 = m.get().await.expect("first read");
        assert_eq!(s1.current_step, OnboardingStep::Mic);
        // Second read sees 'mic' directly (no coercion needed).
        let s2 = m.get().await.expect("second read");
        assert_eq!(s2.current_step, OnboardingStep::Mic);
    }

    #[tokio::test]
    async fn legacy_theme_row_self_heals_to_mic_on_read() {
        ensure_vec_extension();
        let mut conn = Connection::open_in_memory().expect("open mem db");
        WorkspaceManager::migrations()
            .to_latest(&mut conn)
            .expect("apply migrations");
        conn.execute(
            "INSERT INTO onboarding_state (id, current_step, started_at)
             VALUES (1, 'theme', 0)",
            [],
        )
        .expect("seed legacy theme row");
        let m = OnboardingManager::new(Arc::new(Mutex::new(conn)));
        let s = m.get().await.expect("read");
        assert_eq!(s.current_step, OnboardingStep::Mic);
    }

    #[test]
    fn extensions_serializes_snake_case() {
        let s = OnboardingStep::Extensions;
        assert_eq!(serde_json::to_string(&s).unwrap(), "\"extensions\"");
    }

    #[test]
    fn extensions_from_str_roundtrips() {
        let s = OnboardingStep::from_str("extensions").expect("parse extensions");
        assert_eq!(s, OnboardingStep::Extensions);
        assert_eq!(s.as_str(), "extensions");
    }

    #[tokio::test]
    async fn check_constraint_rejects_unknown_step_on_direct_insert() {
        // Not reachable through the typed API, but protects against
        // accidental raw SQL drift later.
        ensure_vec_extension();
        let conn = fresh_conn();
        let err = conn.execute(
            "INSERT INTO onboarding_state (id, current_step, started_at)
             VALUES (1, 'bogus', 0)",
            [],
        );
        assert!(err.is_err(), "CHECK should reject 'bogus'");
    }

    #[tokio::test]
    async fn phase_b_migration_applies_cleanly() {
        // Covered by fresh_conn() but asserted explicitly so a future
        // migration-ordering regression blows up here, not downstream.
        ensure_vec_extension();
        let mut conn = Connection::open_in_memory().unwrap();
        WorkspaceManager::migrations()
            .to_latest(&mut conn)
            .expect("migrations apply");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type = 'table' AND name = 'onboarding_state'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }
}
