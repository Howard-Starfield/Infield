use std::path::Path;

use eyre::{eyre, Result};
use ort::session::{builder::GraphOptimizationLevel, Session};

pub fn create_session<P: AsRef<Path>>(path: P) -> Result<Session> {
    let mut builder = Session::builder().map_err(|err| eyre!(err.to_string()))?;
    builder = builder
        .with_optimization_level(GraphOptimizationLevel::Level3)
        .map_err(|err| eyre!(err.to_string()))?;
    builder = builder
        .with_intra_threads(1)
        .map_err(|err| eyre!(err.to_string()))?;
    builder = builder
        .with_inter_threads(1)
        .map_err(|err| eyre!(err.to_string()))?;

    let session = builder.commit_from_file(path.as_ref())?;
    Ok(session)
}
