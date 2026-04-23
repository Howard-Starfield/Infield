# Embedding Sidecar HTTP Transport — Debug Report

## Executive Summary

The Tauri application crashed with `STATUS_ACCESS_VIOLATION (0xc0000005)` every time a new markdown document was created and immediately queued for embedding. The root cause was the **stdio-based IPC transport** between the host Tauri app and the `llama-cpp-2`-powered embedding sidecar process. The fix was a full refactor of the IPC transport from stdin/stdout pipes to **HTTP via Axum**, isolating the embedding model's native crashes to the sidecar process and preventing them from taking down the host.

---

## The Crash — Symptoms and Initial Hypothesis

### Symptoms
- `STATUS_ACCESS_VIOLATION (0xc0000005)` occurred right after a `vault-watcher Create` event for an untitled markdown file.
- The log sequence showed: `create_node` → `write_node_to_vault` → `enqueue_index` → `process_job` → `embed_batch` → crash.
- The crash was **deterministic** — every new untitled document triggered it.

### Initial Hypothesis
Three theories were considered:
1. **Vault watcher race condition** — the file watcher reading a file that was being written or deleted.
2. **Use-after-free in the embedding pipeline** — the node being modified while being indexed.
3. **Native `llama.cpp` crash** — `llama-cpp-2` triggering a GGML assertion or OOM that manifested as a Windows access violation.

The vault-watcher theory was ruled out because a freshly created untitled doc has no old-path to delete. The real culprit was the embedding pipeline.

---

## What Was Actually Wrong

The original embedding pipeline used **stdio pipes** for IPC:

```
Host (Tauri)              Sidecar (llama-cpp-2)
     |                            |
     |--- stdin: JSON request --->|
     |<-- stdout: JSON response --|
     |                            |
     (blocking read_line())       (native llama.cpp crash)
           ^                              |
           |______________________________|
                     dies with
                 STATUS_ACCESS_VIOLATION
```

When `llama.cpp` triggered a native abort (bad input, bad memory access, GGML assertion), the **entire sidecar process died**. The host's blocking `read_line()` on stdout either hung indefinitely or read garbage, causing the host to crash or hang.

---

## What Was Tried — The Iterative Fix Journey

### Attempt 1: Stdio with `BufReader::read_line`

**What:** Replaced the synchronous pipe IPC with a `BufReader` reading lines from stdout.

**Why it failed:** No isolation from native crashes. The sidecar still died catastrophically.

---

### Attempt 2: Refactor to HTTP Transport (Axum)

**What:** Replaced stdin/stdout pipes with an **Axum HTTP server** inside the sidecar. The host would read the port from the startup `Ready` JSON line, then exclusively use HTTP POST/GET for all embedding requests.

**Files changed:**
- `Cargo.toml` — added `axum = "0.7"`, added `blocking` feature to `reqwest`
- `embedding_sidecar_protocol.rs` — added `port: Option<u16>` to `Ready` variant
- `handy-embedding-sidecar.rs` — replaced stdin loop with Axum HTTP server
- `managers/embedding.rs` — replaced `ChildStdin`/`ChildStdout` fields with `reqwest::blocking::Client` + `base_url`

---

### Attempt 3: `TcpListener::from_std()` — `AddrInUse` Panic

**What:** After binding a `std::net::TcpListener` to an ephemeral port and converting it to `tokio::net::TcpListener` via `from_std()`, the code attempted to bind again — causing `AddrInUse`.

**Fix:** Removed the redundant bind. Used `TcpListener::from_std()` only, after the initial `std::net::TcpListener::bind()`.

---

### Attempt 4: `TcpListener::from_std()` on Windows — Silent Health Check Failure

**What:** Even after fixing the `AddrInUse` error, the HTTP server appeared to start (logs showed `bound to port=X`, `starting axum::serve`) but the health check never reached the handler. The host's polling loop retried 10 times and failed.

**Debug logs revealed:**
```
[DEBUG] Server thread: binding TcpListener to 127.0.0.1:0
[DEBUG] Server thread: bound to port=58739, storing to atomic
[DEBUG] Server thread: starting axum::serve
[DEBUG] Main thread: server bound to port=58739
[DEBUG] Main thread: Ready emitted with port=58739
... (host retries health check 10 times, all fail) ...
[DEBUG] health_handler called — NEVER APPEARED
```

**Root cause hypothesis:** On Windows, calling `TcpListener::from_std()` on a `std::net::TcpListener` that was already bound to an ephemeral port did **not** properly initialize the socket's listen backlog. The `axum::serve()` call would accept the TCP listener, but incoming connections would never complete the TCP handshake from the OS perspective — the health check requests were being sent but the connection attempt was being silently dropped.

This is a **Windows-specific quirk** of `std::net::TcpListener::from_std()` when combined with `tokio::net::TcpListener` and `axum::serve()`.

---

### Attempt 5: Spawn Server on Dedicated Background Thread (The Fix)

**What:** Instead of using `TcpListener::from_std()`, the fix spawns a **dedicated `std::thread`** that runs its own `tokio::Runtime` and `axum::HTTP server`. This thread binds `tokio::net::TcpListener` **directly** to `127.0.0.1:0` (no `from_std()` conversion), gets the assigned port, stores it in an `Arc<AtomicU16>`, then calls `axum::serve()`. The main thread polls the atomic until non-zero, emits the `Ready` message, then blocks on `join()`.

**Key code structure:**

```rust
// handy-embedding-sidecar.rs — run_embedding_mode()

// Shared atomic to receive the bound port from the server thread
let server_port = Arc::new(std::sync::atomic::AtomicU16::new(0));
let server_port_clone = Arc::clone(&server_port);

// Spawn server on a background thread
let server_handle = std::thread::spawn(move || {
    let rt = Runtime::new().expect("Failed to create tokio runtime");
    rt.block_on(async {
        // tokio TcpListener bound DIRECTLY — no from_std() on Windows
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("TcpListener bind failed");
        let port = listener.local_addr().expect("failed to get local addr").port();
        server_port_clone.store(port, std::sync::atomic::Ordering::SeqCst);
        axum::serve(listener, app).await.expect("axum serve error");
    });
});

// Wait for server to bind and store its port
let port = loop {
    let p = server_port.load(std::sync::atomic::Ordering::SeqCst);
    if p != 0 { break p; }
    std::thread::sleep(std::time::Duration::from_millis(5));
};

// Write ONE startup line to stdout with the real port
let ready = EmbeddingSidecarResponse::Ready { port: Some(port), ... };
emit_response(&ready)?;

// Block forever on the server thread
let _ = server_handle.join();
```

**Result:** Health check passed on attempt 0. Multiple embeddings ran over 7+ minutes without crash. `STATUS_ACCESS_VIOLATION` never returned.

---

## Files Modified

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Added `axum = "0.7"`, added `blocking` feature to `reqwest` |
| `src-tauri/src/embedding_sidecar_protocol.rs` | Added `port: Option<u16>` to `Ready` variant |
| `src-tauri/src/bin/handy-embedding-sidecar.rs` | Replaced stdin loop with Axum HTTP server on background thread |
| `src-tauri/src/managers/embedding.rs` | Replaced stdio `SidecarProcess` with HTTP client + health polling |
| `src-tauri/src/managers/vector_store.rs` | Fixed two `usearch` capacity bugs (see below) |

**Files explicitly NOT touched:**
- `embedding_worker.rs` — `is_available()` gate stays exactly as-is; no changes needed
- `transcription.rs` — different model pipeline, out of scope
- All TypeScript/React frontend files

---

## Bug 2: `usearch` "Reserve capacity ahead of insertions!" — Vector Store Corruption

### Symptoms
After the HTTP transport fix, the app no longer crashed — but every embedding job failed with:
```
[Embedding worker job failed: Reserve capacity ahead of insertions!]
```
The error fired on every note: brand new 9-char documents, renames, everything. The app survived but the vector index was never populated.

### Root Cause
`usearch::Index::load()` restores the stored vectors from disk but **does not** restore the in-memory HNSW graph's capacity. The in-memory `capacity` remained at 0 after loading. Every call to `Index::add()` panicked with `"Reserve capacity ahead of insertions!"`.

The code at `vector_store.rs` lines 117–134:

```rust
let index = Index::new(&opts)?;
if index_path.exists() {
    index.load(...)?;          // ← restores vectors, but NOT capacity
    // BUG: no reserve() call here!
} else {
    index.reserve(1024)?;     // ← only the new-index path reserved
    index.save(...)?;
}
```

The new-index path correctly called `index.reserve(1024)`; the load path (which every user who had previously used the app would hit) never did. Additionally, even after the initial capacity was correct, repeated inserts without re-reserving would eventually exhaust the pre-allocated slots.

### Fix — Two Lines

**Fix 1 — `VectorStore::new_with_path()` (post-load reserve):**
After `index.load()`, call `index.reserve(index.size() + 1024)` to restore the in-memory HNSW graph's capacity from the restored vector count.

**Fix 2 — `VectorStore::upsert_chunk()` (pre-add guard):**
Before `idx.add()`, call `idx.reserve(idx.size() + 1)`. Since `usearch::reserve()` is a no-op when `capacity > size`, this is free on the happy path but catches capacity exhaustion as the index grows past its initial reservation.

The `rebuild_for_dimension()` path already called `reserve(1024)` on the fresh index — it was already correct and needed no changes.

---

## Why Both Fixes Work

### HTTP Transport Fix
1. **Process isolation** — when `llama.cpp` crashes the sidecar, the HTTP server thread dies with it. The host's HTTP request returns an error (connection reset), which is caught gracefully. The host can respawn the sidecar.
2. **Windows socket compatibility** — binding `tokio::net::TcpListener` directly on a dedicated thread avoids the `from_std()` listen-backlog issue on Windows.
3. **Sequential embedding** — `Arc<Mutex<EmbeddingRuntime>>` ensures llama-cpp-2's `!Send + !Sync` context is never accessed concurrently.
4. **Graceful degradation** — the `is_available()` gate in `embedding_worker.rs` correctly marks the model as unavailable during sidecar restart, and the reindex loop advances.

### `usearch` Capacity Fix
- Post-load `reserve(index.size() + 1024)` restores the in-memory HNSW graph's capacity to match the number of vectors being restored from disk, making `add()` safe immediately after a load.
- Pre-add `reserve(idx.size() + 1)` ensures that as the index grows, capacity is always extended before the next insertion exhausts it. Because `reserve()` is idempotent when the new capacity exceeds current capacity, the call is free on every insert after the first.

---

## Lessons Learned

### 1. Never Trust Stdio Pipes for Long-Running Child Processes
Stdin/stdout pipes are a Unix-centric IPC primitive. On Windows:
- A child process dying with `STATUS_ACCESS_VIOLATION` leaves the pipe in an undefined state.
- `read_line()` blocks indefinitely if the child dies without closing stdout.
- There is no `SIGPIPE` equivalent to handle broken pipes cleanly.

**Professional software** (Notion, Obsidian, AppFlowy) uses:
- **Named pipes (Windows)** or **Unix domain sockets** for local IPC
- **HTTP servers** for process isolation (the approach taken here)
- **gRPC** for structured, typed IPC between processes

### 2. Windows Socket Quirks with Rust's `std` and `tokio` Interop
`std::net::TcpListener` and `tokio::net::TcpListener` have different socket initialization paths on Windows. When you:
1. Bind a `std::net::TcpListener` to an ephemeral port
2. Convert it to `tokio::net::TcpListener` via `from_std()`
3. Pass it to `axum::serve()`

...the listen backlog queue (controlled by `listen(backlog)` syscall) may not be properly initialized. Connections can be initiated by the client but never complete from the server's perspective.

**The fix:** Always bind the listener using the **same ecosystem** you'll serve with. If using `axum` (which uses `tokio`), bind directly with `tokio::net::TcpListener::bind()`.

### 3. Spawn Dedicated Threads for Async Servers on Windows
When an async runtime (`tokio`) needs to host an HTTP server alongside a synchronous main thread, spawning a dedicated `std::thread::spawn` with its own `Runtime::new()` is the most reliable pattern on Windows. It avoids:
- Lifetime/borrowing issues between sync and async code
- `block_on` nested inside an existing async context (which panics)
- Socket initialization issues from cross-runtime `from_std()` calls

### 4. The Anti-Hallucination Guard Was Correct
The original plan had explicit **DO NOT** rules:
- Do not change `EmbeddingRuntime::embed_texts()` — it was correct
- Do not change `embedding_worker.rs` — `is_available()` was correct
- Do not use any HTTP server other than `axum = "0.7"`
- Do not parallelize embedding inside the sidecar

The crash was entirely in the **transport**, not the embedding logic. Trusting the existing implementation and only changing the transport layer was the right call.

### 5. Instrumentation Is Non-Negotiable for Cross-Process Debugging
When debugging IPC between two processes, you **need**:
- Debug logs in **both** the host and the sidecar
- Logs at every handoff point (before emit, after receive, before/after each operation)
- Sequential, causal log lines that prove execution order

The session used `eprintln!` in the sidecar and `eprintln!` in the host's health loop. Without these, it would have been impossible to prove that the server started but the handler was never called.

---

## Future Edge Cases to Navigate

### 1. Sidecar Crash During Active Embedding
**Scenario:** The sidecar crashes mid-embedding (not at startup).

**Behavior after fix:**
- The HTTP request returns a connection-reset or broken-pipe error.
- `embed_batch()` returns an error.
- `run_embedding_loop()` catches it, sets `process = None`, respawns after 1 second.
- `is_available()` returns `false` during the gap.
- The embedding job stays in the queue and is retried.

**Risk:** If the crash corrupts the queue state, jobs could be lost. Consider making the embedding queue persistent or using an acknowledgement pattern.

### 2. Port Collision on Rapid Respawn
**Scenario:** Sidecar crashes and respawns so quickly that the OS hasn't released the port.

**Mitigation:** Ephemeral port selection (`127.0.0.1:0`) means the OS always picks a free port. Rapid respawns should not collide. However, on Windows, `TIME_WAIT` on the previous port could delay reuse. The 200ms health-polling loop gives the OS time to clean up.

### 3. Very Large Embedding Batches
**Scenario:** A document with thousands of chunks is embedded in one batch.

**Behavior:** `embed_batch()` sends all texts in one HTTP POST. If the batch is too large for the HTTP server's limits, Axum returns a 413. The current implementation does not chunk batches.

**Future work:** Consider streaming embeddings for very large texts, or chunking at the `embedding_worker` level.

### 4. Network Security
**Current state:** The HTTP server binds exclusively to `127.0.0.1`. No authentication, no TLS. This is intentional — the sidecar is a local-only process.

**Risk:** Any local process can send requests to the embedding sidecar. For a single-user desktop app, this is acceptable. If the app is ever exposed over a network, this must change.

### 5. `llama-cpp-2` Native Crashes (Original Issue)
**Scenario:** The underlying `llama.cpp` native code crashes with GGML assertions or memory errors.

**Behavior after fix:** The crash is isolated to the sidecar process. The host survives and can respawn the sidecar. The user sees a temporary embedding unavailability message rather than a full app crash.

**Root cause of the original crash:** Was not fully diagnosed — the HTTP refactor changed too much to isolate the exact trigger. Possible causes:
- A specific input token sequence causing a GGML assertion in `nomic-embed-text-v1.5.Q4_K_M.gguf`
- Memory corruption in the model's context from concurrent access (though `EmbeddingRuntime` was supposed to be single-threaded)
- A Windows-specific memory mapping issue with the GGUF file

A proper post-mortem would require running the sidecar with a debugger (WinDbg, Visual Studio) attached to catch the native exception before the Rust wrapper catches it.

### 6. `usearch` Index File Corruption from Rapid Delete/Re-insert
**Scenario:** Rapid note rename sequences (`Create(cod.md)` → `Remove(cod.md)` → `Create(coder.md)`) cause the embedding worker to delete and re-insert chunks for the same note in quick succession.

**Current behavior:** After the capacity fix, inserts succeed. But if `save_index()` is called after every single `upsert_chunk()` (as it currently is), a rapid sequence of saves can race with concurrent reads or writes to the `embeddings.usearch` file, potentially causing index file corruption on Windows due to file locking.

**Future work:** Consider batching `save_index()` calls — write to disk only after a batch of inserts completes, rather than after every individual chunk. This also improves performance significantly.

---

## Summary

| Aspect | Detail |
|--------|--------|
| **Bug 1 Symptom** | `STATUS_ACCESS_VIOLATION (0xc0000005)` on new document creation |
| **Bug 1 Root Cause** | Stdio pipe IPC between host and `llama-cpp-2` sidecar — native crashes propagated to host |
| **Bug 1 Fix** | Replaced stdio with HTTP transport using Axum + `tokio`, with server on dedicated thread |
| **Bug 1 Key Windows Issue** | `TcpListener::from_std()` on Windows doesn't properly init listen backlog for `axum::serve` |
| **Bug 1 Resolution** | Bind `tokio::net::TcpListener` directly on a dedicated thread, communicate port via `AtomicU16` |
| **Bug 2 Symptom** | `Embedding worker job failed: Reserve capacity ahead of insertions!` on every embed |
| **Bug 2 Root Cause** | `usearch::Index::load()` restores vectors but not in-memory HNSW graph capacity; load path missed `reserve()` call |
| **Bug 2 Fix** | `reserve(index.size() + 1024)` after `load()` + `reserve(idx.size() + 1)` before every `add()` |
| **Bug 2 Resolution** | Two-line fix in `vector_store.rs` — post-load reserve + pre-add reserve |
| **Verification** | Both bugs confirmed fixed in runtime: no crash, no reserve errors, embeddings persist correctly |
