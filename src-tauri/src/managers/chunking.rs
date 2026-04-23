use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct ChunkPipeline {
    max_chars: usize,
    overlap_chars: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct Chunk {
    pub chunk_id: String,
    pub note_id: String,
    pub chunk_index: usize,
    pub text: String,
    pub char_start: usize,
    pub char_end: usize,
}

impl Default for ChunkPipeline {
    fn default() -> Self {
        Self {
            max_chars: 2_000,
            overlap_chars: 400,
        }
    }
}

impl ChunkPipeline {
    pub fn new(max_chars: usize, overlap_chars: usize) -> Self {
        Self {
            max_chars: max_chars.max(1),
            overlap_chars: overlap_chars.min(max_chars.saturating_sub(1)),
        }
    }

    pub fn chunk_text(&self, note_id: &str, text: &str) -> Vec<Chunk> {
        let extracted_text = extract_indexable_text(text);
        let trimmed = extracted_text.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let normalized = trimmed.replace("\r\n", "\n");
        let chars: Vec<char> = normalized.chars().collect();
        let total_chars = chars.len();

        if total_chars <= self.max_chars {
            return vec![Chunk {
                chunk_id: Uuid::new_v4().to_string(),
                note_id: note_id.to_string(),
                chunk_index: 0,
                text: normalized,
                char_start: 0,
                char_end: total_chars,
            }];
        }

        let step = (self.max_chars - self.overlap_chars).max(1);
        let mut chunks = Vec::new();
        let mut start = 0usize;
        let mut chunk_index = 0usize;

        while start < total_chars {
            let mut end = (start + self.max_chars).min(total_chars);

            if end < total_chars {
                for cursor in (start + step..end).rev() {
                    if chars[cursor].is_whitespace() {
                        end = cursor;
                        break;
                    }
                }
            }

            if end <= start {
                end = (start + self.max_chars).min(total_chars);
            }

            let chunk_text: String = chars[start..end].iter().collect();
            let chunk_text = chunk_text.trim().to_string();

            if !chunk_text.is_empty() {
                chunks.push(Chunk {
                    chunk_id: Uuid::new_v4().to_string(),
                    note_id: note_id.to_string(),
                    chunk_index,
                    text: chunk_text,
                    char_start: start,
                    char_end: end,
                });
                chunk_index += 1;
            }

            if end >= total_chars {
                break;
            }

            start = end.saturating_sub(self.overlap_chars);
        }

        chunks
    }
}

fn extract_indexable_text(content: &str) -> String {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => {
            let extracted = extract_json_document_tree_text(&value);
            if extracted.trim().is_empty() {
                trimmed.to_string()
            } else {
                extracted
            }
        }
        Err(_) => trimmed.to_string(),
    }
}

/// Plain text from a JSON array of blocks shaped like legacy rich-editor exports (paragraph + inline `text` nodes).
fn extract_json_document_tree_text(value: &Value) -> String {
    let Some(blocks) = value.as_array() else {
        return String::new();
    };

    let mut lines = Vec::new();
    for block in blocks {
        collect_block_text(block, &mut lines);
    }

    lines.join("\n")
}

fn collect_block_text(block: &Value, lines: &mut Vec<String>) {
    let Some(object) = block.as_object() else {
        return;
    };

    if let Some(content) = object.get("content") {
        match content {
            Value::String(text) => {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    lines.push(trimmed.to_string());
                }
            }
            Value::Array(inline_items) => {
                let text = inline_items
                    .iter()
                    .map(extract_inline_text)
                    .collect::<String>()
                    .trim()
                    .to_string();
                if !text.is_empty() {
                    lines.push(text);
                }
            }
            _ => {}
        }
    }

    if let Some(children) = object.get("children").and_then(Value::as_array) {
        for child in children {
            collect_block_text(child, lines);
        }
    }
}

fn extract_inline_text(value: &Value) -> String {
    let Some(object) = value.as_object() else {
        return String::new();
    };

    if object.get("type").and_then(Value::as_str) == Some("text") {
        return object
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
    }

    if let Some(content) = object.get("content").and_then(Value::as_array) {
        return content.iter().map(extract_inline_text).collect();
    }

    String::new()
}

#[cfg(test)]
mod tests {
    use super::ChunkPipeline;
    use serde_json::json;

    #[test]
    fn chunk_pipeline_returns_single_chunk_for_short_text() {
        let pipeline = ChunkPipeline::default();
        let chunks = pipeline.chunk_text("note-1", "short note");

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "short note");
    }

    #[test]
    fn chunk_pipeline_applies_overlap() {
        let pipeline = ChunkPipeline::new(10, 4);
        let input = "abcdefghij klmnopqrst uvwxyz";
        let chunks = pipeline.chunk_text("note-1", input);

        assert!(chunks.len() >= 2);
        assert!(chunks[0].char_end > chunks[1].char_start);
    }

    #[test]
    fn chunk_pipeline_extracts_json_paragraph_text() {
        let pipeline = ChunkPipeline::default();
        let content = json!([
            {
                "type": "paragraph",
                "content": [
                    { "type": "text", "text": "hello " },
                    { "type": "text", "text": "world" }
                ]
            }
        ])
        .to_string();

        let chunks = pipeline.chunk_text("note-1", &content);

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "hello world");
    }

    #[test]
    fn chunk_pipeline_falls_back_to_raw_text_for_non_json_content() {
        let pipeline = ChunkPipeline::default();
        let chunks = pipeline.chunk_text("note-1", "legacy plain text note");

        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].text, "legacy plain text note");
    }
}
