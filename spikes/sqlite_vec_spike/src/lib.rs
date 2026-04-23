//! Phase A spike — confirm `CREATE VIRTUAL TABLE ... USING vec0(...)` survives
//! `rusqlite_migration`'s wrapping transaction, and settle the final schema
//! for `vec_embeddings` before plumbing into the real migration vec.
//!
//! Standalone crate (no Tauri build chain). Run with:
//!   cd spikes/sqlite_vec_spike && cargo test -- --nocapture

#[cfg(test)]
mod tests {
    use std::sync::Once;

    use rusqlite::{ffi::sqlite3_auto_extension, Connection};
    use rusqlite_migration::{Migrations, M};
    use zerocopy::IntoBytes;

    static INIT: Once = Once::new();

    fn register_vec_extension_once() {
        INIT.call_once(|| unsafe {
            sqlite3_auto_extension(Some(std::mem::transmute(
                sqlite_vec::sqlite3_vec_init as *const (),
            )));
        });
    }

    /// Sanity check — auto-extension binds `vec_version()` on every new conn.
    #[test]
    fn vec_extension_registers() {
        register_vec_extension_once();
        let db = Connection::open_in_memory().expect("open mem");
        let version: String = db
            .query_row("SELECT vec_version()", [], |r| r.get(0))
            .expect("vec_version reachable");
        eprintln!("sqlite-vec version: {version}");
        assert!(!version.is_empty());
    }

    /// PLAN VERBATIM — PLAN.md Phase A specifies:
    ///
    ///   CREATE VIRTUAL TABLE vec_embeddings USING vec0(
    ///     node_id TEXT PRIMARY KEY,
    ///     chunk_index INTEGER,
    ///     embedding float[384]
    ///   );
    ///
    /// Exploratory — print the outcome, don't panic either way. The
    /// refined_schema test below is what we commit to.
    #[test]
    fn plan_verbatim_schema_via_migration() {
        register_vec_extension_once();
        let mut conn = Connection::open_in_memory().expect("open mem");

        let migrations = Migrations::new(vec![M::up(
            "CREATE VIRTUAL TABLE vec_embeddings USING vec0(
                node_id TEXT PRIMARY KEY,
                chunk_index INTEGER,
                embedding float[384]
             );",
        )]);

        match migrations.to_latest(&mut conn) {
            Ok(_) => eprintln!("[plan_verbatim] OK"),
            Err(e) => eprintln!("[plan_verbatim] FAILED -- {e}"),
        }
    }

    /// REFINED — `node_id` as `partition key` (not PK), implicit rowid is PK,
    /// `chunk_index` metadata column, cosine distance. End-to-end assert:
    /// migration applies, insert, KNN query.
    #[test]
    fn refined_schema_via_migration_and_knn_roundtrip() {
        register_vec_extension_once();
        let mut conn = Connection::open_in_memory().expect("open mem");

        let migrations = Migrations::new(vec![M::up(
            "CREATE VIRTUAL TABLE vec_embeddings USING vec0(
                node_id TEXT partition key,
                chunk_index INTEGER,
                embedding float[384] distance_metric=cosine
             );",
        )]);

        migrations
            .to_latest(&mut conn)
            .expect("refined schema migration applies inside rusqlite_migration tx");

        let v_a = mk_vec(0, 384);
        let v_b = mk_vec(1, 384);
        let v_c = mk_vec(2, 384);

        for (i, (node, chunk, vec)) in [
            ("node-A", 0_i64, &v_a),
            ("node-B", 0, &v_b),
            ("node-C", 0, &v_c),
        ]
        .iter()
        .enumerate()
        {
            conn.execute(
                "INSERT INTO vec_embeddings(rowid, node_id, chunk_index, embedding)
                 VALUES (?, ?, ?, ?)",
                rusqlite::params![
                    (i + 1) as i64,
                    node,
                    chunk,
                    vec.as_slice().as_bytes()
                ],
            )
            .expect("insert vector row");
        }

        let query_bytes: Vec<u8> = v_a.as_slice().as_bytes().to_vec();
        let mut stmt = conn
            .prepare(
                "SELECT node_id, chunk_index, distance
                 FROM vec_embeddings
                 WHERE embedding MATCH ?
                   AND k = 3
                 ORDER BY distance",
            )
            .expect("prepare knn");

        let rows: Vec<(String, i64, f64)> = stmt
            .query_map([query_bytes], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, f64>(2)?))
            })
            .expect("execute knn")
            .collect::<Result<_, _>>()
            .expect("collect knn");

        eprintln!("[refined] KNN rows: {rows:?}");
        assert_eq!(rows.len(), 3, "expect 3 results");
        assert_eq!(rows[0].0, "node-A", "nearest should be node-A");
        assert!(rows[0].2 < 1e-5, "identity distance ~0, got {}", rows[0].2);
    }

    /// Decisive test — the plan's verbatim schema has `node_id TEXT PRIMARY
    /// KEY`. The real app needs N chunks per node. Does vec0 enforce PK
    /// uniqueness on a TEXT column, i.e. does inserting the same node_id
    /// twice fail?
    ///
    /// If enforced → plan schema is broken for chunking, must use refined.
    /// If not enforced → plan schema tolerates duplicates but semantics are
    ///                   unclear (silent overwrite? allowed?).
    #[test]
    fn plan_verbatim_pk_uniqueness_with_multiple_chunks() {
        register_vec_extension_once();
        let mut conn = Connection::open_in_memory().expect("open mem");
        let migrations = Migrations::new(vec![M::up(
            "CREATE VIRTUAL TABLE vec_embeddings USING vec0(
                node_id TEXT PRIMARY KEY,
                chunk_index INTEGER,
                embedding float[384]
             );",
        )]);
        migrations.to_latest(&mut conn).expect("migrate");

        let v0 = mk_vec(0, 384);
        let v1 = mk_vec(1, 384);

        let first = conn.execute(
            "INSERT INTO vec_embeddings(node_id, chunk_index, embedding)
             VALUES (?, ?, ?)",
            rusqlite::params!["node-X", 0_i64, v0.as_slice().as_bytes()],
        );
        eprintln!("[plan_pk] first insert: {first:?}");

        let second = conn.execute(
            "INSERT INTO vec_embeddings(node_id, chunk_index, embedding)
             VALUES (?, ?, ?)",
            rusqlite::params!["node-X", 1_i64, v1.as_slice().as_bytes()],
        );
        eprintln!("[plan_pk] second insert (dup node_id, diff chunk): {second:?}");

        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM vec_embeddings WHERE node_id = 'node-X'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(-1);
        eprintln!("[plan_pk] rowcount for node-X after two inserts: {count}");
    }

    /// Batch-insert + read inside the same connection. Guards against vec0
    /// locking weirdness before we hit it in EmbeddingWorker.
    #[test]
    fn batch_insert_then_count() {
        register_vec_extension_once();
        let mut conn = Connection::open_in_memory().expect("open mem");
        let migrations = Migrations::new(vec![M::up(
            "CREATE VIRTUAL TABLE vec_embeddings USING vec0(
                node_id TEXT partition key,
                chunk_index INTEGER,
                embedding float[384] distance_metric=cosine
             );",
        )]);
        migrations.to_latest(&mut conn).expect("migrate");

        let tx = conn.transaction().expect("begin tx");
        for i in 0..100 {
            let v = mk_vec((i as usize) % 384, 384);
            tx.execute(
                "INSERT INTO vec_embeddings(rowid, node_id, chunk_index, embedding)
                 VALUES (?, ?, ?, ?)",
                rusqlite::params![
                    (i + 1) as i64,
                    format!("node-{i}"),
                    0_i64,
                    v.as_slice().as_bytes()
                ],
            )
            .expect("insert");
        }
        tx.commit().expect("commit");

        let n: i64 = conn
            .query_row("SELECT count(*) FROM vec_embeddings", [], |r| r.get(0))
            .expect("count");
        assert_eq!(n, 100);
    }

    fn mk_vec(hot_axis: usize, dim: usize) -> Vec<f32> {
        let mut v = vec![0.0_f32; dim];
        v[hot_axis % dim] = 1.0;
        v
    }
}
