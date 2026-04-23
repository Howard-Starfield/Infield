// TODO(Phase G): Legacy local-LLM inference sidecar. Phase G rewrites
// `LlmManager` on Gemini/Vertex and deletes this file + `bin` entry along
// with the `embedding_sidecar_protocol` module. The binary name stays
// `handy-embedding-sidecar` historically — renaming would churn LlmManager
// spawn args + Cargo.toml + the process tree, which isn't worth it for a
// file that's shortly going away. The "embedding" in the name is a
// historical artifact; Phase A relocated embeddings to an in-process ORT
// path (`managers/embedding_ort.rs`).

#[path = "../embedding_sidecar_protocol.rs"]
mod embedding_sidecar_protocol;

use anyhow::{anyhow, Context, Result};
use embedding_sidecar_protocol::{
    EmbeddingSidecarRequest, EmbeddingSidecarResponse, SidecarModeDto,
};
use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel, Special};
use std::io::{self, BufRead, BufReader, Write};
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::thread;

const INFERENCE_CONTEXT_LENGTH: u32 = 8_192;
const GPU_LAYERS_ALL: u32 = 999;

struct SidecarCli {
    model_path: PathBuf,
    gpu_enabled: bool,
}

struct InferenceRuntime {
    _backend: LlamaBackend,
    model: LlamaModel,
    context_params: LlamaContextParams,
    chat_template: ChatTemplate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChatTemplate {
    None,
    ChatML,
    Llama3,
    Mistral,
    Phi3,
}

fn main() {
    if let Err(error) = run() {
        let _ = emit_response(&EmbeddingSidecarResponse::Error {
            request_id: None,
            message: error.to_string(),
        });
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = parse_cli()?;
    run_inference_mode(&cli.model_path, cli.gpu_enabled)
}

fn run_inference_mode(model_path: &Path, gpu_enabled: bool) -> Result<()> {
    let runtime = InferenceRuntime::load(model_path, gpu_enabled)?;
    let model_id = model_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("local-llm")
        .to_string();

    emit_response(&EmbeddingSidecarResponse::Ready {
        mode: SidecarModeDto::Inference,
        model_id,
    })?;

    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());
    let mut line = String::new();

    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let request: EmbeddingSidecarRequest =
            serde_json::from_str(trimmed).context("Failed to decode sidecar request")?;
        match request {
            EmbeddingSidecarRequest::Infer {
                request_id,
                prompt,
                max_tokens,
            } => match runtime.infer(&prompt, max_tokens) {
                Ok(text) => {
                    emit_response(&EmbeddingSidecarResponse::InferResult { request_id, text })?
                }
                Err(error) => emit_response(&EmbeddingSidecarResponse::Error {
                    request_id: Some(request_id),
                    message: error.to_string(),
                })?,
            },
        }
    }

    Ok(())
}

fn parse_cli() -> Result<SidecarCli> {
    // `--mode` argument kept for call-site compatibility but accepts only
    // "infer" / "inference" now — the embedding path was removed in Phase A.
    // `LlmManager`'s existing spawn code passes `--mode inference` already.
    let mut args = std::env::args().skip(1);
    let mut model_path = None;
    let mut gpu_enabled = false;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--mode" => {
                let raw_mode = args
                    .next()
                    .ok_or_else(|| anyhow!("Missing value after --mode"))?;
                match raw_mode.as_str() {
                    "infer" | "inference" => {}
                    other => {
                        return Err(anyhow!(
                            "Unsupported sidecar mode '{}'. Only 'inference' is supported \
                             (embedding path removed in Phase A — see embedding_ort.rs)",
                            other
                        ));
                    }
                }
            }
            "--model-path" => {
                let value = args
                    .next()
                    .ok_or_else(|| anyhow!("Missing value after --model-path"))?;
                model_path = Some(PathBuf::from(value));
            }
            "--gpu" => {
                let value = args
                    .next()
                    .ok_or_else(|| anyhow!("Missing value after --gpu"))?;
                gpu_enabled = matches!(value.as_str(), "1" | "true" | "on");
            }
            other => {
                return Err(anyhow!(
                    "Unexpected argument '{}'. Usage: handy-embedding-sidecar \
                     [--mode inference] [--gpu true|false] --model-path <path-to-gguf>",
                    other
                ));
            }
        }
    }

    let model_path = model_path.ok_or_else(|| {
        anyhow!(
            "Usage: handy-embedding-sidecar [--mode inference] [--gpu true|false] \
             --model-path <path-to-gguf>"
        )
    })?;

    Ok(SidecarCli {
        model_path,
        gpu_enabled,
    })
}

fn emit_response(response: &EmbeddingSidecarResponse) -> Result<()> {
    let stdout = io::stdout();
    let mut handle = stdout.lock();
    serde_json::to_writer(&mut handle, response)?;
    handle.write_all(b"\n")?;
    handle.flush()?;
    Ok(())
}

impl InferenceRuntime {
    fn load(model_path: &Path, gpu_enabled: bool) -> Result<Self> {
        let mut backend = LlamaBackend::init().map_err(|error| anyhow!(error.to_string()))?;
        backend.void_logs();

        let model_params = if gpu_enabled {
            LlamaModelParams::default().with_n_gpu_layers(GPU_LAYERS_ALL)
        } else {
            LlamaModelParams::default()
        };

        let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
            .map_err(|error| anyhow!(error.to_string()))?;
        let chat_template = detect_chat_template(&model, model_path);
        eprintln!("chat template detected: {:?}", chat_template);
        let thread_count = thread_count();
        let context_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(INFERENCE_CONTEXT_LENGTH))
            .with_n_batch(INFERENCE_CONTEXT_LENGTH)
            .with_n_threads(thread_count)
            .with_n_threads_batch(thread_count);

        Ok(Self {
            _backend: backend,
            model,
            context_params,
            chat_template,
        })
    }

    fn infer(&self, prompt: &str, max_tokens: u32) -> Result<String> {
        let max_chars = (usize::try_from(INFERENCE_CONTEXT_LENGTH).unwrap_or_default() - 350) * 3;
        let truncated_prompt = truncate_for_context(prompt, max_chars);
        let formatted = self.chat_template.format_prompt(&truncated_prompt);

        let prompt_tokens = self
            .model
            .str_to_token(&formatted, self.chat_template.add_bos())
            .context("Failed to tokenize inference prompt")?;

        if prompt_tokens.is_empty() {
            return Err(anyhow!(
                "Inference prompt cannot be empty after tokenization"
            ));
        }

        let requested_tokens = usize::try_from(max_tokens).unwrap_or(0);
        if prompt_tokens.len() + requested_tokens
            > usize::try_from(INFERENCE_CONTEXT_LENGTH).unwrap_or(usize::MAX)
        {
            return Err(anyhow!(
                "Inference prompt is too large for the configured llama context window"
            ));
        }

        let mut context = self
            .model
            .new_context(&self._backend, self.context_params.clone())
            .map_err(|error| anyhow!(error.to_string()))?;
        let mut prompt_batch = LlamaBatch::new(prompt_tokens.len(), 1);
        prompt_batch
            .add_sequence(&prompt_tokens, 0, false)
            .context("Failed to add prompt tokens to llama batch")?;
        context
            .decode(&mut prompt_batch)
            .map_err(|error| anyhow!(error.to_string()))?;

        let eos_token = self.model.token_eos();
        let mut output = String::new();
        let mut position = i32::try_from(prompt_tokens.len()).unwrap_or(i32::MAX);

        for _ in 0..max_tokens {
            let next_token = context.token_data_array().sample_token_greedy();
            if next_token == eos_token || self.model.is_eog_token(next_token) {
                break;
            }

            let token_str = self
                .model
                .token_to_str(next_token, Special::Plaintext)
                .map_err(|error| anyhow!(error.to_string()))?;
            output.push_str(&token_str);

            if let Some(stripped) = strip_stop_marker(&output, self.chat_template.stop_markers()) {
                output = stripped.to_string();
                break;
            }

            let mut batch = LlamaBatch::new(1, 1);
            batch
                .add(next_token, position, &[0], true)
                .context("Failed to add sampled token to llama batch")?;
            context
                .decode(&mut batch)
                .map_err(|error| anyhow!(error.to_string()))?;
            position = position.saturating_add(1);
        }

        Ok(output.trim().to_string())
    }
}

impl ChatTemplate {
    fn format_prompt(self, prompt: &str) -> String {
        match self {
            ChatTemplate::None => prompt.to_string(),
            ChatTemplate::ChatML => format!(
                "<|im_start|>system\nYou are a helpful assistant.<|im_end|>\n<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n"
            ),
            ChatTemplate::Llama3 => format!(
                "<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\nYou are a helpful assistant.<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n{prompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n"
            ),
            ChatTemplate::Mistral => format!("[INST] {prompt} [/INST]"),
            ChatTemplate::Phi3 => format!(
                "<|system|>\nYou are a helpful assistant.<|end|>\n<|user|>\n{prompt}<|end|>\n<|assistant|>\n"
            ),
        }
    }

    fn add_bos(self) -> AddBos {
        match self {
            ChatTemplate::ChatML | ChatTemplate::Llama3 => AddBos::Never,
            ChatTemplate::Mistral | ChatTemplate::Phi3 | ChatTemplate::None => AddBos::Always,
        }
    }

    fn stop_markers(self) -> &'static [&'static str] {
        match self {
            ChatTemplate::None => &[],
            ChatTemplate::ChatML => &["<|im_end|>", "<|im_start|>"],
            ChatTemplate::Llama3 => &["<|eot_id|>", "<|start_header_id|>"],
            ChatTemplate::Mistral => &["[INST]"],
            ChatTemplate::Phi3 => &["<|end|>", "<|user|>"],
        }
    }
}

fn thread_count() -> i32 {
    thread::available_parallelism()
        .map(|parallelism| i32::try_from(parallelism.get()).unwrap_or(4))
        .unwrap_or(4)
}

fn detect_chat_template(model: &LlamaModel, model_path: &Path) -> ChatTemplate {
    if let Ok(template) = model.chat_template(None) {
        if let Ok(raw_template) = template.to_string() {
            if let Some(detected) = detect_chat_template_from_raw(&raw_template) {
                return detected;
            }
        }
    }

    let file_name = model_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if file_name.contains("embed") || file_name.contains("nomic") || file_name.contains("bge") {
        return ChatTemplate::None;
    }
    if file_name.contains("qwen") || file_name.contains("chatml") {
        return ChatTemplate::ChatML;
    }
    if file_name.contains("llama-3") || file_name.contains("llama3") {
        return ChatTemplate::Llama3;
    }
    if file_name.contains("mistral") || file_name.contains("mixtral") {
        return ChatTemplate::Mistral;
    }
    if file_name.contains("phi-3") || file_name.contains("phi3") {
        return ChatTemplate::Phi3;
    }

    ChatTemplate::ChatML
}

fn detect_chat_template_from_raw(raw_template: &str) -> Option<ChatTemplate> {
    if raw_template.contains("<|im_start|>") {
        return Some(ChatTemplate::ChatML);
    }
    if raw_template.contains("<|begin_of_text|>") {
        return Some(ChatTemplate::Llama3);
    }
    if raw_template.contains("[INST]") {
        return Some(ChatTemplate::Mistral);
    }
    if raw_template.contains("<|user|>") {
        return Some(ChatTemplate::Phi3);
    }

    None
}

fn truncate_for_context(text: &str, max_chars: usize) -> String {
    let char_count = text.chars().count();
    if char_count <= max_chars {
        return text.to_string();
    }

    let truncated: String = text.chars().take(max_chars).collect();
    format!("{truncated}... [truncated]")
}

fn strip_stop_marker<'a>(text: &'a str, markers: &[&str]) -> Option<&'a str> {
    for marker in markers {
        if let Some(prefix) = text.strip_suffix(marker) {
            return Some(prefix);
        }
    }

    None
}
