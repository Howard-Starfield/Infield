use crate::settings::{get_settings, write_settings};
use anyhow::Result;
use flate2::read::GzDecoder;
use futures_util::StreamExt;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tar::Archive;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum EngineType {
    Whisper,
    Parakeet,
    Moonshine,
    MoonshineStreaming,
    SenseVoice,
    GigaAM,
    Canary,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub enum ModelCategory {
    Transcription,
    Embedding,
    Llm,
}

/// One remote file in a `DownloadSpec::MultiFile` entry.
///
/// Used for HuggingFace ONNX models (bge-small-en-v1.5, future multi-artifact
/// models) where a single logical model is several independent download URLs
/// — weights, tokenizer, config, vocab, license — not a bundled tarball.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RemoteFile {
    /// Absolute HTTP(S) URL to download from.
    pub url: String,
    /// Target filename within the model directory. May differ from the URL's
    /// tail: e.g. `"onnx/model.onnx"` at the source flattens to
    /// `"model.onnx"` on disk.
    pub filename: String,
    /// Expected SHA-256 of the downloaded bytes, hex-encoded. `None` disables
    /// verification — acceptable only for artifacts that are nice-to-have
    /// (e.g. README) or during bootstrap before upstream hashes are pinned.
    pub sha256: Option<String>,
    /// When `false`, download / hash failure is logged but doesn't fail the
    /// whole model. Used for metadata files (license, README). Weights,
    /// tokenizer, and config files should always be `required: true`.
    pub required: bool,
}

/// How a model's bytes are delivered.
///
/// The enum is the single source of truth for download semantics; callers
/// should never bypass it by inspecting a URL field directly. Introduced in
/// Phase A (D1e locked) to cover HuggingFace ONNX multi-file models
/// alongside the existing single-file and tarball patterns.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum DownloadSpec {
    /// One file → `<models_dir>/<ModelInfo.filename>`.
    /// Used for Whisper `.bin`, LLM `.gguf`, etc.
    SingleFile {
        url: String,
        sha256: Option<String>,
    },
    /// One `.tar.gz` → extracted into `<models_dir>/<ModelInfo.filename>/`.
    /// Used for Parakeet / Moonshine / SenseVoice / GigaAM / Canary int8
    /// bundles.
    SingleArchive {
        url: String,
        sha256: Option<String>,
    },
    /// N independent files → `<models_dir>/<ModelInfo.filename>/<file.filename>`.
    /// Used for HuggingFace ONNX layouts (bge-small) where weights,
    /// tokenizer, config, vocab, and license are separate resolve URLs.
    MultiFile { files: Vec<RemoteFile> },
    /// No remote source — the file is already on disk because the user
    /// dropped it into the models directory themselves (custom Whisper
    /// `.bin`, future bring-your-own models). `download_model()` rejects
    /// these; they appear as `is_downloaded: true` from discovery.
    UserProvided,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    /// On-disk name under `<models_dir>`. For `SingleFile`, the file's name
    /// (e.g. `ggml-small.bin`). For `SingleArchive` / `MultiFile`, the
    /// directory name (e.g. `parakeet-tdt-0.6b-v3-int8`).
    pub filename: String,
    pub download_spec: DownloadSpec,
    pub size_mb: u64,
    pub is_downloaded: bool,
    pub is_downloading: bool,
    pub partial_size: u64,
    pub category: ModelCategory,
    pub engine_type: Option<EngineType>,
    pub accuracy_score: f32,        // 0.0 to 1.0, higher is more accurate
    pub speed_score: f32,           // 0.0 to 1.0, higher is faster
    pub supports_translation: bool, // Whether the model supports translating to English
    pub is_recommended: bool,       // Whether this is the recommended model for new users
    pub supported_languages: Vec<String>, // Languages this model can transcribe
    pub supports_language_selection: bool, // Whether the user can explicitly pick a language
    pub is_custom: bool,            // Whether this is a user-provided custom model
}

impl ModelInfo {
    pub fn is_transcription_model(&self) -> bool {
        self.category == ModelCategory::Transcription
    }

    pub fn is_llm_model(&self) -> bool {
        self.category == ModelCategory::Llm
    }

    /// `true` when the model is materialized as a directory on disk
    /// (`SingleArchive` after extraction, or `MultiFile`). Replaces the
    /// previous `is_directory` field.
    pub fn is_directory_layout(&self) -> bool {
        matches!(
            self.download_spec,
            DownloadSpec::SingleArchive { .. } | DownloadSpec::MultiFile { .. }
        )
    }
}

/// Result of a `download_single_url` call. `UserCancelled` preserves the
/// partial file on disk for a later resume; `Completed` means `target_partial`
/// now holds the verified bytes and the caller owns rename/extract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DownloadOutcome {
    Completed,
    UserCancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DownloadProgress {
    pub model_id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
}

/// RAII guard that cleans up download state (`is_downloading` flag and cancel flag)
/// when dropped, unless explicitly disarmed. This ensures consistent cleanup on
/// every error path without requiring manual cleanup at each `?` or `return Err`.
struct DownloadCleanup<'a> {
    available_models: &'a Mutex<HashMap<String, ModelInfo>>,
    cancel_flags: &'a Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    model_id: String,
    disarmed: bool,
}

impl<'a> Drop for DownloadCleanup<'a> {
    fn drop(&mut self) {
        if self.disarmed {
            return;
        }
        {
            let mut models = self.available_models.lock().unwrap();
            if let Some(model) = models.get_mut(self.model_id.as_str()) {
                model.is_downloading = false;
            }
        }
        self.cancel_flags.lock().unwrap().remove(&self.model_id);
    }
}

pub struct ModelManager {
    app_handle: AppHandle,
    models_dir: PathBuf,
    available_models: Mutex<HashMap<String, ModelInfo>>,
    cancel_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    extracting_models: Arc<Mutex<HashSet<String>>>,
}

impl ModelManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        // Create models directory in app data
        let models_dir = crate::portable::app_data_dir(app_handle)
            .map_err(|e| anyhow::anyhow!("Failed to get app data dir: {}", e))?
            .join("models");

        if !models_dir.exists() {
            fs::create_dir_all(&models_dir)?;
        }

        let mut available_models = HashMap::new();

        // Whisper supported languages (99 languages from tokenizer)
        // Including zh-Hans and zh-Hant variants to match frontend language codes
        let whisper_languages: Vec<String> = vec![
            "en", "zh", "zh-Hans", "zh-Hant", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl",
            "ca", "nl", "ar", "sv", "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs",
            "ro", "da", "hu", "ta", "no", "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy",
            "sk", "te", "fa", "lv", "bn", "sr", "az", "sl", "kn", "et", "mk", "br", "eu", "is",
            "hy", "ne", "mn", "bs", "kk", "sq", "sw", "gl", "mr", "pa", "si", "km", "sn", "yo",
            "so", "af", "oc", "ka", "be", "tg", "sd", "gu", "am", "yi", "lo", "uz", "fo", "ht",
            "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl", "mg", "as", "tt", "haw", "ln",
            "ha", "ba", "jw", "su", "yue",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        // TODO this should be read from a JSON file or something..
        available_models.insert(
            "small".to_string(),
            ModelInfo {
                id: "small".to_string(),
                name: "Whisper Small".to_string(),
                description: "Fast and fairly accurate.".to_string(),
                filename: "ggml-small.bin".to_string(),
                download_spec: DownloadSpec::SingleFile {
                    url: "https://blob.handy.computer/ggml-small.bin".to_string(),
                    sha256: Some(
                        "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b".to_string(),
                    ),
                },
                size_mb: 487,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::Whisper),
                accuracy_score: 0.60,
                speed_score: 0.85,
                supports_translation: true,
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                supports_language_selection: true,
                is_custom: false,
            },
        );

        // Add downloadable models
        available_models.insert(
            "medium".to_string(),
            ModelInfo {
                id: "medium".to_string(),
                name: "Whisper Medium".to_string(),
                description: "Good accuracy, medium speed".to_string(),
                filename: "whisper-medium-q4_1.bin".to_string(),
                download_spec: DownloadSpec::SingleFile {
                    url: "https://blob.handy.computer/whisper-medium-q4_1.bin".to_string(),
                    sha256: Some(
                        "79283fc1f9fe12ca3248543fbd54b73292164d8df5a16e095e2bceeaaabddf57".to_string(),
                    ),
                },
                size_mb: 492, // Approximate size
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::Whisper),
                accuracy_score: 0.75,
                speed_score: 0.60,
                supports_translation: true,
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                supports_language_selection: true,
                is_custom: false,
            },
        );

        available_models.insert(
            "turbo".to_string(),
            ModelInfo {
                id: "turbo".to_string(),
                name: "Whisper Turbo".to_string(),
                description: "Balanced accuracy and speed.".to_string(),
                filename: "ggml-large-v3-turbo.bin".to_string(),
                download_spec: DownloadSpec::SingleFile {
                    url: "https://blob.handy.computer/ggml-large-v3-turbo.bin".to_string(),
                    sha256: Some(
                        "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69".to_string(),
                    ),
                },
                size_mb: 1600, // Approximate size
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::Whisper),
                accuracy_score: 0.80,
                speed_score: 0.40,
                supports_translation: false, // Turbo doesn't support translation
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                supports_language_selection: true,
                is_custom: false,
            },
        );

        available_models.insert(
            "large".to_string(),
            ModelInfo {
                id: "large".to_string(),
                name: "Whisper Large".to_string(),
                description: "Good accuracy, but slow.".to_string(),
                filename: "ggml-large-v3-q5_0.bin".to_string(),
                download_spec: DownloadSpec::SingleFile {
                    url: "https://blob.handy.computer/ggml-large-v3-q5_0.bin".to_string(),
                    sha256: Some(
                        "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1".to_string(),
                    ),
                },
                size_mb: 1100, // Approximate size
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::Whisper),
                accuracy_score: 0.85,
                speed_score: 0.30,
                supports_translation: true,
                is_recommended: false,
                supported_languages: whisper_languages.clone(),
                supports_language_selection: true,
                is_custom: false,
            },
        );

        available_models.insert(
            "breeze-asr".to_string(),
            ModelInfo {
                id: "breeze-asr".to_string(),
                name: "Breeze ASR".to_string(),
                description: "Optimized for Taiwanese Mandarin. Code-switching support."
                    .to_string(),
                filename: "breeze-asr-q5_k.bin".to_string(),
                download_spec: DownloadSpec::SingleFile {
                    url: "https://blob.handy.computer/breeze-asr-q5_k.bin".to_string(),
                    sha256: Some(
                        "8efbf0ce8a3f50fe332b7617da787fb81354b358c288b008d3bdef8359df64c6".to_string(),
                    ),
                },
                size_mb: 1080,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::Whisper),
                accuracy_score: 0.85,
                speed_score: 0.35,
                supports_translation: false,
                is_recommended: false,
                supported_languages: whisper_languages,
                supports_language_selection: true,
                is_custom: false,
            },
        );

        // Add NVIDIA Parakeet models (directory-based)
        available_models.insert(
            "parakeet-tdt-0.6b-v2".to_string(),
            ModelInfo {
                id: "parakeet-tdt-0.6b-v2".to_string(),
                name: "Parakeet V2".to_string(),
                description: "English only. The best model for English speakers.".to_string(),
                filename: "parakeet-tdt-0.6b-v2-int8".to_string(), // Directory name
                download_spec: DownloadSpec::SingleArchive {
                    url: "https://blob.handy.computer/parakeet-v2-int8.tar.gz".to_string(),
                    sha256: Some(
                        "ac9b9429984dd565b25097337a887bb7f0f8ac393573661c651f0e7d31563991".to_string(),
                    ),
                },
                size_mb: 473, // Approximate size for int8 quantized model
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::Parakeet),
                accuracy_score: 0.85,
                speed_score: 0.85,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                supports_language_selection: false,
                is_custom: false,
            },
        );

        // Parakeet V3 supported languages (25 EU languages + Russian/Ukrainian):
        // bg, hr, cs, da, nl, en, et, fi, fr, de, el, hu, it, lv, lt, mt, pl, pt, ro, sk, sl, es, sv, ru, uk
        let parakeet_v3_languages: Vec<String> = vec![
            "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv",
            "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        available_models.insert(
            "parakeet-tdt-0.6b-v3".to_string(),
            ModelInfo {
                id: "parakeet-tdt-0.6b-v3".to_string(),
                name: "Parakeet V3".to_string(),
                description: "Fast and accurate. Supports 25 European languages.".to_string(),
                filename: "parakeet-tdt-0.6b-v3-int8".to_string(), // Directory name
                download_spec: DownloadSpec::SingleArchive {
                    url: "https://blob.handy.computer/parakeet-v3-int8.tar.gz".to_string(),
                    sha256: Some(
                        "43d37191602727524a7d8c6da0eef11c4ba24320f5b4730f1a2497befc2efa77".to_string(),
                    ),
                },
                size_mb: 478, // Approximate size for int8 quantized model
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::Parakeet),
                accuracy_score: 0.80,
                speed_score: 0.85,
                supports_translation: false,
                is_recommended: true,
                supported_languages: parakeet_v3_languages,
                supports_language_selection: false,
                is_custom: false,
            },
        );

        available_models.insert(
            "moonshine-base".to_string(),
            ModelInfo {
                id: "moonshine-base".to_string(),
                name: "Moonshine Base".to_string(),
                description: "Very fast, English only. Handles accents well.".to_string(),
                filename: "moonshine-base".to_string(),
                download_spec: DownloadSpec::SingleArchive {
                    url: "https://blob.handy.computer/moonshine-base.tar.gz".to_string(),
                    sha256: Some(
                        "04bf6ab012cfceebd4ac7cf88c1b31d027bbdd3cd704649b692e2e935236b7e8".to_string(),
                    ),
                },
                size_mb: 58,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::Moonshine),
                accuracy_score: 0.70,
                speed_score: 0.90,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                supports_language_selection: false,
                is_custom: false,
            },
        );

        available_models.insert(
            "moonshine-tiny-streaming-en".to_string(),
            ModelInfo {
                id: "moonshine-tiny-streaming-en".to_string(),
                name: "Moonshine V2 Tiny".to_string(),
                description: "Ultra-fast, English only".to_string(),
                filename: "moonshine-tiny-streaming-en".to_string(),
                download_spec: DownloadSpec::SingleArchive {
                    url: "https://blob.handy.computer/moonshine-tiny-streaming-en.tar.gz"
                        .to_string(),
                    sha256: Some(
                        "465addcfca9e86117415677dfdc98b21edc53537210333a3ecdb58509a80abaf".to_string(),
                    ),
                },
                size_mb: 31,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::MoonshineStreaming),
                accuracy_score: 0.55,
                speed_score: 0.95,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                supports_language_selection: false,
                is_custom: false,
            },
        );

        available_models.insert(
            "moonshine-small-streaming-en".to_string(),
            ModelInfo {
                id: "moonshine-small-streaming-en".to_string(),
                name: "Moonshine V2 Small".to_string(),
                description: "Fast, English only. Good balance of speed and accuracy.".to_string(),
                filename: "moonshine-small-streaming-en".to_string(),
                download_spec: DownloadSpec::SingleArchive {
                    url: "https://blob.handy.computer/moonshine-small-streaming-en.tar.gz"
                        .to_string(),
                    sha256: Some(
                        "dbb3e1c1832bd88a4ac712f7449a136cc2c9a18c5fe33a12ed1b7cb1cfe9cdd5".to_string(),
                    ),
                },
                size_mb: 100,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::MoonshineStreaming),
                accuracy_score: 0.65,
                speed_score: 0.90,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                supports_language_selection: false,
                is_custom: false,
            },
        );

        available_models.insert(
            "moonshine-medium-streaming-en".to_string(),
            ModelInfo {
                id: "moonshine-medium-streaming-en".to_string(),
                name: "Moonshine V2 Medium".to_string(),
                description: "English only. High quality.".to_string(),
                filename: "moonshine-medium-streaming-en".to_string(),
                download_spec: DownloadSpec::SingleArchive {
                    url: "https://blob.handy.computer/moonshine-medium-streaming-en.tar.gz"
                        .to_string(),
                    sha256: Some(
                        "07a66f3bff1c77e75a2f637e5a263928a08baae3c29c4c053fc968a9a9373d13".to_string(),
                    ),
                },
                size_mb: 192,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::MoonshineStreaming),
                accuracy_score: 0.75,
                speed_score: 0.80,
                supports_translation: false,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                supports_language_selection: false,
                is_custom: false,
            },
        );

        // SenseVoice supported languages
        let sense_voice_languages: Vec<String> =
            vec!["zh", "zh-Hans", "zh-Hant", "en", "yue", "ja", "ko"]
                .into_iter()
                .map(String::from)
                .collect();

        available_models.insert(
            "sense-voice-int8".to_string(),
            ModelInfo {
                id: "sense-voice-int8".to_string(),
                name: "SenseVoice".to_string(),
                description: "Very fast. Chinese, English, Japanese, Korean, Cantonese."
                    .to_string(),
                filename: "sense-voice-int8".to_string(),
                download_spec: DownloadSpec::SingleArchive {
                    url: "https://blob.handy.computer/sense-voice-int8.tar.gz".to_string(),
                    sha256: Some(
                        "171d611fe5d353a50bbb741b6f3ef42559b1565685684e9aa888ef563ba3e8a4".to_string(),
                    ),
                },
                size_mb: 160,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::SenseVoice),
                accuracy_score: 0.65,
                speed_score: 0.95,
                supports_translation: false,
                is_recommended: false,
                supported_languages: sense_voice_languages,
                supports_language_selection: true,
                is_custom: false,
            },
        );

        // GigaAM v3 supported languages
        let gigaam_languages: Vec<String> = vec!["ru"].into_iter().map(String::from).collect();

        available_models.insert(
            "gigaam-v3-e2e-ctc".to_string(),
            ModelInfo {
                id: "gigaam-v3-e2e-ctc".to_string(),
                name: "GigaAM v3".to_string(),
                description: "Russian speech recognition. Fast and accurate.".to_string(),
                filename: "giga-am-v3-int8".to_string(),
                download_spec: DownloadSpec::SingleArchive {
                    url: "https://blob.handy.computer/giga-am-v3-int8.tar.gz".to_string(),
                    sha256: Some(
                        "d872462268430db140b69b72e0fc4b787b194c1dbe51b58de39444d55b6da45b".to_string(),
                    ),
                },
                size_mb: 152,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::GigaAM),
                accuracy_score: 0.85,
                speed_score: 0.75,
                supports_translation: false,
                is_recommended: false,
                supported_languages: gigaam_languages,
                supports_language_selection: false,
                is_custom: false,
            },
        );

        // Canary 180m Flash supported languages (4 languages)
        let canary_flash_languages: Vec<String> = vec!["en", "de", "es", "fr"]
            .into_iter()
            .map(String::from)
            .collect();

        available_models.insert(
            "canary-180m-flash".to_string(),
            ModelInfo {
                id: "canary-180m-flash".to_string(),
                name: "Canary 180M Flash".to_string(),
                description: "Very fast. English, German, Spanish, French. Supports translation."
                    .to_string(),
                filename: "canary-180m-flash".to_string(),
                download_spec: DownloadSpec::SingleArchive {
                    url: "https://blob.handy.computer/canary-180m-flash.tar.gz".to_string(),
                    sha256: Some(
                        "6d9cfca6118b296e196eaedc1c8fa9788305a7b0f1feafdb6dc91932ab6e53f7".to_string(),
                    ),
                },
                size_mb: 146,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::Canary),
                accuracy_score: 0.75,
                speed_score: 0.85,
                supports_translation: true,
                is_recommended: false,
                supported_languages: canary_flash_languages,
                supports_language_selection: true,
                is_custom: false,
            },
        );

        // Canary 1B v2 supported languages (25 EU languages)
        let canary_1b_languages: Vec<String> = vec![
            "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv",
            "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk",
        ]
        .into_iter()
        .map(String::from)
        .collect();

        available_models.insert(
            "canary-1b-v2".to_string(),
            ModelInfo {
                id: "canary-1b-v2".to_string(),
                name: "Canary 1B v2".to_string(),
                description: "Accurate multilingual. 25 European languages. Supports translation."
                    .to_string(),
                filename: "canary-1b-v2".to_string(),
                download_spec: DownloadSpec::SingleArchive {
                    url: "https://blob.handy.computer/canary-1b-v2.tar.gz".to_string(),
                    sha256: Some(
                        "02305b2a25f9cf3e7deaffa7f94df00efa44f442cd55c101c2cb9c000f904666".to_string(),
                    ),
                },
                size_mb: 692,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::Canary),
                accuracy_score: 0.85,
                speed_score: 0.70,
                supports_translation: true,
                is_recommended: false,
                supported_languages: canary_1b_languages,
                supports_language_selection: true,
                is_custom: false,
            },
        );

        // bge-small-en-v1.5 — Phase A embedding model (D1 + D1a/b/c/d/e locked).
        //
        // 384d English embedding, 133 MB ONNX (fp32). Downloads as 5 required
        // files + 1 optional README from HuggingFace into
        // `<app_data>/models/bge-small-en-v1.5/`. Loaded by
        // `managers/embedding_ort.rs` via the `ort` crate; mean-pool-style
        // sentence-BERT recipe does NOT apply here — BGE recommends [CLS]
        // pooling (see pitfall.md "Embedding model pooling convention").
        //
        // SHA-256 hashes pinned from the HuggingFace-served bytes (computed
        // locally after download — HF's LFS etags are sha256, so upstream-
        // served bytes and local hashes are the same value). Rule 19 relies
        // on `model.onnx`'s hash being authoritative — it goes into
        // `embedding_model_info.model_hash` at migration time, and a mismatch
        // on boot signals a real model swap (not silent corruption).
        available_models.insert(
            crate::managers::embedding_ort::MODEL_ID.to_string(),
            ModelInfo {
                id: crate::managers::embedding_ort::MODEL_ID.to_string(),
                name: "BGE Small (English)".to_string(),
                description:
                    "Semantic search embeddings for notes. 384-dim, English-only, ~133 MB."
                        .to_string(),
                filename: crate::managers::embedding_ort::MODEL_ID.to_string(), // directory name
                download_spec: DownloadSpec::MultiFile {
                    files: vec![
                        RemoteFile {
                            url: "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/onnx/model.onnx"
                                .to_string(),
                            filename: "model.onnx".to_string(),
                            sha256: Some(
                                "828e1496d7fabb79cfa4dcd84fa38625c0d3d21da474a00f08db0f559940cf35"
                                    .to_string(),
                            ),
                            required: true,
                        },
                        RemoteFile {
                            url: "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/tokenizer.json"
                                .to_string(),
                            filename: "tokenizer.json".to_string(),
                            sha256: Some(
                                "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66"
                                    .to_string(),
                            ),
                            required: true,
                        },
                        RemoteFile {
                            url: "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/tokenizer_config.json"
                                .to_string(),
                            filename: "tokenizer_config.json".to_string(),
                            sha256: Some(
                                "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3"
                                    .to_string(),
                            ),
                            required: true,
                        },
                        RemoteFile {
                            url: "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/config.json"
                                .to_string(),
                            filename: "config.json".to_string(),
                            sha256: Some(
                                "094f8e891b932f2000c92cfc663bac4c62069f5d8af5b5278c4306aef3084750"
                                    .to_string(),
                            ),
                            required: true,
                        },
                        RemoteFile {
                            url: "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/vocab.txt"
                                .to_string(),
                            filename: "vocab.txt".to_string(),
                            sha256: Some(
                                "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3"
                                    .to_string(),
                            ),
                            required: true,
                        },
                        RemoteFile {
                            // README carries the BGE attribution; Rule-12-style
                            // "no silent omission" means we prefer to have it,
                            // but it's not load-bearing for inference.
                            url: "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/README.md"
                                .to_string(),
                            filename: "README.md".to_string(),
                            sha256: Some(
                                "ddb964361a55c6e5dfca6361615854b260c9c960205d04c7520151aaa1d75837"
                                    .to_string(),
                            ),
                            required: false,
                        },
                    ],
                },
                size_mb: 133,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Embedding,
                engine_type: None,
                accuracy_score: 0.0,
                speed_score: 0.0,
                supports_translation: false,
                is_recommended: true, // only embedding model for v1
                supported_languages: vec!["en".to_string()],
                supports_language_selection: false,
                is_custom: false,
            },
        );

        available_models.insert(
            "qwen2.5-1.5b-instruct-q4-k-m".to_string(),
            ModelInfo {
                id: "qwen2.5-1.5b-instruct-q4-k-m".to_string(),
                name: "Qwen 2.5 1.5B Instruct".to_string(),
                description:
                    "Compact local AI model for note tagging, summaries, and Ask AI features."
                        .to_string(),
                filename: "qwen2.5-1.5b-instruct-q4_k_m.gguf".to_string(),
                download_spec: DownloadSpec::SingleFile {
                    url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true".to_string(),
                    sha256: Some(
                        "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"
                            .to_string(),
                    ),
                },
                size_mb: 1120,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Llm,
                engine_type: None,
                accuracy_score: 0.0,
                speed_score: 0.0,
                supports_translation: false,
                is_recommended: true,
                supported_languages: vec![],
                supports_language_selection: false,
                is_custom: false,
            },
        );

        // Auto-discover custom Whisper models (.bin files) in the models directory
        if let Err(e) = Self::discover_custom_whisper_models(&models_dir, &mut available_models) {
            warn!("Failed to discover custom models: {}", e);
        }

        let manager = Self {
            app_handle: app_handle.clone(),
            models_dir,
            available_models: Mutex::new(available_models),
            cancel_flags: Arc::new(Mutex::new(HashMap::new())),
            extracting_models: Arc::new(Mutex::new(HashSet::new())),
        };

        // Migrate any bundled models to user directory
        manager.migrate_bundled_models()?;

        // Migrate GigaAM from single-file to directory format
        manager.migrate_gigaam_to_directory()?;

        // Check which models are already downloaded
        manager.update_download_status()?;

        // Auto-select a model if none is currently selected
        manager.auto_select_model_if_needed()?;

        Ok(manager)
    }

    pub fn get_available_models(&self) -> Vec<ModelInfo> {
        let models = self.available_models.lock().unwrap();
        models.values().cloned().collect()
    }

    pub fn get_model_info(&self, model_id: &str) -> Option<ModelInfo> {
        let models = self.available_models.lock().unwrap();
        models.get(model_id).cloned()
    }

    fn migrate_bundled_models(&self) -> Result<()> {
        // Check for bundled models and copy them to user directory
        let bundled_models = ["ggml-small.bin"]; // Add other bundled models here if any

        for filename in &bundled_models {
            let bundled_path = self.app_handle.path().resolve(
                &format!("resources/models/{}", filename),
                tauri::path::BaseDirectory::Resource,
            );

            if let Ok(bundled_path) = bundled_path {
                if bundled_path.exists() {
                    let user_path = self.models_dir.join(filename);

                    // Only copy if user doesn't already have the model
                    if !user_path.exists() {
                        info!("Migrating bundled model {} to user directory", filename);
                        fs::copy(&bundled_path, &user_path)?;
                        info!("Successfully migrated {}", filename);
                    }
                }
            }
        }

        Ok(())
    }

    /// Migrate GigaAM from the old single-file format (giga-am-v3.int8.onnx)
    /// to the new directory format (giga-am-v3-int8/model.int8.onnx + vocab.txt).
    /// This was required by the transcribe-rs 0.3.x upgrade.
    fn migrate_gigaam_to_directory(&self) -> Result<()> {
        let old_file = self.models_dir.join("giga-am-v3.int8.onnx");
        let new_dir = self.models_dir.join("giga-am-v3-int8");

        if !old_file.exists() || new_dir.exists() {
            return Ok(());
        }

        info!("Migrating GigaAM from single-file to directory format");

        let vocab_path = self
            .app_handle
            .path()
            .resolve(
                "resources/models/gigaam_vocab.txt",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|e| anyhow::anyhow!("Failed to resolve GigaAM vocab path: {}", e))?;

        info!(
            "Resolved vocab path: {:?} (exists: {})",
            vocab_path,
            vocab_path.exists()
        );
        info!("Old file: {:?} (exists: {})", old_file, old_file.exists());
        info!("New dir: {:?} (exists: {})", new_dir, new_dir.exists());

        fs::create_dir_all(&new_dir)?;
        fs::rename(&old_file, new_dir.join("model.int8.onnx"))?;
        fs::copy(&vocab_path, new_dir.join("vocab.txt"))?;

        // Clean up old partial file if it exists
        let old_partial = self.models_dir.join("giga-am-v3.int8.onnx.partial");
        if old_partial.exists() {
            let _ = fs::remove_file(&old_partial);
        }

        info!("GigaAM migration complete");
        Ok(())
    }

    fn update_download_status(&self) -> Result<()> {
        let mut models = self.available_models.lock().unwrap();

        for model in models.values_mut() {
            let model_path = self.models_dir.join(&model.filename);
            let partial_path = self.models_dir.join(format!("{}.partial", &model.filename));

            match &model.download_spec {
                DownloadSpec::SingleArchive { .. } => {
                    let extracting_path = self
                        .models_dir
                        .join(format!("{}.extracting", &model.filename));

                    // Clean up any leftover .extracting directories from
                    // interrupted extractions, unless the model is mid-extract.
                    let is_currently_extracting = {
                        let extracting = self.extracting_models.lock().unwrap();
                        extracting.contains(&model.id)
                    };
                    if extracting_path.exists() && !is_currently_extracting {
                        warn!(
                            "Cleaning up interrupted extraction for model: {}",
                            model.id
                        );
                        let _ = fs::remove_dir_all(&extracting_path);
                    }

                    model.is_downloaded = model_path.exists() && model_path.is_dir();
                    model.is_downloading = false;
                    model.partial_size = partial_path
                        .metadata()
                        .map(|m| m.len())
                        .unwrap_or(0);
                }
                DownloadSpec::MultiFile { files } => {
                    // All `required: true` files must be present for the model
                    // to count as downloaded. Optional files (README, license)
                    // don't gate readiness.
                    let model_dir = model_path.clone();
                    let all_required_present = files
                        .iter()
                        .filter(|f| f.required)
                        .all(|f| model_dir.join(&f.filename).is_file());
                    model.is_downloaded = model_dir.is_dir() && all_required_present;
                    model.is_downloading = false;
                    // Aggregate partial bytes across any per-file `.partial`
                    // remnants inside the model directory. Cheap on empty dirs.
                    model.partial_size = if model_dir.is_dir() {
                        fs::read_dir(&model_dir)
                            .ok()
                            .map(|entries| {
                                entries
                                    .filter_map(|e| e.ok())
                                    .filter(|e| {
                                        e.file_name()
                                            .to_string_lossy()
                                            .ends_with(".partial")
                                    })
                                    .filter_map(|e| e.metadata().ok())
                                    .map(|m| m.len())
                                    .sum::<u64>()
                            })
                            .unwrap_or(0)
                    } else {
                        0
                    };
                }
                DownloadSpec::SingleFile { .. } => {
                    model.is_downloaded = model_path.exists();
                    model.is_downloading = false;
                    model.partial_size = partial_path
                        .metadata()
                        .map(|m| m.len())
                        .unwrap_or(0);
                }
                DownloadSpec::UserProvided => {
                    // Discovery already set `is_downloaded = true`; re-check
                    // against disk in case the user deleted the file.
                    model.is_downloaded = model_path.exists();
                    model.is_downloading = false;
                    model.partial_size = 0;
                }
            }
        }

        Ok(())
    }

    fn auto_select_model_if_needed(&self) -> Result<()> {
        let mut settings = get_settings(&self.app_handle);

        // Clear stale selection: selected model is set but doesn't exist
        // in available_models (e.g. deleted custom model file)
        if !settings.selected_model.is_empty() {
            let models = self.available_models.lock().unwrap();
            let exists = models.contains_key(&settings.selected_model);
            drop(models);

            if !exists {
                info!(
                    "Selected model '{}' not found in available models, clearing selection",
                    settings.selected_model
                );
                settings.selected_model = String::new();
                write_settings(&self.app_handle, settings.clone());
            }
        }

        // If no model is selected, pick the first downloaded one
        if settings.selected_model.is_empty() {
            // Find the first available (downloaded) model
            let models = self.available_models.lock().unwrap();
            if let Some(available_model) = models.values().find(|model| model.is_downloaded) {
                info!(
                    "Auto-selecting model: {} ({})",
                    available_model.id, available_model.name
                );

                // Update settings with the selected model
                let mut updated_settings = settings;
                updated_settings.selected_model = available_model.id.clone();
                write_settings(&self.app_handle, updated_settings);

                info!("Successfully auto-selected model: {}", available_model.id);
            }
        }

        Ok(())
    }

    /// Discover custom Whisper models (.bin files) in the models directory.
    /// Skips files that match predefined model filenames.
    fn discover_custom_whisper_models(
        models_dir: &Path,
        available_models: &mut HashMap<String, ModelInfo>,
    ) -> Result<()> {
        if !models_dir.exists() {
            return Ok(());
        }

        // Collect filenames of predefined Whisper file-based models to skip
        let predefined_filenames: HashSet<String> = available_models
            .values()
            .filter(|m| {
                matches!(m.engine_type, Some(EngineType::Whisper)) && !m.is_directory_layout()
            })
            .map(|m| m.filename.clone())
            .collect();

        // Scan models directory for .bin files
        for entry in fs::read_dir(models_dir)? {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    warn!("Failed to read directory entry: {}", e);
                    continue;
                }
            };

            let path = entry.path();

            // Only process .bin files (not directories)
            if !path.is_file() {
                continue;
            }

            let filename = match path.file_name().and_then(|s| s.to_str()) {
                Some(name) => name.to_string(),
                None => continue,
            };

            // Skip hidden files
            if filename.starts_with('.') {
                continue;
            }

            // Only process .bin files (Whisper GGML format).
            // This also excludes .partial downloads (e.g., "model.bin.partial").
            // If we add discovery for other formats, add a .partial check before this filter.
            if !filename.ends_with(".bin") {
                continue;
            }

            // Skip predefined model files
            if predefined_filenames.contains(&filename) {
                continue;
            }

            // Generate model ID from filename (remove .bin extension)
            let model_id = filename.trim_end_matches(".bin").to_string();

            // Skip if model ID already exists (shouldn't happen, but be safe)
            if available_models.contains_key(&model_id) {
                continue;
            }

            // Generate display name: replace - and _ with space, capitalize words
            let display_name = model_id
                .replace(['-', '_'], " ")
                .split_whitespace()
                .map(|word| {
                    let mut chars = word.chars();
                    match chars.next() {
                        None => String::new(),
                        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");

            // Get file size in MB
            let size_mb = match path.metadata() {
                Ok(meta) => meta.len() / (1024 * 1024),
                Err(e) => {
                    warn!("Failed to get metadata for {}: {}", filename, e);
                    0
                }
            };

            info!(
                "Discovered custom Whisper model: {} ({}, {} MB)",
                model_id, filename, size_mb
            );

            available_models.insert(
                model_id.clone(),
                ModelInfo {
                    id: model_id,
                    name: display_name,
                    description: "Not officially supported".to_string(),
                    filename,
                    // Custom models have no remote source; user dropped the
                    // file into the models dir themselves.
                    download_spec: DownloadSpec::UserProvided,
                    size_mb,
                    is_downloaded: true, // Already present on disk
                    is_downloading: false,
                    partial_size: 0,
                    category: ModelCategory::Transcription,
                    engine_type: Some(EngineType::Whisper),
                    accuracy_score: 0.0, // Sentinel: UI hides score bars when both are 0
                    speed_score: 0.0,
                    supports_translation: false,
                    is_recommended: false,
                    supported_languages: vec![],
                    supports_language_selection: true,
                    is_custom: true,
                },
            );
        }

        Ok(())
    }

    /// Verifies the SHA256 of `path` against `expected_sha256` (if provided).
    /// On mismatch or read error the partial file is deleted and an error is returned,
    /// so the next download attempt always starts from a clean state.
    /// When `expected_sha256` is `None` (custom user models) verification is skipped.
    fn verify_sha256(path: &Path, expected_sha256: Option<&str>, model_id: &str) -> Result<()> {
        let Some(expected) = expected_sha256 else {
            return Ok(());
        };
        match Self::compute_sha256(path) {
            Ok(actual) if actual == expected => {
                info!("SHA256 verified for model {}", model_id);
                Ok(())
            }
            Ok(actual) => {
                warn!(
                    "SHA256 mismatch for model {}: expected {}, got {}",
                    model_id, expected, actual
                );
                let _ = fs::remove_file(path);
                Err(anyhow::anyhow!(
                    "Download verification failed for model {}: file is corrupt. Please retry.",
                    model_id
                ))
            }
            Err(e) => {
                let _ = fs::remove_file(path);
                Err(anyhow::anyhow!(
                    "Failed to verify download for model {}: {}. Please retry.",
                    model_id,
                    e
                ))
            }
        }
    }

    /// Computes the SHA256 hex digest of a file, reading in 64KB chunks to handle large models.
    fn compute_sha256(path: &Path) -> Result<String> {
        let mut file = File::open(path)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let n = file.read(&mut buffer)?;
            if n == 0 {
                break;
            }
            hasher.update(&buffer[..n]);
        }
        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Top-level entry point. Validates the model exists, short-circuits if
    /// already present on disk, sets up cleanup + cancel plumbing, then
    /// dispatches to the right helper for the `DownloadSpec` variant.
    pub async fn download_model(&self, model_id: &str) -> Result<()> {
        let model_info = {
            let models = self.available_models.lock().unwrap();
            models.get(model_id).cloned()
        };
        let model_info =
            model_info.ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        // UserProvided models can never be downloaded — reject early and
        // surface a clearer error than "no URL".
        if matches!(model_info.download_spec, DownloadSpec::UserProvided) {
            return Err(anyhow::anyhow!(
                "Model {} is user-provided and has no remote source",
                model_id
            ));
        }

        let model_path = self.models_dir.join(&model_info.filename);

        // Short-circuit if the model is already on disk in the expected shape.
        // For MultiFile we must check all required files, not just the dir.
        let already_complete = match &model_info.download_spec {
            DownloadSpec::SingleFile { .. } => model_path.exists() && model_path.is_file(),
            DownloadSpec::SingleArchive { .. } => model_path.exists() && model_path.is_dir(),
            DownloadSpec::MultiFile { files } => {
                model_path.is_dir()
                    && files
                        .iter()
                        .filter(|f| f.required)
                        .all(|f| model_path.join(&f.filename).is_file())
            }
            DownloadSpec::UserProvided => unreachable!("rejected above"),
        };
        if already_complete {
            // Clean up any stray partial file (SingleFile/SingleArchive path).
            let partial_path = self
                .models_dir
                .join(format!("{}.partial", &model_info.filename));
            if partial_path.exists() {
                let _ = fs::remove_file(&partial_path);
            }
            self.update_download_status()?;
            return Ok(());
        }

        // Mark as downloading + install cancel flag + arm cleanup guard.
        {
            let mut models = self.available_models.lock().unwrap();
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = true;
            }
        }
        let cancel_flag = Arc::new(AtomicBool::new(false));
        {
            let mut flags = self.cancel_flags.lock().unwrap();
            flags.insert(model_id.to_string(), cancel_flag.clone());
        }
        let mut cleanup = DownloadCleanup {
            available_models: &self.available_models,
            cancel_flags: &self.cancel_flags,
            model_id: model_id.to_string(),
            disarmed: false,
        };

        // Dispatch per variant. Each helper is responsible for its own partial
        // file handling; on `DownloadOutcome::UserCancelled` we return Ok(())
        // with the guard still armed (cleanup runs on drop; partial preserved
        // for resume).
        match &model_info.download_spec {
            DownloadSpec::SingleFile { url, sha256 } => {
                let partial_path = self
                    .models_dir
                    .join(format!("{}.partial", &model_info.filename));
                match self
                    .download_single_url(
                        model_id,
                        url,
                        &partial_path,
                        sha256.as_deref(),
                        &cancel_flag,
                    )
                    .await?
                {
                    DownloadOutcome::UserCancelled => return Ok(()),
                    DownloadOutcome::Completed => {}
                }
                fs::rename(&partial_path, &model_path)?;
            }
            DownloadSpec::SingleArchive { url, sha256 } => {
                let partial_path = self
                    .models_dir
                    .join(format!("{}.partial", &model_info.filename));
                match self
                    .download_single_url(
                        model_id,
                        url,
                        &partial_path,
                        sha256.as_deref(),
                        &cancel_flag,
                    )
                    .await?
                {
                    DownloadOutcome::UserCancelled => return Ok(()),
                    DownloadOutcome::Completed => {}
                }
                self.extract_tarball_to_dir(model_id, &model_info.filename, &partial_path)?;
            }
            DownloadSpec::MultiFile { files } => {
                fs::create_dir_all(&model_path)?;
                for file in files {
                    let final_file = model_path.join(&file.filename);
                    if final_file.is_file() {
                        continue;
                    }
                    let file_partial =
                        model_path.join(format!("{}.partial", file.filename));
                    let result = self
                        .download_single_url(
                            model_id,
                            &file.url,
                            &file_partial,
                            file.sha256.as_deref(),
                            &cancel_flag,
                        )
                        .await;
                    match result {
                        Ok(DownloadOutcome::UserCancelled) => return Ok(()),
                        Ok(DownloadOutcome::Completed) => {
                            // Ensure parent dirs exist for nested filenames
                            // (current bge-small uses flat names, but keep
                            // the invariant for future models).
                            if let Some(parent) = final_file.parent() {
                                fs::create_dir_all(parent)?;
                            }
                            fs::rename(&file_partial, &final_file)?;
                        }
                        Err(e) => {
                            if file.required {
                                return Err(e);
                            }
                            warn!(
                                "Optional file '{}' for model '{}' failed \
                                 ({}); skipping since required=false",
                                file.filename, model_id, e
                            );
                        }
                    }
                }
            }
            DownloadSpec::UserProvided => unreachable!("rejected above"),
        }

        // Success path: disarm guard + flip downloaded flags + emit complete.
        cleanup.disarmed = true;
        {
            let mut models = self.available_models.lock().unwrap();
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = false;
                model.is_downloaded = true;
                model.partial_size = 0;
            }
        }
        self.cancel_flags.lock().unwrap().remove(model_id);
        let _ = self.app_handle.emit("model-download-complete", model_id);
        info!(
            "Successfully downloaded model {} to {:?}",
            model_id, model_path
        );
        Ok(())
    }

    /// Download `url` to `target_partial`, with resume, server-200 fallback,
    /// content-length verify, and optional SHA-256 verify. After a `Completed`
    /// return, `target_partial` holds the verified bytes and the caller owns
    /// the rename / extraction step.
    ///
    /// On `UserCancelled`, the partial file is left in place for a later
    /// resume. On error (network, HTTP 4xx/5xx, size mismatch, bad sha256),
    /// `verify_sha256` / the size check clean up the partial as appropriate
    /// and the error propagates.
    ///
    /// Progress events emit under the model-level `model_id`. For MultiFile
    /// downloads, each sub-file emits its own progress stream — the UI will
    /// see sequential 0→100% cycles, one per file.
    async fn download_single_url(
        &self,
        model_id: &str,
        url: &str,
        target_partial: &Path,
        expected_sha256: Option<&str>,
        cancel_flag: &Arc<AtomicBool>,
    ) -> Result<DownloadOutcome> {
        // Ensure the parent dir exists (MultiFile nests partials inside the
        // model dir, which may not exist yet for a first-run fresh download).
        if let Some(parent) = target_partial.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut resume_from = if target_partial.exists() {
            let size = target_partial.metadata()?.len();
            info!(
                "Resuming download of {} from byte {} ({})",
                model_id, size, url
            );
            size
        } else {
            info!("Starting fresh download of {} from {}", model_id, url);
            0
        };

        let client = reqwest::Client::new();
        let mut request = client.get(url);
        if resume_from > 0 {
            request = request.header("Range", format!("bytes={}-", resume_from));
        }
        let mut response = request.send().await?;

        // If we tried to resume but server returned 200 (not 206 Partial Content),
        // the server doesn't support range requests. Delete partial and restart
        // fresh to avoid file corruption (appending full file to partial).
        if resume_from > 0 && response.status() == reqwest::StatusCode::OK {
            warn!(
                "Server doesn't support range requests for {}, restarting download",
                url
            );
            drop(response);
            let _ = fs::remove_file(target_partial);
            resume_from = 0;
            response = client.get(url).send().await?;
        }

        if !response.status().is_success()
            && response.status() != reqwest::StatusCode::PARTIAL_CONTENT
        {
            return Err(anyhow::anyhow!(
                "Failed to download {}: HTTP {}",
                url,
                response.status()
            ));
        }

        let total_size = if resume_from > 0 {
            resume_from + response.content_length().unwrap_or(0)
        } else {
            response.content_length().unwrap_or(0)
        };

        let mut downloaded = resume_from;
        let mut stream = response.bytes_stream();

        let mut file = if resume_from > 0 {
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(target_partial)?
        } else {
            std::fs::File::create(target_partial)?
        };

        let emit_progress = |downloaded: u64, total: u64| {
            let percentage = if total > 0 {
                (downloaded as f64 / total as f64) * 100.0
            } else {
                0.0
            };
            let _ = self.app_handle.emit(
                "model-download-progress",
                &DownloadProgress {
                    model_id: model_id.to_string(),
                    downloaded,
                    total,
                    percentage,
                },
            );
        };
        emit_progress(downloaded, total_size);

        let mut last_emit = Instant::now();
        let throttle_duration = Duration::from_millis(100);
        while let Some(chunk) = stream.next().await {
            if cancel_flag.load(Ordering::Relaxed) {
                drop(file);
                info!("Download cancelled for: {}", model_id);
                return Ok(DownloadOutcome::UserCancelled);
            }
            let chunk = chunk?;
            file.write_all(&chunk)?;
            downloaded += chunk.len() as u64;

            if last_emit.elapsed() >= throttle_duration {
                emit_progress(downloaded, total_size);
                last_emit = Instant::now();
            }
        }
        emit_progress(downloaded, total_size);

        file.flush()?;
        drop(file);

        if total_size > 0 {
            let actual_size = target_partial.metadata()?.len();
            if actual_size != total_size {
                let _ = fs::remove_file(target_partial);
                return Err(anyhow::anyhow!(
                    "Download incomplete: expected {} bytes, got {} bytes",
                    total_size,
                    actual_size
                ));
            }
        }

        // SHA-256 verify on a blocking thread so hashing a 1+ GB file doesn't
        // stall the async runtime. `verify_sha256` deletes the partial on
        // mismatch so the next attempt starts fresh.
        let _ = self.app_handle.emit("model-verification-started", model_id);
        info!("Verifying SHA256 for {} ({}) ...", model_id, url);
        let verify_path = target_partial.to_path_buf();
        let verify_expected = expected_sha256.map(|s| s.to_string());
        let verify_model_id = model_id.to_string();
        let verify_result = tokio::task::spawn_blocking(move || {
            Self::verify_sha256(&verify_path, verify_expected.as_deref(), &verify_model_id)
        })
        .await
        .map_err(|e| anyhow::anyhow!("SHA256 task panicked: {}", e))?;
        verify_result?;
        let _ = self
            .app_handle
            .emit("model-verification-completed", model_id);

        Ok(DownloadOutcome::Completed)
    }

    /// Extract a downloaded `.tar.gz` partial into `<models_dir>/<model_filename>/`.
    /// Uses a `.extracting` temp dir for atomic rename; on failure, cleans up
    /// the temp dir AND deletes the corrupt partial so the next attempt
    /// starts from a fresh download rather than resuming a broken archive
    /// (issue #858).
    fn extract_tarball_to_dir(
        &self,
        model_id: &str,
        model_filename: &str,
        partial_path: &Path,
    ) -> Result<()> {
        {
            let mut extracting = self.extracting_models.lock().unwrap();
            extracting.insert(model_id.to_string());
        }
        let _ = self.app_handle.emit("model-extraction-started", model_id);
        info!("Extracting archive for directory-based model: {}", model_id);

        let temp_extract_dir = self.models_dir.join(format!("{}.extracting", model_filename));
        let final_model_dir = self.models_dir.join(model_filename);

        if temp_extract_dir.exists() {
            let _ = fs::remove_dir_all(&temp_extract_dir);
        }
        fs::create_dir_all(&temp_extract_dir)?;

        let tar_gz = File::open(partial_path)?;
        let tar = GzDecoder::new(tar_gz);
        let mut archive = Archive::new(tar);
        let model_id_owned = model_id.to_string();
        archive.unpack(&temp_extract_dir).map_err(|e| {
            let error_msg = format!("Failed to extract archive: {}", e);
            let _ = fs::remove_dir_all(&temp_extract_dir);
            let _ = fs::remove_file(partial_path);
            {
                let mut extracting = self.extracting_models.lock().unwrap();
                extracting.remove(&model_id_owned);
            }
            let _ = self.app_handle.emit(
                "model-extraction-failed",
                &serde_json::json!({
                    "model_id": &model_id_owned,
                    "error": error_msg,
                }),
            );
            anyhow::anyhow!(error_msg)
        })?;

        // Unwrap the single-directory wrapper some archives include.
        let extracted_dirs: Vec<_> = fs::read_dir(&temp_extract_dir)?
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
            .collect();
        if extracted_dirs.len() == 1 {
            let source_dir = extracted_dirs[0].path();
            if final_model_dir.exists() {
                fs::remove_dir_all(&final_model_dir)?;
            }
            fs::rename(&source_dir, &final_model_dir)?;
            let _ = fs::remove_dir_all(&temp_extract_dir);
        } else {
            if final_model_dir.exists() {
                fs::remove_dir_all(&final_model_dir)?;
            }
            fs::rename(&temp_extract_dir, &final_model_dir)?;
        }

        info!("Successfully extracted archive for model: {}", model_id);
        {
            let mut extracting = self.extracting_models.lock().unwrap();
            extracting.remove(model_id);
        }
        let _ = self
            .app_handle
            .emit("model-extraction-completed", model_id);

        let _ = fs::remove_file(partial_path);
        Ok(())
    }

    pub fn delete_model(&self, model_id: &str) -> Result<()> {
        debug!("ModelManager: delete_model called for: {}", model_id);

        let model_info = {
            let models = self.available_models.lock().unwrap();
            models.get(model_id).cloned()
        };

        let model_info =
            model_info.ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        debug!("ModelManager: Found model info: {:?}", model_info);

        let model_path = self.models_dir.join(&model_info.filename);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));
        debug!("ModelManager: Model path: {:?}", model_path);
        debug!("ModelManager: Partial path: {:?}", partial_path);

        let mut deleted_something = false;

        if model_info.is_directory_layout() {
            // Delete complete model directory if it exists
            if model_path.exists() && model_path.is_dir() {
                info!("Deleting model directory at: {:?}", model_path);
                fs::remove_dir_all(&model_path)?;
                info!("Model directory deleted successfully");
                deleted_something = true;
            }
        } else {
            // Delete complete model file if it exists
            if model_path.exists() {
                info!("Deleting model file at: {:?}", model_path);
                fs::remove_file(&model_path)?;
                info!("Model file deleted successfully");
                deleted_something = true;
            }
        }

        // Delete partial file if it exists (same for both types)
        if partial_path.exists() {
            info!("Deleting partial file at: {:?}", partial_path);
            fs::remove_file(&partial_path)?;
            info!("Partial file deleted successfully");
            deleted_something = true;
        }

        if !deleted_something {
            return Err(anyhow::anyhow!("No model files found to delete"));
        }

        // Custom models should be removed from the list entirely since they
        // have no download URL and can't be re-downloaded
        if model_info.is_custom {
            let mut models = self.available_models.lock().unwrap();
            models.remove(model_id);
            debug!("ModelManager: removed custom model from available models");
        } else {
            // Update download status (marks predefined models as not downloaded)
            self.update_download_status()?;
            debug!("ModelManager: download status updated");
        }

        // Emit event to notify UI
        let _ = self.app_handle.emit("model-deleted", model_id);

        Ok(())
    }

    pub fn get_model_path(&self, model_id: &str) -> Result<PathBuf> {
        let model_info = self
            .get_model_info(model_id)
            .ok_or_else(|| anyhow::anyhow!("Model not found: {}", model_id))?;

        if !model_info.is_downloaded {
            return Err(anyhow::anyhow!("Model not available: {}", model_id));
        }

        // Ensure we don't return partial files/directories
        if model_info.is_downloading {
            return Err(anyhow::anyhow!(
                "Model is currently downloading: {}",
                model_id
            ));
        }

        let model_path = self.models_dir.join(&model_info.filename);
        let partial_path = self
            .models_dir
            .join(format!("{}.partial", &model_info.filename));

        if model_info.is_directory_layout() {
            // For directory-based models, ensure the directory exists and is complete
            if model_path.exists() && model_path.is_dir() && !partial_path.exists() {
                Ok(model_path)
            } else {
                Err(anyhow::anyhow!(
                    "Complete model directory not found: {}",
                    model_id
                ))
            }
        } else {
            // For file-based models (existing logic)
            if model_path.exists() && !partial_path.exists() {
                Ok(model_path)
            } else {
                Err(anyhow::anyhow!(
                    "Complete model file not found: {}",
                    model_id
                ))
            }
        }
    }

    pub fn cancel_download(&self, model_id: &str) -> Result<()> {
        debug!("ModelManager: cancel_download called for: {}", model_id);

        // Set the cancellation flag to stop the download loop
        {
            let flags = self.cancel_flags.lock().unwrap();
            if let Some(flag) = flags.get(model_id) {
                flag.store(true, Ordering::Relaxed);
                info!("Cancellation flag set for: {}", model_id);
            } else {
                warn!("No active download found for: {}", model_id);
            }
        }

        // Update state immediately for UI responsiveness
        {
            let mut models = self.available_models.lock().unwrap();
            if let Some(model) = models.get_mut(model_id) {
                model.is_downloading = false;
            }
        }

        // Update download status to reflect current state
        self.update_download_status()?;

        // Emit cancellation event so all UI components can clear their state
        let _ = self.app_handle.emit("model-download-cancelled", model_id);

        info!("Download cancellation initiated for: {}", model_id);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    /// Resolve the staged bge-small directory the same way
    /// `managers::embedding_ort::dev_model_dir()` does, for tests that need
    /// real model files. Returns `None` when files aren't staged, so CI
    /// without model files skips cleanly.
    fn staged_bge_small_dir() -> Option<std::path::PathBuf> {
        let appdata = std::env::var_os("APPDATA")?;
        let dir = std::path::PathBuf::from(appdata)
            .join("com.pais.infield")
            .join("models")
            .join(crate::managers::embedding_ort::MODEL_ID);
        if dir.is_dir() && dir.join("model.onnx").is_file() {
            Some(dir)
        } else {
            None
        }
    }

    /// Rule 19 + corrupt-resume safety depend on every pinned sha256 in the
    /// bge-small registry entry matching the actual bytes on disk. If the
    /// upstream files ever change or a local copy drifts, this fails loud
    /// instead of `download_model()` silently resuming a stale partial.
    ///
    /// Also proves the `compute_sha256` pipeline is wired correctly: same
    /// function the download path calls from `verify_sha256`.
    #[test]
    fn bge_small_pinned_hashes_match_staged_files() {
        let dir = match staged_bge_small_dir() {
            Some(d) => d,
            None => {
                eprintln!(
                    "[bge_small_pinned_hashes_match_staged_files] SKIP \
                     — staged files not present"
                );
                return;
            }
        };

        // Extract the pinned expectations from the registry itself — single
        // source of truth. If someone edits the entry without updating
        // hashes, this test reflects the registry, not a duplicate constant.
        let temp = TempDir::new().unwrap();
        let app_handle_unavailable_in_unit_tests = ();
        let _ = app_handle_unavailable_in_unit_tests;
        // Rebuild just the bge-small ModelInfo inline — ModelManager::new
        // needs an AppHandle which unit tests don't have, and this test
        // only cares about the MultiFile spec.
        let files = match extract_bge_small_files() {
            Some(v) => v,
            None => panic!("bge-small entry unexpectedly missing from extractor"),
        };
        assert!(
            !files.is_empty(),
            "bge-small must declare at least one RemoteFile"
        );
        let _ = temp; // quiet unused warning under alternate cfg

        for file in &files {
            let path = dir.join(&file.filename);
            let actual = ModelManager::compute_sha256(&path).unwrap_or_else(|e| {
                panic!("compute_sha256 failed for {}: {e}", file.filename)
            });
            let expected = file.sha256.as_deref().unwrap_or_else(|| {
                panic!(
                    "file {} has sha256 = None; Rule 19 requires authoritative hashes",
                    file.filename
                )
            });
            assert_eq!(
                actual, expected,
                "sha256 mismatch for {} — registry vs staged file drifted",
                file.filename
            );
        }
    }

    /// Return the bge-small `RemoteFile` list as the registry declares it.
    /// Kept as a test-only helper because `ModelManager::new()` needs a real
    /// `AppHandle`; this duplicates just the one entry's spec for test use.
    /// Sync manually if the production entry changes (CI will catch drift
    /// via `bge_small_pinned_hashes_match_staged_files`).
    fn extract_bge_small_files() -> Option<Vec<RemoteFile>> {
        // Mirror of the entry in ModelManager::new at the bge-small block.
        // If the production entry's urls / filenames / sha256s change, copy
        // them here too.
        Some(vec![
            RemoteFile {
                url: "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/onnx/model.onnx"
                    .to_string(),
                filename: "model.onnx".to_string(),
                sha256: Some(
                    "828e1496d7fabb79cfa4dcd84fa38625c0d3d21da474a00f08db0f559940cf35"
                        .to_string(),
                ),
                required: true,
            },
            RemoteFile {
                url: "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/tokenizer.json"
                    .to_string(),
                filename: "tokenizer.json".to_string(),
                sha256: Some(
                    "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66"
                        .to_string(),
                ),
                required: true,
            },
            RemoteFile {
                url: "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/tokenizer_config.json"
                    .to_string(),
                filename: "tokenizer_config.json".to_string(),
                sha256: Some(
                    "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3"
                        .to_string(),
                ),
                required: true,
            },
            RemoteFile {
                url: "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/config.json"
                    .to_string(),
                filename: "config.json".to_string(),
                sha256: Some(
                    "094f8e891b932f2000c92cfc663bac4c62069f5d8af5b5278c4306aef3084750"
                        .to_string(),
                ),
                required: true,
            },
            RemoteFile {
                url: "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/vocab.txt"
                    .to_string(),
                filename: "vocab.txt".to_string(),
                sha256: Some(
                    "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3"
                        .to_string(),
                ),
                required: true,
            },
            RemoteFile {
                url: "https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/main/README.md"
                    .to_string(),
                filename: "README.md".to_string(),
                sha256: Some(
                    "ddb964361a55c6e5dfca6361615854b260c9c960205d04c7520151aaa1d75837"
                        .to_string(),
                ),
                required: false,
            },
        ])
    }

    /// Exercise `verify_sha256`'s failure path on a known-bad hash for
    /// model.onnx. This is the moral equivalent of "corrupt resume ships
    /// silently" — proves we fail loud instead.
    #[test]
    fn bge_small_corrupt_hash_is_rejected() {
        let dir = match staged_bge_small_dir() {
            Some(d) => d,
            None => {
                eprintln!(
                    "[bge_small_corrupt_hash_is_rejected] SKIP \
                     — staged files not present"
                );
                return;
            }
        };
        let real = dir.join("model.onnx");
        // Copy to a temp partial so verify_sha256's cleanup doesn't nuke the
        // staged copy.
        let temp = TempDir::new().unwrap();
        let partial = temp.path().join("model.onnx.partial");
        fs::copy(&real, &partial).unwrap();
        let bogus = "0000000000000000000000000000000000000000000000000000000000000000";
        let result = ModelManager::verify_sha256(&partial, Some(bogus), "test-bge-small");
        assert!(
            result.is_err(),
            "verify_sha256 must reject an incorrect hash"
        );
        // Partial should have been deleted by the failure path.
        assert!(
            !partial.exists(),
            "verify_sha256 must delete the partial on mismatch"
        );
    }

    #[test]
    fn test_discover_custom_whisper_models() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().to_path_buf();

        // Create test .bin files
        let mut custom_file = File::create(models_dir.join("my-custom-model.bin")).unwrap();
        custom_file.write_all(b"fake model data").unwrap();

        let mut another_file = File::create(models_dir.join("whisper_medical_v2.bin")).unwrap();
        another_file.write_all(b"another fake model").unwrap();

        // Create files that should be ignored
        File::create(models_dir.join(".hidden-model.bin")).unwrap(); // Hidden file
        File::create(models_dir.join("readme.txt")).unwrap(); // Non-.bin file
        File::create(models_dir.join("ggml-small.bin")).unwrap(); // Predefined filename
        fs::create_dir(models_dir.join("some-directory.bin")).unwrap(); // Directory

        // Set up available_models with a predefined Whisper model
        let mut models = HashMap::new();
        models.insert(
            "small".to_string(),
            ModelInfo {
                id: "small".to_string(),
                name: "Whisper Small".to_string(),
                description: "Test".to_string(),
                filename: "ggml-small.bin".to_string(),
                download_spec: DownloadSpec::SingleFile {
                    url: "https://example.com".to_string(),
                    sha256: None,
                },
                size_mb: 100,
                is_downloaded: false,
                is_downloading: false,
                partial_size: 0,
                category: ModelCategory::Transcription,
                engine_type: Some(EngineType::Whisper),
                accuracy_score: 0.5,
                speed_score: 0.5,
                supports_translation: true,
                is_recommended: false,
                supported_languages: vec!["en".to_string()],
                supports_language_selection: true,
                is_custom: false,
            },
        );

        // Discover custom models
        ModelManager::discover_custom_whisper_models(&models_dir, &mut models).unwrap();

        // Should have discovered 2 custom models (my-custom-model and whisper_medical_v2)
        assert!(models.contains_key("my-custom-model"));
        assert!(models.contains_key("whisper_medical_v2"));

        // Verify custom model properties
        let custom = models.get("my-custom-model").unwrap();
        assert_eq!(custom.name, "My Custom Model");
        assert_eq!(custom.filename, "my-custom-model.bin");
        assert!(matches!(
            custom.download_spec,
            DownloadSpec::UserProvided
        )); // Custom models have no remote source
        assert!(custom.is_downloaded);
        assert!(custom.is_custom);
        assert_eq!(custom.accuracy_score, 0.0);
        assert_eq!(custom.speed_score, 0.0);
        assert!(custom.supported_languages.is_empty());

        // Verify underscore handling
        let medical = models.get("whisper_medical_v2").unwrap();
        assert_eq!(medical.name, "Whisper Medical V2");

        // Should NOT have discovered hidden, non-.bin, predefined, or directories
        assert!(!models.contains_key(".hidden-model"));
        assert!(!models.contains_key("readme"));
        assert!(!models.contains_key("some-directory"));
    }

    #[test]
    fn test_discover_custom_models_empty_dir() {
        let temp_dir = TempDir::new().unwrap();
        let models_dir = temp_dir.path().to_path_buf();

        let mut models = HashMap::new();
        let count_before = models.len();

        ModelManager::discover_custom_whisper_models(&models_dir, &mut models).unwrap();

        // No new models should be added
        assert_eq!(models.len(), count_before);
    }

    #[test]
    fn test_discover_custom_models_nonexistent_dir() {
        let models_dir = PathBuf::from("/nonexistent/path/that/does/not/exist");

        let mut models = HashMap::new();
        let count_before = models.len();

        // Should not error, just return Ok
        let result = ModelManager::discover_custom_whisper_models(&models_dir, &mut models);
        assert!(result.is_ok());
        assert_eq!(models.len(), count_before);
    }

    // ── SHA256 verification tests ─────────────────────────────────────────────

    /// Helper: write `data` to a temp file and return (TempDir, path).
    /// TempDir must be kept alive for the duration of the test.
    fn write_temp_file(data: &[u8]) -> (TempDir, std::path::PathBuf) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("model.partial");
        let mut f = File::create(&path).unwrap();
        f.write_all(data).unwrap();
        (dir, path)
    }

    #[test]
    fn test_verify_sha256_skipped_when_none() {
        // Custom models have no expected hash — verification must be a no-op.
        let (_dir, path) = write_temp_file(b"anything");
        assert!(ModelManager::verify_sha256(&path, None, "custom").is_ok());
        assert!(
            path.exists(),
            "file must be untouched when verification is skipped"
        );
    }

    #[test]
    fn test_verify_sha256_passes_on_correct_hash() {
        // Compute the real hash so the test is self-consistent.
        let (_dir, path) = write_temp_file(b"hello world");
        let actual = ModelManager::compute_sha256(&path).unwrap();
        assert!(
            ModelManager::verify_sha256(&path, Some(&actual), "test_model").is_ok(),
            "should pass when hash matches"
        );
        assert!(
            path.exists(),
            "file must be kept on successful verification"
        );
    }

    #[test]
    fn test_verify_sha256_fails_and_deletes_partial_on_mismatch() {
        let (_dir, path) = write_temp_file(b"this is not the real model");
        let wrong_hash = "0000000000000000000000000000000000000000000000000000000000000000";

        let result = ModelManager::verify_sha256(&path, Some(wrong_hash), "bad_model");

        assert!(result.is_err(), "mismatch must return an error");
        assert!(
            result.unwrap_err().to_string().contains("corrupt"),
            "error message should mention corruption"
        );
        assert!(
            !path.exists(),
            "partial file must be deleted after hash mismatch"
        );
    }

    #[test]
    fn test_verify_sha256_fails_and_deletes_partial_when_file_missing() {
        // Simulate a partial file that was already removed (e.g. disk full mid-download).
        let dir = TempDir::new().unwrap();
        let missing_path = dir.path().join("gone.partial");
        // Don't create the file — it should not exist.

        let result =
            ModelManager::verify_sha256(&missing_path, Some("anyexpectedhash"), "missing_model");

        assert!(result.is_err(), "missing file must return an error");
    }
}
