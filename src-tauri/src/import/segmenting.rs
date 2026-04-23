//! VAD-based segmentation for long audio import (16 kHz mono WAV).

use crate::audio_toolkit::constants;
use crate::audio_toolkit::vad::{SileroVad, VoiceActivityDetector};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

const FRAME_MS: u32 = 30;
const FRAME_SAMPLES: usize = (constants::WHISPER_SAMPLE_RATE * FRAME_MS / 1000) as usize;
const MERGE_GAP_MS: u64 = 300;
const MAX_SEGMENT_MS: u64 = 30_000;
const MIN_SEGMENT_MS: u64 = 250;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentSpan {
    pub start_ms: u64,
    pub end_ms: u64,
}

/// Build speech segments from a decoded import WAV using Silero VAD.
pub fn segment_wav(wav_path: &Path, silero_model_path: &Path) -> Result<Vec<SegmentSpan>> {
    let mut vad = SileroVad::new(silero_model_path, 0.5).context("Silero VAD init")?;

    let samples = crate::audio_toolkit::read_wav_samples(wav_path).context("read wav for VAD")?;
    if samples.len() < FRAME_SAMPLES {
        return Ok(Vec::new());
    }

    let mut speech_frames: Vec<usize> = Vec::new();
    let mut frame_idx = 0_usize;
    let mut offset = 0_usize;
    while offset + FRAME_SAMPLES <= samples.len() {
        let frame = &samples[offset..offset + FRAME_SAMPLES];
        if vad.is_voice(frame).unwrap_or(false) {
            speech_frames.push(frame_idx);
        }
        frame_idx += 1;
        offset += FRAME_SAMPLES;
    }

    if speech_frames.is_empty() {
        return Ok(Vec::new());
    }

    let mut runs: Vec<(usize, usize)> = Vec::new();
    let mut run_start = speech_frames[0];
    let mut prev = speech_frames[0];
    for &f in speech_frames.iter().skip(1) {
        let gap_frames = f.saturating_sub(prev).saturating_sub(1);
        let gap_ms = gap_frames as u64 * FRAME_MS as u64;
        if gap_ms <= MERGE_GAP_MS {
            prev = f;
            continue;
        }
        runs.push((run_start, prev));
        run_start = f;
        prev = f;
    }
    runs.push((run_start, prev));

    let sample_rate = constants::WHISPER_SAMPLE_RATE as u64;
    let frame = FRAME_SAMPLES as u64;
    let mut raw_spans: Vec<SegmentSpan> = runs
        .into_iter()
        .map(|(a, b)| {
            let start_sample = a as u64 * frame;
            let end_sample = (b as u64 + 1) * frame;
            SegmentSpan {
                start_ms: start_sample.saturating_mul(1000) / sample_rate,
                end_ms: (end_sample.saturating_mul(1000) / sample_rate).min(
                    samples.len() as u64 * 1000 / sample_rate,
                ),
            }
        })
        .filter(|s| s.end_ms.saturating_sub(s.start_ms) >= MIN_SEGMENT_MS)
        .collect();

    let mut out: Vec<SegmentSpan> = Vec::new();
    for mut span in raw_spans.drain(..) {
        let dur = span.end_ms.saturating_sub(span.start_ms);
        if dur <= MAX_SEGMENT_MS {
            out.push(span);
            continue;
        }
        let start_ms = span.start_ms;
        let end_ms = span.end_ms;
        let mut t = start_ms;
        while t < end_ms {
            let next = (t + MAX_SEGMENT_MS).min(end_ms);
            if next.saturating_sub(t) >= MIN_SEGMENT_MS {
                out.push(SegmentSpan {
                    start_ms: t,
                    end_ms: next,
                });
            }
            t = next;
        }
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio_toolkit::save_wav_file;
    use tempfile::tempdir;

    fn silero_path() -> Option<std::path::PathBuf> {
        let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("models")
            .join("silero_vad_v4.onnx");
        if p.exists() {
            Some(p)
        } else {
            None
        }
    }

    #[test]
    fn segment_wav_empty_silence() {
        let Some(model) = silero_path() else {
            return;
        };
        let dir = tempdir().unwrap();
        let wav = dir.path().join("s.wav");
        let silence = vec![0.0f32; 16000];
        save_wav_file(&wav, &silence).unwrap();
        let segs = segment_wav(&wav, &model).unwrap();
        assert!(segs.is_empty());
    }
}
