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
pub const BOOKKEEPING_OPEN_ITEM: &str = "bookkeeping.open-item";
pub const BANKING_STATEMENT: &str = "banking.statement";
pub const BANKING_TRANSACTION: &str = "banking.transaction";
pub const RECONCILIATION_MATCH_CANDIDATE: &str = "reconciliation.match-candidate";

const CORE_FILE_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/core.file.v1.json");
const CORE_BUNDLE_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/core.bundle.v1.json");
const CORE_FILE_INSPECTION_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/core.file-inspection.v1.json");
const CORE_FILE_INSPECTION_V2_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/core.file-inspection.v2.json");
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
const BOOKKEEPING_INVOICE_CANDIDATE_V2_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/bookkeeping.invoice-candidate.v2.json");
const BOOKKEEPING_INVOICE_VALIDATION_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/bookkeeping.invoice-validation.v1.json");
const BOOKKEEPING_INVOICE_DETAILS_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/bookkeeping.invoice-details.v2.json");
const BANKING_ACCOUNT_STATEMENT_CANDIDATE_JSON: &[u8] = include_bytes!(
    "../../../conformance/fixtures/protocol/banking.account-statement-candidate.v2.json"
);
const BANKING_STATEMENT_VALIDATION_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/banking.statement-validation.v1.json");
const BOOKKEEPING_OPEN_ITEM_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/bookkeeping.open-item.v1.json");
const BANKING_STATEMENT_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/banking.statement.v1.json");
const BANKING_TRANSACTION_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/banking.transaction.v1.json");
const RECONCILIATION_MATCH_CANDIDATE_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/reconciliation.match-candidate.v1.json");
const RECONCILIATION_MATCH_CANDIDATE_V2_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/reconciliation.match-candidate.v2.json");
const INTENT_DECLARATION_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/intent.declaration.v1.json");
const RECONCILIATION_DECISION_JSON: &[u8] =
    include_bytes!("../../../conformance/fixtures/protocol/reconciliation.decision.v1.json");

/// Exact source-controlled built-ins registered by the first migration.
///
/// # Errors
///
/// Returns an error if a source fixture is not valid Artifact JSON or does not match
/// the closed type-definition DTO.
pub fn builtin_type_definitions() -> Result<Vec<TypeDefinition>, crate::CoreError> {
    [
        CORE_FILE_JSON,
        include_bytes!("../../../conformance/fixtures/protocol/actors.port-result.v1.json"),
        include_bytes!("../../../conformance/fixtures/protocol/actors.execution-receipt.v1.json"),
        include_bytes!("../../../conformance/fixtures/protocol/studio.skill.v2.json"),
        include_bytes!("../../../conformance/fixtures/protocol/studio.activation.v2.json"),
        include_bytes!("../../../conformance/fixtures/protocol/studio.source.v1.json"),
        include_bytes!("../../../conformance/fixtures/protocol/studio.subscription.v2.json"),
        include_bytes!("../../../conformance/fixtures/protocol/studio.email.v1.json"),
        include_bytes!("../../../conformance/fixtures/protocol/studio.understanding.v1.json"),
        include_bytes!("../../../conformance/fixtures/protocol/studio.brief.v1.json"),
        include_bytes!(
            "../../../conformance/fixtures/protocol/bookkeeping.invoice-candidate.v3.json"
        ),
        include_bytes!("../../../conformance/fixtures/protocol/core.file-inspection.v3.json"),
        include_bytes!("../../../conformance/fixtures/protocol/docs.page.v2.json"),
        include_bytes!("../../../conformance/fixtures/protocol/docs.extracted-text.v2.json"),
        include_bytes!("../../../conformance/fixtures/protocol/docs.text-layout.v2.json"),
        include_bytes!(
            "../../../conformance/fixtures/protocol/bookkeeping.invoice-details.v3.json"
        ),
        include_bytes!(
            "../../../conformance/fixtures/protocol/banking.account-statement-candidate.v3.json"
        ),
        include_bytes!("../../../conformance/fixtures/protocol/banking.statement.v2.json"),
        include_bytes!("../../../conformance/fixtures/protocol/banking.transaction.v2.json"),
        CORE_BUNDLE_JSON,
        CORE_FILE_INSPECTION_JSON,
        CORE_FILE_INSPECTION_V2_JSON,
        DOCS_PAGE_JSON,
        CORE_CONTENT_CLASSIFICATION_JSON,
        CORE_CONTENT_DESCRIPTION_JSON,
        DOCS_EXTRACTED_TEXT_JSON,
        DOCS_TEXT_LAYOUT_JSON,
        CORE_DOCUMENT_CLASSIFICATION_JSON,
        BOOKKEEPING_INVOICE_CANDIDATE_JSON,
        BOOKKEEPING_INVOICE_CANDIDATE_V2_JSON,
        BOOKKEEPING_INVOICE_VALIDATION_JSON,
        BOOKKEEPING_INVOICE_DETAILS_JSON,
        BANKING_ACCOUNT_STATEMENT_CANDIDATE_JSON,
        include_bytes!(
            "../../../conformance/fixtures/protocol/banking.csv-statement-detection.v1.json"
        ),
        include_bytes!(
            "../../../conformance/fixtures/protocol/banking.csv-statement-confirmation.v1.json"
        ),
        BANKING_STATEMENT_VALIDATION_JSON,
        BOOKKEEPING_OPEN_ITEM_JSON,
        BANKING_STATEMENT_JSON,
        BANKING_TRANSACTION_JSON,
        RECONCILIATION_MATCH_CANDIDATE_JSON,
        RECONCILIATION_MATCH_CANDIDATE_V2_JSON,
        RECONCILIATION_DECISION_JSON,
        INTENT_DECLARATION_JSON,
    ]
    .into_iter()
    .map(|bytes| {
        let canonical = parse_canonical(bytes, true)?;
        let normalized = canonical.canonical_bytes();
        Ok(serde_json::from_slice(&normalized)?)
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use aven_artifact_store_contract::{Role, TypeKey};

    #[test]
    fn neutral_actor_result_types_validate_empty_and_exact_membership() {
        let catalog = crate::TypeCatalog::from_definitions(builtin_type_definitions().unwrap())
            .expect("built-ins should register");
        let result_key = TypeKey::new("actors.port-result").unwrap();
        let result = catalog
            .get(&result_key, 1)
            .expect("port result must be installed");
        for bytes in [
            br#"{"invocationId":"exact-call","port":"details","cardinality":"optional","members":[]}"#.as_slice(),
            br#"{"invocationId":"exact-call","port":"members","cardinality":"many","members":[{"memberKey":"left","referenceOrdinal":0},{"memberKey":"right","referenceOrdinal":1}]}"#.as_slice(),
        ] {
            let payload = parse_canonical(bytes, true).unwrap();
            catalog.validate_payload(result, &payload).expect("valid result payload");
        }
        for bytes in [
            br#"{"invocationId":"exact-call","port":"members","cardinality":"many","members":[{"memberKey":"left","referenceOrdinal":256}]}"#.as_slice(),
            br#"{"invocationId":"exact-call","port":"members","cardinality":"invented","members":[]}"#.as_slice(),
        ] {
            let payload = parse_canonical(bytes, true).unwrap();
            assert!(catalog.validate_payload(result, &payload).is_err());
        }
        let receipt_key = TypeKey::new("actors.execution-receipt").unwrap();
        let receipt = catalog
            .get(&receipt_key, 1)
            .expect("execution receipt must be installed");
        let payload = parse_canonical(br#"{"invocationId":"exact-call","capabilityId":"os.aven:capability:fixture:inspect@1","implementationRef":"test-instance","outcome":"completed"}"#, true).unwrap();
        catalog
            .validate_payload(receipt, &payload)
            .expect("valid execution receipt");
        let input_role = Role::new("input").unwrap();
        let exact_input = parse_canonical(br#"{"slot":"source","role":"input"}"#, true).unwrap();
        catalog
            .validate_attributes(receipt, &input_role, &exact_input)
            .expect("receipt input retains named provenance");
        let missing_role = parse_canonical(br#"{"slot":"source"}"#, true).unwrap();
        assert!(catalog
            .validate_attributes(receipt, &input_role, &missing_role)
            .is_err());
        let member_role = Role::new("member").unwrap();
        let empty_attributes = parse_canonical(br#"{}"#, true).unwrap();
        catalog
            .validate_attributes(result, &member_role, &empty_attributes)
            .expect("port member reference has no private attributes");
    }

    #[test]
    fn v2_skill_store_type_accepts_closed_named_ports_not_executable_fields() {
        let catalog = crate::TypeCatalog::from_definitions(builtin_type_definitions().unwrap())
            .expect("built-ins should register");
        let key = TypeKey::new("studio.skill").unwrap();
        let registered = catalog
            .get(&key, 2)
            .expect("v2 Skill type must be installed");
        assert_eq!(
            registered.type_definition_sha256,
            "19eceedc0b9ed8e5694d39c14d559340ad835ec42dc35d6cd426d54dc5568512",
            "the Studio publisher must pin the exact source-controlled v2 type"
        );
        let sample = br#"{"version":2,"name":"Inspect record","inputs":{"source":{"schema":"fixture:input@1","type":{"key":"fixture.input","version":1},"predicate":"fixture.input(X)","role":"source","cardinality":"one"}},"parametersSchema":{"type":"object","properties":{},"required":[],"additionalProperties":false},"steps":[{"id":"inspect","label":"Inspect","kind":"invoke","capabilityId":"ceo.aven:capability:fixture:inspect@1","inputs":{"source":{"kind":"input","port":"source"}},"parameters":{},"outputs":{"summary":{"schema":"fixture:summary@1","type":{"key":"fixture.summary","version":1},"predicate":"fixture.summary(X)","role":"summary","cardinality":"one"}}}],"outputs":{"summary":{"schema":"fixture:summary@1","type":{"key":"fixture.summary","version":1},"predicate":"fixture.summary(X)","role":"summary","cardinality":"one","from":{"kind":"step","stepId":"inspect","port":"summary"}}},"policy":{"maxInvocations":16,"maxDepth":4,"maxMembers":32,"maxConcurrentChildren":2,"allowModel":false}}"#;
        let payload = parse_canonical(sample, true).unwrap();
        catalog
            .validate_payload(registered, &payload)
            .expect("closed v2 sample");
        let mut value: serde_json::Value = serde_json::from_slice(sample).unwrap();
        value["steps"][0]["script"] = "eval(secret)".into();
        let forged = parse_canonical(&serde_json::to_vec(&value).unwrap(), true).unwrap();
        assert!(catalog.validate_payload(registered, &forged).is_err());
    }

    #[test]
    fn studio_v2_activation_and_subscription_accept_settings_and_exact_skill_reference() {
        let catalog = crate::TypeCatalog::from_definitions(builtin_type_definitions().unwrap())
            .expect("built-ins should register");
        let activation = catalog
            .get(&TypeKey::new("studio.activation").unwrap(), 2)
            .expect("v2 activation must be installed");
        let activation_payload = parse_canonical(
            br#"{"contractVersion":2,"activationId":"11111111-1111-4111-8111-111111111111","skillArtifactId":"22222222-2222-4222-8222-222222222222","inputs":{"email":"33333333-3333-4333-8333-333333333333"},"parameters":{"tone":"brief"},"initiator":"user-1","origin":"manual","subscriptionArtifactId":null}"#,
            true,
        )
        .unwrap();
        catalog
            .validate_payload(activation, &activation_payload)
            .expect("v2 activation retains validated public settings");

        let subscription = catalog
            .get(&TypeKey::new("studio.subscription").unwrap(), 2)
            .expect("v2 subscription must be installed");
        let subscription_payload = parse_canonical(
            br#"{"contractVersion":2,"subscriptionId":"44444444-4444-4444-8444-444444444444","name":"Email brief","skillArtifactId":"22222222-2222-4222-8222-222222222222","sourceArtifactId":null,"inputType":{"key":"studio.email","version":1},"inputPort":"email","fixedInputs":{},"parameters":{"tone":"brief"},"generation":"55555555-5555-4555-8555-555555555555"}"#,
            true,
        )
        .unwrap();
        catalog
            .validate_payload(subscription, &subscription_payload)
            .expect("v2 subscription retains validated public settings");
        let rule = subscription
            .definition
            .reference_rules
            .iter()
            .find(|rule| rule.role.as_str() == "skill")
            .expect("subscription requires an exact skill reference");
        assert_eq!(rule.minimum, 1);
        let allowed = serde_json::to_string(&rule.allowed_target_types).unwrap();
        assert!(allowed.contains("studio.skill"));
        assert!(allowed.contains('2'));
    }

    #[test]
    fn reconciliation_payloads_validate_against_registered_builtins() {
        let catalog = crate::TypeCatalog::from_definitions(builtin_type_definitions().unwrap())
            .expect("built-ins should register");
        let samples: [(&str, &[u8]); 4] = [
            (
                BOOKKEEPING_OPEN_ITEM,
                br#"{"amountDueMinor":1200,"amountPaidMinor":null,"businessKey":"invoice:acme:re42","businessKeyBasis":"supplier-invoice-number","currency":"EUR","direction":"unknown","documentKind":"invoice","dueDate":"2026-08-30","grossMinor":1200,"invoiceNumber":"RE-42","issueDate":"2026-08-15","orderNumber":null,"references":["RE-42"],"summary":"Invoice RE-42.","supplierIbans":[],"supplierName":"ACME GmbH","validationStatus":"consistent"}"#,
            ),
            (
                BANKING_STATEMENT,
                br#"{"accountHolder":"Aven GmbH","accountIdentityBasis":"iban","accountRef":"iban:DE89","closingBalanceMinor":8800,"coverage":"verified","currency":"EUR","institutionName":"Example Bank","openingBalanceMinor":10000,"periodEnd":"2026-08-31","periodStart":"2026-08-01","statementKind":"monthly-statement","summary":"August statement.","transactionCount":1,"validationStatus":"consistent"}"#,
            ),
            (
                BANKING_TRANSACTION,
                br#"{"accountRef":"iban:DE89","amountMinor":-1200,"balanceAfterMinor":8800,"bookingDate":"2026-08-18","counterpartyIban":null,"counterpartyName":"ACME GmbH","dedupBasis":"provider-id","dedupKey":"provider:iban:DE89:tx42","description":"Invoice RE-42","exchangeRate":null,"foreignExchangeFeeBps":null,"fxSurchargeMinor":null,"originalAmountMinor":null,"originalCurrency":null,"providerTransactionId":"tx42","sourceOrdinal":0,"sourceRow":17,"statementCoverage":"verified","statementValidationStatus":"consistent","title":"SEPA transfer","valueDate":"2026-08-18","currency":"EUR"}"#,
            ),
            (
                RECONCILIATION_MATCH_CANDIDATE,
                br#"{"amountDistanceMinor":0,"amountMatchBasis":"account","blockers":["open-item-direction-unknown"],"counterpartyMatch":"exact","dueDateDistanceDays":12,"duplicateCount":1,"ibanMatch":false,"issueDateDistanceDays":3,"matchedTransactionAmountMinor":-1200,"matchedTransactionCurrency":"EUR","matcherVersion":"invoice-transaction-v1","openItemBusinessKey":"invoice:acme:re42","pairEligible":false,"rank":1,"rankScore":8250,"reasons":["exact-account-amount"],"recommendation":"review","referenceMatch":"exact","signMatch":"unknown","transactionDedupKey":"provider:iban:DE89:tx42"}"#,
            ),
        ];

        for (type_key, bytes) in samples {
            let key = TypeKey::new(type_key).expect("sample type key should be valid");
            let registered = catalog.get(&key, 1).expect("sample built-in should exist");
            let payload = parse_canonical(bytes, true).expect("sample payload should be canonical");
            catalog
                .validate_payload(registered, &payload)
                .unwrap_or_else(|error| panic!("{type_key} sample failed validation: {error}"));
            if type_key == RECONCILIATION_MATCH_CANDIDATE {
                let current = catalog
                    .get(&key, 2)
                    .expect("current match schema should exist");
                let mut value: serde_json::Value = serde_json::from_slice(bytes).unwrap();
                value["matcherVersion"] = "invoice-transaction-v2".into();
                let missing_ordinal =
                    parse_canonical(&serde_json::to_vec(&value).unwrap(), true).unwrap();
                assert!(catalog.validate_payload(current, &missing_ordinal).is_err());
                value["transactionInputOrdinal"] = 0.into();
                let current_payload =
                    parse_canonical(&serde_json::to_vec(&value).unwrap(), true).unwrap();
                catalog
                    .validate_payload(current, &current_payload)
                    .expect("current match requires exact occurrence ordinal");
            }
        }
    }
}
