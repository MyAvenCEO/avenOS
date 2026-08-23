use aven_artifact_store_contract::{parse_canonical, TypeDefinition};

pub const CORE_FILE: &str = "core.file";
pub const CORE_BUNDLE: &str = "core.bundle";
pub const CORE_FILE_INSPECTION: &str = "core.file-inspection";
pub const DOCS_PAGE: &str = "docs.page";
pub const CORE_CONTENT_CLASSIFICATION: &str = "core.content-classification";
pub const CORE_CONTENT_DESCRIPTION: &str = "core.content-description";
pub const DOCS_EXTRACTED_TEXT: &str = "docs.extracted-text";
pub const DOCS_TEXT_LAYOUT: &str = "docs.text-layout";
pub const CORE_DOCUMENT_CLASSIFICATION: &str = "core.document-classification";
pub const BOOKKEEPING_INVOICE_CANDIDATE: &str = "bookkeeping.invoice-candidate";
pub const BOOKKEEPING_INVOICE_VALIDATION: &str = "bookkeeping.invoice-validation";

const CORE_FILE_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/core.file.v1.json");
const CORE_BUNDLE_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/core.bundle.v1.json");
const CORE_FILE_INSPECTION_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/core.file-inspection.v1.json");
const DOCS_PAGE_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/docs.page.v1.json");
const CORE_CONTENT_CLASSIFICATION_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/core.content-classification.v1.json");
const CORE_CONTENT_DESCRIPTION_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/core.content-description.v1.json");
const DOCS_EXTRACTED_TEXT_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/docs.extracted-text.v1.json");
const DOCS_TEXT_LAYOUT_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/docs.text-layout.v1.json");
const CORE_DOCUMENT_CLASSIFICATION_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/core.document-classification.v1.json");
const BOOKKEEPING_INVOICE_CANDIDATE_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/bookkeeping.invoice-candidate.v1.json");
const BOOKKEEPING_INVOICE_VALIDATION_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/bookkeeping.invoice-validation.v1.json");
const BOOKKEEPING_INVOICE_DETAILS_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/bookkeeping.invoice-details.v1.json");
const BANKING_ACCOUNT_STATEMENT_CANDIDATE_JSON: &[u8] = include_bytes!(
    "../../../conformance/fixtures/protocol/banking.account-statement-candidate.v1.json"
);
const BANKING_STATEMENT_VALIDATION_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/banking.statement-validation.v1.json");

/// Exact source-controlled built-ins registered by the first migration.
///
/// # Errors
///
/// Returns an error if a source fixture is not valid Artifact JSON or does not match
/// the closed type-definition DTO.
pub fn builtin_type_definitions() -> Result<Vec<TypeDefinition>, crate::CoreError> {
    [
        CORE_FILE_JSON,
        CORE_BUNDLE_JSON,
        CORE_FILE_INSPECTION_JSON,
        DOCS_PAGE_JSON,
        CORE_CONTENT_CLASSIFICATION_JSON,
        CORE_CONTENT_DESCRIPTION_JSON,
        DOCS_EXTRACTED_TEXT_JSON,
        DOCS_TEXT_LAYOUT_JSON,
        CORE_DOCUMENT_CLASSIFICATION_JSON,
        BOOKKEEPING_INVOICE_CANDIDATE_JSON,
        BOOKKEEPING_INVOICE_VALIDATION_JSON,
        BOOKKEEPING_INVOICE_DETAILS_JSON,
        BANKING_ACCOUNT_STATEMENT_CANDIDATE_JSON,
        BANKING_STATEMENT_VALIDATION_JSON,
    ]
    .into_iter()
    .map(|bytes| {
        let canonical = parse_canonical(bytes, true)?;
        let normalized = canonical.canonical_bytes();
        Ok(serde_json::from_slice(&normalized)?)
    })
    .collect()
}
