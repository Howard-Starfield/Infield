//! Buddy system state manager.
//!
//! Owns 5 tables in `workspace.db`: `buddy_state` (singleton), `buddy_unlocks`,
//! `buddy_inventory`, `buddy_milestones`, `buddy_claim_log`. See spec at
//! docs/superpowers/specs/2026-04-26-buddy-system-design.md.

use std::sync::Arc;

use rand::Rng;
use rusqlite::{params, Connection};
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
pub struct ActivityEvent {
    pub kind: String,
    pub weight: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct OverlayState {
    pub x: f64,
    pub y: f64,
    pub anchor: String,
    pub hidden: bool,
}

const DRIP_DURATION_SEC: f64 = 8.0 * 60.0 * 60.0; // 8 hours
const CLAIM_MIN_POINTS: f64 = 50.0;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize, specta::Type)]
pub struct ClaimResult {
    pub points_claimed: f64,
    pub xp_awarded: i64,
    pub gear_dropped: Vec<GearItem>,
}

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

    pub async fn record_activity(
        &self,
        events: &[ActivityEvent],
        now_ms: i64,
    ) -> Result<(), String> {
        let trimmed = &events[..events.len().min(50)];
        let total: i64 = trimmed.iter().map(|e| e.weight).sum();
        if total <= 0 {
            return Ok(());
        }

        let mut conn = self.conn.lock().await;
        let tx = conn
            .transaction()
            .map_err(|e| format!("buddy::record_activity: begin tx: {e}"))?;

        let active: String = tx
            .query_row(
                "SELECT active_buddy_id FROM buddy_state WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .map_err(|e| format!("buddy::record_activity: read active: {e}"))?;

        let prev_xp: i64 = tx
            .query_row(
                "SELECT xp_total FROM buddy_unlocks WHERE buddy_id = ?",
                [&active],
                |r| r.get(0),
            )
            .map_err(|e| format!("buddy::record_activity: read xp: {e}"))?;
        let new_xp = prev_xp + total;
        let new_level = level_from_xp(new_xp);

        tx.execute(
            "UPDATE buddy_state SET points_overflow = points_overflow + ?, updated_at_ms = ? WHERE id = 1",
            params![total as f64, now_ms],
        )
        .map_err(|e| format!("buddy::record_activity: bump overflow: {e}"))?;

        tx.execute(
            "UPDATE buddy_unlocks SET xp_total = ?, level = ? WHERE buddy_id = ?",
            params![new_xp, new_level, &active],
        )
        .map_err(|e| format!("buddy::record_activity: bump xp/level: {e}"))?;

        tx.commit()
            .map_err(|e| format!("buddy::record_activity: commit: {e}"))?;
        Ok(())
    }

    pub async fn claim_chest(
        &self,
        now_ms: i64,
        seed: Option<u64>,
    ) -> Result<ClaimResult, String> {
        use rand::SeedableRng;
        let mut conn = self.conn.lock().await;

        // Re-read state inside the lock so we operate on the up-to-date row
        let (mut balance, overflow, cap, last_drip, active): (f64, f64, f64, i64, String) = conn
            .query_row(
                "SELECT points_balance, points_overflow, cap_total, last_drip_ms, active_buddy_id
                   FROM buddy_state WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .map_err(|e| format!("buddy::claim_chest: read state: {e}"))?;

        // Apply lazy drip up to now (same formula as get_state)
        let elapsed_sec = ((now_ms - last_drip) as f64 / 1000.0).max(0.0);
        let rate = cap / DRIP_DURATION_SEC;
        balance = (balance + elapsed_sec * rate).min(cap);

        let claimable = balance + overflow;
        if claimable < CLAIM_MIN_POINTS {
            return Err(format!(
                "buddy::claim_chest: minimum claim is {CLAIM_MIN_POINTS} points; have {claimable:.0}"
            ));
        }

        // Compute team_power for loot bonus
        let roster = Self::read_roster(&conn)?;
        let inv = Self::read_inventory(&conn)?;
        let team_power = Self::compute_team_power(&roster, &inv);

        let activity_bonus = (overflow / 100.0).floor().min(20.0) as i32;
        let team_bonus = ((team_power + 1.0).log10() * 8.0).floor().clamp(0.0, 30.0) as i32;
        let total_bonus = (activity_bonus + team_bonus).min(50);

        let mut rng: rand::rngs::StdRng = match seed {
            Some(s) => rand::rngs::StdRng::seed_from_u64(s),
            None => rand::rngs::StdRng::from_entropy(),
        };

        // Drop count: 1 (60%), 2 (30%), 3 (10%)
        let n = {
            let r: f64 = rng.gen();
            if r < 0.6 {
                1
            } else if r < 0.9 {
                2
            } else {
                3
            }
        };
        let table = shift_rarity_table([0.70, 0.22, 0.07, 0.01], total_bonus);

        let mut drops = Vec::with_capacity(n);
        let slots = ["hat", "aura", "charm"];
        for _ in 0..n {
            let rarity = pick_rarity(table, &mut rng);
            let slot = slots[rng.gen_range(0..3)];
            let shiny = roll_shiny(&mut rng);
            drops.push(generate_gear(rarity, slot, shiny, &mut rng, now_ms));
        }

        let xp_awarded = claimable.floor() as i64;
        // Spec/test expectation: chest balance only, NOT overflow. Overflow continues
        // accumulating across claims as the activity bonus stream.
        let points_claimed = balance;

        let tx = conn
            .transaction()
            .map_err(|e| format!("buddy::claim_chest: begin tx: {e}"))?;

        for g in &drops {
            tx.execute(
                "INSERT INTO buddy_inventory (gear_id, slot, species, rarity, shiny,
                    power_bonus, speed_bonus, charm_bonus, acquired_at_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![
                    g.gear_id,
                    g.slot,
                    g.species,
                    g.rarity,
                    g.shiny as i32,
                    g.power_bonus,
                    g.speed_bonus,
                    g.charm_bonus,
                    g.acquired_at_ms
                ],
            )
            .map_err(|e| format!("buddy::claim_chest: insert gear: {e}"))?;
        }

        tx.execute(
            "UPDATE buddy_state SET points_balance = 0, last_drip_ms = ?, last_claim_ms = ?, updated_at_ms = ?
               WHERE id = 1",
            params![now_ms, now_ms, now_ms],
        )
        .map_err(|e| format!("buddy::claim_chest: reset balance: {e}"))?;

        let prev_xp: i64 = tx
            .query_row(
                "SELECT xp_total FROM buddy_unlocks WHERE buddy_id = ?",
                [&active],
                |r| r.get(0),
            )
            .map_err(|e| format!("buddy::claim_chest: read xp: {e}"))?;
        let new_xp = prev_xp + xp_awarded;
        tx.execute(
            "UPDATE buddy_unlocks SET xp_total = ?, level = ? WHERE buddy_id = ?",
            params![new_xp, level_from_xp(new_xp), &active],
        )
        .map_err(|e| format!("buddy::claim_chest: update xp/level: {e}"))?;

        let gear_ids: Vec<&str> = drops.iter().map(|g| g.gear_id.as_str()).collect();
        tx.execute(
            "INSERT INTO buddy_claim_log (claimed_at_ms, points_claimed, gear_dropped, xp_awarded)
             VALUES (?, ?, ?, ?)",
            params![
                now_ms,
                points_claimed,
                serde_json::to_string(&gear_ids).map_err(|e| format!("serde: {e}"))?,
                xp_awarded
            ],
        )
        .map_err(|e| format!("buddy::claim_chest: insert log: {e}"))?;

        tx.commit()
            .map_err(|e| format!("buddy::claim_chest: commit: {e}"))?;

        Ok(ClaimResult {
            points_claimed,
            xp_awarded,
            gear_dropped: drops,
        })
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

/// Spec §6.3 — inverse of `floor(100 × level^1.4)`.
pub fn level_from_xp(xp: i64) -> i32 {
    let mut cumulative: i64 = 0;
    for level in 1..=10_000 {
        let needed = ((level as f64).powf(1.4) * 100.0).floor() as i64;
        if cumulative + needed > xp {
            return level;
        }
        cumulative += needed;
    }
    10_000
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

/// Spec §6.5 — shift rarity table by +3% per percentage point of total bonus,
/// taken from Common and redistributed proportionally to Rare/Epic/Legendary.
pub fn shift_rarity_table(base: [f64; 4], total_bonus_pct: i32) -> [f64; 4] {
    let drop_pct = (3 * total_bonus_pct) as f64 / 100.0;
    let new_common = (base[0] - drop_pct).max(0.0);
    let removed = base[0] - new_common;
    let upper_sum: f64 = base[1] + base[2] + base[3];
    if upper_sum <= 0.0 {
        return base;
    }
    let bonus = removed / upper_sum;
    [
        new_common,
        base[1] + base[1] * bonus,
        base[2] + base[2] * bonus,
        base[3] + base[3] * bonus,
    ]
}

/// Spec §6.5 — 1-in-512 shiny roll.
pub fn roll_shiny<R: Rng>(rng: &mut R) -> bool {
    rng.gen_range(0..512) == 0
}

/// Spec §6.5 — sample a rarity from a 4-bucket table.
pub fn pick_rarity<R: Rng>(table: [f64; 4], rng: &mut R) -> &'static str {
    let r: f64 = rng.gen();
    let mut acc = 0.0;
    for (i, p) in table.iter().enumerate() {
        acc += p;
        if r < acc {
            return ["common", "rare", "epic", "legendary"][i];
        }
    }
    "legendary"
}

fn rarity_budget(rarity: &str) -> (i32, f64) {
    match rarity {
        "common" => (10, 0.20),
        "rare" => (25, 0.15),
        "epic" => (60, 0.10),
        "legendary" => (150, 0.05),
        _ => (10, 0.20),
    }
}

fn slot_bias(slot: &str) -> [f64; 3] {
    // [power, speed, charm] weights; +50% to one stat.
    match slot {
        "hat" => [1.0, 1.0, 1.5],
        "aura" => [1.5, 1.0, 1.0],
        "charm" => [1.0, 1.5, 1.0],
        _ => [1.0, 1.0, 1.0],
    }
}

/// Spec §6.5 — generate a gear item with rarity budget + slot bias.
pub fn generate_gear<R: Rng>(
    rarity: &str,
    slot: &str,
    shiny: bool,
    rng: &mut R,
    now_ms: i64,
) -> GearItem {
    let (base, var) = rarity_budget(rarity);
    let factor = 1.0 + rng.gen_range(-var..var);
    let budget = (base as f64 * factor).round() as i32;

    let weights = slot_bias(slot);
    let weight_sum: f64 = weights.iter().sum();
    let mut alloc = [0i32; 3];
    let mut remaining = budget;
    for i in 0..2 {
        let share = (budget as f64 * weights[i] / weight_sum * rng.gen_range(0.7..1.3)).round()
            as i32;
        let share = share.min(remaining).max(0);
        alloc[i] = share;
        remaining -= share;
    }
    alloc[2] = remaining.max(0);

    GearItem {
        gear_id: uuid::Uuid::new_v4().to_string(),
        slot: slot.to_string(),
        species: format!("{rarity}-{slot}"), // placeholder species naming; B3 polishes
        rarity: rarity.to_string(),
        shiny,
        power_bonus: alloc[0],
        speed_bonus: alloc[1],
        charm_bonus: alloc[2],
        acquired_at_ms: now_ms,
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

    #[tokio::test]
    async fn record_activity_bumps_overflow_and_xp() {
        let conn = Arc::new(Mutex::new(setup()));
        let mgr = BuddyManager::new(conn);
        mgr.record_activity(&[
            ActivityEvent { kind: "buddy:note-saved".into(), weight: 5 },
            ActivityEvent { kind: "buddy:voice-memo-recorded".into(), weight: 50 },
        ], 9_999_999).await.expect("record");
        let s = mgr.get_state(9_999_999).await.expect("get");
        assert_eq!(s.points_overflow, 55.0);
        let active = s.roster.iter().find(|b| b.buddy_id == "scout-wings").unwrap();
        assert_eq!(active.xp_total, 55);
    }

    #[tokio::test]
    async fn record_activity_caps_batch_at_50_events() {
        let conn = Arc::new(Mutex::new(setup()));
        let mgr = BuddyManager::new(conn);
        let events: Vec<_> = (0..100)
            .map(|_| ActivityEvent { kind: "buddy:note-saved".into(), weight: 1 })
            .collect();
        mgr.record_activity(&events, 0).await.expect("record");
        let s = mgr.get_state(0).await.expect("get");
        assert_eq!(s.points_overflow, 50.0); // first 50 only
    }

    #[tokio::test]
    async fn record_activity_advances_level_when_threshold_crossed() {
        let conn = Arc::new(Mutex::new(setup()));
        let mgr = BuddyManager::new(conn);
        mgr.record_activity(
            &[ActivityEvent { kind: "buddy:url-imported".into(), weight: 101 }],
            0,
        ).await.expect("record");
        let s = mgr.get_state(0).await.expect("get");
        let scout = s.roster.iter().find(|b| b.buddy_id == "scout-wings").unwrap();
        assert_eq!(scout.level, 2, "L1→L2 threshold is 100 XP; feeding 101 should bump to L2");
        assert_eq!(scout.xp_total, 101);
    }

    #[test]
    fn rarity_table_shifts_proportionally() {
        let base = [0.70, 0.22, 0.07, 0.01];
        let shifted = shift_rarity_table(base, 30);
        // Common reduced by 3×30 = 90 percentage points (clamped to 0)
        assert!((shifted[0] - (0.70_f64 - 0.90).max(0.0)).abs() < 0.01);
        // Sum still ≈ 1
        let sum: f64 = shifted.iter().sum();
        assert!((sum - 1.0).abs() < 0.01);
    }

    #[test]
    fn shiny_rate_is_one_in_five_twelve() {
        use rand::SeedableRng;
        let mut shinies = 0;
        let n = 100_000;
        for seed in 0..n {
            let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
            if roll_shiny(&mut rng) {
                shinies += 1;
            }
        }
        let observed = shinies as f64 / n as f64;
        let expected = 1.0 / 512.0;
        // ±20% tolerance
        assert!(
            (observed - expected).abs() < expected * 0.2,
            "observed {observed} expected {expected}"
        );
    }

    #[tokio::test]
    async fn claim_at_full_cap_drops_gear_and_resets_balance() {
        let conn = Arc::new(Mutex::new(setup()));
        let mgr = BuddyManager::new(conn.clone());
        {
            let c = conn.lock().await;
            c.execute(
                "UPDATE buddy_state SET points_balance = 1000, points_overflow = 200, last_drip_ms = ?",
                params![0i64],
            ).unwrap();
        }
        let result = mgr.claim_chest(1_000_000, /*seed*/ Some(42)).await.expect("claim");
        assert!(!result.gear_dropped.is_empty(), "should drop ≥1 piece");
        assert_eq!(result.points_claimed, 1000.0);

        let s = mgr.get_state(1_000_000).await.expect("get");
        assert_eq!(s.points_balance, 0.0);
        assert_eq!(s.points_overflow, 200.0);
        assert_eq!(s.inventory.len(), result.gear_dropped.len());
    }

    #[tokio::test]
    async fn claim_below_minimum_returns_error() {
        let conn = Arc::new(Mutex::new(setup()));
        let mgr = BuddyManager::new(conn.clone());
        {
            let c = conn.lock().await;
            c.execute("UPDATE buddy_state SET points_balance = 30, points_overflow = 0", []).unwrap();
        }
        let err = mgr.claim_chest(0, None).await.unwrap_err();
        assert!(err.contains("minimum"), "got {err}");
    }

    #[tokio::test]
    async fn claim_log_records_each_drop() {
        let conn = Arc::new(Mutex::new(setup()));
        let mgr = BuddyManager::new(conn.clone());
        {
            let c = conn.lock().await;
            c.execute("UPDATE buddy_state SET points_balance = 1000", []).unwrap();
        }
        mgr.claim_chest(0, Some(7)).await.expect("claim");
        let log_count: i64 = {
            let c = conn.lock().await;
            c.query_row("SELECT count(*) FROM buddy_claim_log", [], |r| r.get(0)).unwrap()
        };
        assert_eq!(log_count, 1);
    }

    #[test]
    fn legendary_hat_legendary_budget_biased_to_charm() {
        use rand::SeedableRng;
        let mut totals = (0i64, 0i64, 0i64); // power, speed, charm
        for seed in 0..1000 {
            let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
            let g = generate_gear("legendary", "hat", false, &mut rng, 0);
            totals.0 += g.power_bonus as i64;
            totals.1 += g.speed_bonus as i64;
            totals.2 += g.charm_bonus as i64;
        }
        // Charm should dominate due to +50% bias
        assert!(totals.2 > totals.0, "charm {} > power {}", totals.2, totals.0);
        assert!(totals.2 > totals.1, "charm {} > speed {}", totals.2, totals.1);
    }
}
