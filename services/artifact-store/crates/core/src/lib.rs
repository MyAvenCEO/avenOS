//! Transport-neutral Artifact Store v1 application kernel.

mod builtins;
mod prepare;
mod validation;

pub use builtins::{builtin_type_definitions, CORE_BUNDLE, CORE_FILE};
pub use prepare::{
    prepare_publication, ExistingArtifact, PreparedArtifact, PreparedPublication, PreparedReference,
};
pub use validation::{validate_type_definition, CoreError, Limits, TypeCatalog};
