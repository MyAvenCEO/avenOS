use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Actor, CanonicalValue, LocalKey, Role, StablePublisher, TypeKey};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BlobPolicy {
    Forbidden,
    Optional,
    Required,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceRule {
    pub role: Role,
    pub minimum: u32,
    pub maximum: u32,
    pub allowed_target_types: AllowedTargetTypes,
    pub attributes_schema: CanonicalValue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AllowedTargetTypes {
    Any,
    Exact { types: Vec<ExactType> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExactType {
    pub type_key: TypeKey,
    pub version: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TypeDefinition {
    pub type_key: TypeKey,
    pub version: u32,
    pub schema_profile_id: String,
    pub payload_schema: CanonicalValue,
    pub blob_policy: BlobPolicy,
    pub reference_rules: Vec<ReferenceRule>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegisteredTypeDefinition {
    #[serde(flatten)]
    pub definition: TypeDefinition,
    pub type_definition_sha256: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeclaredBlob {
    pub sha256: String,
    pub length: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum BlobAuthority {
    UploadClaim { claim_id: Uuid },
    SourceArtifact { artifact_id: Uuid },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReferenceTarget {
    Existing { artifact_id: Uuid },
    Local { local_key: LocalKey },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceIntent {
    pub role: Role,
    pub ordinal: u32,
    pub target: ReferenceTarget,
    pub attributes: CanonicalValue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutputBinding {
    pub role: Role,
    pub ordinal: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IntentArtifact {
    pub local_key: LocalKey,
    pub type_key: TypeKey,
    pub type_version: u32,
    pub payload: CanonicalValue,
    pub blob: Option<DeclaredBlob>,
    pub references: Vec<ReferenceIntent>,
    pub output: Option<OutputBinding>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunInput {
    pub role: Role,
    pub ordinal: u32,
    pub artifact_id: Uuid,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunIntent {
    pub procedure_key: TypeKey,
    pub procedure_version: String,
    pub initiator: Actor,
    pub executor: Actor,
    pub inputs: Vec<RunInput>,
    pub parameters: CanonicalValue,
    pub implementation: CanonicalValue,
    pub receipt: CanonicalValue,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Locator {
    ArtifactRoot,
    JsonPointer {
        pointer: String,
    },
    ByteRange {
        start: u64,
        end_exclusive: u64,
    },
    PageRegion {
        page: u32,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceIntent {
    pub ordinal: u32,
    pub output_local_key: LocalKey,
    pub output_locator: Locator,
    pub input_role: Role,
    pub input_ordinal: u32,
    pub input_locator: Locator,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PublicationBody {
    Roots { root_actor: Actor },
    Run { run: Box<RunIntent> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
// `PublicationBody` is flattened so the wire shape is the closed top-level
// `kind` union. Serde does not support `deny_unknown_fields` on a struct that
// contains `flatten`; the tagged body itself remains closed.
#[serde(rename_all = "camelCase")]
pub struct PublicationIntent {
    pub command_version: u32,
    pub publication_id: Uuid,
    pub scope_id: Uuid,
    #[serde(flatten)]
    pub body: PublicationBody,
    pub artifacts: Vec<IntentArtifact>,
    pub evidence: Vec<EvidenceIntent>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationSubmission {
    pub intent: PublicationIntent,
    pub blob_authorities: BTreeMap<LocalKey, BlobAuthority>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactResult {
    pub local_key: LocalKey,
    pub artifact_id: Uuid,
    pub artifact_sha256: String,
    pub type_definition_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationResult {
    pub scope_id: Uuid,
    pub publication_id: Uuid,
    pub publication_request_sha256: String,
    pub committed_store_epoch: Uuid,
    pub scope_sequence: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub committed_at: OffsetDateTime,
    pub run_id: Option<Uuid>,
    pub artifacts: Vec<ArtifactResult>,
    pub replayed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestContext {
    pub publisher: StablePublisher,
    pub scope_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub decision_expires_at: OffsetDateTime,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoreContext {
    pub command_version: u32,
    pub json_profile_id: String,
    pub schema_profile_id: String,
    pub store_epoch: Uuid,
    pub write_mode: String,
    pub features: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UploadDeclaration {
    pub sha256: String,
    pub length: u64,
    pub declared_media_type: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UploadClaimResult {
    pub claim_id: Uuid,
    pub scope_id: Uuid,
    pub sha256: String,
    pub length: u64,
    pub declared_media_type: String,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
    pub replayed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtifactEnvelope {
    pub artifact_id: Uuid,
    pub scope_id: Uuid,
    pub publication_id: Uuid,
    pub publication_ordinal: u32,
    pub scope_sequence: i64,
    pub type_key: TypeKey,
    pub type_version: u32,
    pub type_definition_sha256: String,
    pub payload: CanonicalValue,
    pub blob: Option<DeclaredBlob>,
    pub artifact_sha256: String,
    pub producer_run_id: Option<Uuid>,
    pub output: Option<OutputBinding>,
    #[serde(with = "time::serde::rfc3339")]
    pub committed_at: OffsetDateTime,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeedArtifact {
    pub artifact_id: Uuid,
    pub local_key: LocalKey,
    pub publication_ordinal: u32,
    pub type_key: TypeKey,
    pub type_version: u32,
    pub artifact_sha256: String,
    pub producer_run_id: Option<Uuid>,
    pub output: Option<OutputBinding>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationFeedItem {
    pub scope_id: Uuid,
    pub publication_id: Uuid,
    pub scope_sequence: i64,
    pub committed_store_epoch: Uuid,
    pub publication_request_sha256: String,
    pub kind: String,
    pub publisher: StablePublisher,
    pub run_id: Option<Uuid>,
    /// Ordered immutable inputs for `run` publications. Root publications have none.
    /// Defaulting keeps newer readers compatible with retained v1 feed responses.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inputs: Vec<RunInput>,
    #[serde(with = "time::serde::rfc3339")]
    pub committed_at: OffsetDateTime,
    pub artifacts: Vec<FeedArtifact>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationFeedPage {
    pub store_epoch: Uuid,
    pub items: Vec<PublicationFeedItem>,
    pub next_after_sequence: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blob_authority_uses_camel_case_wire_fields() {
        let authority: BlobAuthority = serde_json::from_str(
            r#"{"kind":"upload-claim","claimId":"22222222-2222-4222-8222-222222222222"}"#,
        )
        .unwrap();
        assert!(matches!(authority, BlobAuthority::UploadClaim { .. }));
        assert_eq!(
            serde_json::to_value(authority).unwrap()["claimId"],
            "22222222-2222-4222-8222-222222222222"
        );
    }

    #[test]
    fn flattened_publication_union_still_rejects_unknown_fields() {
        let json = r#"{
            "commandVersion": 1,
            "publicationId": "33333333-3333-4333-8333-333333333333",
            "scopeId": "11111111-1111-4111-8111-111111111111",
            "kind": "roots",
            "rootActor": {"kind": "user", "id": "user:daniel"},
            "artifacts": [],
            "evidence": [],
            "surprise": true
        }"#;
        assert!(serde_json::from_str::<PublicationIntent>(json).is_err());
    }

    #[test]
    fn feed_inputs_are_additive_and_keep_old_responses_readable() {
        let json = r#"{
            "scopeId": "11111111-1111-4111-8111-111111111111",
            "publicationId": "22222222-2222-4222-8222-222222222222",
            "scopeSequence": 7,
            "committedStoreEpoch": "33333333-3333-4333-8333-333333333333",
            "publicationRequestSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "kind": "run",
            "publisher": {"issuer": "aven", "subject": "processor"},
            "runId": "44444444-4444-4444-8444-444444444444",
            "committedAt": "2026-08-25T12:00:00Z",
            "artifacts": []
        }"#;
        let mut item: PublicationFeedItem = serde_json::from_str(json).unwrap();
        assert!(item.inputs.is_empty());
        item.inputs.push(RunInput {
            role: Role::new("source".to_owned()).unwrap(),
            ordinal: 0,
            artifact_id: Uuid::parse_str("55555555-5555-4555-8555-555555555555").unwrap(),
        });
        let encoded = serde_json::to_value(item).unwrap();
        assert_eq!(encoded["inputs"][0]["role"], "source");
        assert_eq!(
            encoded["inputs"][0]["artifactId"],
            "55555555-5555-4555-8555-555555555555"
        );
    }
}
