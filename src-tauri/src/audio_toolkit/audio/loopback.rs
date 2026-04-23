//! Windows WASAPI loopback capture module.
//!
//! Captures system audio (what the user hears) via the WASAPI loopback interface,
//! resamples to 16 kHz mono, runs Silero VAD to detect speech segments, and calls
//! a user-supplied callback when a complete speech chunk ends.
//!
//! On non-Windows platforms this module compiles to an empty stub so that the
//! rest of the crate remains portable.

use anyhow::Result;
use log::{debug, error, warn};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter, Manager};

/// Whether an audio chunk was flushed by VAD silence detection or by the
/// maximum-duration timer.  Passed to `on_chunk` so callers can apply
/// different joining heuristics for natural vs forced splits.
#[derive(Debug, Clone, Copy)]
pub enum ChunkTrigger {
    /// VAD detected end-of-speech (natural pause).
    Vad,
    /// Chunk exceeded `max_chunk_secs` before VAD fired.
    Timer,
}

// ─────────────────────────────────────────────────────────────────────────────
// Non-Windows stub
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(not(target_os = "windows"))]
pub struct LoopbackCapture {}

#[cfg(not(target_os = "windows"))]
impl LoopbackCapture {
    pub fn new() -> Result<Self> {
        Ok(Self {})
    }

    pub fn start(
        &mut self,
        _app: AppHandle,
        _on_chunk: impl Fn(Vec<f32>, ChunkTrigger) + Send + 'static,
        _max_chunk_secs: f32,
        _vad_hangover_secs: f32,
    ) -> Result<()> {
        Ok(())
    }

    pub fn stop(&mut self) {}

    pub fn is_running(&self) -> bool {
        false
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Windows implementation
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
use windows::Win32::{
    Media::Audio::{
        eMultimedia, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
        MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX,
    },
    System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    },
};

/// WASAPI loopback capture handle.
///
/// Spawns a background thread that captures render-endpoint audio via the
/// loopback flag, resamples it to 16 kHz mono, runs Silero VAD, and fires
/// `on_chunk` for every detected speech segment.
#[cfg(target_os = "windows")]
pub struct LoopbackCapture {
    stop_flag: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

#[cfg(target_os = "windows")]
impl LoopbackCapture {
    /// Create a new (not-yet-started) capture handle.
    pub fn new() -> Result<Self> {
        Ok(Self {
            stop_flag: Arc::new(AtomicBool::new(false)),
            thread: None,
        })
    }

    /// Start capturing.  Spawns a background thread; returns immediately.
    ///
    /// `max_chunk_secs`: force-flush the speech buffer when it reaches this
    /// duration even if VAD has not yet detected silence.  Passed through to
    /// the capture thread as the timer-trigger threshold.
    pub fn start(
        &mut self,
        app: AppHandle,
        on_chunk: impl Fn(Vec<f32>, ChunkTrigger) + Send + 'static,
        max_chunk_secs: f32,
        vad_hangover_secs: f32,
    ) -> Result<()> {
        if self.thread.is_some() {
            return Ok(()); // already running
        }

        self.stop_flag.store(false, Ordering::SeqCst);
        let stop_flag = self.stop_flag.clone();
        let hangover_frames = hangover_frames_for_secs(vad_hangover_secs);

        let handle = std::thread::spawn(move || {
            if let Err(e) =
                capture_thread(app, on_chunk, stop_flag, max_chunk_secs, hangover_frames)
            {
                error!("Loopback capture thread error: {e}");
            }
        });

        self.thread = Some(handle);
        debug!("Loopback capture thread started");
        Ok(())
    }

    /// Signal the capture thread to stop and wait for it to finish.
    pub fn stop(&mut self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(h) = self.thread.take() {
            let _ = h.join();
        }
        debug!("Loopback capture stopped");
    }

    /// Returns `true` while the capture thread is running.
    pub fn is_running(&self) -> bool {
        !self.stop_flag.load(Ordering::SeqCst) && self.thread.is_some()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Capture thread
// ─────────────────────────────────────────────────────────────────────────────

/// VAD uses 30 ms frames at 16 kHz (`VAD_FRAME` / `OUT_HZ`). Converts a target
/// end-of-speech tail duration into a hangover frame count (clamped).
#[cfg(target_os = "windows")]
fn hangover_frames_for_secs(secs: f32) -> usize {
    const VAD_FRAME: f32 = 480.0;
    const OUT_HZ: f32 = 16_000.0;
    let frame_secs = VAD_FRAME / OUT_HZ;
    let raw = (secs / frame_secs).round() as usize;
    raw.clamp(3, 50)
}

#[cfg(target_os = "windows")]
fn capture_thread(
    app: AppHandle,
    on_chunk: impl Fn(Vec<f32>, ChunkTrigger),
    stop_flag: Arc<AtomicBool>,
    max_chunk_secs: f32,
    hangover_frames: usize,
) -> Result<()> {
    use rubato::{FftFixedIn, Resampler};

    unsafe {
        // ── COM initialisation ────────────────────────────────────────────
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        // ── Device enumeration ────────────────────────────────────────────
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|e| anyhow::anyhow!("CoCreateInstance IMMDeviceEnumerator: {e}"))?;

        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| anyhow::anyhow!("GetDefaultAudioEndpoint: {e}"))?;

        // ── Activate IAudioClient ────────────────────────────────────────
        let audio_client: IAudioClient = device
            .Activate::<IAudioClient>(CLSCTX_ALL, None)
            .map_err(|e| anyhow::anyhow!("Activate IAudioClient: {e}"))?;

        // ── Query mix format ─────────────────────────────────────────────
        let fmt_ptr: *mut WAVEFORMATEX = audio_client
            .GetMixFormat()
            .map_err(|e| anyhow::anyhow!("GetMixFormat: {e}"))?;

        let in_sample_rate = (*fmt_ptr).nSamplesPerSec as usize;
        let in_channels = (*fmt_ptr).nChannels as usize;
        let bits_per_sample = (*fmt_ptr).wBitsPerSample as usize;
        let format_tag = (*fmt_ptr).wFormatTag;

        debug!(
            "Loopback mix format: {}Hz, {}ch, {}bps, tag=0x{:04X}",
            in_sample_rate, in_channels, bits_per_sample, format_tag
        );

        // ── Initialise stream (loopback, shared mode) ────────────────────
        // Buffer duration: 1 second (10_000_000 × 100ns = 1s)
        audio_client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                10_000_000i64,
                0,
                fmt_ptr,
                None,
            )
            .map_err(|e| anyhow::anyhow!("IAudioClient::Initialize: {e}"))?;

        // ── Capture client ────────────────────────────────────────────────
        let capture_client: IAudioCaptureClient = audio_client
            .GetService::<IAudioCaptureClient>()
            .map_err(|e| anyhow::anyhow!("GetService IAudioCaptureClient: {e}"))?;

        audio_client
            .Start()
            .map_err(|e| anyhow::anyhow!("IAudioClient::Start: {e}"))?;

        // ── Resampler ─────────────────────────────────────────────────────
        const RESAMPLE_CHUNK: usize = 1024;
        const OUT_HZ: usize = 16_000;

        struct SimpleResampler {
            resampler: Option<FftFixedIn<f32>>,
            chunk_in: usize,
            in_buf: Vec<f32>,
        }

        let mut resampler = SimpleResampler {
            resampler: if in_sample_rate != OUT_HZ {
                Some(
                    FftFixedIn::<f32>::new(in_sample_rate, OUT_HZ, RESAMPLE_CHUNK, 1, 1)
                        .map_err(|e| anyhow::anyhow!("FftFixedIn::new: {e}"))?,
                )
            } else {
                None
            },
            chunk_in: RESAMPLE_CHUNK,
            in_buf: Vec::with_capacity(RESAMPLE_CHUNK),
        };

        // ── VAD ───────────────────────────────────────────────────────────
        const VAD_THRESHOLD: f32 = 0.65;
        const VAD_FRAME: usize = 480; // 30 ms @ 16 kHz

        enum VadState {
            Idle,
            InSpeech,
            Hangover(usize),
        }

        // Resolve model path via the Tauri path resolver
        let model_path = app
            .path()
            .resolve(
                "resources/models/silero_vad_v4.onnx",
                tauri::path::BaseDirectory::Resource,
            )
            .map_err(|e| anyhow::anyhow!("Failed to resolve VAD model path: {e}"))?;

        let mut vad = vad_rs::Vad::new(&model_path, OUT_HZ)
            .map_err(|e| anyhow::anyhow!("Failed to create Vad: {e}"))?;

        let mut vad_state = VadState::Idle;
        let mut speech_buf: Vec<f32> = Vec::new();

        // Pending 16 kHz samples waiting to be assembled into VAD frames
        let mut pending_16k: Vec<f32> = Vec::new();

        // ── Main capture loop ─────────────────────────────────────────────
        loop {
            if stop_flag.load(Ordering::SeqCst) {
                break;
            }

            // Poll the capture client for available packets
            let next_packet_size = match capture_client.GetNextPacketSize() {
                Ok(n) => n,
                Err(e) => {
                    warn!("GetNextPacketSize failed (device removed?): {e}");
                    break;
                }
            };

            if next_packet_size == 0 {
                // Nothing ready yet – sleep briefly to avoid busy-spinning
                std::thread::sleep(std::time::Duration::from_millis(5));
                continue;
            }

            // Read all available packets
            loop {
                let mut data_ptr: *mut u8 = std::ptr::null_mut();
                let mut num_frames: u32 = 0;
                let mut flags: u32 = 0;
                let mut device_position: u64 = 0;
                let mut qpc_position: u64 = 0;

                match capture_client.GetBuffer(
                    &mut data_ptr,
                    &mut num_frames,
                    &mut flags,
                    Some(&mut device_position),
                    Some(&mut qpc_position),
                ) {
                    Ok(()) => {}
                    Err(e) => {
                        // AUDCLNT_S_BUFFER_EMPTY (0x08890001) – nothing more to read
                        let code = e.code().0 as u32;
                        if code == 0x0889_0001 {
                            break;
                        }
                        warn!("GetBuffer error (device removed?): {e}");
                        stop_flag.store(true, Ordering::SeqCst);
                        break;
                    }
                }

                let frame_count = num_frames as usize;
                let is_silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;

                // Convert raw bytes → f32 mono
                let mono_samples: Vec<f32> = if is_silent || data_ptr.is_null() {
                    vec![0.0f32; frame_count]
                } else {
                    let bytes_per_sample = bits_per_sample / 8;
                    let bytes_per_frame = in_channels * bytes_per_sample;
                    let total_bytes = frame_count * bytes_per_frame;
                    let raw = std::slice::from_raw_parts(data_ptr, total_bytes);

                    // Determine actual format (wFormatTag 0xFFFE = extensible)
                    // For extensible, inspect the SubFormat GUID: the first 4 bytes
                    // of the SubFormat identify PCM (0x0001) or IEEE float (0x0003).
                    // In practice GetMixFormat almost always returns float; we check
                    // bits_per_sample as a fallback.
                    let is_float = format_tag == 3 || format_tag == 0xFFFE && bits_per_sample == 32;

                    let mut out = Vec::with_capacity(frame_count);
                    for frame in raw.chunks_exact(bytes_per_frame) {
                        let mono = if is_float {
                            // 32-bit IEEE float samples
                            let sum: f32 = (0..in_channels)
                                .map(|ch| {
                                    let offset = ch * 4;
                                    let bytes: [u8; 4] =
                                        frame[offset..offset + 4].try_into().unwrap_or([0u8; 4]);
                                    f32::from_le_bytes(bytes)
                                })
                                .sum();
                            sum / in_channels as f32
                        } else {
                            // 16-bit PCM samples
                            let sum: f32 = (0..in_channels)
                                .map(|ch| {
                                    let offset = ch * 2;
                                    let bytes: [u8; 2] =
                                        frame[offset..offset + 2].try_into().unwrap_or([0u8; 2]);
                                    i16::from_le_bytes(bytes) as f32 / 32768.0
                                })
                                .sum();
                            sum / in_channels as f32
                        };
                        out.push(mono);
                    }
                    out
                };

                // Release the buffer immediately after converting
                let _ = capture_client.ReleaseBuffer(num_frames);

                // ── Resample to 16 kHz ────────────────────────────────────
                let mut src = mono_samples.as_slice();

                if let Some(ref mut rs) = resampler.resampler {
                    while !src.is_empty() {
                        let space = resampler.chunk_in - resampler.in_buf.len();
                        let take = space.min(src.len());
                        resampler.in_buf.extend_from_slice(&src[..take]);
                        src = &src[take..];

                        if resampler.in_buf.len() == resampler.chunk_in {
                            match rs.process(&[&resampler.in_buf], None) {
                                Ok(out_channels) => {
                                    pending_16k.extend_from_slice(&out_channels[0]);
                                }
                                Err(e) => {
                                    warn!("Resampler error: {e}");
                                }
                            }
                            resampler.in_buf.clear();
                        }
                    }
                } else {
                    // Already at 16 kHz
                    pending_16k.extend_from_slice(src);
                }

                // ── Process complete VAD frames ───────────────────────────
                while pending_16k.len() >= VAD_FRAME {
                    let frame: Vec<f32> = pending_16k.drain(..VAD_FRAME).collect();

                    // ── Level visualisation ───────────────────────────────
                    let rms =
                        (frame.iter().map(|x| x * x).sum::<f32>() / frame.len() as f32).sqrt();
                    let level = (rms * 10.0).clamp(0.0, 1.0);
                    let levels: Vec<f32> = vec![level; 16];
                    let _ = app.emit("loopback-level", &levels);
                    if let Some(overlay) = app.get_webview_window("recording_overlay") {
                        let _ = overlay.emit("loopback-level", &levels);
                    }

                    // ── Silero VAD ────────────────────────────────────────
                    let speech_prob = match vad.compute(&frame) {
                        Ok(result) => result.prob,
                        Err(e) => {
                            warn!("VAD compute error: {e}");
                            0.0
                        }
                    };
                    let is_speech = speech_prob >= VAD_THRESHOLD;

                    vad_state = match vad_state {
                        VadState::Idle => {
                            if is_speech {
                                speech_buf.extend_from_slice(&frame);
                                VadState::InSpeech
                            } else {
                                VadState::Idle
                            }
                        }
                        VadState::InSpeech => {
                            speech_buf.extend_from_slice(&frame);
                            if !is_speech {
                                VadState::Hangover(hangover_frames)
                            } else {
                                VadState::InSpeech
                            }
                        }
                        VadState::Hangover(n) => {
                            speech_buf.extend_from_slice(&frame);
                            if is_speech {
                                VadState::InSpeech
                            } else if n == 0 {
                                // Chunk complete – fire callback (natural silence boundary)
                                let chunk = std::mem::take(&mut speech_buf);
                                debug!(
                                    "Loopback VAD chunk: {} samples ({:.2}s)",
                                    chunk.len(),
                                    chunk.len() as f32 / OUT_HZ as f32
                                );
                                on_chunk(chunk, ChunkTrigger::Vad);
                                VadState::Idle
                            } else {
                                VadState::Hangover(n - 1)
                            }
                        }
                    };

                    // Timer-triggered force-flush: if the speech buffer has
                    // accumulated more than max_chunk_secs of audio, flush
                    // immediately regardless of VAD state.
                    if !speech_buf.is_empty()
                        && speech_buf.len() as f32 / OUT_HZ as f32 >= max_chunk_secs
                    {
                        let chunk = std::mem::take(&mut speech_buf);
                        debug!(
                            "Loopback timer chunk: {} samples ({:.2}s)",
                            chunk.len(),
                            chunk.len() as f32 / OUT_HZ as f32
                        );
                        on_chunk(chunk, ChunkTrigger::Timer);
                        vad_state = VadState::Idle;
                    }
                }

                // Check for more packets in this poll iteration
                let more = match capture_client.GetNextPacketSize() {
                    Ok(n) => n,
                    Err(e) => {
                        warn!("GetNextPacketSize (inner) failed: {e}");
                        stop_flag.store(true, Ordering::SeqCst);
                        0
                    }
                };
                if more == 0 {
                    break;
                }
            }
        }

        // ── Cleanup ───────────────────────────────────────────────────────
        let _ = audio_client.Stop();
        CoTaskMemFree(Some(fmt_ptr as *const std::ffi::c_void));
        CoUninitialize();

        debug!("Loopback capture thread exiting cleanly");
        Ok(())
    }
}
