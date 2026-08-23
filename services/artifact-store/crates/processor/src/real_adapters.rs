use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use aven_artifact_store_contract::{
    sha256_hex, EvidenceIntent, Locator, ReferenceIntent, ReferenceTarget,
};
use roxmltree::Document;
use serde_json::{json, Value};
use wait_timeout::ChildExt;

use crate::executor::{
    artifact, canonical, local_key, output, page_evidence, role, single_artifact, whole_page,
    ExecutorError, MaterializedInput,
};
use crate::model::{ClaimedStep, ExecutionOutput};

const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;
// One decomposition publication contains every page plus one bundle, while the
// Artifact Store admits at most 64 artifacts atomically. Larger documents are
// rejected explicitly until the coordinator has durable batch planning.
const MAX_PAGES: usize = 63;
const MAX_DECODER_OUTPUT: usize = 4 * 1024 * 1024;
const MAX_RENDER_BYTES: usize = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS: u64 = 40_000_000;
const MAX_TEXT_BYTES: usize = 2_000_000;
const MAX_LAYOUT_SPANS: usize = 512;
const DECODER_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MediaKind {
    Pdf,
    Png,
    Jpeg,
    Unsupported,
}

pub(crate) struct RenderedPage {
    pub media_type: &'static str,
    pub bytes: Vec<u8>,
}

pub(crate) fn render_page_for_model(
    source: &[u8],
    page: usize,
) -> Result<RenderedPage, ExecutorError> {
    if !(1..=MAX_PAGES).contains(&page) {
        return Err(ExecutorError::Invalid(
            "page parameter is outside bounds".into(),
        ));
    }
    match detect_media(source) {
        MediaKind::Pdf => {
            let page_text = page.to_string();
            let bytes = run_decoder_with_limit(
                "pdftoppm",
                &[
                    "-f",
                    &page_text,
                    "-l",
                    &page_text,
                    "-singlefile",
                    "-r",
                    "144",
                    "-png",
                ],
                &["page"],
                source,
                "input.pdf",
                MAX_RENDER_BYTES,
            )?;
            let dimensions = png_dimensions(&bytes).ok_or_else(|| {
                ExecutorError::Invalid("page renderer returned invalid PNG".into())
            })?;
            validate_image_area(dimensions)?;
            Ok(RenderedPage {
                media_type: "image/png",
                bytes,
            })
        }
        MediaKind::Png => {
            validate_image_area(png_dimensions(source).ok_or_else(|| {
                ExecutorError::Invalid("source PNG dimensions are invalid".into())
            })?)?;
            Ok(RenderedPage {
                media_type: "image/png",
                bytes: source.to_vec(),
            })
        }
        MediaKind::Jpeg => {
            validate_image_area(jpeg_dimensions(source).ok_or_else(|| {
                ExecutorError::Invalid("source JPEG dimensions are invalid".into())
            })?)?;
            let visual = jpeg_visual_bytes(source).ok_or_else(|| {
                ExecutorError::Invalid("source JPEG has no valid end marker".into())
            })?;
            Ok(RenderedPage {
                media_type: "image/jpeg",
                // Camera metadata or transport residue after EOI is not visual input and may
                // contain sensitive bytes. Preserve it in the immutable source, but never send
                // it to the vision provider.
                bytes: visual.to_vec(),
            })
        }
        MediaKind::Unsupported => Err(ExecutorError::Unsupported(
            "vision input must be PDF, PNG, or JPEG".into(),
        )),
    }
}

fn validate_image_area((width, height): (u32, u32)) -> Result<(), ExecutorError> {
    let pixels = u64::from(width).saturating_mul(u64::from(height));
    if pixels > MAX_IMAGE_PIXELS {
        return Err(ExecutorError::LimitExceeded(format!(
            "image has {pixels} pixels; maximum is {MAX_IMAGE_PIXELS}"
        )));
    }
    Ok(())
}

impl MediaKind {
    const fn media_type(self) -> &'static str {
        match self {
            Self::Pdf => "application/pdf",
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Unsupported => "application/octet-stream",
        }
    }
}

#[derive(Clone, Debug)]
struct PageGeometry {
    width: f64,
    height: f64,
    rotation: u32,
}

#[derive(Clone, Debug)]
struct PdfInfo {
    pages: usize,
    encrypted: bool,
    geometries: Vec<PageGeometry>,
}

#[derive(Debug)]
struct WordSpan {
    text: String,
    x_min: f64,
    y_min: f64,
    x_max: f64,
    y_max: f64,
    page_width: f64,
    page_height: f64,
}

pub(crate) fn execute(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    match step.procedure_key.as_str() {
        "core.inspect-file" => inspect(step, inputs),
        "docs.decompose-pages" => decompose(step, inputs),
        "docs.extract-native-text" => extract_native_text(step, inputs),
        "core.classify-page-signals" => classify_page(step, inputs),
        "docs.assemble-document-representation" => assemble(step, inputs),
        "core.aggregate-content-classification" => aggregate(step, inputs),
        "bookkeeping.validate-invoice" => validate_invoice(step, inputs),
        "banking.validate-statement" => validate_statement(step, inputs),
        other => Err(ExecutorError::Unsupported(format!(
            "procedure {other} is unavailable"
        ))),
    }
}

fn inspect(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    let source = source_input(step, inputs)?;
    let bytes = source_bytes(source)?;
    verify_blob(source, bytes)?;
    let kind = detect_media(bytes);
    let (outcome, readable, pages, encrypted) = match kind {
        MediaKind::Pdf => match read_pdf_info(bytes) {
            Ok(info) if info.encrypted => ("encrypted", false, info.pages, true),
            Ok(info) => ("ok", true, info.pages, false),
            Err(ExecutorError::Invalid(_)) => ("malformed", false, 0, false),
            Err(error) => return Err(error),
        },
        MediaKind::Png => match png_dimensions(bytes) {
            Some(_) => ("ok", true, 1, false),
            None => ("malformed", false, 0, false),
        },
        MediaKind::Jpeg => match jpeg_dimensions(bytes) {
            Some(_) => ("ok", true, 1, false),
            None => ("malformed", false, 0, false),
        },
        MediaKind::Unsupported => ("unsupported", false, 0, false),
    };
    if pages > MAX_PAGES {
        return Err(ExecutorError::LimitExceeded(format!(
            "document has {pages} pages; maximum is {MAX_PAGES}"
        )));
    }
    single_artifact(
        step,
        artifact(
            "inspection",
            "core.file-inspection",
            json!({
                "outcome": outcome,
                "detectedMediaType": kind.media_type(),
                "readable": readable,
                "pageCount": pages,
                "encrypted": encrypted
            }),
            None,
            "inspection",
            0,
        )?,
        vec![crate::executor::whole_source_evidence("inspection", 0)?],
    )
}

fn decompose(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    let source = source_input(step, inputs)?;
    let bytes = source_bytes(source)?;
    let kind = detect_media(bytes);
    let geometries = match kind {
        MediaKind::Pdf => read_pdf_info(bytes)?.geometries,
        MediaKind::Png => vec![geometry_from_pixels(
            png_dimensions(bytes)
                .ok_or_else(|| ExecutorError::Invalid("invalid PNG dimensions".into()))?,
        )],
        MediaKind::Jpeg => vec![geometry_from_pixels(
            jpeg_dimensions(bytes)
                .ok_or_else(|| ExecutorError::Invalid("invalid JPEG dimensions".into()))?,
        )],
        MediaKind::Unsupported => {
            return Err(ExecutorError::Unsupported(
                "unsupported media cannot be decomposed".into(),
            ))
        }
    };
    if geometries.is_empty() || geometries.len() > MAX_PAGES {
        return Err(ExecutorError::LimitExceeded(format!(
            "page count {} is outside 1..={MAX_PAGES}",
            geometries.len()
        )));
    }

    let title = payload_value(source)
        .get("originalName")
        .and_then(Value::as_str)
        .map_or_else(
            || "Document".into(),
            |name| name.chars().take(255).collect::<String>(),
        );
    let mut artifacts = Vec::with_capacity(geometries.len() + geometries.len().div_ceil(64));
    let mut evidence = Vec::with_capacity(geometries.len());
    let mut bundle_members = Vec::new();
    for (index, geometry) in geometries.iter().enumerate() {
        let page = u32::try_from(index + 1)
            .map_err(|_| ExecutorError::LimitExceeded("page number overflow".into()))?;
        let key = format!("page-{page:03}");
        let (width, height) = normalized_page_dimensions(geometry);
        artifacts.push(artifact(
            &key,
            "docs.page",
            json!({
                "sourcePage": page,
                "rotationDegrees": geometry.rotation,
                "widthUnits": width,
                "heightUnits": height
            }),
            None,
            "page",
            page - 1,
        )?);
        bundle_members.push((key.clone(), page));
        evidence.push(page_evidence(&key, page - 1, page)?);
    }
    for (bundle_index, chunk) in bundle_members.chunks(64).enumerate() {
        let bundle_key = format!("pages-{:03}", bundle_index + 1);
        let mut bundle = artifact(
            &bundle_key,
            "core.bundle",
            json!({ "purpose": "document-pages", "displayName": title }),
            None,
            "page-bundle",
            u32::try_from(bundle_index)
                .map_err(|_| ExecutorError::LimitExceeded("bundle ordinal overflow".into()))?,
        )?;
        bundle.references = chunk
            .iter()
            .enumerate()
            .map(|(ordinal, (key, page))| {
                Ok(ReferenceIntent {
                    role: role("member")?,
                    ordinal: u32::try_from(ordinal).map_err(|_| {
                        ExecutorError::LimitExceeded("bundle member ordinal overflow".into())
                    })?,
                    target: ReferenceTarget::Local {
                        local_key: local_key(key)?,
                    },
                    attributes: canonical(json!({
                        "path": format!("page/{page:03}"),
                        "label": format!("Page {page}")
                    }))?,
                })
            })
            .collect::<Result<Vec<_>, ExecutorError>>()?;
        artifacts.push(bundle);
    }
    output(step, artifacts, evidence, Vec::new())
}

fn extract_native_text(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    let source = source_input(step, inputs)?;
    let bytes = source_bytes(source)?;
    let page = page_parameter(step)?;
    let kind = detect_media(bytes);
    let words = if kind == MediaKind::Pdf {
        pdf_words(bytes, page)?
    } else {
        Vec::new()
    };
    let (text, spans, complete) = materialize_words(&words, page);
    let text_bytes = text.into_bytes();
    let text_artifact = artifact(
        "text",
        "docs.extracted-text",
        json!({
            "method": "native",
            "language": "und",
            "pageCount": 1,
            "characterCount": String::from_utf8_lossy(&text_bytes).chars().count(),
            "complete": complete
        }),
        Some(&text_bytes),
        "text",
        0,
    )?;
    let layout = artifact(
        "layout",
        "docs.text-layout",
        json!({
            "coordinateSpace": "normalized-millionths",
            "spans": spans,
            "complete": complete
        }),
        None,
        "layout",
        0,
    )?;
    let page_u32 = u32::try_from(page)
        .map_err(|_| ExecutorError::LimitExceeded("page number overflow".into()))?;
    let mut evidence = vec![page_evidence("layout", 0, page_u32)?];
    if !text_bytes.is_empty() {
        evidence.push(EvidenceIntent {
            ordinal: 1,
            output_local_key: local_key("text")?,
            output_locator: Locator::ByteRange {
                start: 0,
                end_exclusive: text_bytes.len() as u64,
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
        vec![("text", "text/plain; charset=utf-8", text_bytes)],
    )
}

fn classify_page(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    let source = source_input(step, inputs)?;
    let page = page_parameter(step)?;
    let text = inputs
        .iter()
        .find(|input| input.envelope.type_key.as_str() == "docs.extracted-text")
        .and_then(|input| input.content.as_deref())
        .unwrap_or_default();
    let kind = detect_media(source_bytes(source)?);
    let has_text = text.iter().any(|byte| !byte.is_ascii_whitespace());
    let (primary, facets, score, reason) = if has_text {
        (
            "document",
            vec!["native-text"],
            10_000,
            "The pinned native-text adapter returned non-whitespace text.",
        )
    } else if matches!(kind, MediaKind::Png | MediaKind::Jpeg) {
        (
            "image",
            Vec::new(),
            10_000,
            "The source is a supported single-image format; no semantic visual claim was made.",
        )
    } else {
        (
            "unknown",
            Vec::new(),
            0,
            "No trustworthy native text was present; OCR or visual analysis is required.",
        )
    };
    let page_u32 = u32::try_from(page)
        .map_err(|_| ExecutorError::LimitExceeded("page number overflow".into()))?;
    single_artifact(
        step,
        artifact(
            "classification",
            "core.content-classification",
            json!({
                "subjectLevel": "page",
                "primaryKind": primary,
                "facets": facets,
                "confidenceBps": score,
                "reason": reason,
                "resolutionMode": "rule",
                "complete": primary != "unknown"
            }),
            None,
            "classification",
            0,
        )?,
        vec![page_evidence("classification", 0, page_u32)?],
    )
}

fn assemble(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    let texts = inputs
        .iter()
        .filter(|input| input.envelope.type_key.as_str() == "docs.extracted-text")
        .collect::<Vec<_>>();
    let mut assembled = Vec::new();
    let mut spans = Vec::new();
    let mut complete = true;
    for (index, input) in texts.iter().enumerate() {
        if index > 0 {
            assembled.extend_from_slice(b"\n\n");
        }
        let start = assembled.len();
        if let Some(content) = &input.content {
            if assembled.len().saturating_add(content.len()) > MAX_TEXT_BYTES {
                complete = false;
                break;
            }
            assembled.extend_from_slice(content);
        }
        let end = assembled.len();
        if end > start && spans.len() < MAX_LAYOUT_SPANS {
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
    let methods = texts
        .iter()
        .filter_map(|input| {
            payload_value(input)
                .get("method")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect::<std::collections::BTreeSet<_>>();
    let method = if methods.len() > 1 {
        "hybrid"
    } else {
        methods.iter().next().map_or("native", String::as_str)
    };
    let text = artifact(
        "text",
        "docs.extracted-text",
        json!({
            "method": method,
            "language": "und",
            "pageCount": texts.len(),
            "characterCount": String::from_utf8_lossy(&assembled).chars().count(),
            "complete": complete
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
            "complete": complete
        }),
        None,
        "layout",
        0,
    )?;
    output(
        step,
        vec![text, layout],
        vec![crate::executor::whole_source_evidence("layout", 0)?],
        vec![("text", "text/plain; charset=utf-8", assembled)],
    )
}

fn validate_invoice(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    let candidate = inputs
        .iter()
        .find(|input| input.envelope.type_key.as_str() == "bookkeeping.invoice-candidate")
        .ok_or_else(|| ExecutorError::Invalid("invoice candidate input is missing".into()))?;
    let payload = payload_value(candidate);
    let net = payload.get("netMinor").and_then(Value::as_i64);
    let tax = payload.get("taxMinor").and_then(Value::as_i64);
    let gross = payload.get("grossMinor").and_then(Value::as_i64);
    let arithmetic = match (net, tax, gross) {
        (Some(net), Some(tax), Some(gross))
            if net
                .checked_add(tax)
                .and_then(|total| total.checked_sub(gross))
                .is_some_and(|difference| difference.unsigned_abs() <= 2) =>
        {
            "PASS"
        }
        // Invoice totals can legitimately include document-level discounts, credits,
        // withholding, shipping, or rounding that are not represented by the compact
        // candidate. Missing fields and mismatches are incomplete coverage, not proof of
        // a contradiction.
        _ => "UNKNOWN",
    };
    let identity = if payload
        .get("supplier")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
        && payload
            .get("invoiceNumber")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    {
        "PASS"
    } else {
        "FAIL"
    };
    let outcomes = [arithmetic, identity];
    let status = if outcomes.contains(&"FAIL") {
        "inconsistent"
    } else if outcomes.contains(&"UNKNOWN") {
        "insufficient-coverage"
    } else {
        "consistent"
    };
    let coverage = i32::try_from(
        outcomes
            .iter()
            .filter(|outcome| **outcome != "UNKNOWN")
            .count()
            * 5_000,
    )
    .unwrap_or(0);
    single_artifact(
        step,
        artifact(
            "validation",
            "bookkeeping.invoice-validation",
            json!({
                "rulesetVersion": "invoice-core-v1",
                "status": status,
                "coverageBps": coverage,
                "checks": [
                    {
                        "ruleId": "invoice.net-plus-tax-equals-gross",
                        "outcome": arithmetic,
                        "severity": "hard",
                        "paths": ["/netMinor", "/taxMinor", "/grossMinor"],
                        "message": "Net plus tax agrees with gross, or requires explicit adjustment coverage."
                    },
                    {
                        "ruleId": "invoice.identity-present",
                        "outcome": identity,
                        "severity": "hard",
                        "paths": ["/supplier", "/invoiceNumber"],
                        "message": "Supplier and invoice number must both be present."
                    }
                ]
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

#[allow(clippy::too_many_lines)]
fn validate_statement(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    let candidate = inputs
        .iter()
        .find(|input| input.envelope.type_key.as_str() == "banking.account-statement-candidate")
        .ok_or_else(|| ExecutorError::Invalid("statement candidate input is missing".into()))?;
    let payload = payload_value(candidate);
    let transactions = payload
        .get("transactions")
        .and_then(Value::as_array)
        .ok_or_else(|| ExecutorError::Invalid("statement transactions are invalid".into()))?;
    let opening = payload.get("openingBalanceMinor").and_then(Value::as_i64);
    let closing = payload.get("closingBalanceMinor").and_then(Value::as_i64);
    let transaction_sum = transactions.iter().try_fold(0_i64, |sum, transaction| {
        transaction
            .get("amountMinor")
            .and_then(Value::as_i64)
            .and_then(|amount| sum.checked_add(amount))
    });
    let balance = match (opening, closing, transaction_sum) {
        (Some(opening), Some(closing), Some(sum)) if opening.checked_add(sum) == Some(closing) => {
            "PASS"
        }
        (Some(_), Some(_), Some(_)) => "FAIL",
        _ => "UNKNOWN",
    };
    let period = match (
        payload.get("periodStart").and_then(Value::as_str),
        payload.get("periodEnd").and_then(Value::as_str),
    ) {
        (Some(start), Some(end)) if start <= end => "PASS",
        (Some(_), Some(_)) => "FAIL",
        _ => "UNKNOWN",
    };
    let receipt = if payload.get("statementKind").and_then(Value::as_str) == Some("payment-receipt")
    {
        if transactions.len() == 1
            && transactions[0]
                .get("amountMinor")
                .and_then(Value::as_i64)
                .is_some_and(|amount| amount < 0)
        {
            "PASS"
        } else {
            "FAIL"
        }
    } else {
        "UNKNOWN"
    };
    let outcomes = [balance, period, receipt];
    let status = if outcomes.contains(&"FAIL") {
        "inconsistent"
    } else if outcomes.iter().all(|outcome| *outcome == "UNKNOWN") {
        "incomplete"
    } else {
        "consistent"
    };
    let known = outcomes
        .iter()
        .filter(|outcome| **outcome != "UNKNOWN")
        .count();
    let coverage = u32::try_from((known * 10_000) / outcomes.len()).unwrap_or(0);
    single_artifact(
        step,
        artifact(
            "validation",
            "banking.statement-validation",
            json!({
                "rulesetVersion": "statement-core-v1",
                "status": status,
                "coverageBps": coverage,
                "checks": [
                    {
                        "ruleId": "statement.opening-plus-transactions-equals-closing",
                        "outcome": balance,
                        "severity": "hard",
                        "paths": ["/openingBalanceMinor", "/transactions", "/closingBalanceMinor"],
                        "message": "Opening balance plus transaction amounts should equal closing balance when all operands are printed."
                    },
                    {
                        "ruleId": "statement.period-ordered",
                        "outcome": period,
                        "severity": "hard",
                        "paths": ["/periodStart", "/periodEnd"],
                        "message": "Statement period start must not be after period end."
                    },
                    {
                        "ruleId": "statement.payment-receipt-shape",
                        "outcome": receipt,
                        "severity": "soft",
                        "paths": ["/statementKind", "/transactions"],
                        "message": "A payment receipt should contain exactly one outgoing transaction."
                    }
                ]
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

fn aggregate(
    step: &ClaimedStep,
    inputs: &[MaterializedInput],
) -> Result<ExecutionOutput, ExecutorError> {
    let classifications = inputs
        .iter()
        .filter(|input| input.envelope.type_key.as_str() == "core.content-classification")
        .map(payload_value)
        .collect::<Vec<_>>();
    let kinds = classifications
        .iter()
        .filter_map(|value| value.get("primaryKind").and_then(Value::as_str))
        .collect::<Vec<_>>();
    let primary = if kinds.contains(&"document") {
        "document"
    } else if !kinds.is_empty() && kinds.iter().all(|kind| *kind == "image") {
        "image"
    } else {
        "unknown"
    };
    let complete = !kinds.is_empty() && !kinds.contains(&"unknown");
    let facets = classifications
        .iter()
        .flat_map(|value| {
            value
                .get("facets")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(Value::as_str)
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    single_artifact(
        step,
        artifact(
            "classification",
            "core.content-classification",
            json!({
                "subjectLevel": "file",
                "primaryKind": primary,
                "facets": facets,
                "confidenceBps": if complete { 10_000 } else { 0 },
                "reason": "Deterministic aggregation preserved every page outcome.",
                "resolutionMode": "rule",
                "complete": complete
            }),
            None,
            "classification",
            0,
        )?,
        vec![crate::executor::whole_source_evidence("classification", 0)?],
    )
}

fn source_input<'a>(
    step: &ClaimedStep,
    inputs: &'a [MaterializedInput],
) -> Result<&'a MaterializedInput, ExecutorError> {
    inputs
        .iter()
        .find(|input| input.envelope.artifact_id == step.source_artifact_id)
        .ok_or_else(|| ExecutorError::Invalid("source input is missing".into()))
}

fn source_bytes(input: &MaterializedInput) -> Result<&[u8], ExecutorError> {
    let bytes = input
        .content
        .as_deref()
        .ok_or_else(|| ExecutorError::Invalid("source bytes are missing".into()))?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(ExecutorError::LimitExceeded(format!(
            "source exceeds {MAX_FILE_BYTES} bytes"
        )));
    }
    Ok(bytes)
}

fn verify_blob(input: &MaterializedInput, bytes: &[u8]) -> Result<(), ExecutorError> {
    let declared = input
        .envelope
        .blob
        .as_ref()
        .ok_or_else(|| ExecutorError::Invalid("source blob declaration is missing".into()))?;
    if declared.length != bytes.len() as u64 || declared.sha256 != sha256_hex(bytes) {
        return Err(ExecutorError::Invalid(
            "materialized source does not match its immutable blob declaration".into(),
        ));
    }
    Ok(())
}

fn payload_value(input: &MaterializedInput) -> Value {
    serde_json::to_value(&input.envelope.payload).unwrap_or(Value::Null)
}

fn detect_media(bytes: &[u8]) -> MediaKind {
    if bytes.starts_with(b"%PDF-") {
        MediaKind::Pdf
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        MediaKind::Png
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        MediaKind::Jpeg
    } else {
        MediaKind::Unsupported
    }
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let header = bytes.get(0..24)?;
    if !header.starts_with(b"\x89PNG\r\n\x1a\n") || &header[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(header[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(header[20..24].try_into().ok()?);
    if width == 0 || height == 0 {
        return None;
    }
    let mut offset = 8_usize;
    let mut chunks = 0_usize;
    let mut saw_header = false;
    let mut saw_data = false;
    while offset.checked_add(12)? <= bytes.len() && chunks < 10_000 {
        let length = usize::try_from(u32::from_be_bytes(
            bytes.get(offset..offset + 4)?.try_into().ok()?,
        ))
        .ok()?;
        let chunk_end = offset.checked_add(12)?.checked_add(length)?;
        if chunk_end > bytes.len() {
            return None;
        }
        let kind = bytes.get(offset + 4..offset + 8)?;
        let data_end = offset + 8 + length;
        let expected_crc = u32::from_be_bytes(bytes.get(data_end..data_end + 4)?.try_into().ok()?);
        let actual_crc = crc32fast::hash(bytes.get(offset + 4..data_end)?);
        if expected_crc != actual_crc {
            return None;
        }
        chunks += 1;
        match kind {
            b"IHDR" if !saw_header && offset == 8 && length == 13 => saw_header = true,
            b"IDAT" if saw_header => saw_data = true,
            b"IEND" if saw_header && saw_data && length == 0 => {
                return (chunk_end == bytes.len()).then_some((width, height));
            }
            b"IHDR" | b"IEND" => return None,
            _ => {}
        }
        offset = chunk_end;
    }
    None
}

fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let bytes = jpeg_visual_bytes(bytes)?;
    let mut cursor = 2;
    while cursor + 4 <= bytes.len() {
        while bytes.get(cursor) == Some(&0xff) {
            cursor += 1;
        }
        let marker = *bytes.get(cursor)?;
        cursor += 1;
        if matches!(marker, 0xd8 | 0xd9) {
            continue;
        }
        let length = usize::from(u16::from_be_bytes(
            bytes.get(cursor..cursor + 2)?.try_into().ok()?,
        ));
        if length < 2 || cursor + length > bytes.len() {
            return None;
        }
        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            let height = u32::from(u16::from_be_bytes(
                bytes.get(cursor + 3..cursor + 5)?.try_into().ok()?,
            ));
            let width = u32::from(u16::from_be_bytes(
                bytes.get(cursor + 5..cursor + 7)?.try_into().ok()?,
            ));
            return (width > 0 && height > 0).then_some((width, height));
        }
        cursor += length;
    }
    None
}

fn jpeg_visual_bytes(bytes: &[u8]) -> Option<&[u8]> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    // Skip length-delimited metadata (which may contain complete thumbnail JPEGs), then
    // scan entropy-coded image data where a literal 0xff is represented as 0xff00.
    let mut cursor = 2;
    while cursor + 1 < bytes.len() {
        if bytes[cursor] != 0xff {
            return None;
        }
        let mut marker = cursor + 1;
        while marker < bytes.len() && bytes[marker] == 0xff {
            marker += 1;
        }
        let code = *bytes.get(marker)?;
        if code == 0xd9 {
            return bytes.get(..marker + 1);
        }
        if matches!(code, 0x01 | 0xd0..=0xd8) {
            cursor = marker + 1;
            continue;
        }
        let length = usize::from(u16::from_be_bytes(
            bytes.get(marker + 1..marker + 3)?.try_into().ok()?,
        ));
        if length < 2 {
            return None;
        }
        cursor = (marker + 1).checked_add(length)?;
        if cursor > bytes.len() {
            return None;
        }
        if code != 0xda {
            continue;
        }
        loop {
            let relative = bytes.get(cursor..)?.iter().position(|byte| *byte == 0xff)?;
            let start = cursor + relative;
            let mut entropy_marker = start + 1;
            while entropy_marker < bytes.len() && bytes[entropy_marker] == 0xff {
                entropy_marker += 1;
            }
            let entropy_code = *bytes.get(entropy_marker)?;
            if entropy_code == 0x00 || matches!(entropy_code, 0xd0..=0xd7) {
                cursor = entropy_marker + 1;
                continue;
            }
            if entropy_code == 0xd9 {
                return bytes.get(..entropy_marker + 1);
            }
            // Progressive JPEGs can leave one scan and begin another marker segment.
            cursor = start;
            break;
        }
    }
    None
}

fn geometry_from_pixels((width, height): (u32, u32)) -> PageGeometry {
    PageGeometry {
        width: f64::from(width),
        height: f64::from(height),
        rotation: 0,
    }
}

fn normalized_page_dimensions(geometry: &PageGeometry) -> (u32, u32) {
    let maximum = geometry.width.max(geometry.height).max(1.0);
    let width = normalized_millionths(geometry.width, maximum);
    let height = normalized_millionths(geometry.height, maximum);
    (width.max(1), height.max(1))
}

fn read_pdf_info(bytes: &[u8]) -> Result<PdfInfo, ExecutorError> {
    let output = run_decoder("pdfinfo", &["-f", "1", "-l", "63"], &[], bytes, "input.pdf")?;
    let text = std::str::from_utf8(&output)
        .map_err(|_| ExecutorError::Invalid("pdfinfo returned non-UTF-8 output".into()))?;
    let pages = field(text, "Pages")
        .and_then(|value| value.parse::<usize>().ok())
        .ok_or_else(|| ExecutorError::Invalid("PDF page count is unavailable".into()))?;
    if pages == 0 || pages > MAX_PAGES {
        return Err(ExecutorError::LimitExceeded(format!(
            "PDF page count {pages} is outside 1..={MAX_PAGES}"
        )));
    }
    let encrypted = field(text, "Encrypted").is_some_and(|value| value.starts_with("yes"));
    let default_size =
        parse_size(field(text, "Page size").unwrap_or("612 x 792 pts")).unwrap_or((612.0, 792.0));
    let default_rotation = field(text, "Page rot")
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0);
    let mut geometries = Vec::with_capacity(pages);
    for page in 1..=pages {
        let size_key = format!("Page {page} size");
        let rotation_key = format!("Page {page} rot");
        let size = field(text, &size_key)
            .and_then(parse_size)
            .unwrap_or(default_size);
        let rotation = field(text, &rotation_key)
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(default_rotation);
        geometries.push(PageGeometry {
            width: size.0,
            height: size.1,
            rotation: normalize_rotation(rotation)?,
        });
    }
    Ok(PdfInfo {
        pages,
        encrypted,
        geometries,
    })
}

fn field<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    text.lines().find_map(|line| {
        let (candidate, value) = line.split_once(':')?;
        (candidate.trim() == key).then_some(value.trim())
    })
}

fn parse_size(value: &str) -> Option<(f64, f64)> {
    let mut parts = value.split_whitespace();
    let width = parts.next()?.parse().ok()?;
    (parts.next()? == "x").then_some(())?;
    let height = parts.next()?.parse().ok()?;
    (width > 0.0 && height > 0.0).then_some((width, height))
}

fn normalize_rotation(rotation: u32) -> Result<u32, ExecutorError> {
    match rotation % 360 {
        value @ (0 | 90 | 180 | 270) => Ok(value),
        value => Err(ExecutorError::Invalid(format!(
            "unsupported PDF page rotation {value}"
        ))),
    }
}

fn pdf_words(bytes: &[u8], page: usize) -> Result<Vec<WordSpan>, ExecutorError> {
    if page == 0 || page > MAX_PAGES {
        return Err(ExecutorError::Invalid(
            "page parameter is outside bounds".into(),
        ));
    }
    let page_string = page.to_string();
    let output = run_decoder(
        "pdftotext",
        &["-f", &page_string, "-l", &page_string, "-bbox"],
        &["-"],
        bytes,
        "input.pdf",
    )?;
    let xml = std::str::from_utf8(&output)
        .map_err(|_| ExecutorError::Invalid("pdftotext returned non-UTF-8 XML".into()))?;
    let document = Document::parse_with_options(
        xml,
        roxmltree::ParsingOptions {
            allow_dtd: true,
            nodes_limit: 20_000,
            entity_resolver: None,
        },
    )
    .map_err(|error| ExecutorError::Invalid(format!("invalid pdftotext XML: {error}")))?;
    let page_node = document
        .descendants()
        .find(|node| node.has_tag_name("page"))
        .ok_or_else(|| ExecutorError::Invalid("pdftotext returned no page".into()))?;
    let page_width = attribute_number(page_node, "width")?;
    let page_height = attribute_number(page_node, "height")?;
    document
        .descendants()
        .filter(|node| node.has_tag_name("word"))
        .map(|node| {
            Ok(WordSpan {
                text: node.text().unwrap_or_default().to_owned(),
                x_min: attribute_number(node, "xMin")?,
                y_min: attribute_number(node, "yMin")?,
                x_max: attribute_number(node, "xMax")?,
                y_max: attribute_number(node, "yMax")?,
                page_width,
                page_height,
            })
        })
        .collect()
}

fn attribute_number(node: roxmltree::Node<'_, '_>, name: &str) -> Result<f64, ExecutorError> {
    node.attribute(name)
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite())
        .ok_or_else(|| ExecutorError::Invalid(format!("invalid {name} coordinate")))
}

fn materialize_words(words: &[WordSpan], page: usize) -> (String, Vec<Value>, bool) {
    let mut text = String::new();
    let mut spans = Vec::new();
    let mut complete = true;
    for word in words {
        if word.text.is_empty() {
            continue;
        }
        if !text.is_empty() {
            text.push(' ');
        }
        let start = text.len();
        if text.len().saturating_add(word.text.len()) > MAX_TEXT_BYTES {
            complete = false;
            break;
        }
        text.push_str(&word.text);
        let end = text.len();
        if spans.len() < MAX_LAYOUT_SPANS {
            spans.push(json!({
                "start": start,
                "endExclusive": end,
                "page": page,
                "x": normalize_coordinate(word.x_min, word.page_width),
                "y": normalize_coordinate(word.y_min, word.page_height),
                "width": normalize_coordinate((word.x_max - word.x_min).max(0.0), word.page_width),
                "height": normalize_coordinate((word.y_max - word.y_min).max(0.0), word.page_height)
            }));
        } else {
            complete = false;
        }
    }
    (text, spans, complete)
}

fn normalize_coordinate(value: f64, dimension: f64) -> u32 {
    if dimension <= 0.0 {
        return 0;
    }
    normalized_millionths(value, dimension)
}

#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn normalized_millionths(value: f64, dimension: f64) -> u32 {
    ((value / dimension) * 1_000_000.0)
        .round()
        .clamp(0.0, 1_000_000.0) as u32
}

fn page_parameter(step: &ClaimedStep) -> Result<usize, ExecutorError> {
    step.parameters
        .get("page")
        .and_then(Value::as_u64)
        .and_then(|page| usize::try_from(page).ok())
        .filter(|page| (1..=MAX_PAGES).contains(page))
        .ok_or_else(|| ExecutorError::Invalid("page parameter is missing or invalid".into()))
}

fn run_decoder(
    program: &str,
    arguments: &[&str],
    trailing_arguments: &[&str],
    bytes: &[u8],
    input_name: &str,
) -> Result<Vec<u8>, ExecutorError> {
    run_decoder_with_limit(
        program,
        arguments,
        trailing_arguments,
        bytes,
        input_name,
        MAX_DECODER_OUTPUT,
    )
}

fn run_decoder_with_limit(
    program: &str,
    arguments: &[&str],
    trailing_arguments: &[&str],
    bytes: &[u8],
    input_name: &str,
    maximum_output: usize,
) -> Result<Vec<u8>, ExecutorError> {
    let executable = match program {
        "pdfinfo" => "/usr/bin/pdfinfo",
        "pdftotext" => "/usr/bin/pdftotext",
        "pdftoppm" => "/usr/bin/pdftoppm",
        _ => {
            return Err(ExecutorError::Internal(format!(
                "decoder {program} is not allowlisted"
            )))
        }
    };
    let scratch = tempfile::Builder::new()
        .prefix("aven-decoder-")
        .tempdir()
        .map_err(|error| ExecutorError::Internal(format!("scratch creation failed: {error}")))?;
    let input_path = scratch.path().join(input_name);
    let mut input = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&input_path)
        .map_err(|error| ExecutorError::Internal(format!("scratch input failed: {error}")))?;
    input
        .write_all(bytes)
        .map_err(|error| ExecutorError::Internal(format!("scratch write failed: {error}")))?;
    input
        .sync_all()
        .map_err(|error| ExecutorError::Internal(format!("scratch sync failed: {error}")))?;
    drop(input);

    let mut command = Command::new(executable);
    command
        .args(arguments)
        .arg(&input_path)
        .args(trailing_arguments)
        .current_dir(scratch.path())
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| {
        ExecutorError::Unavailable(format!("{program} could not start: {error}"))
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ExecutorError::Internal("decoder stdout was not piped".into()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ExecutorError::Internal("decoder stderr was not piped".into()))?;
    let stdout_reader = thread::spawn(move || read_bounded(stdout, maximum_output));
    let stderr_reader = thread::spawn(move || read_bounded(stderr, 64 * 1024));
    let status = child
        .wait_timeout(DECODER_TIMEOUT)
        .map_err(|error| ExecutorError::Internal(format!("decoder wait failed: {error}")))?;
    let Some(status) = status else {
        let _ = child.kill();
        let _ = child.wait();
        return Err(ExecutorError::DeadlineExceeded(format!(
            "{program} exceeded {} seconds",
            DECODER_TIMEOUT.as_secs()
        )));
    };
    let stdout = join_reader(stdout_reader, "stdout")?;
    let stderr = join_reader(stderr_reader, "stderr")?;
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr);
        return Err(ExecutorError::Invalid(format!(
            "{program} rejected the input: {}",
            detail.chars().take(512).collect::<String>()
        )));
    }
    if program == "pdftoppm" {
        let rendered = std::fs::File::open(scratch.path().join("page.png")).map_err(|error| {
            ExecutorError::Internal(format!("page renderer output is absent: {error}"))
        })?;
        return read_bounded(rendered, maximum_output)
            .map_err(|error| ExecutorError::LimitExceeded(format!("page render {error}")));
    }
    Ok(stdout)
}

fn read_bounded(mut reader: impl Read, maximum: usize) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    reader
        .by_ref()
        .take((maximum + 1) as u64)
        .read_to_end(&mut output)
        .map_err(|error| error.to_string())?;
    if output.len() > maximum {
        return Err(format!("decoder output exceeded {maximum} bytes"));
    }
    Ok(output)
}

fn join_reader(
    handle: thread::JoinHandle<Result<Vec<u8>, String>>,
    stream: &str,
) -> Result<Vec<u8>, ExecutorError> {
    handle
        .join()
        .map_err(|_| ExecutorError::Internal(format!("decoder {stream} reader panicked")))?
        .map_err(ExecutorError::LimitExceeded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signatures_win_over_names_and_declared_types() {
        assert_eq!(detect_media(b"%PDF-1.7\n"), MediaKind::Pdf);
        assert_eq!(detect_media(b"\x89PNG\r\n\x1a\nignored"), MediaKind::Png);
        assert_eq!(detect_media(&[0xff, 0xd8, 0xff, 0xe0]), MediaKind::Jpeg);
        assert_eq!(detect_media(b"invoice.pdf"), MediaKind::Unsupported);
    }

    #[test]
    fn reads_png_dimensions_without_decoding_pixels() {
        let bytes = test_png(640, 480);
        assert_eq!(png_dimensions(&bytes), Some((640, 480)));
    }

    #[test]
    fn refuses_invalid_png_dimensions() {
        let bytes = test_png(0, 480);
        assert_eq!(png_dimensions(&bytes), None);
    }

    #[test]
    fn accepts_but_does_not_forward_jpeg_trailing_data() {
        let jpeg = [
            0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x01, 0x01, 0x11,
            0x00, 0xff, 0xd9,
        ];
        let mut with_tail = jpeg.to_vec();
        with_tail.extend_from_slice(b"camera-private-tail");
        assert_eq!(jpeg_dimensions(&with_tail), Some((640, 480)));
        assert_eq!(jpeg_visual_bytes(&with_tail), Some(jpeg.as_slice()));
    }

    #[test]
    fn camera_fixture_skips_embedded_thumbnail_end_markers() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../../fixtures/artifacts/IM_00140.JPG");
        let source = std::fs::read(path).unwrap();
        let visual = jpeg_visual_bytes(&source).unwrap();
        assert_eq!(jpeg_dimensions(&source), Some((3840, 2160)));
        assert!(visual.ends_with(&[0xff, 0xd9]));
        assert!(visual.len() < source.len());
    }

    fn test_png(width: u32, height: u32) -> Vec<u8> {
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut header = Vec::from(width.to_be_bytes());
        header.extend_from_slice(&height.to_be_bytes());
        header.extend_from_slice(&[8, 2, 0, 0, 0]);
        append_chunk(&mut png, *b"IHDR", &header);
        append_chunk(&mut png, *b"IDAT", &[0]);
        append_chunk(&mut png, *b"IEND", &[]);
        png
    }

    fn append_chunk(png: &mut Vec<u8>, kind: [u8; 4], data: &[u8]) {
        png.extend_from_slice(&u32::try_from(data.len()).unwrap().to_be_bytes());
        png.extend_from_slice(&kind);
        png.extend_from_slice(data);
        let mut crc = crc32fast::Hasher::new();
        crc.update(&kind);
        crc.update(data);
        png.extend_from_slice(&crc.finalize().to_be_bytes());
    }

    #[test]
    fn normalization_preserves_page_aspect_ratio() {
        assert_eq!(
            normalized_page_dimensions(&geometry_from_pixels((200, 100))),
            (1_000_000, 500_000)
        );
    }
}
