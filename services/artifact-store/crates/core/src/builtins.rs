use aven_artifact_store_contract::{parse_canonical, TypeDefinition};

pub const CORE_FILE: &str = "core.file";
pub const CORE_BUNDLE: &str = "core.bundle";

const CORE_FILE_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/core.file.v1.json");
const CORE_BUNDLE_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/core.bundle.v1.json");

/// Exact source-controlled built-ins registered by the first migration.
///
/// # Errors
///
/// Returns an error if a source fixture is not valid Artifact JSON or does not match
/// the closed type-definition DTO.
pub fn builtin_type_definitions() -> Result<Vec<TypeDefinition>, crate::CoreError> {
    [CORE_FILE_JSON, CORE_BUNDLE_JSON]
        .into_iter()
        .map(|bytes| {
            let canonical = parse_canonical(bytes, true)?;
            let normalized = canonical.canonical_bytes();
            Ok(serde_json::from_slice(&normalized)?)
        })
        .collect()
}
