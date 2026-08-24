use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::repository::RepositoryError;

#[derive(Clone, Debug)]
pub struct DiscoveredIntent {
    pub id: Uuid,
    pub declaration_artifact_id: Uuid,
    pub source_artifact_id: Uuid,
    pub title: String,
    pub created_at: time::OffsetDateTime,
}

#[derive(Clone)]
pub struct IntentRepository {
    pool: PgPool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentSummary {
    pub id: Uuid,
    pub title: String,
    pub routing_summary: String,
    pub state: String,
    pub source_artifact_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: time::OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: time::OffsetDateTime,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentArtifactView {
    pub artifact_id: Uuid,
    pub relation: String,
    pub type_key: String,
    pub type_version: i32,
    pub stage_key: Option<String>,
    pub display_order: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentContributionView {
    pub id: Uuid,
    pub sequence: i64,
    pub contributor_kind: String,
    pub kind: String,
    pub text: Option<String>,
    pub payload: Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: time::OffsetDateTime,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSkillView {
    pub case_id: Option<Uuid>,
    pub state: String,
    pub projection_version: Option<String>,
    pub presentation: Option<Value>,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: time::OffsetDateTime,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentDetail {
    #[serde(flatten)]
    pub intent: IntentSummary,
    pub contributions: Vec<IntentContributionView>,
    pub artifacts: Vec<IntentArtifactView>,
    pub file_skill: FileSkillView,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppendContribution {
    pub id: Uuid,
    pub contributor_kind: String,
    pub kind: String,
    pub text: Option<String>,
    #[serde(default)]
    pub payload: Value,
}

impl IntentRepository {
    #[must_use]
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self, scope_id: Uuid) -> Result<Vec<IntentSummary>, RepositoryError> {
        let rows = sqlx::query("SELECT intent.id,intent.title,intent.routing_summary,CASE skill.state WHEN 'needs_review' THEN 'waiting' WHEN 'failed' THEN 'error' ELSE intent.state END AS state,intent.source_artifact_id,intent.created_at,intent.updated_at FROM aven_intents.intents intent JOIN aven_intents.file_skills skill ON skill.intent_id=intent.id WHERE intent.scope_id=$1 ORDER BY intent.updated_at DESC,intent.id")
            .bind(scope_id).fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(summary_from_row).collect())
    }

    pub async fn detail(
        &self,
        scope_id: Uuid,
        intent_id: Uuid,
    ) -> Result<Option<IntentDetail>, RepositoryError> {
        let Some(row) = sqlx::query("SELECT intent.id,intent.title,intent.routing_summary,CASE skill.state WHEN 'needs_review' THEN 'waiting' WHEN 'failed' THEN 'error' ELSE intent.state END AS state,intent.source_artifact_id,intent.created_at,intent.updated_at FROM aven_intents.intents intent JOIN aven_intents.file_skills skill ON skill.intent_id=intent.id WHERE intent.scope_id=$1 AND intent.id=$2")
            .bind(scope_id).bind(intent_id).fetch_optional(&self.pool).await? else { return Ok(None); };
        let contributions = sqlx::query("SELECT id,sequence,contributor_kind,kind,text,payload,created_at FROM aven_intents.contributions WHERE intent_id=$1 ORDER BY sequence")
            .bind(intent_id).fetch_all(&self.pool).await?.into_iter().map(|row| IntentContributionView {
                id: row.get("id"), sequence: row.get("sequence"), contributor_kind: row.get("contributor_kind"),
                kind: row.get("kind"), text: row.get("text"), payload: row.get("payload"), created_at: row.get("created_at"),
            }).collect();
        let artifacts = sqlx::query("SELECT artifact_id,relation,type_key,type_version,stage_key,display_order FROM aven_intents.artifacts WHERE intent_id=$1 ORDER BY display_order,artifact_id")
            .bind(intent_id).fetch_all(&self.pool).await?.into_iter().map(|row| IntentArtifactView {
                artifact_id: row.get("artifact_id"), relation: row.get("relation"), type_key: row.get("type_key"),
                type_version: row.get("type_version"), stage_key: row.get("stage_key"), display_order: row.get("display_order"),
            }).collect();
        let skill = sqlx::query("SELECT case_id,state,projection_version,presentation,updated_at FROM aven_intents.file_skills WHERE intent_id=$1")
            .bind(intent_id).fetch_one(&self.pool).await?;
        Ok(Some(IntentDetail {
            intent: summary_from_row(row),
            contributions,
            artifacts,
            file_skill: FileSkillView {
                case_id: skill.get("case_id"),
                state: skill.get("state"),
                projection_version: skill.get("projection_version"),
                presentation: skill.get("presentation"),
                updated_at: skill.get("updated_at"),
            },
        }))
    }

    pub async fn append(
        &self,
        scope_id: Uuid,
        intent_id: Uuid,
        input: &AppendContribution,
    ) -> Result<Option<IntentContributionView>, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let owned: Option<bool> = sqlx::query_scalar(
            "SELECT true FROM aven_intents.intents WHERE scope_id=$1 AND id=$2 FOR UPDATE",
        )
        .bind(scope_id)
        .bind(intent_id)
        .fetch_optional(&mut *transaction)
        .await?;
        if owned.is_none()
            || !matches!(input.contributor_kind.as_str(), "human" | "agent")
            || input.kind.is_empty()
            || input.kind.len() > 64
            || input.text.as_deref().is_some_and(|v| v.len() > 100_000)
            || !input.payload.is_object()
            || serde_json::to_vec(&input.payload)?.len() > 64 * 1024
        {
            return Ok(None);
        }
        let row = sqlx::query("INSERT INTO aven_intents.contributions (id,intent_id,sequence,contributor_kind,kind,text,payload,idempotency_key) VALUES($1,$2,(SELECT COALESCE(max(sequence),0)+1 FROM aven_intents.contributions WHERE intent_id=$2),$3,$4,$5,$6,$7) ON CONFLICT(intent_id,idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING id,sequence,contributor_kind,kind,text,payload,created_at")
            .bind(input.id).bind(intent_id).bind(&input.contributor_kind).bind(&input.kind).bind(&input.text).bind(&input.payload).bind(input.id.to_string())
            .fetch_one(&mut *transaction).await?;
        sqlx::query("UPDATE aven_intents.intents SET updated_at=clock_timestamp(),version=version+1 WHERE id=$1")
            .bind(intent_id).execute(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(Some(IntentContributionView {
            id: row.get("id"),
            sequence: row.get("sequence"),
            contributor_kind: row.get("contributor_kind"),
            kind: row.get("kind"),
            text: row.get("text"),
            payload: row.get("payload"),
            created_at: row.get("created_at"),
        }))
    }
}

fn summary_from_row(row: sqlx::postgres::PgRow) -> IntentSummary {
    IntentSummary {
        id: row.get("id"),
        title: row.get("title"),
        routing_summary: row.get("routing_summary"),
        state: row.get("state"),
        source_artifact_id: row.get("source_artifact_id"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}
