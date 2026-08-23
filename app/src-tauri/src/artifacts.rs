use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
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
    artifact_id: String,
    original_name: String,
    media_type: String,
    sha256: String,
    length: u64,
    scope_sequence: u64,
    replayed: bool,
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

fn upload(
    app: tauri::AppHandle,
    upload_id: String,
    publication_id: String,
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
    if original_name.as_bytes().len() > 512 {
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
    path: PathBuf,
    app: tauri::AppHandle,
    state: tauri::State<'_, AuthState>,
) -> Result<UploadedArtifact, String> {
    let token = session_token(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        upload(app, upload_id, publication_id, path, token)
    })
    .await
    .map_err(|error| format!("Artifact upload task failed: {error}"))?
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
}
