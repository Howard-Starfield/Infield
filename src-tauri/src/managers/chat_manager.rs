use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures_util::Stream;
use futures_util::StreamExt;
use log::info;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use specta::Type;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

// ── Data types ────────────────────────────────────────────────────────────────

/// Image attached to a user message (OpenAI / Anthropic multimodal).
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChatImageAttachment {
    pub mime: String,
    pub data_base64: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChatMessage {
    pub role: String, // "user" | "assistant" | "system"
    pub content: String,
    #[serde(default)]
    pub attachments: Option<Vec<ChatImageAttachment>>,
    /// Extracted `<document>...</document>` blocks for this user turn (merged into `content` for the API only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_context: Option<String>,
}

impl ChatMessage {
    pub fn text(role: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: content.into(),
            attachments: None,
            document_context: None,
        }
    }
}

/// Default completion cap for chat (raised from 2048; user can override in settings).
pub const DEFAULT_CHAT_MAX_OUTPUT_TOKENS: u32 = 8192;

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChatOptions {
    /// For OpenAI-compatible `/v1/chat/completions`: when `Some`, sent as `max_tokens` (Groq,
    /// Gemini, Mistral, Ollama, etc.) or `max_completion_tokens` on the official OpenAI API host.
    /// When `None`, that field is omitted so the server uses its own default.
    pub max_tokens: Option<u32>,
    /// Anthropic Messages API requires `max_tokens` on every request. This value is always used
    /// for Claude, including when `max_tokens` is `None` above (omit mode for OpenAI-compatible only).
    #[serde(default = "default_anthropic_max_tokens")]
    pub anthropic_max_tokens: u32,
    pub temperature: Option<f32>,
    /// When set (non-empty), overrides the provider's configured model for this request only.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_override: Option<String>,
}

fn default_anthropic_max_tokens() -> u32 {
    DEFAULT_CHAT_MAX_OUTPUT_TOKENS
}

impl Default for ChatOptions {
    fn default() -> Self {
        Self {
            max_tokens: Some(DEFAULT_CHAT_MAX_OUTPUT_TOKENS),
            anthropic_max_tokens: DEFAULT_CHAT_MAX_OUTPUT_TOKENS,
            temperature: Some(0.7),
            model_override: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChatTokenEvent {
    pub session_id: String,
    pub token: String,
    pub done: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ChatProviderConfig {
    pub provider_type: String, // "openai_compatible" | "anthropic"
    pub base_url: Option<String>,
    pub model: String,
    pub provider_id: String, // "openai" | "anthropic" | "groq" | "gemini" | "mistral" | "ollama" | "llama_cpp"
    /// Ollama: optional vision model override (persisted). Omitted in JSON means "leave unchanged" on save.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vision_model: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct ProviderStatus {
    pub provider_id: String,
    pub model: String,
    pub base_url: Option<String>,
    /// Ollama: saved vision-only model tag when the user attaches images.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vision_model: Option<String>,
    /// Built-in default model for this provider (for placeholders / reset).
    pub default_model: String,
    /// Built-in default API base when applicable (OpenAI-compatible providers only).
    pub default_base_url: Option<String>,
    pub key_status: String, // "saved" | "not_set" | "unavailable"
    pub is_active: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct TestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub error: Option<String>,
}

/// Trim keychain value and strip a duplicated `Bearer ` prefix (users sometimes paste the full header).
fn normalize_chat_api_key(raw: Option<String>) -> Option<String> {
    let owned = raw?;
    let s = owned.trim();
    if s.is_empty() {
        return None;
    }
    let s = s
        .strip_prefix("Bearer ")
        .or_else(|| s.strip_prefix("bearer "))
        .map(str::trim)
        .unwrap_or(s);
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

/// Local OpenAI-compatible servers (Ollama, llama.cpp) usually accept requests without a key.
fn openai_base_url_allows_anonymous(base_url: &str) -> bool {
    let lower = base_url.to_lowercase();
    lower.contains("localhost")
        || lower.contains("127.0.0.1")
        || lower.contains("0.0.0.0")
}

/// Official OpenAI Chat Completions uses `max_completion_tokens` (not `max_tokens`) for recent models.
fn openai_compatible_uses_max_completion_tokens(base_url: &str) -> bool {
    base_url.to_lowercase().contains("api.openai.com")
}

// ── Provider trait ────────────────────────────────────────────────────────────

#[async_trait]
pub trait ChatProvider: Send + Sync {
    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        opts: ChatOptions,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<String>> + Send>>>;
    fn display_name(&self) -> String;
}

// ── OpenAI-compatible provider ────────────────────────────────────────────────

pub struct OpenAiCompatibleProvider {
    base_url: String,
    api_key: Option<String>,
    model: String,
    client: Client,
}

impl OpenAiCompatibleProvider {
    pub fn new(base_url: String, api_key: Option<String>, model: String) -> Self {
        Self {
            base_url,
            api_key: normalize_chat_api_key(api_key),
            model,
            client: Client::new(),
        }
    }
}

/// True when user text should not be sent as a separate text part alongside images (empty or UI placeholder).
fn user_text_redundant_for_vision(content: &str) -> bool {
    let t = content.trim();
    t.is_empty() || t == "(image)"
}

/// Serialize a chat message for OpenAI-compatible `/v1/chat/completions` (text or multimodal user content).
pub fn openai_chat_message_to_json(m: &ChatMessage) -> serde_json::Value {
    let user_images = m.role == "user"
        && m
            .attachments
            .as_ref()
            .map(|a| !a.is_empty())
            .unwrap_or(false);
    if user_images {
        let mut parts: Vec<serde_json::Value> = Vec::new();
        if !user_text_redundant_for_vision(&m.content) {
            parts.push(json!({"type": "text", "text": m.content}));
        }
        for img in m.attachments.as_ref().unwrap_or(&Vec::new()) {
            let url = format!("data:{};base64,{}", img.mime, img.data_base64);
            parts.push(json!({
                "type": "image_url",
                "image_url": { "url": url }
            }));
        }
        json!({ "role": m.role, "content": parts })
    } else {
        json!({ "role": m.role, "content": m.content })
    }
}

/// Append assistant-visible text from one OpenAI-style `choices[0].delta` object.
/// Ollama thinking models often stream under `reasoning` / `reasoning_content` before `content`;
/// we concatenate in API order so the UI shows one continuous assistant transcript.
fn push_openai_delta_to_string(delta: &serde_json::Value, out: &mut String) {
    for key in ["reasoning", "reasoning_content"] {
        if let Some(s) = delta.get(key).and_then(|v| v.as_str()) {
            out.push_str(s);
        }
    }
    if let Some(s) = delta.get("content").and_then(|v| v.as_str()) {
        out.push_str(s);
    }
}

#[async_trait]
impl ChatProvider for OpenAiCompatibleProvider {
    fn display_name(&self) -> String {
        format!("{}", self.model)
    }

    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        opts: ChatOptions,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<String>> + Send>>> {
        let base = self.base_url.trim();
        if !openai_base_url_allows_anonymous(base) && self.api_key.is_none() {
            return Err(anyhow!(
                "No API key saved for this provider. For MiniMax (OpenAI-compatible), paste your MiniMax secret key from platform.minimax.io in the key field, click Save, set base URL to https://api.minimax.io/v1, then test again."
            ));
        }

        let url = format!("{}/chat/completions", base.trim_end_matches('/'));

        let mut req = self
            .client
            .post(&url)
            .header("Content-Type", "application/json");

        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }

        let openai_messages: Vec<serde_json::Value> =
            messages.iter().map(openai_chat_message_to_json).collect();

        if let Some(last) = messages.iter().rev().find(|m| m.role == "user") {
            let img_n = last
                .attachments
                .as_ref()
                .map(|a| a.len())
                .unwrap_or(0);
            let content_is_array = openai_messages
                .iter()
                .rev()
                .find(|v| v.get("role").and_then(|r| r.as_str()) == Some("user"))
                .and_then(|v| v.get("content"))
                .map(|c| c.is_array())
                .unwrap_or(false);
            log::debug!(
                "OpenAI-compatible chat: last user message has {} image(s), content JSON is_array={}",
                img_n,
                content_is_array
            );
        }

        let model = opts
            .model_override
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(self.model.as_str());

        let mut body = serde_json::Map::new();
        body.insert("model".to_string(), json!(model));
        body.insert("messages".to_string(), json!(openai_messages));
        body.insert("stream".to_string(), json!(true));
        if let Some(n) = opts.max_tokens {
            let key = if openai_compatible_uses_max_completion_tokens(base) {
                "max_completion_tokens"
            } else {
                "max_tokens"
            };
            body.insert(key.to_string(), json!(n));
        }
        if let Some(t) = opts.temperature {
            body.insert("temperature".to_string(), json!(t));
        }
        let body = serde_json::Value::Object(body);

        let response = req.json(&body).send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(anyhow!("HTTP {}: {}", status, text));
        }

        let byte_stream = response.bytes_stream();
        let token_stream = byte_stream.map(|chunk| -> Result<String> {
            let bytes = chunk.map_err(|e| anyhow!(e))?;
            let text = String::from_utf8_lossy(&bytes);
            let mut tokens = String::new();
            for line in text.lines() {
                let line = line.trim();
                if line == "data: [DONE]" || line.is_empty() {
                    continue;
                }
                let json_str = line.strip_prefix("data: ").unwrap_or(line);
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                    if let Some(delta) = val.pointer("/choices/0/delta") {
                        push_openai_delta_to_string(delta, &mut tokens);
                    }
                }
            }
            Ok(tokens)
        });

        Ok(Box::pin(token_stream))
    }
}

// ── Anthropic provider ────────────────────────────────────────────────────────

pub struct AnthropicProvider {
    api_key: String,
    model: String,
    client: Client,
}

impl AnthropicProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            api_key,
            model,
            client: Client::new(),
        }
    }
}

#[async_trait]
impl ChatProvider for AnthropicProvider {
    fn display_name(&self) -> String {
        format!("Claude · {}", self.model)
    }

    async fn chat_stream(
        &self,
        messages: Vec<ChatMessage>,
        opts: ChatOptions,
    ) -> Result<Pin<Box<dyn Stream<Item = Result<String>> + Send>>> {
        // Separate system message from conversation messages
        let (system_msgs, conv_msgs): (Vec<_>, Vec<_>) =
            messages.iter().partition(|m| m.role == "system");
        let system_content = system_msgs
            .iter()
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        let anthropic_messages: Vec<serde_json::Value> = conv_msgs
            .iter()
            .map(|m| {
                let user_images = m.role == "user"
                    && m
                        .attachments
                        .as_ref()
                        .map(|a| !a.is_empty())
                        .unwrap_or(false);
                if user_images {
                    let mut blocks: Vec<serde_json::Value> = Vec::new();
                    for img in m.attachments.as_ref().unwrap_or(&Vec::new()) {
                        blocks.push(json!({
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": img.mime,
                                "data": img.data_base64
                            }
                        }));
                    }
                    if !user_text_redundant_for_vision(&m.content) {
                        blocks.push(json!({
                            "type": "text",
                            "text": m.content
                        }));
                    }
                    json!({ "role": m.role, "content": blocks })
                } else {
                    json!({ "role": m.role, "content": m.content })
                }
            })
            .collect();

        if let Some(last) = conv_msgs.iter().rev().find(|m| m.role == "user") {
            let img_n = last
                .attachments
                .as_ref()
                .map(|a| a.len())
                .unwrap_or(0);
            log::debug!(
                "Anthropic chat: last user turn has {} image attachment(s)",
                img_n
            );
        }

        let mut body = json!({
            "model": self.model,
            "messages": anthropic_messages,
            "stream": true,
            "max_tokens": opts.anthropic_max_tokens,
        });
        if !system_content.is_empty() {
            body["system"] = json!(system_content);
        }

        let response = self
            .client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(anyhow!("HTTP {}: {}", status, text));
        }

        let byte_stream = response.bytes_stream();
        let token_stream = byte_stream.map(|chunk| -> Result<String> {
            let bytes = chunk.map_err(|e| anyhow!(e))?;
            let text = String::from_utf8_lossy(&bytes);
            let mut tokens = String::new();
            for line in text.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let json_str = line.strip_prefix("data: ").unwrap_or(line);
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(json_str) {
                    if val.get("type").and_then(|v| v.as_str()) == Some("content_block_delta") {
                        let Some(delta) = val.get("delta") else {
                            continue;
                        };
                        let ty = delta.get("type").and_then(|v| v.as_str());
                        match ty {
                            Some("thinking_delta") => {
                                if let Some(s) = delta.get("thinking").and_then(|v| v.as_str()) {
                                    tokens.push_str(s);
                                }
                            }
                            Some("text_delta") => {
                                if let Some(s) = delta.get("text").and_then(|v| v.as_str()) {
                                    tokens.push_str(s);
                                }
                            }
                            Some("signature_delta") | Some("input_json_delta") => {}
                            _ => {
                                if let Some(s) = delta.get("text").and_then(|v| v.as_str()) {
                                    tokens.push_str(s);
                                }
                            }
                        }
                    }
                }
            }
            Ok(tokens)
        });

        Ok(Box::pin(token_stream))
    }
}

// ── ChatManager ───────────────────────────────────────────────────────────────

pub struct ChatManager {
    provider: Arc<RwLock<Arc<Box<dyn ChatProvider>>>>,
    is_streaming: Arc<AtomicBool>,
    active_provider_id: Arc<RwLock<String>>,
    active_model: Arc<RwLock<String>>,
}

impl ChatManager {
    pub fn new() -> Self {
        // Default: Ollama
        let default_provider: Arc<Box<dyn ChatProvider>> =
            Arc::new(Box::new(OpenAiCompatibleProvider::new(
                "http://localhost:11434/v1".to_string(),
                None,
                "llama3.2".to_string(),
            )));
        Self {
            provider: Arc::new(RwLock::new(default_provider)),
            is_streaming: Arc::new(AtomicBool::new(false)),
            active_provider_id: Arc::new(RwLock::new("ollama".to_string())),
            active_model: Arc::new(RwLock::new("llama3.2".to_string())),
        }
    }

    pub async fn reload(&self, config: ChatProviderConfig) -> Result<()> {
        let api_key = Self::load_api_key_normalized(&config.provider_id);
        let new_provider: Arc<Box<dyn ChatProvider>> = match config.provider_type.as_str() {
            "anthropic" => {
                let key =
                    api_key.ok_or_else(|| anyhow!("Anthropic API key not found in keychain"))?;
                Arc::new(Box::new(AnthropicProvider::new(key, config.model.clone())))
            }
            _ => {
                let base_url = config
                    .base_url
                    .unwrap_or_else(|| "http://localhost:11434/v1".to_string());
                Arc::new(Box::new(OpenAiCompatibleProvider::new(
                    base_url,
                    api_key,
                    config.model.clone(),
                )))
            }
        };

        {
            let mut guard = self.provider.write().await;
            *guard = new_provider;
        }
        {
            let mut pid = self.active_provider_id.write().await;
            *pid = config.provider_id;
        }
        {
            let mut model = self.active_model.write().await;
            *model = config.model;
        }

        info!("ChatManager reloaded");
        Ok(())
    }

    pub fn is_streaming(&self) -> bool {
        self.is_streaming.load(Ordering::Relaxed)
    }

    pub async fn get_display_name(&self) -> String {
        let provider_guard = self.provider.read().await;
        provider_guard.display_name()
    }

    /// Stream a chat completion, emitting tokens via the provided callback.
    pub async fn stream_chat<F>(
        &self,
        messages: Vec<ChatMessage>,
        opts: ChatOptions,
        on_token: F,
    ) -> Result<()>
    where
        F: Fn(String, bool) + Send + 'static,
    {
        self.is_streaming.store(true, Ordering::Relaxed);
        let provider = {
            let guard = self.provider.read().await;
            Arc::clone(&*guard)
        };

        let result = async {
            let mut stream = provider.chat_stream(messages, opts).await?;
            while let Some(chunk) = stream.next().await {
                match chunk {
                    Ok(token) if !token.is_empty() => on_token(token, false),
                    Ok(_) => {}
                    Err(e) => return Err(e),
                }
            }
            on_token(String::new(), true);
            Ok(())
        }
        .await;

        self.is_streaming.store(false, Ordering::Relaxed);
        result
    }

    /// Non-streaming completion: collects all tokens into a single String.
    pub async fn complete(&self, messages: Vec<ChatMessage>, opts: ChatOptions) -> Result<String> {
        let provider = {
            let guard = self.provider.read().await;
            Arc::clone(&*guard)
        };
        let mut stream = provider.chat_stream(messages, opts).await?;
        let mut output = String::new();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(token) => output.push_str(&token),
                Err(e) => return Err(e),
            }
        }
        Ok(output)
    }

    // ── API key helpers (keychain) ──────────────────────────────────────────

    pub fn save_api_key(provider_id: &str, key: &str) -> Result<()> {
        let normalized = normalize_chat_api_key(Some(key.to_string()))
            .ok_or_else(|| anyhow!("API key cannot be empty"))?;
        keyring::Entry::new("handy", &format!("{}_api_key", provider_id))
            .map_err(|e| anyhow!("Keyring error: {}", e))?
            .set_password(&normalized)
            .map_err(|e| anyhow!("Keyring set error: {}", e))
    }

    pub fn load_api_key(provider_id: &str) -> Option<String> {
        keyring::Entry::new("handy", &format!("{}_api_key", provider_id))
            .ok()?
            .get_password()
            .ok()
    }

    pub fn load_api_key_normalized(provider_id: &str) -> Option<String> {
        normalize_chat_api_key(Self::load_api_key(provider_id))
    }

    /// Matches whether `load_api_key_normalized` would return a usable key (not raw keyring presence).
    pub fn key_status(provider_id: &str) -> String {
        match keyring::Entry::new("handy", &format!("{}_api_key", provider_id)) {
            Ok(entry) => match entry.get_password() {
                Ok(raw) => {
                    if normalize_chat_api_key(Some(raw)).is_some() {
                        "saved".to_string()
                    } else {
                        "not_set".to_string()
                    }
                }
                Err(keyring::Error::NoEntry) => "not_set".to_string(),
                Err(_) => "unavailable".to_string(),
            },
            Err(_) => "unavailable".to_string(),
        }
    }

    /// For provider test: use inline draft key if non-empty after normalize, else keychain.
    pub fn resolve_api_key_for_test(provider_id: &str, api_key_override: Option<String>) -> Option<String> {
        normalize_chat_api_key(api_key_override).or_else(|| Self::load_api_key_normalized(provider_id))
    }

    pub async fn active_provider_id(&self) -> String {
        self.active_provider_id.read().await.clone()
    }

    pub async fn active_model(&self) -> String {
        self.active_model.read().await.clone()
    }
}

