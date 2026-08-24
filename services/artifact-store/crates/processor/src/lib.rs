#![allow(clippy::missing_errors_doc)]

pub mod engine;
pub mod executor;
pub mod model;
mod real_adapters;
pub mod repository;
pub mod store;
pub mod vision;

pub use engine::{EngineError, ProcessingEngine, TickResult};
pub use model::ProcessingStatus;
pub use repository::{ProcessingRepository, RepositoryError};
pub use store::ArtifactStoreClient;
pub use vision::VisionAdapter;
