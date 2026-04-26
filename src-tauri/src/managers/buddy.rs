//! Buddy system state manager.
//!
//! Owns 5 tables in `workspace.db`: `buddy_state` (singleton), `buddy_unlocks`,
//! `buddy_inventory`, `buddy_milestones`, `buddy_claim_log`. See spec at
//! docs/superpowers/specs/2026-04-26-buddy-system-design.md.

use std::sync::Arc;

use rusqlite::Connection;
use rusqlite_migration::{M, Migrations};
use tokio::sync::Mutex;

pub struct BuddyManager {
    #[allow(dead_code)]
    conn: Arc<Mutex<Connection>>,
}

impl BuddyManager {
    #[allow(dead_code)]
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    /// Returns the migration set. Apply at boot via `to_latest(&mut conn)`.
    pub fn migrations() -> Migrations<'static> {
        Migrations::new(vec![
            M::up(
                r#"
                CREATE TABLE buddy_state (
                  id INTEGER PRIMARY KEY CHECK (id = 1),
                  points_balance REAL NOT NULL DEFAULT 0,
                  points_overflow REAL NOT NULL DEFAULT 0,
                  cap_total REAL NOT NULL DEFAULT 1000.0,
                  last_drip_ms INTEGER NOT NULL,
                  last_claim_ms INTEGER,
                  active_buddy_id TEXT NOT NULL,
                  overlay_x REAL NOT NULL DEFAULT 0.96,
                  overlay_y REAL NOT NULL DEFAULT 0.92,
                  overlay_anchor TEXT NOT NULL DEFAULT 'br',
                  overlay_hidden INTEGER NOT NULL DEFAULT 0,
                  updated_at_ms INTEGER NOT NULL
                );
                CREATE TABLE buddy_unlocks (
                  buddy_id TEXT PRIMARY KEY,
                  unlocked_at_ms INTEGER NOT NULL,
                  xp_total INTEGER NOT NULL DEFAULT 0,
                  level INTEGER NOT NULL DEFAULT 1,
                  shiny INTEGER NOT NULL DEFAULT 0,
                  equipped_hat_id TEXT,
                  equipped_aura_id TEXT,
                  equipped_charm_id TEXT
                );
                CREATE TABLE buddy_inventory (
                  gear_id TEXT PRIMARY KEY,
                  slot TEXT NOT NULL CHECK (slot IN ('hat','aura','charm')),
                  species TEXT NOT NULL,
                  rarity TEXT NOT NULL CHECK (rarity IN ('common','rare','epic','legendary')),
                  shiny INTEGER NOT NULL DEFAULT 0,
                  power_bonus INTEGER NOT NULL,
                  speed_bonus INTEGER NOT NULL,
                  charm_bonus INTEGER NOT NULL,
                  acquired_at_ms INTEGER NOT NULL
                );
                CREATE TABLE buddy_milestones (
                  milestone_id TEXT PRIMARY KEY,
                  progress INTEGER NOT NULL DEFAULT 0,
                  target INTEGER NOT NULL,
                  completed_at_ms INTEGER,
                  reward_buddy_id TEXT
                );
                CREATE TABLE buddy_claim_log (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  claimed_at_ms INTEGER NOT NULL,
                  points_claimed REAL NOT NULL,
                  gear_dropped TEXT NOT NULL,
                  xp_awarded INTEGER NOT NULL
                );
            "#,
            ),
            M::up(
                r#"
                INSERT INTO buddy_state (id, last_drip_ms, active_buddy_id, updated_at_ms)
                VALUES (1, strftime('%s','now')*1000, 'scout-wings', strftime('%s','now')*1000);
                INSERT INTO buddy_unlocks (buddy_id, unlocked_at_ms, level)
                VALUES ('scout-wings', strftime('%s','now')*1000, 1);
                INSERT INTO buddy_milestones (milestone_id, target, reward_buddy_id) VALUES
                  ('embeddings-100', 100, 'hover-wings'),
                  ('embeddings-1000', 1000, NULL),
                  ('notes-50', 50, 'glide-wings'),
                  ('voice-memos-10', 10, 'lookout-wings'),
                  ('streak-7-days', 7, 'sleepy-wings'),
                  ('streak-30-days', 30, NULL),
                  ('database-rows-100', 100, 'patrol-wings'),
                  ('searches-30', 30, NULL);
            "#,
            ),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup() -> Connection {
        let mut conn = Connection::open_in_memory().expect("open");
        BuddyManager::migrations().to_latest(&mut conn).expect("migrate");
        conn
    }

    #[test]
    fn migration_creates_all_five_tables() {
        let conn = setup();
        for table in [
            "buddy_state",
            "buddy_unlocks",
            "buddy_inventory",
            "buddy_milestones",
            "buddy_claim_log",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?",
                    [table],
                    |r| r.get(0),
                )
                .expect("query");
            assert_eq!(count, 1, "table {table} missing");
        }
    }

    #[test]
    fn migration_seeds_starter_state() {
        let conn = setup();
        let active: String = conn
            .query_row(
                "SELECT active_buddy_id FROM buddy_state WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .expect("seed row");
        assert_eq!(active, "scout-wings");
        let unlocked: i64 = conn
            .query_row(
                "SELECT count(*) FROM buddy_unlocks WHERE buddy_id = 'scout-wings'",
                [],
                |r| r.get(0),
            )
            .expect("seed unlock");
        assert_eq!(unlocked, 1);
    }
}
