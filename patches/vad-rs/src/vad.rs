use eyre::{bail, eyre, Result};
use ndarray::{Array1, Array2, Array3, ArrayBase, Ix1, Ix3, OwnedRepr};
use ort::session::Session;
use ort::value::TensorRef;
use std::path::Path;

use crate::{session, vad_result::VadResult};

#[derive(Debug)]
pub struct Vad {
    session: Session,
    h_tensor: ArrayBase<OwnedRepr<f32>, Ix3>,
    c_tensor: ArrayBase<OwnedRepr<f32>, Ix3>,
    sample_rate_tensor: ArrayBase<OwnedRepr<i64>, Ix1>,
}

impl Vad {
    pub fn new<P: AsRef<Path>>(model_path: P, sample_rate: usize) -> Result<Self> {
        if ![8000_usize, 16000].contains(&sample_rate) {
            bail!("Unsupported sample rate, use 8000 or 16000!");
        }
        let session = session::create_session(model_path)?;
        let h_tensor = Array3::<f32>::zeros((2, 1, 64));
        let c_tensor = Array3::<f32>::zeros((2, 1, 64));
        let sample_rate_tensor = Array1::from_vec(vec![sample_rate as i64]);

        Ok(Self {
            session,
            h_tensor,
            c_tensor,
            sample_rate_tensor,
        })
    }

    pub fn compute(&mut self, samples: &[f32]) -> Result<VadResult> {
        let samples_tensor = Array2::from_shape_vec((1, samples.len()), samples.to_vec())?;
        let result = {
            let input = TensorRef::from_array_view(([1usize, samples.len()], samples_tensor.as_slice().unwrap()))?;
            let sample_rate = TensorRef::from_array_view(([1usize], self.sample_rate_tensor.as_slice().unwrap()))?;
            let h = TensorRef::from_array_view(([2usize, 1, 64], self.h_tensor.as_slice().unwrap()))?;
            let c = TensorRef::from_array_view(([2usize, 1, 64], self.c_tensor.as_slice().unwrap()))?;

            self.session.run(ort::inputs![
                "input" => input,
                "sr" => sample_rate,
                "h" => h,
                "c" => c
            ])?
        };

        // Update internal state tensors.
        let (_, h_data) = result
            .get("hn")
            .ok_or_else(|| eyre!("Missing hn output"))?
            .try_extract_tensor::<f32>()?;
        self.h_tensor = Array3::from_shape_vec((2, 1, 64), h_data.to_vec())?;

        let (_, c_data) = result
            .get("cn")
            .ok_or_else(|| eyre!("Missing cn output"))?
            .try_extract_tensor::<f32>()?;
        self.c_tensor = Array3::from_shape_vec((2, 1, 64), c_data.to_vec())?;

        let (_, output) = result
            .get("output")
            .ok_or_else(|| eyre!("Missing output tensor"))?
            .try_extract_tensor::<f32>()?;
        let prob = output
            .first()
            .copied()
            .ok_or_else(|| eyre!("Model output tensor was empty"))?;
        Ok(VadResult { prob })
    }

    pub fn reset(&mut self) {
        self.h_tensor.fill(0.0);
        self.c_tensor.fill(0.0);
    }
}
