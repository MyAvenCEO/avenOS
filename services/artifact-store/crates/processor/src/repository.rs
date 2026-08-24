use std::collections::BTreeMap;

use aven_artifact_store_contract::{ArtifactEnvelope, PublicationResult};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use sqlx::{PgPool, Postgres, Row, Transaction};
use thiserror::Error;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::model::{
    CaseSnapshot, ClaimedStep, GeneratedBlob, PendingOutbox, ProcessingStatus, StepSnapshot,
    StoredOutput,
};
use crate::vision::{CompletedModelCall, PreparedModelCall};

const MIGRATIONS: &[(i32, &str)] = &[
    (1, include_str!("../migrations/0001_processing.sql")),
    (2, include_str!("../migrations/0002_adapter_runtime.sql")),
    (3, include_str!("../migrations/0003_scopes.sql")),
    (4, include_str!("../migrations/0004_intents.sql")),
    (
        5,
        include_str!("../migrations/0005_intent_service_boundary.sql"),
    ),
];
const PLAN_KEY: &str = "artifact-understanding-local";
const PLAN_VERSION: &str = "2";
const PROJECTION_VERSION: &str = "artifact-presentation-v2";

#[derive(Clone)]
pub struct ProcessingRepository {
    pool: PgPool,
}

#[derive(Debug)]
pub enum ModelCallLease {
    Acquired { fencing_token: Uuid },
    Cached(CompletedModelCall),
    Busy,
}

#[derive(Debug, Error)]
pub enum RepositoryError {
    #[error("processing database operation failed: {0}")]
    Database(#[from] sqlx::Error),
    #[error("processing JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("processing migration checksum drifted")]
    MigrationDrift,
    #[error("processing feed epoch changed from {expected} to {actual}")]
    EpochChanged { expected: Uuid, actual: Uuid },
    #[error("processing feed cursor moved concurrently")]
    CursorMoved,
    #[error("processing attempt lost its lease or fencing token")]
    StaleAttempt,
    #[error("processing runtime role is invalid")]
    InvalidRole,
    #[error("processing outbox is inconsistent: {0}")]
    InvalidOutbox(String),
}

impl ProcessingRepository {
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

    #[must_use]
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn migrate(&self, runtime_role: &str) -> Result<(), RepositoryError> {
        if !valid_role_name(runtime_role) {
            return Err(RepositoryError::InvalidRole);
        }
        sqlx::raw_sql(
            "CREATE SCHEMA IF NOT EXISTS aven_processing;\
             CREATE TABLE IF NOT EXISTS aven_processing.schema_migrations (\
               version integer PRIMARY KEY, checksum char(64) NOT NULL,\
               applied_at timestamptz NOT NULL DEFAULT clock_timestamp());",
        )
        .execute(&self.pool)
        .await?;
        for (version, migration) in MIGRATIONS {
            let checksum = hex::encode(Sha256::digest(migration.as_bytes()));
            let existing: Option<String> = sqlx::query_scalar(
                "SELECT checksum::text FROM aven_processing.schema_migrations WHERE version=$1",
            )
            .bind(version)
            .fetch_optional(&self.pool)
            .await?;
            if let Some(existing) = existing {
                // The first deployed scopes migration carried one additional
                // trailing LF. Its SQL is byte-for-byte identical otherwise;
                // accept that known digest without weakening drift detection.
                let compatible_scopes_digest = *version == 3
                    && existing
                        == "7a4965c0e3a01d5d5c5f511b3316a8ff0b8d5fd749f8149524f0eef10f68e7bf"
                    && checksum
                        == "383b5b6ad30b8532f6eb671da948b90ccff9f56e863b3dfe5fc7bb8b557b7811";
                if existing != checksum && !compatible_scopes_digest {
                    return Err(RepositoryError::MigrationDrift);
                }
            } else {
                sqlx::raw_sql(migration).execute(&self.pool).await?;
                sqlx::query(
                    "INSERT INTO aven_processing.schema_migrations(version,checksum) VALUES ($1,$2)",
                )
                .bind(version)
                .bind(&checksum)
                .execute(&self.pool)
                .await?;
            }
        }
        let quoted_role = format!("\"{runtime_role}\"");
        for statement in [
            format!("GRANT USAGE ON SCHEMA aven_processing TO {quoted_role}"),
            format!("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA aven_processing TO {quoted_role}"),
            format!("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA aven_intents FROM {quoted_role}"),
            format!("REVOKE ALL PRIVILEGES ON SCHEMA aven_intents FROM {quoted_role}"),
        ] {
            sqlx::query(&statement).execute(&self.pool).await?;
        }
        Ok(())
    }

    pub async fn ready(&self) -> Result<(), RepositoryError> {
        sqlx::query("SELECT 1 FROM aven_processing.schema_migrations WHERE version=5")
            .fetch_one(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn ensure_scope(&self, scope_id: Uuid) -> Result<(), RepositoryError> {
        sqlx::query(
            "INSERT INTO aven_processing.processor_scopes(scope_id) VALUES($1) \
             ON CONFLICT(scope_id) DO NOTHING",
        )
        .bind(scope_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn has_scope(&self, scope_id: Uuid) -> Result<bool, RepositoryError> {
        Ok(sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM aven_processing.processor_scopes WHERE scope_id=$1)",
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
        sqlx::query(
            "INSERT INTO aven_processing.processing_feed_cursors(scope_id,store_epoch,after_sequence) \
             VALUES($1,$2,0) ON CONFLICT(scope_id) DO NOTHING",
        )
        .bind(scope_id)
        .bind(store_epoch)
        .execute(&self.pool)
        .await?;
        let row = sqlx::query(
            "SELECT store_epoch,after_sequence FROM aven_processing.processing_feed_cursors WHERE scope_id=$1",
        )
        .bind(scope_id)
        .fetch_one(&self.pool)
        .await?;
        let actual: Uuid = row.get("store_epoch");
        if actual != store_epoch {
            sqlx::query(
                "UPDATE aven_processing.processing_feed_cursors SET store_epoch=$2,after_sequence=0,updated_at=now() \
                 WHERE scope_id=$1 AND store_epoch=$3",
            )
            .bind(scope_id)
            .bind(store_epoch)
            .bind(actual)
            .execute(&self.pool)
            .await?;
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
        sources: &[Uuid],
    ) -> Result<Vec<Uuid>, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT store_epoch,after_sequence FROM aven_processing.processing_feed_cursors \
             WHERE scope_id=$1 FOR UPDATE",
        )
        .bind(scope_id)
        .fetch_one(&mut *transaction)
        .await?;
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
        let mut inserted = Vec::new();
        for source in sources {
            let case_id = Uuid::new_v4();
            let trigger_key = format!("{source}:{PLAN_KEY}:{PLAN_VERSION}");
            let result = sqlx::query(
                "INSERT INTO aven_processing.processing_cases \
                 (id,scope_id,source_artifact_id,trigger_key,plan_key,plan_version,state) \
                 VALUES($1,$2,$3,$4,$5,$6,'active') ON CONFLICT(trigger_key) DO NOTHING",
            )
            .bind(case_id)
            .bind(scope_id)
            .bind(source)
            .bind(trigger_key)
            .bind(PLAN_KEY)
            .bind(PLAN_VERSION)
            .execute(&mut *transaction)
            .await?;
            if result.rows_affected() == 1 {
                inserted.push(case_id);
            }
        }
        sqlx::query(
            "UPDATE aven_processing.processing_feed_cursors SET after_sequence=$2,updated_at=now() WHERE scope_id=$1",
        )
        .bind(scope_id)
        .bind(next_after)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(inserted)
    }

    pub async fn ensure_step(
        &self,
        case_id: Uuid,
        step_key: &str,
        procedure_key: &str,
        input_artifact_ids: &[Uuid],
        parameters: &serde_json::Value,
        dependencies: &[&str],
    ) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let step_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO aven_processing.processing_steps \
             (id,case_id,step_key,procedure_key,publication_id,state,input_artifact_ids,parameters) \
             VALUES($1,$2,$3,$4,$5,'pending',$6,$7) ON CONFLICT(case_id,step_key) DO NOTHING",
        )
        .bind(step_id)
        .bind(case_id)
        .bind(step_key)
        .bind(procedure_key)
        .bind(Uuid::new_v4())
        .bind(input_artifact_ids)
        .bind(parameters)
        .execute(&mut *transaction)
        .await?;
        let actual_step_id: Uuid = sqlx::query_scalar(
            "SELECT id FROM aven_processing.processing_steps WHERE case_id=$1 AND step_key=$2",
        )
        .bind(case_id)
        .bind(step_key)
        .fetch_one(&mut *transaction)
        .await?;
        for dependency in dependencies {
            let dependency_id: Uuid = sqlx::query_scalar(
                "SELECT id FROM aven_processing.processing_steps WHERE case_id=$1 AND step_key=$2",
            )
            .bind(case_id)
            .bind(dependency)
            .fetch_one(&mut *transaction)
            .await?;
            sqlx::query(
                "INSERT INTO aven_processing.processing_step_dependencies(step_id,dependency_step_id) \
                 VALUES($1,$2) ON CONFLICT DO NOTHING",
            )
            .bind(actual_step_id)
            .bind(dependency_id)
            .execute(&mut *transaction)
            .await?;
        }
        queue_ready(&mut transaction, case_id).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn recover_expired(&self, max_attempts: i32) -> Result<u64, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let expired = sqlx::query(
            "UPDATE aven_processing.processing_attempts SET state='expired',finished_at=now(),error_code='lease-expired',error_message='Attempt lease expired.' \
             WHERE state='running' AND lease_expires_at <= now() RETURNING id,step_id",
        )
        .fetch_all(&mut *transaction)
        .await?;
        for row in &expired {
            let attempt_id: Uuid = row.get("id");
            let step_id: Uuid = row.get("step_id");
            sqlx::query(
                "UPDATE aven_processing.processing_steps SET \
                 state=CASE WHEN attempt_count >= $3 THEN 'failed' ELSE 'queued' END, \
                 terminal_code=CASE WHEN attempt_count >= $3 THEN 'attempts-exhausted' ELSE NULL END, \
                 active_attempt_id=NULL,available_at=now(),updated_at=now() \
                 WHERE id=$1 AND active_attempt_id=$2 AND state='running'",
            )
            .bind(step_id)
            .bind(attempt_id)
            .bind(max_attempts)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(expired.len() as u64)
    }

    pub async fn claim_step(
        &self,
        lease: Duration,
    ) -> Result<Option<ClaimedStep>, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "UPDATE aven_processing.processing_steps SET state='queued',updated_at=now() \
             WHERE state='retry_wait' AND available_at<=now()",
        )
        .execute(&mut *transaction)
        .await?;
        let row = sqlx::query(
            "SELECT step.id,step.case_id,step.step_key,step.procedure_key,step.publication_id, \
                    step.input_artifact_ids,step.parameters,step.attempt_count, \
                    case_row.scope_id,case_row.source_artifact_id \
             FROM aven_processing.processing_steps step \
             JOIN aven_processing.processing_cases case_row ON case_row.id=step.case_id \
             WHERE case_row.state='active' AND step.state='queued' AND step.available_at <= now() \
             ORDER BY step.created_at,step.step_key LIMIT 1 FOR UPDATE OF step SKIP LOCKED",
        )
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(row) = row else {
            transaction.commit().await?;
            return Ok(None);
        };
        let step_id: Uuid = row.get("id");
        let attempt_number = row.get::<i32, _>("attempt_count") + 1;
        let attempt_id = Uuid::new_v4();
        let fencing_token = Uuid::new_v4();
        let lease_expires_at = OffsetDateTime::now_utc() + lease;
        sqlx::query(
            "INSERT INTO aven_processing.processing_attempts \
             (id,step_id,attempt_number,fencing_token,lease_expires_at,state) \
             VALUES($1,$2,$3,$4,$5,'running')",
        )
        .bind(attempt_id)
        .bind(step_id)
        .bind(attempt_number)
        .bind(fencing_token)
        .bind(lease_expires_at)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE aven_processing.processing_steps SET state='running',attempt_count=$2,active_attempt_id=$3,updated_at=now() WHERE id=$1",
        )
        .bind(step_id)
        .bind(attempt_number)
        .bind(attempt_id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(Some(ClaimedStep {
            id: step_id,
            case_id: row.get("case_id"),
            scope_id: row.get("scope_id"),
            source_artifact_id: row.get("source_artifact_id"),
            step_key: row.get("step_key"),
            procedure_key: row.get("procedure_key"),
            publication_id: row.get("publication_id"),
            input_artifact_ids: row.get("input_artifact_ids"),
            parameters: row.get("parameters"),
            attempt_id,
            fencing_token,
            attempt_number,
        }))
    }

    pub async fn save_outbox(
        &self,
        step: &ClaimedStep,
        output: &crate::model::ExecutionOutput,
    ) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let valid: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM aven_processing.processing_steps step \
             JOIN aven_processing.processing_attempts attempt ON attempt.id=step.active_attempt_id \
             WHERE step.id=$1 AND step.state='running' AND attempt.id=$2 \
               AND attempt.fencing_token=$3 AND attempt.state='running' AND attempt.lease_expires_at>now())",
        )
        .bind(step.id)
        .bind(step.attempt_id)
        .bind(step.fencing_token)
        .fetch_one(&mut *transaction)
        .await?;
        if !valid {
            return Err(RepositoryError::StaleAttempt);
        }
        let outbox_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO aven_processing.processing_outbox \
             (id,step_id,attempt_id,publication_id,submission,state) VALUES($1,$2,$3,$4,$5,'pending')",
        )
        .bind(outbox_id)
        .bind(step.id)
        .bind(step.attempt_id)
        .bind(step.publication_id)
        .bind(serde_json::to_value(&output.submission)?)
        .execute(&mut *transaction)
        .await?;
        for blob in &output.blobs {
            sqlx::query(
                "INSERT INTO aven_processing.processing_outbox_blobs \
                 (outbox_id,local_key,claim_id,media_type,bytes) VALUES($1,$2,$3,$4,$5)",
            )
            .bind(outbox_id)
            .bind(&blob.local_key)
            .bind(blob.claim_id)
            .bind(&blob.media_type)
            .bind(&blob.bytes)
            .execute(&mut *transaction)
            .await?;
        }
        sqlx::query(
            "UPDATE aven_processing.processing_attempts SET state='completed',finished_at=now() WHERE id=$1",
        )
        .bind(step.attempt_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE aven_processing.processing_steps SET state='publishing',active_attempt_id=NULL,updated_at=now() WHERE id=$1",
        )
        .bind(step.id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn heartbeat_attempt(
        &self,
        step: &ClaimedStep,
        lease: Duration,
    ) -> Result<(), RepositoryError> {
        let seconds = lease.whole_seconds();
        let result = sqlx::query(
            "UPDATE aven_processing.processing_attempts attempt SET \
             lease_expires_at=now()+make_interval(secs => $4) \
             WHERE attempt.id=$1 AND attempt.step_id=$2 AND attempt.fencing_token=$3 \
               AND attempt.state='running' AND attempt.lease_expires_at>now() \
               AND EXISTS(SELECT 1 FROM aven_processing.processing_steps step \
                 WHERE step.id=attempt.step_id AND step.active_attempt_id=attempt.id \
                   AND step.state='running')",
        )
        .bind(step.attempt_id)
        .bind(step.id)
        .bind(step.fencing_token)
        .bind(seconds)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(RepositoryError::StaleAttempt);
        }
        Ok(())
    }

    pub async fn lease_model_call(
        &self,
        step: &ClaimedStep,
        prepared: &PreparedModelCall,
        lease: Duration,
    ) -> Result<ModelCallLease, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let existing = sqlx::query(
            "SELECT state,lease_expires_at,structured_result,receipt \
             FROM aven_processing.model_call_ledger \
             WHERE scope_id=$1 AND request_key=$2 FOR UPDATE",
        )
        .bind(step.scope_id)
        .bind(&prepared.request_key)
        .fetch_optional(&mut *transaction)
        .await?;
        if let Some(row) = existing {
            let state: String = row.get("state");
            if state == "succeeded" {
                let result = ModelCallLease::Cached(CompletedModelCall {
                    structured: row.get("structured_result"),
                    receipt: row.get("receipt"),
                });
                transaction.commit().await?;
                return Ok(result);
            }
            let lease_expires: Option<OffsetDateTime> = row.get("lease_expires_at");
            if state == "leased"
                && lease_expires.is_some_and(|value| value > OffsetDateTime::now_utc())
            {
                transaction.commit().await?;
                return Ok(ModelCallLease::Busy);
            }
            let fencing_token = Uuid::new_v4();
            sqlx::query(
                "UPDATE aven_processing.model_call_ledger SET state='leased',lease_owner=$3, \
                 fencing_token=$4,lease_expires_at=$5,attempt_count=attempt_count+1, \
                 structured_result=NULL,receipt=NULL,error_code=NULL,updated_at=now() \
                 WHERE scope_id=$1 AND request_key=$2",
            )
            .bind(step.scope_id)
            .bind(&prepared.request_key)
            .bind(step.attempt_id)
            .bind(fencing_token)
            .bind(OffsetDateTime::now_utc() + lease)
            .execute(&mut *transaction)
            .await?;
            transaction.commit().await?;
            return Ok(ModelCallLease::Acquired { fencing_token });
        }
        let fencing_token = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO aven_processing.model_call_ledger \
             (id,scope_id,request_key,procedure_key,contract_version,model_deployment, \
              prompt_digest,implementation_digest,state,lease_owner,fencing_token, \
              lease_expires_at,attempt_count) \
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,'leased',$9,$10,$11,1)",
        )
        .bind(Uuid::new_v4())
        .bind(step.scope_id)
        .bind(&prepared.request_key)
        .bind(&step.procedure_key)
        .bind(prepared.contract_version)
        .bind(&prepared.model_deployment)
        .bind(&prepared.prompt_digest)
        .bind(&prepared.implementation_digest)
        .bind(step.attempt_id)
        .bind(fencing_token)
        .bind(OffsetDateTime::now_utc() + lease)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(ModelCallLease::Acquired { fencing_token })
    }

    pub async fn complete_model_call(
        &self,
        step: &ClaimedStep,
        prepared: &PreparedModelCall,
        fencing_token: Uuid,
        completed: &CompletedModelCall,
    ) -> Result<(), RepositoryError> {
        let result = sqlx::query(
            "UPDATE aven_processing.model_call_ledger SET state='succeeded', \
             structured_result=$5,receipt=$6,lease_owner=NULL,fencing_token=NULL, \
             lease_expires_at=NULL,error_code=NULL,updated_at=now() \
             WHERE scope_id=$1 AND request_key=$2 AND state='leased' \
               AND lease_owner=$3 AND fencing_token=$4 AND lease_expires_at>now()",
        )
        .bind(step.scope_id)
        .bind(&prepared.request_key)
        .bind(step.attempt_id)
        .bind(fencing_token)
        .bind(&completed.structured)
        .bind(&completed.receipt)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() != 1 {
            return Err(RepositoryError::StaleAttempt);
        }
        Ok(())
    }

    pub async fn fail_model_call(
        &self,
        step: &ClaimedStep,
        prepared: &PreparedModelCall,
        fencing_token: Uuid,
        error_code: &str,
    ) -> Result<(), RepositoryError> {
        sqlx::query(
            "UPDATE aven_processing.model_call_ledger SET state='failed',error_code=$5, \
             lease_owner=NULL,fencing_token=NULL,lease_expires_at=NULL,updated_at=now() \
             WHERE scope_id=$1 AND request_key=$2 AND state='leased' \
               AND lease_owner=$3 AND fencing_token=$4",
        )
        .bind(step.scope_id)
        .bind(&prepared.request_key)
        .bind(step.attempt_id)
        .bind(fencing_token)
        .bind(error_code)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn fail_attempt(
        &self,
        step: &ClaimedStep,
        code: &str,
        message: &str,
        retryable: bool,
        max_attempts: i32,
    ) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let terminal = !retryable || step.attempt_number >= max_attempts;
        let result = sqlx::query(
            "UPDATE aven_processing.processing_attempts SET state='failed',error_code=$4,error_message=$5,finished_at=now() \
             WHERE id=$1 AND step_id=$2 AND fencing_token=$3 AND state='running'",
        )
        .bind(step.attempt_id)
        .bind(step.id)
        .bind(step.fencing_token)
        .bind(code)
        .bind(message)
        .execute(&mut *transaction)
        .await?;
        if result.rows_affected() != 1 {
            return Err(RepositoryError::StaleAttempt);
        }
        sqlx::query(
            "UPDATE aven_processing.processing_steps SET state=$2,active_attempt_id=NULL,terminal_code=$3, \
             available_at=CASE WHEN $2='retry_wait' THEN now()+interval '1 second' ELSE available_at END,updated_at=now() \
             WHERE id=$1 AND active_attempt_id=$4",
        )
        .bind(step.id)
        .bind(if terminal { "failed" } else { "retry_wait" })
        .bind(if terminal { Some(code) } else { None::<&str> })
        .bind(step.attempt_id)
        .execute(&mut *transaction)
        .await?;
        if !terminal {
            sqlx::query(
                "UPDATE aven_processing.processing_steps SET state='queued' WHERE id=$1 AND state='retry_wait' AND available_at<=now()",
            )
            .bind(step.id)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn pending_outbox(&self) -> Result<Option<PendingOutbox>, RepositoryError> {
        let row = sqlx::query(
            "SELECT outbox.id,outbox.step_id,outbox.publication_id,outbox.submission,outbox.state, \
                    step.case_id,case_row.scope_id \
             FROM aven_processing.processing_outbox outbox \
             JOIN aven_processing.processing_steps step ON step.id=outbox.step_id \
             JOIN aven_processing.processing_cases case_row ON case_row.id=step.case_id \
             WHERE outbox.state IN ('pending','publishing') ORDER BY outbox.created_at LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else { return Ok(None) };
        let outbox_id: Uuid = row.get("id");
        let blob_rows = sqlx::query(
            "SELECT local_key,claim_id,media_type,bytes FROM aven_processing.processing_outbox_blobs WHERE outbox_id=$1 ORDER BY local_key",
        )
        .bind(outbox_id)
        .fetch_all(&self.pool)
        .await?;
        let blobs = blob_rows
            .into_iter()
            .map(|blob| GeneratedBlob {
                local_key: blob.get("local_key"),
                claim_id: blob.get("claim_id"),
                media_type: blob.get("media_type"),
                bytes: blob.get("bytes"),
            })
            .collect();
        Ok(Some(PendingOutbox {
            id: outbox_id,
            step_id: row.get("step_id"),
            case_id: row.get("case_id"),
            scope_id: row.get("scope_id"),
            publication_id: row.get("publication_id"),
            state: row.get("state"),
            submission: serde_json::from_value(row.get("submission"))?,
            blobs,
        }))
    }

    pub async fn mark_outbox_publishing(&self, id: Uuid) -> Result<(), RepositoryError> {
        sqlx::query(
            "UPDATE aven_processing.processing_outbox SET state='publishing',updated_at=now() WHERE id=$1 AND state='pending'",
        )
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn record_outbox_failure(
        &self,
        outbox: &PendingOutbox,
        code: &str,
        retryable: bool,
        max_attempts: i32,
    ) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let attempt_count: i32 = sqlx::query_scalar(
            "UPDATE aven_processing.processing_steps SET attempt_count=attempt_count+1,updated_at=now() \
             WHERE id=$1 AND state='publishing' RETURNING attempt_count",
        )
        .bind(outbox.step_id)
        .fetch_one(&mut *transaction)
        .await?;
        let terminal = !retryable || attempt_count >= max_attempts;
        sqlx::query(
            "UPDATE aven_processing.processing_outbox SET state=$2,last_error_code=$3,updated_at=now() WHERE id=$1",
        )
        .bind(outbox.id)
        .bind(if terminal { "failed" } else { &outbox.state })
        .bind(code)
        .execute(&mut *transaction)
        .await?;
        if terminal {
            sqlx::query(
                "UPDATE aven_processing.processing_steps SET state='failed',terminal_code=$2,updated_at=now() \
                 WHERE id=$1 AND state='publishing'",
            )
            .bind(outbox.step_id)
            .bind(if retryable {
                "publication-attempts-exhausted"
            } else {
                code
            })
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn acknowledge(
        &self,
        outbox: &PendingOutbox,
        result: &PublicationResult,
        envelopes: &[ArtifactEnvelope],
    ) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO aven_processing.processing_acknowledgements(outbox_id,result) \
             VALUES($1,$2) ON CONFLICT(outbox_id) DO NOTHING",
        )
        .bind(outbox.id)
        .bind(serde_json::to_value(result)?)
        .execute(&mut *transaction)
        .await?;
        for envelope in envelopes {
            let artifact = result
                .artifacts
                .iter()
                .find(|artifact| artifact.artifact_id == envelope.artifact_id)
                .ok_or_else(|| {
                    RepositoryError::InvalidOutbox(format!(
                        "artifact {} is missing from acknowledgement",
                        envelope.artifact_id
                    ))
                })?;
            sqlx::query(
                "INSERT INTO aven_processing.processing_step_outputs \
                 (step_id,local_key,artifact_id,type_key,type_version,payload) \
                 VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(step_id,local_key) DO NOTHING",
            )
            .bind(outbox.step_id)
            .bind(artifact.local_key.as_str())
            .bind(envelope.artifact_id)
            .bind(envelope.type_key.as_str())
            .bind(i32::try_from(envelope.type_version).unwrap_or(i32::MAX))
            .bind(serde_json::to_value(&envelope.payload)?)
            .execute(&mut *transaction)
            .await?;
        }
        sqlx::query(
            "UPDATE aven_processing.processing_outbox SET state='acknowledged',updated_at=now() WHERE id=$1",
        )
        .bind(outbox.id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "UPDATE aven_processing.processing_steps SET state='succeeded',terminal_code=NULL,updated_at=now() WHERE id=$1",
        )
        .bind(outbox.step_id)
        .execute(&mut *transaction)
        .await?;
        queue_ready(&mut transaction, outbox.case_id).await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn active_cases(&self) -> Result<Vec<Uuid>, RepositoryError> {
        Ok(sqlx::query_scalar(
            "SELECT id FROM aven_processing.processing_cases WHERE state='active' ORDER BY created_at",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn case_snapshot(&self, case_id: Uuid) -> Result<CaseSnapshot, RepositoryError> {
        let case = sqlx::query(
            "SELECT id,scope_id,source_artifact_id,plan_key,plan_version,state FROM aven_processing.processing_cases WHERE id=$1",
        )
        .bind(case_id)
        .fetch_one(&self.pool)
        .await?;
        let step_rows = sqlx::query(
            "SELECT step.id,step.step_key,step.state,step.terminal_code, \
                    outbox.submission #> '{intent,run,receipt}' AS receipt \
             FROM aven_processing.processing_steps step \
             LEFT JOIN aven_processing.processing_outbox outbox ON outbox.step_id=step.id \
             WHERE step.case_id=$1 ORDER BY step.created_at,step.step_key",
        )
        .bind(case_id)
        .fetch_all(&self.pool)
        .await?;
        let mut steps = Vec::new();
        for step in step_rows {
            let step_id: Uuid = step.get("id");
            let outputs = sqlx::query(
                "SELECT local_key,artifact_id,type_key,type_version,payload FROM aven_processing.processing_step_outputs WHERE step_id=$1 ORDER BY local_key",
            )
            .bind(step_id)
            .fetch_all(&self.pool)
            .await?
            .into_iter()
            .map(|output| StoredOutput {
                local_key: output.get("local_key"),
                artifact_id: output.get("artifact_id"),
                type_key: output.get("type_key"),
                type_version: output.get("type_version"),
                payload: output.get("payload"),
            })
            .collect();
            steps.push(StepSnapshot {
                id: step_id,
                step_key: step.get("step_key"),
                state: step.get("state"),
                terminal_code: step.get("terminal_code"),
                receipt: step.get("receipt"),
                outputs,
            });
        }
        Ok(CaseSnapshot {
            id: case.get("id"),
            scope_id: case.get("scope_id"),
            source_artifact_id: case.get("source_artifact_id"),
            plan_key: case.get("plan_key"),
            plan_version: case.get("plan_version"),
            state: case.get("state"),
            steps,
        })
    }

    pub async fn complete_case(&self, case_id: Uuid) -> Result<(), RepositoryError> {
        sqlx::query(
            "UPDATE aven_processing.processing_cases SET state='succeeded',updated_at=now() WHERE id=$1 AND state='active'",
        )
        .bind(case_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn needs_review_case(&self, case_id: Uuid) -> Result<(), RepositoryError> {
        sqlx::query(
            "UPDATE aven_processing.processing_cases SET state='needs_review',updated_at=now() \
             WHERE id=$1 AND state='active'",
        )
        .bind(case_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn fail_cases_with_terminal_steps(&self) -> Result<Vec<Uuid>, RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        let case_ids: Vec<Uuid> = sqlx::query_scalar(
            "SELECT case_row.id FROM aven_processing.processing_cases case_row \
             WHERE state='active' AND EXISTS(SELECT 1 FROM aven_processing.processing_steps step \
             WHERE step.case_id=case_row.id AND step.state='failed' \
             AND NOT (step.parameters @> '{\"required\":false}'::jsonb)) FOR UPDATE",
        )
        .fetch_all(&mut *transaction)
        .await?;
        if !case_ids.is_empty() {
            sqlx::query(
                "UPDATE aven_processing.processing_steps SET state='skipped',terminal_code='upstream-failed',updated_at=now() \
                 WHERE case_id=ANY($1) AND state IN ('pending','queued','retry_wait')",
            )
            .bind(&case_ids)
            .execute(&mut *transaction)
            .await?;
            sqlx::query(
                "UPDATE aven_processing.processing_cases SET state='failed',updated_at=now() WHERE id=ANY($1)",
            )
            .bind(&case_ids)
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(case_ids)
    }

    pub async fn save_presentation(
        &self,
        case_id: Uuid,
        source_artifact_id: Uuid,
        status: &ProcessingStatus,
    ) -> Result<(), RepositoryError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO aven_processing.processing_presentations \
             (case_id,source_artifact_id,projection_version,presentation) VALUES($1,$2,$3,$4) \
             ON CONFLICT(case_id) DO UPDATE SET projection_version=excluded.projection_version, \
             presentation=excluded.presentation,updated_at=now()",
        )
        .bind(case_id)
        .bind(source_artifact_id)
        .bind(PROJECTION_VERSION)
        .bind(serde_json::to_value(status)?)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    pub async fn status(
        &self,
        scope_id: Uuid,
        source_artifact_id: Uuid,
    ) -> Result<Option<ProcessingStatus>, RepositoryError> {
        let value: Option<serde_json::Value> = sqlx::query_scalar(
            "SELECT presentation.presentation FROM aven_processing.processing_presentations presentation \
             JOIN aven_processing.processing_cases case_row ON case_row.id=presentation.case_id \
             WHERE case_row.scope_id=$1 AND presentation.source_artifact_id=$2",
        )
        .bind(scope_id)
        .bind(source_artifact_id)
        .fetch_optional(&self.pool)
        .await?;
        value
            .map(serde_json::from_value)
            .transpose()
            .map_err(Into::into)
    }

    pub async fn counts(&self) -> Result<BTreeMap<String, i64>, RepositoryError> {
        let rows = sqlx::query(
            "SELECT state,count(*)::bigint AS count FROM aven_processing.processing_cases GROUP BY state",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|row| (row.get("state"), row.get("count")))
            .collect())
    }
}

async fn queue_ready(
    transaction: &mut Transaction<'_, Postgres>,
    case_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE aven_processing.processing_steps step SET state='queued',available_at=now(),updated_at=now() \
         WHERE step.case_id=$1 AND step.state='pending' AND NOT EXISTS( \
           SELECT 1 FROM aven_processing.processing_step_dependencies dependency \
           JOIN aven_processing.processing_steps required ON required.id=dependency.dependency_step_id \
           WHERE dependency.step_id=step.id AND required.state<>'succeeded')",
    )
    .bind(case_id)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

fn valid_role_name(role: &str) -> bool {
    !role.is_empty()
        && role.len() <= 63
        && role
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_names_fail_closed() {
        assert!(valid_role_name("aven_artifact_processor"));
        assert!(!valid_role_name("aven-processor"));
        assert!(!valid_role_name("processor;drop schema public"));
    }
}
