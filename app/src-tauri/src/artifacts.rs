use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Emitter;

use crate::auth::{api_endpoint, session_token, AuthState};

const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
const HASH_BUFFER_BYTES: usize = 256 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadProgress {
    upload_id: String,
    phase: &'static str,
    sent: u64,
    total: u64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadedArtifact {
    publication_id: String,
    intent_id: String,
    intent_declaration_artifact_id: String,
    artifact_id: String,
    original_name: String,
    media_type: String,
    sha256: String,
    length: u64,
    scope_sequence: u64,
    replayed: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactProcessingWarning {
    code: String,
    message: String,
    retryable: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactProcessingStage {
    key: String,
    state: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    depends_on: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    procedure_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    attempt_count: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    terminal_code: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedArtifact {
    artifact_id: String,
    type_key: String,
    type_version: i32,
    stage_key: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactProcessingState {
    Active,
    Succeeded,
    NeedsReview,
    Failed,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactProcessingPresentation {
    case_id: String,
    state: ArtifactProcessingState,
    projection_version: String,
    preferred_type: String,
    label: String,
    summary: Option<String>,
    metadata: serde_json::Map<String, serde_json::Value>,
    warnings: Vec<ArtifactProcessingWarning>,
    stages: Vec<ArtifactProcessingStage>,
    derived_artifacts: Vec<DerivedArtifact>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactProcessingLookup {
    pending: bool,
    presentation: Option<ArtifactProcessingPresentation>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactContent {
    media_type: String,
    base64: String,
}

#[derive(Deserialize)]
struct ApiErrorBody {
    message: Option<String>,
}

fn emit_progress(
    app: &tauri::AppHandle,
    upload_id: &str,
    phase: &'static str,
    sent: u64,
    total: u64,
) {
    let _ = app.emit(
        "artifact-upload-progress",
        UploadProgress {
            upload_id: upload_id.to_string(),
            phase,
            sent,
            total,
        },
    );
}

fn hash_file(path: &Path) -> Result<String, String> {
    let file =
        File::open(path).map_err(|error| format!("Could not open the dropped file: {error}"))?;
    let mut reader = BufReader::new(file);
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; HASH_BUFFER_BYTES];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("Could not read the dropped file: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

struct ProgressReader {
    file: File,
    app: tauri::AppHandle,
    upload_id: String,
    total: u64,
    sent: u64,
    last_percentage: u64,
}

impl Read for ProgressReader {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let read = self.file.read(buffer)?;
        self.sent += read as u64;
        let percentage = if self.total == 0 {
            100
        } else {
            self.sent.saturating_mul(100) / self.total
        };
        if percentage != self.last_percentage || self.sent == self.total {
            self.last_percentage = percentage;
            emit_progress(
                &self.app,
                &self.upload_id,
                if self.sent == self.total {
                    "finalizing"
                } else {
                    "uploading"
                },
                self.sent,
                self.total,
            );
        }
        Ok(read)
    }
}

fn response_error(response: ureq::Response, fallback: &str) -> String {
    response
        .into_string()
        .ok()
        .and_then(|body| serde_json::from_str::<ApiErrorBody>(&body).ok())
        .and_then(|body| body.message)
        .unwrap_or_else(|| fallback.to_string())
}

fn valid_artifact_id(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn processing_status(
    token: String,
    artifact_id: String,
) -> Result<ArtifactProcessingLookup, String> {
    if !valid_artifact_id(&artifact_id) {
        return Err("The artifact ID is invalid.".to_string());
    }
    let result = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(20))
        .build()
        .get(&api_endpoint(&format!(
            "/api/artifacts/{artifact_id}/processing"
        )))
        .set("authorization", &format!("Bearer {token}"))
        .call();
    let response = match result {
        Ok(response) => response,
        Err(ureq::Error::Status(404, _)) => {
            return Ok(ArtifactProcessingLookup {
                pending: true,
                presentation: None,
            });
        }
        Err(ureq::Error::Status(_, response)) => {
            return Err(response_error(
                response,
                "Artifact processing status is unavailable.",
            ));
        }
        Err(ureq::Error::Transport(error)) => {
            return Err(format!("Aven API unavailable: {error}"));
        }
    };
    let body = response
        .into_string()
        .map_err(|error| format!("Could not read artifact processing status: {error}"))?;
    let presentation = serde_json::from_str(&body)
        .map_err(|error| format!("Invalid artifact processing status: {error}"))?;
    Ok(ArtifactProcessingLookup {
        pending: false,
        presentation: Some(presentation),
    })
}

fn intent_json(
    token: String,
    method: &str,
    path: String,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(20))
        .build();
    let url = api_endpoint(&path);
    let request = match method {
        "GET" => agent.get(&url),
        "POST" => agent
            .post(&url)
            .set("content-type", "application/json")
            .set("origin", &api_endpoint("")),
        "PATCH" => agent
            .patch(&url)
            .set("content-type", "application/json")
            .set("origin", &api_endpoint("")),
        "DELETE" => agent
            .delete(&url)
            .set("content-type", "application/json")
            .set("origin", &api_endpoint("")),
        _ => return Err("Unsupported intent request method.".to_string()),
    }
    .set("authorization", &format!("Bearer {token}"));
    let result = match body {
        Some(body) => request.send_string(&body),
        None => request.call(),
    };
    let response = result.map_err(|error| match error {
        ureq::Error::Status(_, response) => {
            response_error(response, "The intent request was rejected.")
        }
        ureq::Error::Transport(error) => format!("Aven API unavailable: {error}"),
    })?;
    let body = response
        .into_string()
        .map_err(|error| format!("Could not read intent state: {error}"))?;
    serde_json::from_str(&body).map_err(|error| format!("Invalid intent state: {error}"))
}

fn artifact_content(token: String, artifact_id: String) -> Result<ArtifactContent, String> {
    let response = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(120))
        .build()
        .get(&api_endpoint(&format!(
            "/api/artifacts/{artifact_id}/content"
        )))
        .set("authorization", &format!("Bearer {token}"))
        .call()
        .map_err(|error| match error {
            ureq::Error::Status(_, response) => {
                response_error(response, "Artifact content is unavailable.")
            }
            ureq::Error::Transport(error) => format!("Aven API unavailable: {error}"),
        })?;
    let media_type = response
        .header("content-type")
        .unwrap_or("application/octet-stream")
        .to_string();
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read artifact content: {error}"))?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("Artifact content exceeds the desktop preview limit.".to_string());
    }
    Ok(ArtifactContent {
        media_type,
        base64: STANDARD.encode(bytes),
    })
}

fn upload(
    app: tauri::AppHandle,
    upload_id: String,
    publication_id: String,
    intent_id: String,
    observed_at: String,
    path: PathBuf,
    token: String,
) -> Result<UploadedArtifact, String> {
    let metadata = path
        .metadata()
        .map_err(|error| format!("Could not inspect the dropped file: {error}"))?;
    if !metadata.is_file() {
        return Err("Only one regular file can be uploaded at a time.".to_string());
    }
    let length = metadata.len();
    if length > MAX_FILE_BYTES {
        return Err("Files may not exceed 25 MiB.".to_string());
    }
    let original_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "The dropped file has no valid UTF-8 filename.".to_string())?
        .to_string();
    if original_name.len() > 512 {
        return Err("The dropped filename is longer than 512 bytes.".to_string());
    }
    let media_type = mime_guess::from_path(&path)
        .first_raw()
        .unwrap_or("application/octet-stream")
        .to_string();

    emit_progress(&app, &upload_id, "preparing", 0, length);
    let sha256 = hash_file(&path)?;
    let file = File::open(&path)
        .map_err(|error| format!("Could not reopen the dropped file for upload: {error}"))?;
    if file
        .metadata()
        .map_err(|error| format!("Could not recheck the dropped file: {error}"))?
        .len()
        != length
    {
        return Err("The dropped file changed while it was being prepared.".to_string());
    }
    emit_progress(&app, &upload_id, "uploading", 0, length);
    if length == 0 {
        emit_progress(&app, &upload_id, "finalizing", 0, 0);
    }

    let encoded_name = URL_SAFE_NO_PAD.encode(original_name.as_bytes());
    let reader = ProgressReader {
        file,
        app,
        upload_id,
        total: length,
        sent: 0,
        last_percentage: 0,
    };
    let response = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(600))
        .build()
        .put(&api_endpoint(&format!(
            "/api/artifacts/files/{publication_id}"
        )))
        // SvelteKit rejects safelisted content types such as text/plain on state-
        // changing requests without a same-origin marker. Native HTTP has no
        // browser-generated Origin header, so provide the API's own origin here.
        .set("origin", &api_endpoint(""))
        .set("authorization", &format!("Bearer {token}"))
        .set("content-type", &media_type)
        .set("content-length", &length.to_string())
        .set("x-expected-sha256", &sha256)
        .set("x-aven-original-name", &encoded_name)
        .set("x-aven-intent-id", &intent_id)
        .set("x-aven-observed-at", &observed_at)
        .send(reader)
        .map_err(|error| match error {
            ureq::Error::Status(_, response) => {
                response_error(response, "The artifact upload was rejected.")
            }
            ureq::Error::Transport(error) => format!("Aven API unavailable: {error}"),
        })?;
    let body = response
        .into_string()
        .map_err(|error| format!("Could not read the artifact receipt: {error}"))?;
    serde_json::from_str(&body).map_err(|error| format!("Invalid artifact receipt: {error}"))
}

#[tauri::command]
pub async fn artifact_upload(
    upload_id: String,
    publication_id: String,
    intent_id: String,
    observed_at: String,
    path: PathBuf,
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
) -> Result<UploadedArtifact, String> {
    let token = session_token(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let first = upload(
            app.clone(),
            upload_id.clone(),
            publication_id.clone(),
            intent_id.clone(),
            observed_at.clone(),
            path.clone(),
            token.clone(),
        );
        if first
            .as_ref()
            .is_err_and(|error| error.starts_with("Aven API unavailable:"))
        {
            upload(
                app,
                upload_id,
                publication_id,
                intent_id,
                observed_at,
                path,
                token,
            )
        } else {
            first
        }
    })
    .await
    .map_err(|error| format!("Artifact upload task failed: {error}"))?
}

#[tauri::command]
pub async fn artifact_processing_status(
    artifact_id: String,
    state: tauri::State<'_, AuthState>,
) -> Result<ArtifactProcessingLookup, String> {
    let token = session_token(&state)?;
    tauri::async_runtime::spawn_blocking(move || processing_status(token, artifact_id))
        .await
        .map_err(|error| format!("Artifact processing status task failed: {error}"))?
}

#[tauri::command]
pub async fn artifact_client_run_publish(
    publication_id: String,
    run: serde_json::Value,
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    if !valid_artifact_id(&publication_id) {
        return Err("The publication ID is invalid.".to_string());
    }
    let token = session_token(&state)?;
    let body = serde_json::to_string(&run)
        .map_err(|error| format!("Invalid client actor run: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        intent_json(
            token,
            "POST",
            format!("/api/artifacts/client-runs/{publication_id}"),
            Some(body),
        )
    })
    .await
    .map_err(|error| format!("Client actor publication task failed: {error}"))?
}

/// Authenticated inference transport for the client-owned document actors.
/// The webview owns rendering, prompts, contracts, orchestration and output
/// materialization; this command only keeps the session token out of JavaScript.
#[tauri::command]
pub async fn document_model_complete(
    request: serde_json::Value,
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    let token = session_token(&state)?;
    let body = serde_json::to_string(&request)
        .map_err(|error| format!("Invalid document model request: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        intent_json(token, "POST", "/api/model/document".into(), Some(body))
    })
    .await
    .map_err(|error| format!("Document model task failed: {error}"))?
}

#[tauri::command]
pub async fn document_model_status(
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    let token = session_token(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        intent_json(token, "GET", "/api/model/document".into(), None)
    })
    .await
    .map_err(|error| format!("Document model status task failed: {error}"))?
}

#[tauri::command]
pub async fn intent_list(state: tauri::State<'_, AuthState>) -> Result<serde_json::Value, String> {
    let token = session_token(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        intent_json(token, "GET", "/api/intents".into(), None)
    })
    .await
    .map_err(|error| format!("Intent list task failed: {error}"))?
}

#[tauri::command]
pub async fn intent_get(
    intent_id: String,
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    if !valid_artifact_id(&intent_id) {
        return Err("The intent ID is invalid.".to_string());
    }
    let token = session_token(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        intent_json(token, "GET", format!("/api/intents/{intent_id}"), None)
    })
    .await
    .map_err(|error| format!("Intent detail task failed: {error}"))?
}

#[tauri::command]
pub async fn intent_append_contribution(
    intent_id: String,
    contribution: serde_json::Value,
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    if !valid_artifact_id(&intent_id) {
        return Err("The intent ID is invalid.".to_string());
    }
    let token = session_token(&state)?;
    let body = serde_json::to_string(&contribution)
        .map_err(|error| format!("Invalid contribution: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        intent_json(
            token,
            "POST",
            format!("/api/intents/{intent_id}"),
            Some(body),
        )
    })
    .await
    .map_err(|error| format!("Intent contribution task failed: {error}"))?
}

#[tauri::command]
pub async fn intent_create(
    intent: serde_json::Value,
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    let token = session_token(&state)?;
    let body =
        serde_json::to_string(&intent).map_err(|error| format!("Invalid intent: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        intent_json(token, "POST", "/api/intents".into(), Some(body))
    })
    .await
    .map_err(|error| format!("Intent creation task failed: {error}"))?
}

#[tauri::command]
pub async fn intent_update(
    intent_id: String,
    update: serde_json::Value,
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    intent_command(intent_id, "PATCH", None, update, &state).await
}

#[tauri::command]
pub async fn intent_lifecycle(
    intent_id: String,
    action: String,
    command: serde_json::Value,
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    if !matches!(action.as_str(), "archive" | "restore" | "merge") {
        return Err("The intent action is invalid.".to_string());
    }
    intent_command(intent_id, "POST", Some(action), command, &state).await
}

#[tauri::command]
pub async fn intent_delete(
    intent_id: String,
    command: serde_json::Value,
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    intent_command(intent_id, "DELETE", None, command, &state).await
}

async fn intent_command(
    intent_id: String,
    method: &'static str,
    action: Option<String>,
    command: serde_json::Value,
    state: &tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    if !valid_artifact_id(&intent_id) {
        return Err("The intent ID is invalid.".to_string());
    }
    let token = session_token(state)?;
    let body = serde_json::to_string(&command)
        .map_err(|error| format!("Invalid intent command: {error}"))?;
    let suffix = action.map_or_else(String::new, |value| format!("/{value}"));
    tauri::async_runtime::spawn_blocking(move || {
        intent_json(
            token,
            method,
            format!("/api/intents/{intent_id}{suffix}"),
            Some(body),
        )
    })
    .await
    .map_err(|error| format!("Intent command task failed: {error}"))?
}

#[tauri::command]
pub async fn artifact_content_get(
    artifact_id: String,
    state: tauri::State<'_, AuthState>,
) -> Result<ArtifactContent, String> {
    if !valid_artifact_id(&artifact_id) {
        return Err("The artifact ID is invalid.".to_string());
    }
    let token = session_token(&state)?;
    tauri::async_runtime::spawn_blocking(move || artifact_content(token, artifact_id))
        .await
        .map_err(|error| format!("Artifact content task failed: {error}"))?
}

#[tauri::command]
pub async fn artifact_get(
    artifact_id: String,
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    if !valid_artifact_id(&artifact_id) {
        return Err("The artifact ID is invalid.".to_string());
    }
    let token = session_token(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        intent_json(token, "GET", format!("/api/artifacts/{artifact_id}"), None)
    })
    .await
    .map_err(|error| format!("Artifact lookup task failed: {error}"))?
}

#[tauri::command]
pub async fn artifact_evidence_get(
    artifact_id: String,
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    if !valid_artifact_id(&artifact_id) {
        return Err("The artifact ID is invalid.".to_string());
    }
    let token = session_token(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        intent_json(
            token,
            "GET",
            format!("/api/artifacts/{artifact_id}/evidence"),
            None,
        )
    })
    .await
    .map_err(|error| format!("Artifact evidence task failed: {error}"))?
}

#[tauri::command]
pub async fn artifact_store_list(
    state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
    let token = session_token(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        intent_json(token, "GET", "/api/artifacts".into(), None)
    })
    .await
    .map_err(|error| format!("Artifact list task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_is_streamed_and_exact() {
        let path = std::env::temp_dir().join(format!(
            "aven-artifact-hash-{}-{}",
            std::process::id(),
            std::thread::current().name().unwrap_or("test")
        ));
        std::fs::write(&path, b"hello").unwrap();
        let digest = hash_file(&path).unwrap();
        std::fs::remove_file(path).unwrap();
        assert_eq!(
            digest,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn artifact_ids_are_restricted_to_one_uuid_path_segment() {
        assert!(valid_artifact_id("ce31a00e-5f10-4707-ac07-e3b0cbd43ba4"));
        assert!(valid_artifact_id("CE31A00E-5F10-4707-AC07-E3B0CBD43BA4"));
        assert!(!valid_artifact_id("../../api/auth/get-session"));
        assert!(!valid_artifact_id("ce31a00e5f104707ac07e3b0cbd43ba4"));
    }

    #[test]
    fn processing_stage_keeps_runtime_graph_metadata() {
        let stage: ArtifactProcessingStage = serde_json::from_value(serde_json::json!({
            "key": "decompose-pages",
            "state": "running",
            "dependsOn": ["inspect"],
            "procedureKey": "docs.decompose-pages",
            "attemptCount": 2,
            "terminalCode": null
        }))
        .unwrap();
        let encoded = serde_json::to_value(stage).unwrap();
        assert_eq!(encoded["dependsOn"][0], "inspect");
        assert_eq!(encoded["procedureKey"], "docs.decompose-pages");
        assert_eq!(encoded["attemptCount"], 2);
    }
}
