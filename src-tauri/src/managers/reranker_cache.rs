//! In-memory LRU cache for rerank results (Stage 4 of search).
//!
//! Keyed by (query_hash, candidate_ids_hash) — repeated typing of the same
//! query against the same retrieval set hits the cache and skips inference.
//! Capacity 128 entries; ~30 KB total assuming ~10 results × 24 bytes each.
//! Cleared on Rule 19 mismatch (Task 4 outcome) or app restart.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::num::NonZeroUsize;
use std::sync::Mutex;

use lru::LruCache;

use crate::managers::reranker_ort::RerankResult;

const CAPACITY: usize = 128;

#[derive(Hash, PartialEq, Eq, Clone, Copy, Debug)]
pub struct RerankCacheKey {
    query_hash: u64,
    ids_hash: u64,
}

impl RerankCacheKey {
    pub fn new(query: &str, candidate_ids: &[&str]) -> Self {
        let mut q_hasher = DefaultHasher::new();
        query.hash(&mut q_hasher);
        let query_hash = q_hasher.finish();

        let mut i_hasher = DefaultHasher::new();
        for id in candidate_ids {
            id.hash(&mut i_hasher);
        }
        let ids_hash = i_hasher.finish();

        Self { query_hash, ids_hash }
    }
}

pub struct RerankerCache {
    inner: Mutex<LruCache<RerankCacheKey, Vec<RerankResult>>>,
}

impl Default for RerankerCache {
    fn default() -> Self {
        Self::new()
    }
}

impl RerankerCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(LruCache::new(NonZeroUsize::new(CAPACITY).unwrap())),
        }
    }

    pub fn get(&self, key: &RerankCacheKey) -> Option<Vec<RerankResult>> {
        let mut g = self.inner.lock().ok()?;
        g.get(key).cloned()
    }

    pub fn put(&self, key: RerankCacheKey, value: Vec<RerankResult>) {
        if let Ok(mut g) = self.inner.lock() {
            g.put(key, value);
        }
    }

    pub fn clear(&self) {
        if let Ok(mut g) = self.inner.lock() {
            g.clear();
        }
    }

    pub fn len(&self) -> usize {
        self.inner.lock().map(|g| g.len()).unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rr(node: &str, score: f32) -> RerankResult {
        RerankResult {
            node_id: node.to_string(),
            rerank_score: score,
            original_rank: 0,
        }
    }

    #[test]
    fn key_stable_for_same_query_and_ids() {
        let k1 = RerankCacheKey::new("react", &["a", "b", "c"]);
        let k2 = RerankCacheKey::new("react", &["a", "b", "c"]);
        assert_eq!(k1, k2);
    }

    #[test]
    fn key_differs_on_query() {
        let k1 = RerankCacheKey::new("react", &["a"]);
        let k2 = RerankCacheKey::new("vue", &["a"]);
        assert_ne!(k1, k2);
    }

    #[test]
    fn key_differs_on_ids_order() {
        // Order matters — two distinct candidate sets should yield distinct keys
        // even if they contain the same elements (different RRF ordering implies
        // different rerank context).
        let k1 = RerankCacheKey::new("react", &["a", "b"]);
        let k2 = RerankCacheKey::new("react", &["b", "a"]);
        assert_ne!(k1, k2);
    }

    #[test]
    fn put_and_get_roundtrip() {
        let cache = RerankerCache::new();
        let key = RerankCacheKey::new("q", &["a"]);
        cache.put(key, vec![rr("a", 0.9)]);
        let got = cache.get(&key).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].node_id, "a");
    }

    #[test]
    fn evicts_oldest_at_capacity() {
        let cache = RerankerCache::new();
        for i in 0..(CAPACITY + 1) {
            let id = format!("id-{i}");
            let key = RerankCacheKey::new("q", &[&id]);
            cache.put(key, vec![rr(&id, 0.5)]);
        }
        assert_eq!(cache.len(), CAPACITY);
        // First-inserted key should be evicted.
        let first_key = RerankCacheKey::new("q", &["id-0"]);
        assert!(cache.get(&first_key).is_none());
    }

    #[test]
    fn clear_empties() {
        let cache = RerankerCache::new();
        cache.put(RerankCacheKey::new("q", &["a"]), vec![rr("a", 0.5)]);
        cache.clear();
        assert_eq!(cache.len(), 0);
    }
}
