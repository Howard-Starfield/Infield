use anyhow::{anyhow, Context, Result};
use log::warn;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use tauri::AppHandle;
use tokio::runtime::Builder as RuntimeBuilder;
use tokio::sync::{mpsc, oneshot};

use crate::embedding_sidecar_protocol::{
    EmbeddingSidecarRequest, EmbeddingSidecarResponse, SidecarModeDto,
};
use crate::settings::get_settings;

const DEFAULT_INFERENCE_MAX_TOKENS: u32 = 256;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Type, PartialEq, Eq)]
pub enum LlmPriority {
    High,
    Low,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct LlmStatus {
    pub available: bool,
    pub model_path: Option<String>,
    pub disabled_reason: Option<String>,
}

enum LlmState {
    Ready {
        high_tx: mpsc::Sender<LlmRequest>,
        low_tx: mpsc::Sender<LlmRequest>,
    },
    Disabled(String),
}

enum LlmRequest {
    Infer {
        prompt: String,
        max_tokens: u32,
        response: oneshot::Sender<std::result::Result<String, String>>,
    },
}

pub struct LlmManager {
    inner: Mutex<LlmRuntime>,
}

struct LlmRuntime {
    state: LlmState,
    model_path: Option<PathBuf>,
}

struct SidecarProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_request_id: u64,
}

impl LlmManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        let (state, model_path) = Self::build_runtime(app_handle)?;
        Ok(Self {
            inner: Mutex::new(LlmRuntime { state, model_path }),
        })
    }

    fn build_runtime(app_handle: &AppHandle) -> Result<(LlmState, Option<PathBuf>)> {
        let settings = get_settings(app_handle);
        let Some(model_path_raw) = settings
            .llm_model_path
            .clone()
            .filter(|path| !path.trim().is_empty())
        else {
            return Ok(Self::disabled_state(
                None,
                "Local LLM model path is not configured yet.".to_string(),
            ));
        };

        let model_path = PathBuf::from(&model_path_raw);
        if !model_path.exists() {
            return Ok(Self::disabled_state(
                Some(model_path.clone()),
                format!(
                    "Configured LLM model path does not exist: {}",
                    model_path.display()
                ),
            ));
        }

        let sidecar_path = match resolve_sidecar_path() {
            Ok(path) => path,
            Err(error) => {
                return Ok(Self::disabled_state(
                    Some(model_path.clone()),
                    format!("LLM sidecar is unavailable: {error}"),
                ));
            }
        };

        let (high_tx, high_rx) = mpsc::channel(8);
        let (low_tx, low_rx) = mpsc::channel(32);
        let (startup_tx, startup_rx) = std::sync::mpsc::channel();
        let gpu_enabled = settings.llm_gpu_enabled;
        let model_path_for_thread = model_path.clone();

        thread::Builder::new()
            .name("handy-llm-sidecar".to_string())
            .spawn(move || {
                let startup_result =
                    SidecarProcess::spawn(&sidecar_path, &model_path_for_thread, gpu_enabled)
                        .map_err(|error| error.to_string());
                let startup_status = match &startup_result {
                    Ok(_) => Ok(()),
                    Err(error) => Err(error.clone()),
                };
                let _ = startup_tx.send(startup_status);

                let mut process = match startup_result {
                    Ok(process) => process,
                    Err(_) => return,
                };

                let runtime = match RuntimeBuilder::new_current_thread().enable_all().build() {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        log::warn!("Failed to build LLM worker runtime: {error}");
                        return;
                    }
                };

                runtime.block_on(async move {
                    Self::run_llm_loop(&mut process, high_rx, low_rx).await;
                });
            })
            .context("Failed to spawn LLM sidecar manager thread")?;

        match startup_rx.recv() {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                return Ok(Self::disabled_state(
                    Some(model_path),
                    format!("LLM sidecar failed to initialize: {error}"),
                ));
            }
            Err(_) => {
                return Ok(Self::disabled_state(
                    Some(model_path),
                    "LLM sidecar thread exited before initialization".to_string(),
                ));
            }
        }

        Ok((LlmState::Ready { high_tx, low_tx }, Some(model_path)))
    }

    fn disabled_state(model_path: Option<PathBuf>, reason: String) -> (LlmState, Option<PathBuf>) {
        warn!("{reason}");
        (LlmState::Disabled(reason), model_path)
    }

    pub fn reload_from_settings(&self, app_handle: &AppHandle) -> Result<()> {
        let (state, model_path) = Self::build_runtime(app_handle)?;
        let mut inner = self.inner.lock().unwrap();
        inner.state = state;
        inner.model_path = model_path;
        Ok(())
    }

    pub fn is_available(&self) -> bool {
        let inner = self.inner.lock().unwrap();
        matches!(inner.state, LlmState::Ready { .. })
    }

    pub fn status(&self) -> LlmStatus {
        let inner = self.inner.lock().unwrap();
        match &inner.state {
            LlmState::Ready { .. } => LlmStatus {
                available: true,
                model_path: inner
                    .model_path
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string()),
                disabled_reason: None,
            },
            LlmState::Disabled(reason) => LlmStatus {
                available: false,
                model_path: inner
                    .model_path
                    .as_ref()
                    .map(|path| path.to_string_lossy().to_string()),
                disabled_reason: Some(reason.clone()),
            },
        }
    }

    pub async fn infer(
        &self,
        prompt: String,
        priority: LlmPriority,
        max_tokens: Option<u32>,
    ) -> Result<String> {
        let state_snapshot = {
            let inner = self.inner.lock().unwrap();
            match &inner.state {
                LlmState::Ready { high_tx, low_tx } => Ok((high_tx.clone(), low_tx.clone())),
                LlmState::Disabled(reason) => Err(anyhow!(reason.clone())),
            }
        }?;

        let (high_tx, low_tx) = state_snapshot;
        let (response_tx, response_rx) = oneshot::channel();
        let request = LlmRequest::Infer {
            prompt,
            max_tokens: max_tokens.unwrap_or(DEFAULT_INFERENCE_MAX_TOKENS),
            response: response_tx,
        };

        let tx = match priority {
            LlmPriority::High => high_tx,
            LlmPriority::Low => low_tx,
        };

        tx.send(request)
            .await
            .map_err(|_| anyhow!("LLM sidecar is no longer running"))?;

        response_rx
            .await
            .map_err(|_| anyhow!("LLM sidecar dropped the response"))?
            .map_err(|error| anyhow!(error))
    }

    async fn run_llm_loop(
        process: &mut SidecarProcess,
        mut high_rx: mpsc::Receiver<LlmRequest>,
        mut low_rx: mpsc::Receiver<LlmRequest>,
    ) {
        loop {
            tokio::select! {
                biased;
                Some(request) = high_rx.recv() => {
                    Self::handle_request(process, request);
                }
                Some(request) = low_rx.recv() => {
                    Self::handle_request(process, request);
                }
                else => break,
            }
        }
    }

    fn handle_request(process: &mut SidecarProcess, request: LlmRequest) {
        match request {
            LlmRequest::Infer {
                prompt,
                max_tokens,
                response,
            } => {
                let result = process
                    .infer(prompt, max_tokens)
                    .map_err(|error| error.to_string());
                let _ = response.send(result);
            }
        }
    }
}

impl SidecarProcess {
    fn spawn(sidecar_path: &Path, model_path: &Path, gpu_enabled: bool) -> Result<Self> {
        let mut child = Command::new(sidecar_path)
            .arg("--mode")
            .arg("inference")
            .arg("--gpu")
            .arg(if gpu_enabled { "true" } else { "false" })
            .arg("--model-path")
            .arg(model_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| {
                format!("Failed to spawn LLM sidecar at {}", sidecar_path.display())
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("LLM sidecar stdin was not available"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("LLM sidecar stdout was not available"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow!("LLM sidecar stderr was not available"))?;

        spawn_stderr_logger(stderr);

        let mut process = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_request_id: 1,
        };

        match process.read_response()? {
            EmbeddingSidecarResponse::Ready { mode, .. } => {
                if mode != SidecarModeDto::Inference {
                    return Err(anyhow!(
                        "LLM sidecar started in unexpected mode: {:?}",
                        mode
                    ));
                }
            }
            EmbeddingSidecarResponse::Error { message, .. } => {
                return Err(anyhow!("LLM sidecar failed to initialize: {message}"));
            }
            other => {
                return Err(anyhow!(
                    "LLM sidecar returned an unexpected startup response: {other:?}"
                ));
            }
        }

        Ok(process)
    }

    fn infer(&mut self, prompt: String, max_tokens: u32) -> Result<String> {
        let request_id = self.next_request_id;
        self.next_request_id = self.next_request_id.saturating_add(1);

        self.write_request(&EmbeddingSidecarRequest::Infer {
            request_id,
            prompt,
            max_tokens,
        })?;

        match self.read_response()? {
            EmbeddingSidecarResponse::InferResult {
                request_id: response_id,
                text,
            } => {
                if response_id != request_id {
                    return Err(anyhow!(
                        "LLM sidecar response ID mismatch: expected {}, got {}",
                        request_id,
                        response_id
                    ));
                }
                Ok(text)
            }
            EmbeddingSidecarResponse::Error {
                request_id: Some(response_id),
                message,
            } if response_id == request_id => Err(anyhow!(message)),
            EmbeddingSidecarResponse::Error { message, .. } => Err(anyhow!(message)),
            other => Err(anyhow!(
                "LLM sidecar returned an unexpected response: {other:?}"
            )),
        }
    }

    fn write_request(&mut self, request: &EmbeddingSidecarRequest) -> Result<()> {
        serde_json::to_writer(&mut self.stdin, request)?;
        self.stdin.write_all(b"\n")?;
        self.stdin.flush()?;
        Ok(())
    }

    fn read_response(&mut self) -> Result<EmbeddingSidecarResponse> {
        let mut line = String::new();
        if self.stdout.read_line(&mut line)? == 0 {
            if let Some(status) = self.child.try_wait()? {
                return Err(anyhow!("LLM sidecar exited unexpectedly: {status}"));
            }

            return Err(anyhow!("LLM sidecar closed stdout unexpectedly"));
        }

        serde_json::from_str(line.trim()).context("Failed to decode LLM sidecar response")
    }
}

impl Drop for SidecarProcess {
    fn drop(&mut self) {
        let _ = self.stdin.flush();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn spawn_stderr_logger(stderr: ChildStderr) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut buffer = String::new();

        loop {
            buffer.clear();
            match reader.read_line(&mut buffer) {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = buffer.trim();
                    if !trimmed.is_empty() {
                        log::warn!("llm sidecar: {trimmed}");
                    }
                }
                Err(error) => {
                    log::warn!("Failed to read LLM sidecar stderr: {error}");
                    break;
                }
            }
        }
    });
}

fn resolve_sidecar_path() -> Result<PathBuf> {
    let current_exe =
        std::env::current_exe().context("Failed to resolve current Handy executable path")?;
    let executable_dir = current_exe
        .parent()
        .ok_or_else(|| anyhow!("Current executable has no parent directory"))?;

    for candidate in sidecar_candidates() {
        let path = executable_dir.join(candidate);
        if path.exists() {
            return Ok(path);
        }
    }

    Err(anyhow!(
        "Unable to locate the shared llama sidecar next to {}",
        current_exe.display()
    ))
}

fn sidecar_candidates() -> Vec<OsString> {
    let mut candidates = Vec::new();
    let base_name = if cfg!(windows) {
        "handy-embedding-sidecar.exe"
    } else {
        "handy-embedding-sidecar"
    };

    candidates.push(OsString::from(base_name));

    let target_suffixed = if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("handy-embedding-sidecar-x86_64-pc-windows-msvc.exe")
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        Some("handy-embedding-sidecar-aarch64-pc-windows-msvc.exe")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("handy-embedding-sidecar-aarch64-apple-darwin")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("handy-embedding-sidecar-x86_64-apple-darwin")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("handy-embedding-sidecar-x86_64-unknown-linux-gnu")
    } else {
        None
    };

    if let Some(name) = target_suffixed {
        candidates.push(OsString::from(name));
    }

    candidates
}

pub fn render_prompt_template(template: &str, content: &str) -> String {
    template.replace("{{content}}", content)
}
