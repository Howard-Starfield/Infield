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
    conn: Arc<Mutex<Connection>>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct BuddyState {
    pub points_balance: f64,
    pub points_overflow: f64,
    pub cap_total: f64,
    pub active_buddy_id: String,
    pub roster: Vec<BuddyUnlock>,
    pub inventory: Vec<GearItem>,
    pub milestones: Vec<Milestone>,
    pub overlay: OverlayState,
    pub team_power: f64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct BuddyUnlock {
    pub buddy_id: String,
    pub unlocked_at_ms: i64,
    pub xp_total: i64,
    pub level: i32,
    pub shiny: bool,
    pub equipped_hat_id: Option<String>,
    pub equipped_aura_id: Option<String>,
    pub equipped_charm_id: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct GearItem {
    pub gear_id: String,
    pub slot: String,
    pub species: String,
    pub rarity: String,
    pub shiny: bool,
    pub power_bonus: i32,
    pub speed_bonus: i32,
    pub charm_bonus: i32,
    pub acquired_at_ms: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct Milestone {
    pub milestone_id: String,
    pub progress: i64,
    pub target: i64,
    pub completed_at_ms: Option<i64>,
    pub reward_buddy_id: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct OverlayState {
    pub x: f64,
    pub y: f64,
    pub anchor: String,
    pub hidden: bool,
}

const DRIP_DURATION_SEC: f64 = 8.0 * 60.0 * 60.0; // 8 hours

impl BuddyManager {
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }

    pub async fn get_state(&self, now_ms: i64) -> Result<BuddyState, String> {
        let conn = self.conn.lock().await;
        let row = conn
            .query_row(
                "SELECT points_balance, points_overflow, cap_total, last_drip_ms,
                    active_buddy_id, overlay_x, overlay_y, overlay_anchor, overlay_hidden
               FROM buddy_state WHERE id = 1",
                [],
                |r| {
                    Ok((
                        r.get::<_, f64>(0)?,
                        r.get::<_, f64>(1)?,
                        r.get::<_, f64>(2)?,
                        r.get::<_, i64>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, f64>(5)?,
                        r.get::<_, f64>(6)?,
                        r.get::<_, String>(7)?,
                        r.get::<_, i64>(8)?,
                    ))
                },
            )
            .map_err(|e| format!("read buddy_state: {e}"))?;

        // Lazy drip: clamp elapsed at 0 to defend against system-clock rewind (spec §10).
        let elapsed_sec = ((now_ms - row.3) as f64 / 1000.0).max(0.0);
        let rate = row.2 / DRIP_DURATION_SEC;
        let drifted = (row.0 + elapsed_sec * rate).min(row.2);

        let roster = Self::read_roster(&conn)?;
        let inventory = Self::read_inventory(&conn)?;
        let milestones = Self::read_milestones(&conn)?;
        let team_power = Self::compute_team_power(&roster, &inventory);

        Ok(BuddyState {
            points_balance: drifted,
            points_overflow: row.1,
            cap_total: row.2,
            active_buddy_id: row.4,
            roster,
            inventory,
            milestones,
            overlay: OverlayState {
                x: row.5,
                y: row.6,
                anchor: row.7,
                hidden: row.8 != 0,
            },
            team_power,
        })
    }

    fn read_roster(conn: &Connection) -> Result<Vec<BuddyUnlock>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT buddy_id, unlocked_at_ms, xp_total, level, shiny,
                    equipped_hat_id, equipped_aura_id, equipped_charm_id
               FROM buddy_unlocks ORDER BY unlocked_at_ms",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(BuddyUnlock {
                    buddy_id: r.get(0)?,
                    unlocked_at_ms: r.get(1)?,
                    xp_total: r.get(2)?,
                    level: r.get(3)?,
                    shiny: r.get::<_, i64>(4)? != 0,
                    equipped_hat_id: r.get(5)?,
                    equipped_aura_id: r.get(6)?,
                    equipped_charm_id: r.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn read_inventory(conn: &Connection) -> Result<Vec<GearItem>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT gear_id, slot, species, rarity, shiny,
                    power_bonus, speed_bonus, charm_bonus, acquired_at_ms
               FROM buddy_inventory ORDER BY acquired_at_ms DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(GearItem {
                    gear_id: r.get(0)?,
                    slot: r.get(1)?,
                    species: r.get(2)?,
                    rarity: r.get(3)?,
                    shiny: r.get::<_, i64>(4)? != 0,
                    power_bonus: r.get(5)?,
                    speed_bonus: r.get(6)?,
                    charm_bonus: r.get(7)?,
                    acquired_at_ms: r.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn read_milestones(conn: &Connection) -> Result<Vec<Milestone>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT milestone_id, progress, target, completed_at_ms, reward_buddy_id
               FROM buddy_milestones",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Milestone {
                    milestone_id: r.get(0)?,
                    progress: r.get(1)?,
                    target: r.get(2)?,
                    completed_at_ms: r.get(3)?,
                    reward_buddy_id: r.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    fn compute_team_power(roster: &[BuddyUnlock], inv: &[GearItem]) -> f64 {
        let base_stats = base_stats_table();
        let mut total = 0.0;
        for b in roster {
            let (p, s, c) = base_stats
                .get(b.buddy_id.as_str())
                .copied()
                .unwrap_or((10, 10, 10));
            let stat_sum = (p + s + c) as f64;
            total += stat_sum * (((b.level + 1) as f64).log2());
            for slot_id in [
                &b.equipped_hat_id,
                &b.equipped_aura_id,
                &b.equipped_charm_id,
            ] {
                if let Some(id) = slot_id {
                    if let Some(g) = inv.iter().find(|g| &g.gear_id == id) {
                        total += (g.power_bonus + g.speed_bonus + g.charm_bonus) as f64;
                    }
                }
            }
        }
        total
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

/// Spec §6.4
fn base_stats_table() -> std::collections::HashMap<&'static str, (i32, i32, i32)> {
    [
        ("scout-wings", (10, 10, 10)),
        ("hover-wings", (8, 14, 8)),
        ("glide-wings", (14, 8, 8)),
        ("lookout-wings", (8, 8, 14)),
        ("sleepy-wings", (10, 12, 8)),
        ("patrol-wings", (12, 12, 6)),
    ]
    .iter()
    .copied()
    .collect()
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

    #[tokio::test]
    async fn get_state_returns_starter_balance_zero() {
        let conn = Arc::new(Mutex::new(setup()));
        let mgr = BuddyManager::new(conn);
        let s = mgr.get_state(1_000_000).await.expect("get");
        assert_eq!(s.points_balance, 0.0);
        assert_eq!(s.cap_total, 1000.0);
        assert_eq!(s.active_buddy_id, "scout-wings");
        assert_eq!(s.roster.len(), 1);
    }

    #[tokio::test]
    async fn lazy_drip_grows_balance_until_cap() {
        let conn = Arc::new(Mutex::new(setup()));
        let mgr = BuddyManager::new(conn.clone());
        // last_drip_ms was set to ~now during migration; re-anchor for deterministic test
        {
            let c = conn.lock().await;
            c.execute("UPDATE buddy_state SET last_drip_ms = 0", []).unwrap();
        }
        // After 1 hour: drip_rate ~= 0.0347 pt/sec → 124.92 pt
        let s = mgr.get_state(3_600_000).await.expect("get");
        assert!((s.points_balance - 125.0).abs() < 1.0, "got {}", s.points_balance);

        // After >8 hours: clamped to cap_total
        let s = mgr.get_state(40_000_000).await.expect("get");
        assert_eq!(s.points_balance, 1000.0);
    }

    #[tokio::test]
    async fn lazy_drip_clamps_clock_rewind() {
        let conn = Arc::new(Mutex::new(setup()));
        let mgr = BuddyManager::new(conn.clone());
        {
            let c = conn.lock().await;
            c.execute("UPDATE buddy_state SET last_drip_ms = 5_000_000, points_balance = 500", []).unwrap();
        }
        // now < last_drip_ms → no growth, no destruction
        let s = mgr.get_state(1_000_000).await.expect("get");
        assert_eq!(s.points_balance, 500.0);
    }
}
