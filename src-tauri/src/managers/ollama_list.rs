//! List vision-capable models from a local Ollama daemon (native HTTP API, not OpenAI-compatible).

use reqwest::Client;
use serde::Deserialize;

/// Strip `/v1` from an OpenAI-compatible base URL to get the Ollama root (e.g. `http://localhost:11434`).
pub fn openai_base_url_to_ollama_origin(base: &str) -> String {
    let t = base.trim().trim_end_matches('/');
    t.strip_suffix("/v1")
        .unwrap_or(t)
        .trim_end_matches('/')
        .to_string()
}

#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Vec<TagModel>,
}

#[derive(Debug, Deserialize)]
struct TagModel {
    name: String,
    #[serde(default)]
    details: Option<TagDetails>,
}

#[derive(Debug, Deserialize)]
struct TagDetails {
    #[serde(default)]
    families: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct ShowResponse {
    #[serde(default)]
    capabilities: Option<Vec<String>>,
    #[serde(default)]
    details: Option<TagDetails>,
}

fn name_suggests_vision(name: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("llava")
        || n.contains("vision")
        || n.contains("vl-")
        || n.contains("-vl")
        || n.contains("moondream")
        || n.contains("bakllava")
        || n.contains("pixtral")
        || n.contains("minicpm-v")
}

fn families_suggest_vision(details: &Option<TagDetails>) -> bool {
    details
        .as_ref()
        .and_then(|d| d.families.as_ref())
        .map(|fams| fams.iter().any(|f| f.to_lowercase().contains("clip")))
        .unwrap_or(false)
}

fn capabilities_include_vision(cap: &[String]) -> bool {
    cap.iter().any(|c| c.eq_ignore_ascii_case("vision"))
}

/// Returns installed models that appear to support vision, best-effort across Ollama versions.
pub async fn list_ollama_vision_model_names(openai_compatible_base_url: &str) -> Result<Vec<String>, String> {
    let origin = openai_base_url_to_ollama_origin(openai_compatible_base_url);
    if origin.is_empty() {
        return Err("Base URL is empty.".to_string());
    }

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let tags_url = format!("{}/api/tags", origin);
    let tags_resp = client
        .get(&tags_url)
        .send()
        .await
        .map_err(|e| format!("GET {} failed: {}", tags_url, e))?;

    if !tags_resp.status().is_success() {
        return Err(format!(
            "Ollama returned HTTP {} from /api/tags. Is Ollama running at {}?",
            tags_resp.status(),
            origin
        ));
    }

    let tags: TagsResponse = tags_resp.json().await.map_err(|e| e.to_string())?;

    let mut vision: Vec<String> = Vec::new();

    for m in tags.models {
        let name = m.name.clone();
        let show_url = format!("{}/api/show", origin);
        let show_body = serde_json::json!({ "name": &name });

        let mut is_vision = name_suggests_vision(&name) || families_suggest_vision(&m.details);

        match client.post(&show_url).json(&show_body).send().await {
            Ok(resp) if resp.status().is_success() => {
                if let Ok(show) = resp.json::<ShowResponse>().await {
                    if let Some(cap) = show.capabilities.as_ref() {
                        if capabilities_include_vision(cap) {
                            is_vision = true;
                        }
                    }
                    if !is_vision {
                        is_vision = families_suggest_vision(&show.details);
                    }
                }
            }
            Ok(resp) => {
                log::debug!(
                    "Ollama /api/show for {} returned HTTP {}; using heuristics only",
                    name,
                    resp.status()
                );
            }
            Err(e) => {
                log::debug!("Ollama /api/show for {} failed: {}; using heuristics only", name, e);
            }
        }

        if is_vision {
            vision.push(name);
        }
    }

    vision.sort();
    vision.dedup();
    Ok(vision)
}
