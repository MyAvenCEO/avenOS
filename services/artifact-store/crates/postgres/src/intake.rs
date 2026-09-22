//! Quarantined uploads have no readable content or executable input authority.
//! Only the authenticated API's explicit promotion publishes the admitted file.
use crate::{artifact_from_row, PostgresStore, StoreError};
use aven_artifact_store_contract::{BlobAuthority, PublicationBody};
use aven_artifact_store_core::PreparedPublication;
use serde_json::{json, Value};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub async fn admit(
    transaction: &mut Transaction<'_, Postgres>,
    prepared: &PreparedPublication,
) -> Result<(), StoreError> {
    let intent = &prepared.submission.intent;
    let inputs = match &intent.body {
        PublicationBody::Run { run } => {
            run.inputs.iter().map(|i| i.artifact_id).collect::<Vec<_>>()
        }
        _ => vec![],
    };
    let mut touched = inputs.clone();
    for artifact in &prepared.artifacts {
        for reference in &artifact.references {
            touched.push(reference.target_artifact_id);
        }
    }
    for authority in prepared.submission.blob_authorities.values() {
        if let BlobAuthority::SourceArtifact { artifact_id } = authority {
            touched.push(*artifact_id);
        }
    }
    let pending: Vec<Uuid> = sqlx::query_scalar(
        "SELECT artifact_id FROM artifact_store.artifact_contents
         WHERE scope_id=$1 AND type_key='intake.upload' AND artifact_id=ANY($2)",
    )
    .bind(intent.scope_id)
    .bind(&touched)
    .fetch_all(&mut **transaction)
    .await?;
    if pending.is_empty() {
        return Ok(());
    }
    let PublicationBody::Run { run } = &intent.body else {
        return Err(StoreError::InputUnavailable);
    };
    // Publisher identity comes from the server's configured service credential,
    // never the command. The API issuer varies by deployment domain.
    if prepared.context.publisher.subject != "service:aven-api"
        || run.procedure_key.as_str() != "intake.promote"
        || run.procedure_version != "1"
        || pending.len() != 1
        || inputs != pending
        || run.inputs[0].role.as_str() != "intake"
        || prepared.artifacts.len() != 2
        || prepared
            .artifacts
            .iter()
            .filter(|a| a.type_key.as_str() == "core.file")
            .count()
            != 1
        || prepared
            .artifacts
            .iter()
            .filter(|a| a.type_key.as_str() == "intent.declaration")
            .count()
            != 1
    {
        return Err(StoreError::InputUnavailable);
    }
    // publish() already owns the scope admission lock: competing promotions serialize.
    let promoted: bool = sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM artifact_store.artifact_run_inputs i
            JOIN artifact_store.production_runs r ON r.scope_id=i.scope_id AND r.id=i.run_id
            WHERE i.scope_id=$1 AND i.input_artifact_id=$2 AND r.procedure_key='intake.promote'
         )",
    )
    .bind(intent.scope_id)
    .bind(pending[0])
    .fetch_one(&mut **transaction)
    .await?;
    if promoted {
        return Err(StoreError::PublicationConflict);
    }
    let file = prepared
        .artifacts
        .iter()
        .find(|a| a.type_key.as_str() == "core.file")
        .unwrap();
    if !matches!(
        prepared.submission.blob_authorities.get(&file.local_key),
        Some(BlobAuthority::SourceArtifact { artifact_id }) if *artifact_id == pending[0]
    ) {
        return Err(StoreError::InputUnavailable);
    }
    Ok(())
}

impl PostgresStore {
    pub async fn inbox(
        &self,
        scope: Uuid,
        after: Option<Uuid>,
        limit: u32,
    ) -> Result<Value, StoreError> {
        let limit = limit.clamp(1, 100);
        let rows = sqlx::query(
            "SELECT r.id,r.scope_id,r.publication_id,r.publication_ordinal,r.producer_run_id,
                    r.output_role,r.output_ordinal,p.scope_sequence,p.committed_at,c.type_key,
                    c.type_version,c.type_definition_sha256::text,c.payload,c.blob_sha256::text,
                    c.blob_length,c.artifact_sha256::text
             FROM artifact_store.artifact_contents c
             JOIN artifact_store.artifact_records r ON r.scope_id=c.scope_id AND r.id=c.artifact_id
             JOIN artifact_store.publications p ON p.scope_id=r.scope_id AND p.publication_id=r.publication_id
             WHERE c.scope_id=$1 AND c.type_key='intake.upload' AND ($2::uuid IS NULL OR r.id>$2)
               AND NOT EXISTS(
                   SELECT 1 FROM artifact_store.artifact_run_inputs i
                   JOIN artifact_store.production_runs pr ON pr.scope_id=i.scope_id AND pr.id=i.run_id
                   WHERE i.scope_id=c.scope_id AND i.input_artifact_id=c.artifact_id
                     AND pr.procedure_key='intake.promote'
               )
             ORDER BY r.id LIMIT $3",
        )
        .bind(scope)
        .bind(after)
        .bind(i64::from(limit) + 1)
        .fetch_all(&self.pool)
        .await?;
        let items = rows
            .iter()
            .take(limit as usize)
            .map(artifact_from_row)
            .collect::<Result<Vec<_>, _>>()?;
        let next = if rows.len() > limit as usize {
            items.last().map(|a| a.artifact_id)
        } else {
            None
        };
        Ok(json!({"items":items,"nextAfter":next,"consistency":"live-queue"}))
    }
}
