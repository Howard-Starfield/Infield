//! Phase A stop-gate seed vault generator.
//!
//! Populates a `workspace.db` with N synthetic nodes + N synthetic 384d
//! `vec_embeddings` rows, so Howard can exercise:
//!   - Item 2 (semantic top-5 overlap): inspect curated query results
//!     against known-seeded document IDs.
//!   - Item 3 (perf <50ms @ 10k / <200ms @ 100k): measure KNN latency
//!     against a populated vec0 index.
//!
//! The generated vectors are structured, not random: each node gets a
//! "theme axis" deterministically derived from its ID, so queries whose
//! vector sits near a theme axis retrieve a predictable cluster. That
//! lets the semantic-overlap test be a real assertion (not just "did we
//! get any results").
//!
//! Usage:
//!   cd spikes/seed_vault
//!   cargo run --release -- --count 10000 --db "<path/to/workspace.db>"
//!
//! Flags:
//!   --count  N       Number of synthetic nodes to insert (default 10_000)
//!   --db     PATH    Target workspace.db. Defaults to
//!                    %APPDATA%\com.pais.infield.seed\workspace.db
//!                    (distinct from live vault — you pick the real path
//!                    explicitly to avoid accidental clobber)
//!   --themes M       How many theme clusters (default 10) — queries that
//!                    target theme K should retrieve mostly nodes from
//!                    theme K in their top-N.
//!   --wipe           Delete existing workspace_nodes + vec_embeddings +
//!                    embed_backfill_queue rows before seeding. (The
//!                    schema migration runs regardless.)

use anyhow::{anyhow, Context, Result};
use clap::Parser;
use rand::prelude::*;
use rusqlite::{ffi::sqlite3_auto_extension, params, Connection};
use rusqlite_migration::{Migrations, M};
use std::path::PathBuf;
use std::time::Instant;
use zerocopy::IntoBytes;

const EMBEDDING_DIM: usize = 384;

#[derive(Parser)]
struct Args {
    #[arg(long, default_value_t = 10_000)]
    count: usize,
    #[arg(long)]
    db: Option<PathBuf>,
    #[arg(long, default_value_t = 10)]
    themes: usize,
    #[arg(long)]
    wipe: bool,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let db_path = args.db.unwrap_or_else(default_seed_db_path);
    std::fs::create_dir_all(
        db_path
            .parent()
            .ok_or_else(|| anyhow!("db path has no parent"))?,
    )?;

    // Must register before any Connection::open so vec0 is available.
    unsafe {
        sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    }

    println!(
        "seed_vault: db={} count={} themes={} wipe={}",
        db_path.display(),
        args.count,
        args.themes,
        args.wipe
    );

    let mut conn = Connection::open(&db_path).context("open seed workspace.db")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");

    // Run the schema. Single monolithic migration mirrors what the real
    // app's `WorkspaceManager::migrations()` produces for a fresh DB —
    // keep this in sync if Phase A migration list changes.
    apply_schema(&mut conn)?;

    if args.wipe {
        conn.execute("DELETE FROM vec_embeddings", [])?;
        conn.execute("DELETE FROM embed_backfill_queue", [])?;
        conn.execute("DELETE FROM workspace_fts", [])?;
        conn.execute("DELETE FROM workspace_nodes", [])?;
        println!("seed_vault: wiped existing rows");
    }

    let mut rng = StdRng::seed_from_u64(0xB9E_511_A);
    let now: i64 = 1_700_000_000;

    let tx = conn.transaction()?;
    let start = Instant::now();

    // Insert nodes + embeddings in one tx for speed.
    for i in 0..args.count {
        let id = format!("seed-{:07}", i);
        let theme = i % args.themes;
        let name = format!("Seed doc {} (theme {})", i, theme);
        let body = synthetic_body(i, theme);

        tx.execute(
            r#"
            INSERT INTO workspace_nodes
                (id, parent_id, node_type, name, icon, position,
                 created_at, updated_at, deleted_at, properties, body, vault_rel_path)
            VALUES (?, NULL, 'document', ?, '📄', ?, ?, ?, NULL, '{}', ?, NULL)
            "#,
            params![id, name, i as f64, now, now, body],
        )?;

        tx.execute(
            "INSERT INTO workspace_fts(node_id, title, body) VALUES (?, ?, ?)",
            params![id, name, body],
        )?;

        let embedding = synthesize_embedding(theme, args.themes, &mut rng);
        tx.execute(
            "INSERT INTO vec_embeddings(node_id, chunk_index, embedding) VALUES (?, ?, ?)",
            params![id, 0_i64, embedding.as_slice().as_bytes()],
        )?;

        if (i + 1) % 1000 == 0 {
            println!(
                "  {:>7} / {:>7} nodes ({}ms elapsed)",
                i + 1,
                args.count,
                start.elapsed().as_millis()
            );
        }
    }

    tx.commit()?;
    println!(
        "seed_vault: done in {:.2}s",
        start.elapsed().as_secs_f32()
    );
    println!();
    println!("To measure KNN latency against the seeded index:");
    println!(
        "  sqlite3 \"{}\" \"SELECT node_id, distance FROM vec_embeddings \\",
        db_path.display()
    );
    println!("    WHERE embedding MATCH :q AND k = 5 ORDER BY distance\"");
    println!();
    println!("A query vector sitting near theme-K's axis retrieves a cluster of");
    println!("theme-K nodes — use that to validate top-5 overlap.");

    Ok(())
}

/// Mirrors the Phase A migration vec for a fresh DB. Intentionally NOT
/// imported from the real crate — seed_vault stays standalone to avoid
/// pulling the Tauri build chain for a dev utility.
fn apply_schema(conn: &mut Connection) -> Result<()> {
    Migrations::new(vec![
        M::up(
            r#"
            CREATE TABLE IF NOT EXISTS workspace_nodes (
                id TEXT PRIMARY KEY,
                parent_id TEXT REFERENCES workspace_nodes(id) ON DELETE CASCADE,
                node_type TEXT NOT NULL
                    CHECK(node_type IN ('document','database','row')),
                name TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT '📄',
                position REAL NOT NULL DEFAULT 0.0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                deleted_at INTEGER,
                properties TEXT NOT NULL DEFAULT '{}',
                body TEXT NOT NULL DEFAULT '',
                vault_rel_path TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_wn_parent ON workspace_nodes(parent_id);
            CREATE INDEX IF NOT EXISTS idx_wn_node_type ON workspace_nodes(node_type);
            CREATE VIRTUAL TABLE IF NOT EXISTS workspace_fts USING fts5(
                node_id UNINDEXED,
                title,
                body
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
                node_id TEXT partition key,
                chunk_index INTEGER,
                embedding float[384] distance_metric=cosine
            );
            CREATE TABLE IF NOT EXISTS embedding_model_info (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                model_id TEXT NOT NULL,
                dimension INTEGER NOT NULL,
                model_hash TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS embed_backfill_queue (
                node_id TEXT PRIMARY KEY,
                chunk_index INTEGER NOT NULL DEFAULT 0,
                state TEXT NOT NULL
                    CHECK (state IN ('pending', 'in_progress', 'error')),
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                enqueued_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ebq_state
                ON embed_backfill_queue(state, enqueued_at);
        "#,
        ),
    ])
    .to_latest(conn)?;
    Ok(())
}

fn default_seed_db_path() -> PathBuf {
    let appdata = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    appdata.join("com.pais.infield.seed").join("workspace.db")
}

fn synthetic_body(i: usize, theme: usize) -> String {
    // Real-looking text varies by theme so FTS + semantic results can be
    // compared meaningfully. Keep it short but not trivial — ~150-300 chars
    // per node is a reasonable "short note" size.
    let theme_fragments = [
        "quarterly revenue projections logistics supply chain",
        "neural network training gradient descent optimization",
        "recipe sourdough hydration autolyse bulk fermentation",
        "climbing route grade crux beta gear rack",
        "guitar chord voicing inversion fingerstyle tablature",
        "garden soil amendment nitrogen compost mulch irrigation",
        "car maintenance oil filter brake pads alignment",
        "photography aperture iso shutter speed composition bokeh",
        "woodworking joinery dovetail mortise tenon hand planes",
        "coffee extraction grind size water temperature brew ratio",
    ];
    let fragment = theme_fragments[theme % theme_fragments.len()];
    format!(
        "Document {i} in theme {theme}. {fragment}. Additional \
         context paragraph with keyword density spread across \
         the body. Notes from {i} informed by the theme topic."
    )
}

/// Generate a 384d vector clustered around a per-theme axis plus noise.
/// Produces unit-normalised vectors so cosine distance on them matches
/// what bge-small produces at inference time.
fn synthesize_embedding(theme: usize, themes: usize, rng: &mut StdRng) -> Vec<f32> {
    let mut v = vec![0.0_f32; EMBEDDING_DIM];

    // Each theme claims a contiguous band of dimensions as its "signal"
    // region; noise lives in all other dimensions.
    let band_width = EMBEDDING_DIM / themes.max(1);
    let band_start = (theme * band_width).min(EMBEDDING_DIM - band_width);

    for d in 0..EMBEDDING_DIM {
        let in_band = d >= band_start && d < band_start + band_width;
        let signal = if in_band { 1.0 } else { 0.0 };
        let noise: f32 = rng.gen_range(-0.1_f32..0.1);
        v[d] = signal + noise;
    }

    // L2-normalise so dot product == cosine similarity.
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
    v
}
