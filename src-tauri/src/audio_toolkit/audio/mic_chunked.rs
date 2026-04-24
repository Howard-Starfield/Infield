//! VAD-cut mic capture that delivers live chunks (parallel to `LoopbackCapture`).
//!
//! Unlike `AudioRecorder` (which buffers every sample until stop), this feeds
//! VAD-cut chunks to a user callback so interview mode can stream "You"
//! paragraphs into the UI while the user is still speaking.
//!
//! Shape mirrors `LoopbackCapture`:
//!   - `new()` creates an unstarted handle.
//!   - `start(app, on_chunk, max_chunk_secs, vad_hangover_secs)` spawns a
//!     background cpal stream + resampler + Silero VAD loop.
//!   - `stop()` signals the loop and joins. Flushes trailing buffer once.
//!   - `is_running()` reports thread liveness.

use crate::audio_toolkit::audio::loopback::ChunkTrigger;
use crate::audio_toolkit::audio::FrameResampler;
use crate::audio_toolkit::constants;
use crate::audio_toolkit::vad::{SileroVad, VoiceActivityDetector};
use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SizedSample};
use log::{debug, error};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// 30 ms @ 16 kHz — matches Silero's frame size.
const VAD_FRAME_SAMPLES: usize = (constants::WHISPER_SAMPLE_RATE as usize) * 30 / 1000;

pub struct MicChunkedCapture {
    stop_flag: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl MicChunkedCapture {
    pub fn new() -> Result<Self> {
        Ok(Self {
            stop_flag: Arc::new(AtomicBool::new(false)),
            thread: None,
        })
    }

    pub fn start(
        &mut self,
        app: AppHandle,
        on_chunk: impl Fn(Vec<f32>, ChunkTrigger) + Send + 'static,
        max_chunk_secs: f32,
        vad_hangover_secs: f32,
    ) -> Result<()> {
        if self.thread.is_some() {
            return Ok(());
        }
        self.stop_flag.store(false, Ordering::SeqCst);
        let stop_flag = Arc::clone(&self.stop_flag);

        // Resolve the Silero VAD model path up front so the spawned thread
        // doesn't need to reach for app resources.
        let vad_path = app
            .path()
            .resolve(
                "resources/models/silero_vad_v4.onnx",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|e| anyhow!("Failed to resolve VAD model path: {e}"))?;

        let handle = std::thread::spawn(move || {
            if let Err(e) = capture_thread(
                on_chunk,
                stop_flag,
                max_chunk_secs,
                vad_hangover_secs,
                vad_path.to_string_lossy().into_owned(),
            ) {
                error!("MicChunkedCapture capture thread error: {e}");
            }
        });
        self.thread = Some(handle);
        debug!("MicChunkedCapture thread started");
        Ok(())
    }

    pub fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(h) = self.thread.take() {
            let _ = h.join();
        }
        debug!("MicChunkedCapture thread stopped");
    }

    pub fn is_running(&self) -> bool {
        !self.stop_flag.load(Ordering::SeqCst) && self.thread.is_some()
    }
}

impl Drop for MicChunkedCapture {
    fn drop(&mut self) {
        self.stop();
    }
}

fn hangover_frames_for_secs(secs: f32) -> usize {
    let frame_secs = 30.0 / 1000.0;
    let raw = (secs / frame_secs).round() as usize;
    raw.clamp(3, 50)
}

fn capture_thread(
    on_chunk: impl Fn(Vec<f32>, ChunkTrigger) + Send + 'static,
    stop_flag: Arc<AtomicBool>,
    max_chunk_secs: f32,
    vad_hangover_secs: f32,
    vad_model_path: String,
) -> Result<()> {
    // ── Open the default input device via cpal ────────────────────────────
    let host = crate::audio_toolkit::get_cpal_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| anyhow!("No default input device for MicChunkedCapture"))?;
    let config = device
        .default_input_config()
        .map_err(|e| anyhow!("default_input_config: {e}"))?;
    let in_sample_rate = config.sample_rate().0 as usize;
    let channels = config.channels() as usize;

    debug!(
        "MicChunkedCapture: device={:?} sr={} ch={} fmt={:?}",
        device.name().ok(),
        in_sample_rate,
        channels,
        config.sample_format()
    );

    // ── Channel into the capture thread ───────────────────────────────────
    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let stream_stop = Arc::clone(&stop_flag);

    macro_rules! build_stream {
        ($T:ty) => {{
            let tx = tx.clone();
            let stop = Arc::clone(&stream_stop);
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[$T], _: &cpal::InputCallbackInfo| {
                    if stop.load(Ordering::Relaxed) {
                        return;
                    }
                    let mut out: Vec<f32> = Vec::with_capacity(data.len() / channels.max(1));
                    if channels == 1 {
                        out.extend(data.iter().map(|&s| s.to_sample::<f32>()));
                    } else {
                        for frame in data.chunks_exact(channels) {
                            let mono = frame.iter().map(|&s| s.to_sample::<f32>()).sum::<f32>()
                                / channels as f32;
                            out.push(mono);
                        }
                    }
                    let _ = tx.send(out);
                },
                |err| log::error!("MicChunkedCapture stream error: {err}"),
                None,
            )
        }};
    }

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => build_stream!(f32),
        cpal::SampleFormat::I16 => build_stream!(i16),
        cpal::SampleFormat::I32 => build_stream!(i32),
        cpal::SampleFormat::I8 => build_stream!(i8),
        cpal::SampleFormat::U8 => build_stream!(u8),
        fmt => return Err(anyhow!("Unsupported sample format: {fmt:?}")),
    }
    .map_err(|e| anyhow!("build_input_stream: {e}"))?;

    stream
        .play()
        .map_err(|e| anyhow!("stream.play: {e}"))?;

    // ── Resampler + VAD ───────────────────────────────────────────────────
    let mut resampler = FrameResampler::new(
        in_sample_rate,
        constants::WHISPER_SAMPLE_RATE as usize,
        Duration::from_millis(30),
    );
    let mut vad: Box<dyn VoiceActivityDetector> = Box::new(
        SileroVad::new(&vad_model_path, 0.3).map_err(|e| anyhow!("SileroVad::new: {e}"))?,
    );

    // ── Chunking state ────────────────────────────────────────────────────
    let max_samples =
        (max_chunk_secs * constants::WHISPER_SAMPLE_RATE as f32) as usize;
    let hangover_frames = hangover_frames_for_secs(vad_hangover_secs);
    let mut speech_buf: Vec<f32> = Vec::with_capacity(max_samples.max(VAD_FRAME_SAMPLES));
    let mut silent_frames: usize = 0;
    let mut in_speech = false;
    let mut last_emit = Instant::now();

    let mut flush = |buf: &mut Vec<f32>, trigger: ChunkTrigger| {
        if buf.is_empty() {
            return;
        }
        let chunk = std::mem::take(buf);
        on_chunk(chunk, trigger);
    };

    // ── Main loop ─────────────────────────────────────────────────────────
    const POLL: Duration = Duration::from_millis(50);
    while !stop_flag.load(Ordering::SeqCst) {
        let raw = match rx.recv_timeout(POLL) {
            Ok(v) => v,
            Err(mpsc::RecvTimeoutError::Timeout) => Vec::new(),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };

        if !raw.is_empty() {
            resampler.push(&raw, &mut |frame: &[f32]| {
                match vad
                    .push_frame(frame)
                    .unwrap_or(crate::audio_toolkit::vad::VadFrame::Noise)
                {
                    crate::audio_toolkit::vad::VadFrame::Speech(buf) => {
                        in_speech = true;
                        silent_frames = 0;
                        speech_buf.extend_from_slice(buf);
                    }
                    crate::audio_toolkit::vad::VadFrame::Noise => {
                        if in_speech {
                            silent_frames += 1;
                            if silent_frames >= hangover_frames && !speech_buf.is_empty() {
                                let chunk = std::mem::take(&mut speech_buf);
                                on_chunk(chunk, ChunkTrigger::Vad);
                                in_speech = false;
                                silent_frames = 0;
                                last_emit = Instant::now();
                            }
                        }
                    }
                }
            });
        }

        // Max-chunk force-flush.
        if speech_buf.len() >= max_samples {
            flush(&mut speech_buf, ChunkTrigger::Timer);
            in_speech = false;
            silent_frames = 0;
            last_emit = Instant::now();
        }

        // Sanity flush: prevent UI freeze if VAD misses a cut.
        if !speech_buf.is_empty()
            && last_emit.elapsed() > Duration::from_secs_f32(max_chunk_secs * 2.0)
        {
            flush(&mut speech_buf, ChunkTrigger::Timer);
            in_speech = false;
            silent_frames = 0;
            last_emit = Instant::now();
        }
    }

    // ── Drain: pause stream first (Windows WASAPI safety, mirrors recorder.rs) ──
    let _ = stream.pause();

    // Drain any buffered samples.
    while let Ok(raw) = rx.try_recv() {
        resampler.push(&raw, &mut |frame: &[f32]| {
            if let Ok(crate::audio_toolkit::vad::VadFrame::Speech(buf)) = vad.push_frame(frame) {
                speech_buf.extend_from_slice(buf);
            }
        });
    }
    resampler.finish(&mut |frame: &[f32]| {
        if let Ok(crate::audio_toolkit::vad::VadFrame::Speech(buf)) = vad.push_frame(frame) {
            speech_buf.extend_from_slice(buf);
        }
    });
    if !speech_buf.is_empty() {
        on_chunk(std::mem::take(&mut speech_buf), ChunkTrigger::Timer);
    }

    drop(stream);
    Ok(())
}
