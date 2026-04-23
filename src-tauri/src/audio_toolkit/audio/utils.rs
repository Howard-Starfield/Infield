use anyhow::Result;
use hound::{WavReader, WavSpec, WavWriter};
use log::debug;
use std::path::Path;

/// Read a WAV file and return normalised f32 samples.
pub fn read_wav_samples<P: AsRef<Path>>(file_path: P) -> Result<Vec<f32>> {
    let reader = WavReader::open(file_path.as_ref())?;
    let samples = reader
        .into_samples::<i16>()
        .map(|s| s.map(|v| v as f32 / i16::MAX as f32))
        .collect::<Result<Vec<f32>, _>>()?;
    Ok(samples)
}

/// Read a half-open sample range `[start_sample, end_sample)` from a mono 16-bit WAV as normalised f32.
/// Seeks to `start_sample` then decodes only `(end - start)` frames (see `hound::WavReader::seek`).
pub fn read_wav_samples_range<P: AsRef<Path>>(
    file_path: P,
    start_sample: u64,
    end_sample: u64,
) -> Result<Vec<f32>> {
    if end_sample <= start_sample {
        return Ok(Vec::new());
    }
    let mut reader = WavReader::open(file_path.as_ref())?;
    let spec = reader.spec();
    if spec.channels != 1 {
        anyhow::bail!("expected mono WAV, got {} channels", spec.channels);
    }
    let total = reader.duration() as u64;
    let end_sample = end_sample.min(total);
    let start_sample = start_sample.min(end_sample);
    let to_read = (end_sample - start_sample) as usize;

    reader
        .seek(start_sample as u32)
        .map_err(|e| anyhow::anyhow!("WAV seek: {e}"))?;

    let mut out = Vec::with_capacity(to_read);
    for s in reader.samples::<i16>().take(to_read) {
        let v = s?;
        out.push(v as f32 / i16::MAX as f32);
    }
    Ok(out)
}

/// Verify a WAV file by reading it back and checking the sample count.
pub fn verify_wav_file<P: AsRef<Path>>(file_path: P, expected_samples: usize) -> Result<()> {
    let reader = WavReader::open(file_path.as_ref())?;
    let actual_samples = reader.len() as usize;
    if actual_samples != expected_samples {
        anyhow::bail!(
            "WAV sample count mismatch: expected {}, got {}",
            expected_samples,
            actual_samples
        );
    }
    Ok(())
}

/// Save audio samples as a WAV file
pub fn save_wav_file<P: AsRef<Path>>(file_path: P, samples: &[f32]) -> Result<()> {
    let spec = WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = WavWriter::create(file_path.as_ref(), spec)?;

    // Convert f32 samples to i16 for WAV
    for sample in samples {
        let sample_i16 = (sample * i16::MAX as f32) as i16;
        writer.write_sample(sample_i16)?;
    }

    writer.finalize()?;
    debug!("Saved WAV file: {:?}", file_path.as_ref());
    Ok(())
}
