//! TODO(Phase G): Legacy local-LLM inference sidecar protocol. Phase G
//! rewrites `LlmManager` on Gemini/Vertex and deletes this file + its bin
//! entry (`bin/handy-embedding-sidecar.rs` — kept under its old name to
//! avoid a cross-file rename rabbit-hole for a soon-to-be-deleted path).
//!
//! Phase A reduced the sidecar to LLM inference only. The embedding path
//! moved in-process to `managers/embedding_ort.rs` (bge-small via the `ort`
//! crate). The file name stays `embedding_sidecar_protocol` historically;
//! it no longer carries any embedding types.

use serde::{Deserialize, Serialize};

/// Single-variant enum kept for compatibility with `LlmManager`'s Ready
/// handshake check (`if mode != SidecarModeDto::Inference`). Collapsed
/// from the previous `Embedding | Inference` split in Phase A. Phase G
/// deletes this type entirely when the sidecar goes away.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SidecarModeDto {
    Inference,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EmbeddingSidecarRequest {
    Infer {
        request_id: u64,
        prompt: String,
        max_tokens: u32,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EmbeddingSidecarResponse {
    Ready {
        mode: SidecarModeDto,
        model_id: String,
    },
    InferResult {
        request_id: u64,
        text: String,
    },
    Error {
        request_id: Option<u64>,
        message: String,
    },
}
