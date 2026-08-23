use std::collections::{BTreeMap, BTreeSet};

use aven_artifact_store_contract::{
    parse_canonical, sha256_hex, Actor, ArtifactEnvelope, BlobAuthority, DeclaredBlob,
    EvidenceIntent, IntentArtifact, LocalKey, Locator, OutputBinding, PublicationBody,
    PublicationIntent, PublicationSubmission, ReferenceIntent, ReferenceTarget, Role, RunInput,
    RunIntent, TypeKey, UploadDeclaration,
};
use serde_json::{json, Value};
use thiserror::Error;
use uuid::Uuid;

use crate::model::{ClaimedStep, ExecutionOutput, GeneratedBlob, MockDocument};

const MAX_MOCK_PAGES: usize = 16;
const MAX_PAGE_TEXT_BYTES: usize = 100_000;

#[derive(Clone, Debug)]
pub struct MaterializedInput {
    pub envelope: ArtifactEnvelope,
    pub content: Option<Vec<u8>>,
}

#[derive(Debug, Error)]
pub enum ExecutorError {
    #[error("adapter input is unsupported: {0}")]
    Unsupported(String),
    #[error("adapter input is invalid: {0}")]
    Invalid(String),
    #[error("model output is invalid: {0}")]
    ModelOutput(String),
    #[error("adapter resource limit was exceeded: {0}")]
    LimitExceeded(String),
    #[error("adapter rejected unsafe input: {0}")]
    UnsafeInput(String),
    #[error("adapter dependency is unavailable: {0}")]
    Unavailable(String),
    #[error("adapter deadline was exceeded: {0}")]
    DeadlineExceeded(String),
    #[error("adapter failed internally: {0}")]
    Internal(String),
    #[error("processor could not serialize valid Artifact JSON: {0}")]
    Canonical(String),
}

impl ExecutorError {
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unsupported(_) => "unsupported",
            Self::Invalid(_) => "invalid-input",
            Self::ModelOutput(_) | Self::Canonical(_) => "invalid-output",
            Self::LimitExceeded(_) => "limit-exceeded",
            Self::UnsafeInput(_) => "unsafe-input",
            Self::Unavailable(_) => "unavailable",
            Self::DeadlineExceeded(_) => "deadline-exceeded",
            Self::Internal(_) => "internal",
        }
    }

    #[must_use]
    pub const fn retryable(&self) -> bool {
        matches!(
            self,
            Self::ModelOutput(_)
                | Self::Unavailable(_)
                | Self::DeadlineExceeded(_)
                | Self::Internal(_)
        )
    }
}

pub fn execute(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    if !step.procedure_key.starts_with("mock.") {
        let mut output = crate::real_adapters::execute(step, inputs)?;
        output.submission.intent.body = PublicationBody::Run {
            run: Box::new(run_intent(step, inputs)?),
        };
        return Ok(output);
    }
    let source = inputs
        .iter()
        .find(|input| input.envelope.artifact_id == step.source_artifact_id)
        .ok_or_else(|| ExecutorError::Invalid("source input is missing".into()))?;
    let source_bytes = source
        .content
        .as_deref()
        .ok_or_else(|| ExecutorError::Invalid("source bytes are missing".into()))?;
    let document = parse_mock_document(source_bytes)?;
    let mut output = match step.procedure_key.as_str() {
        "mock.inspect" => inspect(step, &document)?,
        "mock.classify-content" => classify_content(step, &document)?,
        "mock.decompose-pages" => decompose(step, &document)?,
        "mock.classify-page" => classify_page(step, &document)?,
        "mock.represent-page" => represent_page(step, &document)?,
        "mock.refine-content" => refine_content(step, inputs)?,
        "mock.assemble-text" => assemble_text(step, inputs)?,
        "mock.classify-document" => classify_document(step, &document)?,
        "mock.extract-invoice" => extract_invoice(step, &document)?,
        "mock.validate-invoice" => validate_invoice(step, inputs)?,
        other => {
            return Err(ExecutorError::Unsupported(format!(
                "procedure {other} is unavailable"
            )))
        }
    };
    output.submission.intent.body = PublicationBody::Run {
        run: Box::new(run_intent(step, inputs)?),
    };
    Ok(output)
}

#[must_use]
pub fn generated_uploads(output: &ExecutionOutput) -> Vec<(Uuid, UploadDeclaration, Vec<u8>)> {
    output
        .blobs
        .iter()
        .map(|blob| {
            (
                blob.claim_id,
                UploadDeclaration {
                    sha256: sha256_hex(&blob.bytes),
                    length: blob.bytes.len() as u64,
                    declared_media_type: blob.media_type.clone(),
                },
                blob.bytes.clone(),
            )
        })
        .collect()
}

fn parse_mock_document(bytes: &[u8]) -> Result<MockDocument, ExecutorError> {
    let document: MockDocument = serde_json::from_slice(bytes)
        .map_err(|error| ExecutorError::Unsupported(format!("not a mock document: {error}")))?;
    if document.title.trim().is_empty() || document.title.len() > 512 {
        return Err(ExecutorError::Invalid("title is outside bounds".into()));
    }
    if document.pages.is_empty() || document.pages.len() > MAX_MOCK_PAGES {
        return Err(ExecutorError::Invalid(format!(
            "mock documents require 1..={MAX_MOCK_PAGES} pages"
        )));
    }
    let allowed = BTreeSet::from([
        "native-text",
        "raster-text",
        "handwriting",
        "photograph",
        "illustration",
        "diagram",
        "chart",
        "table",
    ]);
    for page in &document.pages {
        if page.text.len() > MAX_PAGE_TEXT_BYTES {
            return Err(ExecutorError::Invalid(
                "mock page text exceeds limit".into(),
            ));
        }
        if page.visual_summary.len() > 2_000 {
            return Err(ExecutorError::Invalid(
                "mock page visual summary exceeds limit".into(),
            ));
        }
        if page.facets.len() > 16
            || page
                .facets
                .iter()
                .any(|facet| !allowed.contains(facet.as_str()))
        {
            return Err(ExecutorError::Invalid(
                "mock page contains an unsupported facet".into(),
            ));
        }
    }
    Ok(document)
}

fn inspect(step: &ClaimedStep, document: &MockDocument) -> Result<ExecutionOutput, ExecutorError> {
    single_artifact(
        step,
        artifact(
            "inspection",
            "core.file-inspection",
            json!({
                "outcome": "ok",
                "detectedMediaType": "application/x-aven-mock-document+json",
                "readable": true,
                "pageCount": document.pages.len(),
                "encrypted": false
            }),
            None,
            "inspection",
            0,
        )?,
        vec![whole_source_evidence("inspection", 0)?],
    )
}

fn classify_content(
    step: &ClaimedStep,
    document: &MockDocument,
) -> Result<ExecutionOutput, ExecutorError> {
    single_artifact(
        step,
        artifact(
            "classification",
            "core.content-classification",
            json!({
                "subjectLevel": "file",
                "primaryKind": "document",
                "facets": [],
                "confidenceBps": 9500,
                "reason": format!("Mock file declares {} logical pages.", document.pages.len()),
                "resolutionMode": "model",
                "complete": false
            }),
            None,
            "classification",
            0,
        )?,
        vec![whole_source_evidence("classification", 0)?],
    )
}

fn decompose(
    step: &ClaimedStep,
    document: &MockDocument,
) -> Result<ExecutionOutput, ExecutorError> {
    let mut artifacts = Vec::new();
    let mut evidence = Vec::new();
    let mut references = Vec::new();
    for index in 0..document.pages.len() {
        let page_number = u32::try_from(index + 1)
            .map_err(|_| ExecutorError::Invalid("page number overflow".into()))?;
        let page_key = format!("page-{page_number:03}");
        artifacts.push(artifact(
            &page_key,
            "docs.page",
            json!({
                "sourcePage": page_number,
                "rotationDegrees": 0,
                "widthUnits": 1_000_000,
                "heightUnits": 1_000_000
            }),
            None,
            "page",
            page_number - 1,
        )?);
        references.push(ReferenceIntent {
            role: role("member")?,
            ordinal: page_number - 1,
            target: ReferenceTarget::Local {
                local_key: local_key(&page_key)?,
            },
            attributes: canonical(json!({
                "path": format!("page/{page_number:03}"),
                "label": format!("Page {page_number}")
            }))?,
        });
        evidence.push(EvidenceIntent {
            ordinal: page_number - 1,
            output_local_key: local_key(&page_key)?,
            output_locator: Locator::ArtifactRoot,
            input_role: role("source")?,
            input_ordinal: 0,
            input_locator: whole_page(page_number),
        });
    }
    let mut bundle = artifact(
        "pages",
        "core.bundle",
        json!({ "purpose": "document-pages", "displayName": document.title }),
        None,
        "page-bundle",
        0,
    )?;
    bundle.references = references;
    artifacts.push(bundle);
    output(step, artifacts, evidence, Vec::new())
}

fn classify_page(
    step: &ClaimedStep,
    document: &MockDocument,
) -> Result<ExecutionOutput, ExecutorError> {
    let page_number = page_parameter(step)?;
    let page = document
        .pages
        .get(page_number - 1)
        .ok_or_else(|| ExecutorError::Invalid("page parameter is out of range".into()))?;
    let has_text = page.facets.iter().any(|facet| {
        matches!(
            facet.as_str(),
            "native-text" | "raster-text" | "handwriting"
        )
    });
    let has_visual = page.facets.iter().any(|facet| {
        matches!(
            facet.as_str(),
            "photograph" | "illustration" | "diagram" | "chart"
        )
    });
    let primary = match (has_text, has_visual, page.facets.is_empty()) {
        (_, _, true) => "blank",
        (true, true, false) => "mixed",
        (true, false, false) => "document",
        (false, true, false) => "image",
        _ => "unknown",
    };
    let mut artifacts = vec![artifact(
        "classification",
        "core.content-classification",
        json!({
            "subjectLevel": "page",
            "primaryKind": primary,
            "facets": page.facets,
            "confidenceBps": 9800,
            "reason": format!("Mock page {page_number} facets were supplied by the fixture."),
            "resolutionMode": "model",
            "complete": true
        }),
        None,
        "classification",
        0,
    )?];
    let page_u32 = u32::try_from(page_number)
        .map_err(|_| ExecutorError::Invalid("page number overflow".into()))?;
    let mut evidence = vec![page_evidence("classification", 0, page_u32)?];
    if !page.visual_summary.is_empty() {
        artifacts.push(artifact(
            "description",
            "core.content-description",
            json!({
                "summary": page.visual_summary,
                "topics": page.facets
            }),
            None,
            "description",
            0,
        )?);
        evidence.push(EvidenceIntent {
            ordinal: 1,
            output_local_key: local_key("description")?,
            output_locator: Locator::JsonPointer {
                pointer: "/summary".into(),
            },
            input_role: role("source")?,
            input_ordinal: 0,
            input_locator: whole_page(page_u32),
        });
    }
    output(step, artifacts, evidence, Vec::new())
}

fn represent_page(
    step: &ClaimedStep,
    document: &MockDocument,
) -> Result<ExecutionOutput, ExecutorError> {
    let page_number = page_parameter(step)?;
    let page = document
        .pages
        .get(page_number - 1)
        .ok_or_else(|| ExecutorError::Invalid("page parameter is out of range".into()))?;
    let bytes = page.text.as_bytes().to_vec();
    let text_artifact = artifact(
        "text",
        "docs.extracted-text",
        json!({
            "method": "mock",
            "language": "en",
            "pageCount": 1,
            "characterCount": page.text.chars().count(),
            "complete": true
        }),
        Some(&bytes),
        "text",
        0,
    )?;
    let spans = if bytes.is_empty() {
        Vec::new()
    } else {
        vec![json!({
            "start": 0,
            "endExclusive": bytes.len(),
            "page": page_number,
            "x": 0,
            "y": 0,
            "width": 1_000_000,
            "height": 1_000_000
        })]
    };
    let layout = artifact(
        "layout",
        "docs.text-layout",
        json!({
            "coordinateSpace": "normalized-millionths",
            "spans": spans,
            "complete": true
        }),
        None,
        "layout",
        0,
    )?;
    let page_u32 = u32::try_from(page_number)
        .map_err(|_| ExecutorError::Invalid("page number overflow".into()))?;
    let mut evidence = vec![page_evidence("layout", 0, page_u32)?];
    if !bytes.is_empty() {
        evidence.push(EvidenceIntent {
            ordinal: 1,
            output_local_key: local_key("text")?,
            output_locator: Locator::ByteRange {
                start: 0,
                end_exclusive: bytes.len() as u64,
            },
            input_role: role("source")?,
            input_ordinal: 0,
            input_locator: whole_page(page_u32),
        });
    }
    output(
        step,
        vec![text_artifact, layout],
        evidence,
        vec![("text", "text/plain; charset=utf-8", bytes)],
    )
}

fn refine_content(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    let mut facets = BTreeSet::new();
    for input in inputs.iter().filter(|input| {
        input.envelope.type_key.as_str() == "core.content-classification"
            && input.envelope.payload_field("subjectLevel") == Some("page")
    }) {
        if let Some(Value::Array(values)) = serde_json::to_value(&input.envelope.payload)
            .ok()
            .and_then(|value| value.get("facets").cloned())
        {
            for value in values {
                if let Some(facet) = value.as_str() {
                    facets.insert(facet.to_owned());
                }
            }
        }
    }
    let has_text = facets.iter().any(|facet| {
        matches!(
            facet.as_str(),
            "native-text" | "raster-text" | "handwriting"
        )
    });
    let has_visual = facets.iter().any(|facet| {
        matches!(
            facet.as_str(),
            "photograph" | "illustration" | "diagram" | "chart"
        )
    });
    let primary = if has_text && has_visual {
        "mixed"
    } else if has_visual {
        "image"
    } else {
        "document"
    };
    single_artifact(
        step,
        artifact(
            "classification",
            "core.content-classification",
            json!({
                "subjectLevel": "file",
                "primaryKind": primary,
                "facets": facets.into_iter().collect::<Vec<_>>(),
                "confidenceBps": 9700,
                "reason": "Mock whole-file classification aggregates every page result.",
                "resolutionMode": "rule",
                "complete": true
            }),
            None,
            "classification",
            0,
        )?,
        vec![whole_source_evidence("classification", 0)?],
    )
}

fn assemble_text(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    let text_inputs = inputs
        .iter()
        .filter(|input| input.envelope.type_key.as_str() == "docs.extracted-text")
        .collect::<Vec<_>>();
    let mut assembled = Vec::new();
    let mut spans = Vec::new();
    for (index, input) in text_inputs.iter().enumerate() {
        if index > 0 {
            assembled.extend_from_slice(b"\n\n");
        }
        let start = assembled.len();
        if let Some(content) = &input.content {
            assembled.extend_from_slice(content);
        }
        let end = assembled.len();
        if end > start {
            spans.push(json!({
                "start": start,
                "endExclusive": end,
                "page": index + 1,
                "x": 0,
                "y": 0,
                "width": 1_000_000,
                "height": 1_000_000
            }));
        }
    }
    let character_count = String::from_utf8_lossy(&assembled).chars().count();
    let text = artifact(
        "text",
        "docs.extracted-text",
        json!({
            "method": "mock",
            "language": "en",
            "pageCount": text_inputs.len(),
            "characterCount": character_count,
            "complete": true
        }),
        Some(&assembled),
        "text",
        0,
    )?;
    let layout = artifact(
        "layout",
        "docs.text-layout",
        json!({
            "coordinateSpace": "normalized-millionths",
            "spans": spans,
            "complete": true
        }),
        None,
        "layout",
        0,
    )?;
    output(
        step,
        vec![text, layout],
        vec![whole_source_evidence("layout", 0)?],
        vec![("text", "text/plain; charset=utf-8", assembled)],
    )
}

fn classify_document(
    step: &ClaimedStep,
    document: &MockDocument,
) -> Result<ExecutionOutput, ExecutorError> {
    let (resolved, family) = if document.document_kind == "invoice" {
        ("invoice", "invoice-family")
    } else {
        ("unknown", "fallback")
    };
    single_artifact(
        step,
        artifact(
            "classification",
            "core.document-classification",
            json!({
                "rawKind": document.document_kind,
                "resolvedKind": resolved,
                "family": family,
                "confidenceBps": if resolved == "unknown" { 0 } else { 9900 },
                "reason": "Mock classifier uses the fixture's declared document kind.",
                "resolutionMode": "model",
                "alternatives": []
            }),
            None,
            "classification",
            0,
        )?,
        vec![EvidenceIntent {
            ordinal: 0,
            output_local_key: local_key("classification")?,
            output_locator: Locator::JsonPointer {
                pointer: "/resolvedKind".into(),
            },
            input_role: role("source")?,
            input_ordinal: 0,
            input_locator: whole_page(1),
        }],
    )
}

fn extract_invoice(
    step: &ClaimedStep,
    document: &MockDocument,
) -> Result<ExecutionOutput, ExecutorError> {
    let invoice = document
        .invoice
        .as_ref()
        .ok_or_else(|| ExecutorError::Unsupported("mock invoice data is absent".into()))?;
    let summary = format!(
        "Invoice {} from {} for {} {} minor units.",
        invoice.invoice_number, invoice.supplier, invoice.gross_minor, invoice.currency
    );
    let candidate = artifact(
        "invoice",
        "bookkeeping.invoice-candidate",
        json!({
            "supplier": invoice.supplier,
            "invoiceNumber": invoice.invoice_number,
            "currency": invoice.currency,
            "netMinor": invoice.net_minor,
            "taxMinor": invoice.tax_minor,
            "grossMinor": invoice.gross_minor,
            "dueDate": invoice.due_date,
            "summary": summary
        }),
        None,
        "candidate",
        0,
    )?;
    let fields = [
        "/supplier",
        "/invoiceNumber",
        "/currency",
        "/netMinor",
        "/taxMinor",
        "/grossMinor",
        "/dueDate",
        "/summary",
    ];
    let evidence = fields
        .into_iter()
        .enumerate()
        .map(|(ordinal, pointer)| {
            Ok(EvidenceIntent {
                ordinal: u32::try_from(ordinal)
                    .map_err(|_| ExecutorError::Invalid("evidence ordinal overflow".into()))?,
                output_local_key: local_key("invoice")?,
                output_locator: Locator::JsonPointer {
                    pointer: pointer.into(),
                },
                input_role: role("source")?,
                input_ordinal: 0,
                input_locator: whole_page(1),
            })
        })
        .collect::<Result<Vec<_>, ExecutorError>>()?;
    single_artifact(step, candidate, evidence)
}

fn validate_invoice(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    let candidate = inputs
        .iter()
        .find(|input| input.envelope.type_key.as_str() == "bookkeeping.invoice-candidate")
        .ok_or_else(|| ExecutorError::Invalid("invoice candidate input is missing".into()))?;
    let payload = serde_json::to_value(&candidate.envelope.payload)
        .map_err(|error| ExecutorError::Canonical(error.to_string()))?;
    let net = integer_field(&payload, "netMinor")?;
    let tax = integer_field(&payload, "taxMinor")?;
    let gross = integer_field(&payload, "grossMinor")?;
    let passed = net.checked_add(tax) == Some(gross);
    let status = if passed { "consistent" } else { "inconsistent" };
    single_artifact(
        step,
        artifact(
            "validation",
            "bookkeeping.invoice-validation",
            json!({
                "rulesetVersion": "mock-invoice-v1",
                "status": status,
                "coverageBps": 10000,
                "checks": [{
                    "ruleId": "invoice.net-plus-tax-equals-gross",
                    "outcome": if passed { "PASS" } else { "FAIL" },
                    "severity": "hard",
                    "paths": ["/netMinor", "/taxMinor", "/grossMinor"],
                    "message": if passed {
                        "Net plus tax equals gross."
                    } else {
                        "Net plus tax does not equal gross."
                    }
                }]
            }),
            None,
            "validation",
            0,
        )?,
        vec![EvidenceIntent {
            ordinal: 0,
            output_local_key: local_key("validation")?,
            output_locator: Locator::ArtifactRoot,
            input_role: role("candidate")?,
            input_ordinal: 0,
            input_locator: Locator::ArtifactRoot,
        }],
    )
}

pub(crate) fn run_intent(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<RunIntent, ExecutorError> {
    let mut role_counts = BTreeMap::<String, u32>::new();
    let mut run_inputs = Vec::new();
    for input in inputs {
        let role_name = input_role(input);
        let ordinal = role_counts.entry(role_name.to_owned()).or_default();
        run_inputs.push(RunInput {
            role: role(role_name)?,
            ordinal: *ordinal,
            artifact_id: input.envelope.artifact_id,
        });
        *ordinal += 1;
    }
    let is_mock = step.procedure_key.starts_with("mock.");
    let is_model = step.procedure_key.starts_with("model.");
    Ok(RunIntent {
        procedure_key: type_key(&step.procedure_key)?,
        procedure_version: if is_mock { "mock-v1" } else { "1" }.into(),
        initiator: service_actor("artifact-processing-coordinator")?,
        executor: service_actor(if is_mock {
            "mock-artifact-processor"
        } else if is_model {
            "openai-compatible-vision-adapter"
        } else {
            "deterministic-artifact-adapter"
        })?,
        inputs: run_inputs,
        parameters: canonical(step.parameters.clone())?,
        implementation: canonical(if is_mock {
            json!({ "adapter": "mock", "version": "1", "deterministic": true })
        } else if is_model {
            json!({
                "adapter": "openai-compatible-vision",
                "version": env!("CARGO_PKG_VERSION"),
                "procedure": step.procedure_key,
                "modelDeployment": step.parameters.get("modelDeployment"),
                "modelProfile": step.parameters.get("modelProfile"),
                "contractVersion": step.parameters.get("contractVersion"),
                "deterministic": false
            })
        } else {
            json!({
                "adapter": "deterministic-local",
                "version": env!("CARGO_PKG_VERSION"),
                "procedure": step.procedure_key,
                "deterministic": true
            })
        })?,
        receipt: canonical(json!({
            "outcome": "succeeded",
            "attemptNumber": step.attempt_number
        }))?,
    })
}

fn input_role(input: &MaterializedInput) -> &'static str {
    match input.envelope.type_key.as_str() {
        "core.file" => "source",
        "core.file-inspection" => "inspection",
        "docs.page" => "page",
        "docs.extracted-text" => "text",
        "docs.text-layout" => "layout",
        "core.content-description" => "description",
        "core.document-classification" => "document-classification",
        "bookkeeping.invoice-candidate" | "banking.account-statement-candidate" => "candidate",
        "bookkeeping.invoice-details" => "details",
        "core.content-classification" => {
            if input.envelope.payload_field("subjectLevel") == Some("page") {
                "page-classification"
            } else {
                "content-classification"
            }
        }
        _ => "input",
    }
}

trait PayloadField {
    fn payload_field(&self, key: &str) -> Option<&str>;
}

impl PayloadField for ArtifactEnvelope {
    fn payload_field(&self, key: &str) -> Option<&str> {
        let aven_artifact_store_contract::CanonicalValue::Object(object) = &self.payload else {
            return None;
        };
        let aven_artifact_store_contract::CanonicalValue::String(value) = object.get(key)? else {
            return None;
        };
        Some(value)
    }
}

pub(crate) fn output(
    step: &ClaimedStep,
    artifacts: Vec<IntentArtifact>,
    evidence: Vec<EvidenceIntent>,
    blobs: Vec<(&str, &str, Vec<u8>)>,
) -> Result<ExecutionOutput, ExecutorError> {
    let mut authorities = BTreeMap::new();
    let mut generated = Vec::new();
    for (key, media_type, bytes) in blobs {
        let claim_id = Uuid::new_v4();
        let key = local_key(key)?;
        authorities.insert(key.clone(), BlobAuthority::UploadClaim { claim_id });
        generated.push(GeneratedBlob {
            local_key: key.as_str().to_owned(),
            claim_id,
            media_type: media_type.to_owned(),
            bytes,
        });
    }
    Ok(ExecutionOutput {
        submission: PublicationSubmission {
            intent: PublicationIntent {
                command_version: 1,
                publication_id: step.publication_id,
                scope_id: step.scope_id,
                body: PublicationBody::Run {
                    run: Box::new(RunIntent {
                        procedure_key: type_key(&step.procedure_key)?,
                        procedure_version: "mock-v1".into(),
                        initiator: service_actor("artifact-processing-coordinator")?,
                        executor: service_actor("mock-artifact-processor")?,
                        inputs: Vec::new(),
                        parameters: canonical(json!({}))?,
                        implementation: canonical(json!({}))?,
                        receipt: canonical(json!({}))?,
                    }),
                },
                artifacts,
                evidence,
            },
            blob_authorities: authorities,
        },
        blobs: generated,
    })
}

pub(crate) fn single_artifact(
    step: &ClaimedStep,
    artifact: IntentArtifact,
    evidence: Vec<EvidenceIntent>,
) -> Result<ExecutionOutput, ExecutorError> {
    output(step, vec![artifact], evidence, Vec::new())
}

pub(crate) fn artifact(
    local: &str,
    type_name: &str,
    payload: Value,
    blob: Option<&[u8]>,
    output_role: &str,
    output_ordinal: u32,
) -> Result<IntentArtifact, ExecutorError> {
    Ok(IntentArtifact {
        local_key: local_key(local)?,
        type_key: type_key(type_name)?,
        type_version: 1,
        payload: canonical(payload)?,
        blob: blob.map(|bytes| DeclaredBlob {
            sha256: sha256_hex(bytes),
            length: bytes.len() as u64,
        }),
        references: Vec::new(),
        output: Some(OutputBinding {
            role: role(output_role)?,
            ordinal: output_ordinal,
        }),
    })
}

pub(crate) fn whole_source_evidence(
    output_local_key: &str,
    ordinal: u32,
) -> Result<EvidenceIntent, ExecutorError> {
    Ok(EvidenceIntent {
        ordinal,
        output_local_key: local_key(output_local_key)?,
        output_locator: Locator::ArtifactRoot,
        input_role: role("source")?,
        input_ordinal: 0,
        input_locator: Locator::ArtifactRoot,
    })
}

pub(crate) fn page_evidence(
    output_local_key: &str,
    ordinal: u32,
    page: u32,
) -> Result<EvidenceIntent, ExecutorError> {
    Ok(EvidenceIntent {
        ordinal,
        output_local_key: local_key(output_local_key)?,
        output_locator: Locator::ArtifactRoot,
        input_role: role("source")?,
        input_ordinal: 0,
        input_locator: whole_page(page),
    })
}

pub(crate) const fn whole_page(page: u32) -> Locator {
    Locator::PageRegion {
        page,
        x: 0,
        y: 0,
        width: 1_000_000,
        height: 1_000_000,
    }
}

fn page_parameter(step: &ClaimedStep) -> Result<usize, ExecutorError> {
    let page = step
        .parameters
        .get("page")
        .and_then(Value::as_u64)
        .ok_or_else(|| ExecutorError::Invalid("page parameter is missing".into()))?;
    usize::try_from(page).map_err(|_| ExecutorError::Invalid("page parameter overflow".into()))
}

fn integer_field(value: &Value, key: &str) -> Result<i64, ExecutorError> {
    value
        .get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| ExecutorError::Invalid(format!("candidate field {key} is invalid")))
}

#[allow(clippy::needless_pass_by_value)]
pub(crate) fn canonical(
    value: Value,
) -> Result<aven_artifact_store_contract::CanonicalValue, ExecutorError> {
    let bytes =
        serde_json::to_vec(&value).map_err(|error| ExecutorError::Canonical(error.to_string()))?;
    parse_canonical(&bytes, value.is_object())
        .map_err(|error| ExecutorError::Canonical(error.to_string()))
}

pub(crate) fn local_key(value: &str) -> Result<LocalKey, ExecutorError> {
    LocalKey::new(value).map_err(|error| ExecutorError::Canonical(error.to_string()))
}

pub(crate) fn role(value: &str) -> Result<Role, ExecutorError> {
    Role::new(value).map_err(|error| ExecutorError::Canonical(error.to_string()))
}

fn type_key(value: &str) -> Result<TypeKey, ExecutorError> {
    TypeKey::new(value).map_err(|error| ExecutorError::Canonical(error.to_string()))
}

fn service_actor(id: &str) -> Result<Actor, ExecutorError> {
    let actor = Actor {
        kind: type_key("service")?,
        id: id.to_owned(),
    };
    actor
        .validate()
        .map_err(|error| ExecutorError::Canonical(error.to_string()))?;
    Ok(actor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_mock_facets() {
        let bytes = br#"{
          "title":"Bad fixture",
          "documentKind":"invoice",
          "pages":[{"facets":["execute-macro"],"text":"","visualSummary":""}],
          "invoice":null
        }"#;
        assert!(matches!(
            parse_mock_document(bytes),
            Err(ExecutorError::Invalid(_))
        ));
    }
}
