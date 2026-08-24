use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, PgPool, Postgres, Row, Transaction};
use thiserror::Error;
use time::OffsetDateTime;
use uuid::Uuid;

const MIGRATIONS: &[(i32, &str)] = &[(1, include_str!("../migrations/0001_intents.sql"))];

#[derive(Clone)]
pub struct IntentRepository {
    pool: PgPool,
}

#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("intent migration checksum drift")]
    MigrationDrift,
    #[error("invalid runtime role")]
    InvalidRole,
    #[error("artifact store epoch changed from {expected} to {actual}")]
    EpochChanged { expected: Uuid, actual: Uuid },
    #[error("artifact feed cursor moved concurrently")]
    CursorMoved,
}

#[derive(Clone, Debug)]
pub struct DiscoveredIntent {
    pub id: Uuid,
    pub declaration_artifact_id: Uuid,
    pub source_artifact_id: Uuid,
    pub title: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentSummary {
    pub id: Uuid,
    pub title: String,
    pub intent_type: String,
    pub source_label: String,
    pub deadline: Option<String>,
    pub routing_summary: String,
    pub state: String,
    pub version: i64,
    pub source_artifact_id: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
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
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSkillView {
    pub state: String,
    pub projection_version: Option<String>,
    pub presentation: Option<Value>,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntentDetail {
    #[serde(flatten)]
    pub intent: IntentSummary,
    pub contributions: Vec<IntentContributionView>,
    pub artifacts: Vec<IntentArtifactView>,
    pub file_skill: Option<FileSkillView>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateIntent {
    pub id: Uuid,
    pub title: String,
    #[serde(default = "default_intent_type")]
    pub intent_type: String,
    #[serde(default = "default_source_label")]
    pub source_label: String,
    pub deadline: Option<String>,
    pub routing_summary: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateIntent {
    pub expected_version: i64,
    pub title: Option<String>,
    pub intent_type: Option<String>,
    pub source_label: Option<String>,
    pub deadline: Option<String>,
    #[serde(default)]
    pub clear_deadline: bool,
    pub routing_summary: Option<String>,
    pub state: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppendContribution {
    pub id: Uuid,
    pub contributor_kind: String,
    pub kind: String,
    pub text: Option<String>,
    #[serde(default = "empty_object")]
    pub payload: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VersionCommand {
    pub id: Uuid,
    pub expected_version: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergeCommand {
    pub id: Uuid,
    pub expected_version: i64,
    pub source_intent_ids: Vec<Uuid>,
}

fn default_intent_type() -> String {
    "intent".into()
}

fn default_source_label() -> String {
    "Conversation".into()
}

fn empty_object() -> Value {
    json!({})
}

impl IntentRepository {
    pub async fn connect(
        database_url: &str,
        max_connections: u32,
    ) -> Result<Self, RepositoryError> {
        let pool = PgPoolOptions::new()
            .max_connections(max_connections)
            .acquire_timeout(std::time::Duration::from_secs(10))
            .after_connect(|connection, _| {
                Box::pin(async move {
                    sqlx::query("SET statement_timeout = '60s'")
                        .execute(&mut *connection)
                        .await?;
                    sqlx::query("SET lock_timeout = '10s'")
                        .execute(&mut *connection)
                        .await?;
                    Ok(())
                })
            })
            .connect(database_url)
            .await?;
        Ok(Self { pool })
    }

    pub async fn migrate(&self, runtime_role: &str) -> Result<(), RepositoryError> {
        if !valid_role_name(runtime_role) {
            return Err(RepositoryError::InvalidRole);
        }
        sqlx::raw_sql(
            "CREATE SCHEMA IF NOT EXISTS aven_intent_service;\
             CREATE TABLE IF NOT EXISTS aven_intent_service.schema_migrations (\
             version integer PRIMARY KEY,checksum text NOT NULL,\
             applied_at timestamptz NOT NULL DEFAULT clock_timestamp());",
        )
        .execute(&self.pool)
        .await?;
        for (version, migration) in MIGRATIONS {
            let checksum = hex::encode(Sha256::digest(migration.as_bytes()));
            let existing: Option<String> = sqlx::query_scalar(
                "SELECT checksum FROM aven_intent_service.schema_migrations WHERE version=$1",
            )
            .bind(version)
            .fetch_optional(&self.pool)
            .await?;
            if let Some(existing) = existing {
                if existing != checksum {
                    return Err(RepositoryError::MigrationDrift);
                }
            } else {
                sqlx::raw_sql(migration).execute(&self.pool).await?;
                sqlx::query(
                    "INSERT INTO aven_intent_service.schema_migrations(version,checksum) VALUES($1,$2)",
                )
                .bind(version)
                .bind(checksum)
                .execute(&self.pool)
                .await?;
            }
        }
        let quoted = format!("\"{runtime_role}\"");
        for statement in [
            format!("GRANT USAGE ON SCHEMA aven_intent_service TO {quoted}"),
            format!("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA aven_intent_service TO {quoted}"),
            format!("GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA aven_intent_service TO {quoted}"),
        ] {
            sqlx::query(&statement).execute(&self.pool).await?;
        }
        Ok(())
    }

    pub async fn ready(&self) -> Result<(), RepositoryError> {
        sqlx::query("SELECT 1 FROM aven_intent_service.schema_migrations WHERE version=1")
            .fetch_one(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn ensure_scope(&self, scope_id: Uuid) -> Result<(), RepositoryError> {
        sqlx::query(
            "INSERT INTO aven_intent_service.scopes(scope_id) VALUES($1) ON CONFLICT DO NOTHING",
        )
        .bind(scope_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn has_scope(&self, scope_id: Uuid) -> Result<bool, RepositoryError> {
        Ok(sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM aven_intent_service.scopes WHERE scope_id=$1)",
        )
        .bind(scope_id)
        .fetch_one(&self.pool)
        .await?)
    }

    pub async fn initialize_cursor(
        &self,
        scope_id: Uuid,
        store_epoch: Uuid,
    ) -> Result<i64, RepositoryError> {
        sqlx::query("INSERT INTO aven_intent_service.feed_cursors(scope_id,store_epoch,after_sequence) VALUES($1,$2,0) ON CONFLICT(scope_id) DO NOTHING")
            .bind(scope_id).bind(store_epoch).execute(&self.pool).await?;
        let row = sqlx::query(
            "SELECT store_epoch,after_sequence FROM aven_intent_service.feed_cursors WHERE scope_id=$1",
        )
        .bind(scope_id)
        .fetch_one(&self.pool)
        .await?;
        let actual: Uuid = row.get("store_epoch");
        if actual != store_epoch {
            sqlx::query("UPDATE aven_intent_service.feed_cursors SET store_epoch=$2,after_sequence=0,updated_at=clock_timestamp() WHERE scope_id=$1 AND store_epoch=$3")
                .bind(scope_id).bind(store_epoch).bind(actual).execute(&self.pool).await?;
            return Ok(0);
        }
        Ok(row.get("after_sequence"))
    }

    pub async fn record_feed_page(
        &self,
        scope_id: Uuid,
        store_epoch: Uuid,
        expected_after: i64,
        next_after: i64,
        intents: &[DiscoveredIntent],
    ) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let row = sqlx::query("SELECT store_epoch,after_sequence FROM aven_intent_service.feed_cursors WHERE scope_id=$1 FOR UPDATE")
            .bind(scope_id).fetch_one(&mut *transaction).await?;
        let actual_epoch: Uuid = row.get("store_epoch");
        if actual_epoch != store_epoch {
            return Err(RepositoryError::EpochChanged {
                expected: actual_epoch,
                actual: store_epoch,
            });
        }
        if row.get::<i64, _>("after_sequence") != expected_after {
            return Err(RepositoryError::CursorMoved);
        }
        for intent in intents {
            insert_discovered(&mut transaction, scope_id, intent).await?;
        }
        sqlx::query("UPDATE aven_intent_service.feed_cursors SET after_sequence=$2,updated_at=clock_timestamp() WHERE scope_id=$1")
            .bind(scope_id).bind(next_after).execute(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn list(&self, scope_id: Uuid) -> Result<Vec<IntentSummary>, RepositoryError> {
        let rows = sqlx::query("SELECT id,title,intent_type,source_label,deadline,routing_summary,state,version,source_artifact_id,created_at,updated_at FROM aven_intent_service.intents WHERE scope_id=$1 AND state NOT IN ('merged','deleted') ORDER BY updated_at DESC,id")
            .bind(scope_id).fetch_all(&self.pool).await?;
        Ok(rows.iter().map(summary_from_row).collect())
    }

    pub async fn detail(
        &self,
        scope_id: Uuid,
        intent_id: Uuid,
    ) -> Result<Option<IntentDetail>, RepositoryError> {
        let Some(row) = sqlx::query("SELECT id,title,intent_type,source_label,deadline,routing_summary,state,version,source_artifact_id,created_at,updated_at FROM aven_intent_service.intents WHERE scope_id=$1 AND id=$2 AND state<>'deleted'")
            .bind(scope_id).bind(intent_id).fetch_optional(&self.pool).await? else { return Ok(None); };
        let contributions = sqlx::query("SELECT id,sequence,contributor_kind,kind,text,payload,created_at FROM aven_intent_service.contributions WHERE intent_id=$1 ORDER BY sequence")
            .bind(intent_id).fetch_all(&self.pool).await?.iter().map(contribution_from_row).collect();
        let artifacts = sqlx::query("SELECT artifact_id,relation,type_key,type_version,stage_key,display_order FROM aven_intent_service.artifacts WHERE intent_id=$1 ORDER BY display_order,artifact_id")
            .bind(intent_id).fetch_all(&self.pool).await?.into_iter().map(|row| IntentArtifactView {
                artifact_id: row.get("artifact_id"), relation: row.get("relation"), type_key: row.get("type_key"),
                type_version: row.get("type_version"), stage_key: row.get("stage_key"), display_order: row.get("display_order"),
            }).collect();
        let file_skill = sqlx::query("SELECT state,projection_version,presentation,updated_at FROM aven_intent_service.file_skills WHERE intent_id=$1")
            .bind(intent_id).fetch_optional(&self.pool).await?.map(|row| FileSkillView {
                state: row.get("state"), projection_version: row.get("projection_version"),
                presentation: row.get("presentation"), updated_at: row.get("updated_at"),
            });
        Ok(Some(IntentDetail {
            intent: summary_from_row(&row),
            contributions,
            artifacts,
            file_skill,
        }))
    }

    pub async fn create(
        &self,
        scope_id: Uuid,
        input: &CreateIntent,
    ) -> Result<Option<IntentDetail>, RepositoryError> {
        if !valid_text(&input.title, 512)
            || !valid_text(&input.intent_type, 128)
            || !valid_text(&input.source_label, 256)
            || input
                .deadline
                .as_deref()
                .is_some_and(|value| !valid_text(value, 128))
        {
            return Ok(None);
        }
        let summary = input
            .routing_summary
            .clone()
            .unwrap_or_else(|| format!("Intent: {}", input.title));
        if !valid_text(&summary, 1024) {
            return Ok(None);
        }
        let mut transaction = self.pool.begin().await?;
        let result = sqlx::query("INSERT INTO aven_intent_service.intents(id,scope_id,trigger_kind,title,intent_type,source_label,deadline,routing_summary) VALUES($1,$2,'human',$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING")
            .bind(input.id).bind(scope_id).bind(input.title.trim()).bind(input.intent_type.trim())
            .bind(input.source_label.trim()).bind(input.deadline.as_deref().map(str::trim)).bind(summary.trim())
            .execute(&mut *transaction).await?;
        if result.rows_affected() == 0 {
            transaction.rollback().await?;
            let existing = self.detail(scope_id, input.id).await?;
            return Ok(existing.filter(|detail| {
                detail.intent.source_artifact_id.is_none()
                    && detail.file_skill.is_none()
                    && detail.intent.title == input.title.trim()
                    && detail.intent.intent_type == input.intent_type.trim()
                    && detail.intent.source_label == input.source_label.trim()
                    && detail.intent.deadline.as_deref() == input.deadline.as_deref().map(str::trim)
                    && detail.intent.routing_summary == summary.trim()
            }));
        }
        insert_contribution(
            &mut transaction,
            input.id,
            &AppendContribution {
                id: Uuid::new_v4(),
                contributor_kind: "system".into(),
                kind: "intent-created".into(),
                text: None,
                payload: json!({"triggerKind":"human"}),
            },
            format!("create:{}", input.id),
        )
        .await?;
        transaction.commit().await?;
        self.detail(scope_id, input.id).await
    }

    pub async fn update(
        &self,
        scope_id: Uuid,
        intent_id: Uuid,
        input: &UpdateIntent,
    ) -> Result<bool, RepositoryError> {
        if input.expected_version < 1
            || input
                .title
                .as_deref()
                .is_some_and(|value| !valid_text(value, 512))
            || input
                .intent_type
                .as_deref()
                .is_some_and(|value| !valid_text(value, 128))
            || input
                .source_label
                .as_deref()
                .is_some_and(|value| !valid_text(value, 256))
            || input
                .deadline
                .as_deref()
                .is_some_and(|value| !valid_text(value, 128))
            || input
                .routing_summary
                .as_deref()
                .is_some_and(|value| !valid_text(value, 1024))
            || input
                .state
                .as_deref()
                .is_some_and(|value| !matches!(value, "working" | "waiting" | "done" | "error"))
            || (input.title.is_none()
                && input.intent_type.is_none()
                && input.source_label.is_none()
                && input.deadline.is_none()
                && !input.clear_deadline
                && input.routing_summary.is_none()
                && input.state.is_none())
        {
            return Ok(false);
        }
        let result = sqlx::query("UPDATE aven_intent_service.intents SET title=COALESCE($4,title),intent_type=COALESCE($5,intent_type),source_label=COALESCE($6,source_label),deadline=CASE WHEN $7 THEN NULL WHEN $8::text IS NOT NULL THEN $8 ELSE deadline END,routing_summary=COALESCE($9,routing_summary),state=COALESCE($10,state),version=version+1,updated_at=clock_timestamp() WHERE scope_id=$1 AND id=$2 AND version=$3 AND state NOT IN ('merged','deleted')")
            .bind(scope_id).bind(intent_id).bind(input.expected_version)
            .bind(input.title.as_deref().map(str::trim)).bind(input.intent_type.as_deref().map(str::trim))
            .bind(input.source_label.as_deref().map(str::trim)).bind(input.clear_deadline)
            .bind(input.deadline.as_deref().map(str::trim)).bind(input.routing_summary.as_deref().map(str::trim))
            .bind(&input.state).execute(&self.pool).await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn append(
        &self,
        scope_id: Uuid,
        intent_id: Uuid,
        input: &AppendContribution,
    ) -> Result<Option<IntentContributionView>, RepositoryError> {
        if !matches!(input.contributor_kind.as_str(), "human" | "agent")
            || !valid_text(&input.kind, 64)
            || input
                .text
                .as_deref()
                .is_some_and(|value| value.chars().count() > 100_000)
            || !input.payload.is_object()
            || serde_json::to_vec(&input.payload)?.len() > 64 * 1024
        {
            return Ok(None);
        }
        let mut transaction = self.pool.begin().await?;
        let owned: Option<bool> = sqlx::query_scalar("SELECT true FROM aven_intent_service.intents WHERE scope_id=$1 AND id=$2 AND state NOT IN ('merged','deleted') FOR UPDATE")
            .bind(scope_id).bind(intent_id).fetch_optional(&mut *transaction).await?;
        if owned.is_none() {
            return Ok(None);
        }
        let idempotency_key = input.id.to_string();
        let existing = sqlx::query(
            "SELECT id,intent_id,sequence,contributor_kind,kind,text,payload,created_at \
             FROM aven_intent_service.contributions \
             WHERE id=$1 OR (intent_id=$2 AND idempotency_key=$3) LIMIT 1 FOR UPDATE",
        )
        .bind(input.id)
        .bind(intent_id)
        .bind(&idempotency_key)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(row) = existing {
            let matches = row.get::<Uuid, _>("intent_id") == intent_id
                && row.get::<String, _>("contributor_kind") == input.contributor_kind
                && row.get::<String, _>("kind") == input.kind
                && row.get::<Option<String>, _>("text") == input.text
                && row.get::<Value, _>("payload") == input.payload;
            transaction.commit().await?;
            return Ok(matches.then(|| contribution_from_row(&row)));
        }
        let row = insert_contribution(&mut transaction, intent_id, input, idempotency_key).await?;
        sqlx::query("UPDATE aven_intent_service.intents SET version=version+1,updated_at=clock_timestamp() WHERE id=$1")
            .bind(intent_id).execute(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(Some(row))
    }

    pub async fn archive_or_restore(
        &self,
        scope_id: Uuid,
        intent_id: Uuid,
        input: &VersionCommand,
        restore: bool,
    ) -> Result<bool, RepositoryError> {
        let query = if restore {
            "UPDATE aven_intent_service.intents SET state=COALESCE(state_before_archive,'working'),state_before_archive=NULL,version=version+1,updated_at=clock_timestamp() WHERE scope_id=$1 AND id=$2 AND version=$3 AND state='archive'"
        } else {
            "UPDATE aven_intent_service.intents SET state_before_archive=state,state='archive',version=version+1,updated_at=clock_timestamp() WHERE scope_id=$1 AND id=$2 AND version=$3 AND state IN ('working','waiting','done','error')"
        };
        let result = sqlx::query(query)
            .bind(scope_id)
            .bind(intent_id)
            .bind(input.expected_version)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn tombstone(
        &self,
        scope_id: Uuid,
        intent_id: Uuid,
        input: &VersionCommand,
    ) -> Result<bool, RepositoryError> {
        if input.id != intent_id {
            return Ok(false);
        }
        let result = sqlx::query("UPDATE aven_intent_service.intents SET state='deleted',version=version+1,updated_at=clock_timestamp() WHERE scope_id=$1 AND id=$2 AND version=$3 AND state NOT IN ('merged','deleted')")
            .bind(scope_id).bind(intent_id).bind(input.expected_version).execute(&self.pool).await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn merge(
        &self,
        scope_id: Uuid,
        target_id: Uuid,
        input: &MergeCommand,
    ) -> Result<bool, RepositoryError> {
        if input.id != target_id
            || input.source_intent_ids.is_empty()
            || input.source_intent_ids.contains(&target_id)
        {
            return Ok(false);
        }
        let mut sources = input.source_intent_ids.clone();
        sources.sort_unstable();
        sources.dedup();
        let mut transaction = self.pool.begin().await?;
        let target: Option<i64> = sqlx::query_scalar("SELECT version FROM aven_intent_service.intents WHERE scope_id=$1 AND id=$2 AND state NOT IN ('merged','deleted') FOR UPDATE")
            .bind(scope_id).bind(target_id).fetch_optional(&mut *transaction).await?;
        if target != Some(input.expected_version) {
            return Ok(false);
        }
        for source_id in &sources {
            let valid: Option<bool> = sqlx::query_scalar("SELECT true FROM aven_intent_service.intents WHERE scope_id=$1 AND id=$2 AND state NOT IN ('merged','deleted') FOR UPDATE")
                .bind(scope_id).bind(source_id).fetch_optional(&mut *transaction).await?;
            if valid.is_none() {
                return Ok(false);
            }
        }
        for source_id in &sources {
            sqlx::query("INSERT INTO aven_intent_service.merge_relations(target_intent_id,source_intent_id) VALUES($1,$2)")
                .bind(target_id).bind(source_id).execute(&mut *transaction).await?;
            sqlx::query("INSERT INTO aven_intent_service.artifacts(intent_id,artifact_id,relation,type_key,type_version,stage_key,display_order) SELECT $1,artifact_id,relation,type_key,type_version,stage_key,(SELECT COALESCE(max(display_order),0)+1 FROM aven_intent_service.artifacts WHERE intent_id=$1)+row_number() OVER(ORDER BY display_order,artifact_id) FROM aven_intent_service.artifacts WHERE intent_id=$2 ON CONFLICT(intent_id,artifact_id) DO NOTHING")
                .bind(target_id).bind(source_id).execute(&mut *transaction).await?;
            sqlx::query("UPDATE aven_intent_service.intents SET state='merged',merged_into_id=$1,version=version+1,updated_at=clock_timestamp() WHERE id=$2")
                .bind(target_id).bind(source_id).execute(&mut *transaction).await?;
        }
        insert_contribution(
            &mut transaction,
            target_id,
            &AppendContribution {
                id: Uuid::new_v4(),
                contributor_kind: "system".into(),
                kind: "intents-merged".into(),
                text: None,
                payload: json!({"sourceIntentIds": sources}),
            },
            input.id.to_string(),
        )
        .await?;
        sqlx::query("UPDATE aven_intent_service.intents SET version=version+1,updated_at=clock_timestamp() WHERE id=$1")
            .bind(target_id).execute(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn pending_file_sources(&self, scope_id: Uuid) -> Result<Vec<Uuid>, RepositoryError> {
        Ok(sqlx::query_scalar("SELECT intent.source_artifact_id FROM aven_intent_service.intents intent JOIN aven_intent_service.file_skills skill ON skill.intent_id=intent.id WHERE intent.scope_id=$1 AND intent.state NOT IN ('merged','deleted') AND skill.state IN ('waiting','active') ORDER BY skill.updated_at LIMIT 8")
            .bind(scope_id).fetch_all(&self.pool).await?)
    }

    pub async fn sync_file_presentation(
        &self,
        scope_id: Uuid,
        source_artifact_id: Uuid,
        presentation: &Value,
    ) -> Result<(), RepositoryError> {
        let state = presentation
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("active");
        let skill_state = match state {
            "succeeded" => "succeeded",
            "needs_review" => "needs_review",
            "failed" => "failed",
            _ => "active",
        };
        let projection_version = presentation
            .get("projectionVersion")
            .and_then(Value::as_str);
        let mut transaction = self.pool.begin().await?;
        let intent_id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM aven_intent_service.intents WHERE scope_id=$1 AND source_artifact_id=$2",
        )
        .bind(scope_id)
        .bind(source_artifact_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(intent_id) = intent_id else {
            return Ok(());
        };
        let changed: bool = sqlx::query_scalar(
            "SELECT presentation IS DISTINCT FROM $2 FROM aven_intent_service.file_skills WHERE intent_id=$1",
        )
        .bind(intent_id)
        .bind(presentation)
        .fetch_one(&mut *transaction)
        .await?;
        if !changed {
            return Ok(());
        }
        sqlx::query("UPDATE aven_intent_service.file_skills SET state=$2,projection_version=$3,presentation=$4,updated_at=clock_timestamp() WHERE intent_id=$1")
            .bind(intent_id).bind(skill_state).bind(projection_version).bind(presentation).execute(&mut *transaction).await?;
        if let Some(artifacts) = presentation
            .get("derivedArtifacts")
            .and_then(Value::as_array)
        {
            for (index, artifact) in artifacts.iter().enumerate() {
                let Some(artifact_id) = artifact
                    .get("artifactId")
                    .and_then(Value::as_str)
                    .and_then(|value| value.parse::<Uuid>().ok())
                else {
                    continue;
                };
                let Some(type_key) = artifact.get("typeKey").and_then(Value::as_str) else {
                    continue;
                };
                let type_version = artifact
                    .get("typeVersion")
                    .and_then(Value::as_i64)
                    .and_then(|value| i32::try_from(value).ok())
                    .unwrap_or(1);
                let stage_key = artifact.get("stageKey").and_then(Value::as_str);
                sqlx::query("INSERT INTO aven_intent_service.artifacts(intent_id,artifact_id,relation,type_key,type_version,stage_key,display_order) VALUES($1,$2,'file-skill-output',$3,$4,$5,$6) ON CONFLICT(intent_id,artifact_id) DO UPDATE SET stage_key=excluded.stage_key,display_order=excluded.display_order")
                    .bind(intent_id).bind(artifact_id).bind(type_key).bind(type_version).bind(stage_key)
                    .bind(i64::try_from(index).unwrap_or(i64::MAX - 1) + 1).execute(&mut *transaction).await?;
                sqlx::query("INSERT INTO aven_intent_service.artifacts(intent_id,artifact_id,relation,type_key,type_version,stage_key,display_order) SELECT relation.target_intent_id,$2,'file-skill-output',$3,$4,$5,(SELECT COALESCE(max(display_order),0)+1 FROM aven_intent_service.artifacts WHERE intent_id=relation.target_intent_id) FROM aven_intent_service.merge_relations relation WHERE relation.source_intent_id=$1 ON CONFLICT(intent_id,artifact_id) DO NOTHING")
                    .bind(intent_id).bind(artifact_id).bind(type_key).bind(type_version).bind(stage_key).execute(&mut *transaction).await?;
            }
        }
        let intent_state = match skill_state {
            "needs_review" => "waiting",
            "failed" => "error",
            _ => "working",
        };
        sqlx::query("UPDATE aven_intent_service.intents SET state=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND state NOT IN ('archive','merged','deleted')")
            .bind(intent_id).bind(intent_state).execute(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(())
    }
}

async fn insert_discovered(
    transaction: &mut Transaction<'_, Postgres>,
    scope_id: Uuid,
    intent: &DiscoveredIntent,
) -> Result<(), RepositoryError> {
    let result = sqlx::query("INSERT INTO aven_intent_service.intents(id,scope_id,trigger_kind,declaration_artifact_id,source_artifact_id,title,intent_type,source_label,routing_summary,created_at) VALUES($1,$2,'file-upload',$3,$4,$5,'file','Upload · File',$6,$7) ON CONFLICT(id) DO NOTHING")
        .bind(intent.id).bind(scope_id).bind(intent.declaration_artifact_id).bind(intent.source_artifact_id)
        .bind(&intent.title).bind(format!("File upload: {}", intent.title)).bind(intent.created_at)
        .execute(&mut **transaction).await?;
    if result.rows_affected() == 0 {
        return Ok(());
    }
    insert_contribution(
        transaction,
        intent.id,
        &AppendContribution {
            id: Uuid::new_v4(),
            contributor_kind: "human".into(),
            kind: "file-upload".into(),
            text: None,
            payload: json!({"artifactId": intent.source_artifact_id, "originalName": intent.title}),
        },
        format!("declaration:{}", intent.declaration_artifact_id),
    )
    .await?;
    sqlx::query("INSERT INTO aven_intent_service.artifacts(intent_id,artifact_id,relation,type_key,type_version,display_order) VALUES($1,$2,'source','core.file',1,0)")
        .bind(intent.id).bind(intent.source_artifact_id).execute(&mut **transaction).await?;
    sqlx::query(
        "INSERT INTO aven_intent_service.file_skills(intent_id,state) VALUES($1,'waiting')",
    )
    .bind(intent.id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

async fn insert_contribution(
    transaction: &mut Transaction<'_, Postgres>,
    intent_id: Uuid,
    input: &AppendContribution,
    idempotency_key: String,
) -> Result<IntentContributionView, RepositoryError> {
    let row = sqlx::query("INSERT INTO aven_intent_service.contributions(id,intent_id,sequence,contributor_kind,kind,text,payload,idempotency_key) VALUES($1,$2,(SELECT COALESCE(max(sequence),0)+1 FROM aven_intent_service.contributions WHERE intent_id=$2),$3,$4,$5,$6,$7) ON CONFLICT(intent_id,idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING id,sequence,contributor_kind,kind,text,payload,created_at")
        .bind(input.id).bind(intent_id).bind(&input.contributor_kind).bind(&input.kind).bind(&input.text)
        .bind(&input.payload).bind(idempotency_key).fetch_one(&mut **transaction).await?;
    Ok(contribution_from_row(&row))
}

fn summary_from_row(row: &sqlx::postgres::PgRow) -> IntentSummary {
    IntentSummary {
        id: row.get("id"),
        title: row.get("title"),
        intent_type: row.get("intent_type"),
        source_label: row.get("source_label"),
        deadline: row.get("deadline"),
        routing_summary: row.get("routing_summary"),
        state: row.get("state"),
        version: row.get("version"),
        source_artifact_id: row.get("source_artifact_id"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

fn contribution_from_row(row: &sqlx::postgres::PgRow) -> IntentContributionView {
    IntentContributionView {
        id: row.get("id"),
        sequence: row.get("sequence"),
        contributor_kind: row.get("contributor_kind"),
        kind: row.get("kind"),
        text: row.get("text"),
        payload: row.get("payload"),
        created_at: row.get("created_at"),
    }
}

fn valid_role_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 63
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn valid_text(value: &str, max: usize) -> bool {
    let length = value.trim().chars().count();
    (1..=max).contains(&length)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_names_fail_closed() {
        assert!(valid_role_name("aven_intent_service"));
        assert!(!valid_role_name("aven-intent-service"));
        assert!(!valid_role_name("Aven_intents"));
        assert!(!valid_role_name(""));
    }
}
