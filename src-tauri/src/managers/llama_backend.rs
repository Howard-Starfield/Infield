use anyhow::Result;
use llama_cpp_2::llama_backend::LlamaBackend;

pub struct LlamaBackendManager {
    backend: LlamaBackend,
}

impl LlamaBackendManager {
    pub fn new() -> Result<Self> {
        let backend = LlamaBackend::init()?;
        Ok(Self { backend })
    }

    pub fn backend(&self) -> &LlamaBackend {
        &self.backend
    }
}
