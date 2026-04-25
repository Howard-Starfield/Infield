//! Lazy downloader for the bge-reranker-v2-m3 ONNX bundle.
//!
//! Downloads to <app_data>/handy/models/bge-reranker-v2-m3/<filename>.tmp,
//! verifies sha256, atomic-renames to final filename. Emits
//! `reranker-download-progress` via Tauri so the frontend can render a
//! progress overlay.
//!
//! The bundle ships THREE files: model.onnx (568 MB), tokenizer.json
//! (~10 MB), config.json (~1 KB). All three must succeed for the worker
//! to use the model.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Result};
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};
use tokio::fs::OpenOptions;
use tokio::io::{AsyncSeekExt, AsyncWriteExt};
use tokio::sync::Mutex;

#[allow(unused_imports)]
use crate::managers::reranker_ort::MODEL_ID;

/// Files to fetch from the HF mirror, with their expected sha256.
/// Hashes pinned at plan-write time; update if BAAI republishes.
const FILES: &[(&str, &str, &str)] = &[
    // (filename, sha256, base_url-relative path)
    (
        "model.onnx",
        // TODO Task 6 implementer: pin the actual sha256 of bge-reranker-v2-m3
        // model.onnx by downloading once, computing locally, and pasting here.
        // Frontend should treat this as advisory-only on first ship.
        "PLACEHOLDER_REPLACE_WITH_ACTUAL_SHA256",
        "onnx/model.onnx",
    ),
    (
        "tokenizer.json",
        "PLACEHOLDER_REPLACE_WITH_ACTUAL_SHA256",
        "tokenizer.json",
    ),
    (
        "config.json",
        "PLACEHOLDER_REPLACE_WITH_ACTUAL_SHA256",
        "config.json",
    ),
];

const HF_BASE: &str = "https://huggingface.co/BAAI/bge-reranker-v2-m3/resolve/main";

#[derive(Serialize, Clone)]
struct DownloadProgress {
    file: String,
    bytes: u64,
    total: u64,
    status: String, // "downloading" | "verifying" | "done" | "error"
    overall_pct: f32,
}

pub struct RerankerDownload {
    app: AppHandle,
    target_dir: PathBuf,
    in_flight: Mutex<bool>,
}

impl RerankerDownload {
    pub fn new(app: AppHandle, target_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self {
            app,
            target_dir,
            in_flight: Mutex::new(false),
        })
    }

    /// Download all files. Returns Ok if every file present + verified.
    /// Concurrent-safe: second caller short-circuits if first is in flight.
    pub async fn download_all(self: Arc<Self>) -> Result<()> {
        let mut g = self.in_flight.lock().await;
        if *g {
            return Err(anyhow!("download_already_in_progress"));
        }
        *g = true;
        drop(g);

        let result = self.do_download().await;

        let mut g = self.in_flight.lock().await;
        *g = false;
        drop(g);

        result
    }

    async fn do_download(&self) -> Result<()> {
        tokio::fs::create_dir_all(&self.target_dir).await?;

        let total_files = FILES.len();
        for (i, (name, expected_hash, url_path)) in FILES.iter().enumerate() {
            let final_path = self.target_dir.join(name);
            let tmp_path = self.target_dir.join(format!("{name}.tmp"));

            // Skip if already present and verified.
            if final_path.exists() {
                if expected_hash != &"PLACEHOLDER_REPLACE_WITH_ACTUAL_SHA256" {
                    if sha256_of(&final_path).await? == *expected_hash {
                        emit(&self.app, name, 0, 0, "done", file_progress(i + 1, total_files));
                        continue;
                    }
                    // Hash mismatch → re-download
                    let _ = tokio::fs::remove_file(&final_path).await;
                } else {
                    // Placeholder hash: treat presence as success.
                    emit(&self.app, name, 0, 0, "done", file_progress(i + 1, total_files));
                    continue;
                }
            }

            let url = format!("{HF_BASE}/{url_path}");
            self.fetch(name, &url, &tmp_path, expected_hash, i, total_files).await?;
            tokio::fs::rename(&tmp_path, &final_path).await?;
        }

        Ok(())
    }

    async fn fetch(
        &self,
        name: &str,
        url: &str,
        tmp_path: &Path,
        expected_hash: &str,
        file_index: usize,
        total_files: usize,
    ) -> Result<()> {
        // Resume: if .tmp exists, check size and send Range header.
        let resume_from: u64 = match tokio::fs::metadata(tmp_path).await {
            Ok(m) => m.len(),
            Err(_) => 0,
        };

        let client = reqwest::Client::new();
        let mut req = client.get(url);
        if resume_from > 0 {
            req = req.header("Range", format!("bytes={resume_from}-"));
        }
        let resp = req.send().await?.error_for_status()?;
        let total = resp
            .content_length()
            .map(|l| l + resume_from)
            .unwrap_or(0);

        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .open(tmp_path)
            .await?;
        if resume_from > 0 {
            file.seek(std::io::SeekFrom::Start(resume_from)).await?;
        }

        let mut downloaded = resume_from;
        let mut stream = resp.bytes_stream();
        let mut last_emit = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;

            // Emit at most every 250ms to avoid event spam.
            if last_emit.elapsed() > std::time::Duration::from_millis(250) {
                emit(
                    &self.app,
                    name,
                    downloaded,
                    total,
                    "downloading",
                    overall_progress(file_index, total_files, downloaded, total),
                );
                last_emit = std::time::Instant::now();
            }
        }
        file.flush().await?;

        // Verify if a real hash was provided.
        if expected_hash != "PLACEHOLDER_REPLACE_WITH_ACTUAL_SHA256" {
            emit(&self.app, name, downloaded, total, "verifying", file_progress(file_index, total_files));
            let actual = sha256_of(tmp_path).await?;
            if actual != expected_hash {
                let _ = tokio::fs::remove_file(tmp_path).await;
                anyhow::bail!("sha256_mismatch for {name}: expected {expected_hash} got {actual}");
            }
        }

        emit(&self.app, name, downloaded, total, "done", file_progress(file_index + 1, total_files));
        Ok(())
    }
}

fn file_progress(complete: usize, total: usize) -> f32 {
    (complete as f32 / total as f32).min(1.0)
}

fn overall_progress(file_index: usize, total_files: usize, bytes: u64, total: u64) -> f32 {
    let per_file = 1.0 / total_files as f32;
    let so_far = file_index as f32 * per_file;
    let in_progress = if total > 0 {
        (bytes as f32 / total as f32) * per_file
    } else {
        0.0
    };
    (so_far + in_progress).min(1.0)
}

fn emit(app: &AppHandle, file: &str, bytes: u64, total: u64, status: &str, overall_pct: f32) {
    let _ = app.emit(
        "reranker-download-progress",
        DownloadProgress {
            file: file.to_string(),
            bytes,
            total,
            status: status.to_string(),
            overall_pct,
        },
    );
}

async fn sha256_of(path: &Path) -> Result<String> {
    let bytes = tokio::fs::read(path).await?;
    let mut h = Sha256::new();
    h.update(&bytes);
    Ok(format!("{:x}", h.finalize()))
}
