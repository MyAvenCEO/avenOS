//! Device-private unassigned input. No transcript is sent to customer history here.
//! The local key is protected by OS file permissions, not a user password or E2EE claim.
use crate::auth::{api_endpoint, customer_session_identity, AuthState};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::rand::{SecureRandom, SystemRandom};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

const MAX_BYTES: usize = 512 * 1024;
static IO: Mutex<()> = Mutex::new(());

fn private_options() -> OpenOptions {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
}

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_data_dir().map_err(|_| "Private input storage is unavailable.")?.join("input-drafts");
    fs::create_dir_all(&path).map_err(|_| "Could not create private input storage.")?;
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(|_| "Could not protect private input storage.")?;
    }
    Ok(path)
}

// Protect the key and atomic replacement across desktop processes, not just commands.
fn lock_directory(dir: &Path) -> Result<fs::File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(dir.join("storage.lock")).map_err(|_| "Could not lock private input storage.")?;
    file.try_lock().map_err(|_| "Another client is saving input. Please try again.")?;
    Ok(file)
}

fn sync_directory(dir: &Path) -> Result<(), String> {
    #[cfg(unix)]
    fs::File::open(dir).and_then(|file| file.sync_all()).map_err(|_| "Could not finish saving input.")?;
    #[cfg(not(unix))]
    let _ = dir;
    Ok(())
}

fn scope(state: &tauri::State<'_, AuthState>) -> Result<String, String> {
    let (session, subject) = customer_session_identity(state)?;
    Ok(format!("{:x}", Sha256::digest(format!("input-v1\0{}\0{}\0{}", api_endpoint(""), subject, session.environment_id))))
}

fn key(dir: &Path) -> Result<LessSafeKey, String> {
    let path = dir.join("device.key");
    let mut bytes = [0u8; 32];
    if !path.exists() {
        SystemRandom::new().fill(&mut bytes).map_err(|_| "Could not initialize draft encryption.")?;
        match private_options().open(&path) {
            Ok(mut file) => {
                file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|_| "Could not save the draft key.")?;
                sync_directory(dir)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err("Could not protect the draft key.".into()),
        }
    }
    let mut file = fs::File::open(path).map_err(|_| "Could not read the draft key.")?;
    file.read_exact(&mut bytes).map_err(|_| "The draft key is unavailable. Existing drafts were not changed.")?;
    UnboundKey::new(&AES_256_GCM, &bytes).map(LessSafeKey::new).map_err(|_| "Invalid draft key.".into())
}

fn encrypt(key: &LessSafeKey, scope: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; 12];
    SystemRandom::new().fill(&mut nonce).map_err(|_| "Could not initialize draft encryption.")?;
    let mut encrypted = bytes.to_vec();
    key.seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(scope.as_bytes()), &mut encrypted)
        .map_err(|_| "Could not encrypt the input draft.")?;
    let mut result = vec![1];
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&encrypted);
    Ok(result)
}

fn decrypt(key: &LessSafeKey, scope: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() < 29 || bytes.len() > MAX_BYTES + 29 || bytes[0] != 1 {
        return Err("The saved input cannot be read. It has not been changed.".into());
    }
    let nonce: [u8; 12] = bytes[1..13].try_into().map_err(|_| "Invalid saved input.")?;
    let mut encrypted = bytes[13..].to_vec();
    key.open_in_place(Nonce::assume_unique_for_key(nonce), Aad::from(scope.as_bytes()), &mut encrypted)
        .map(|plain| plain.to_vec()).map_err(|_| "The saved input could not be verified. It has not been changed.".into())
}

fn load(dir: &Path, scope: &str) -> Result<serde_json::Value, String> {
    let path = dir.join(format!("{scope}.bin"));
    if !path.exists() { return Ok(serde_json::json!({ "revision": 0, "items": [] })); }
    let mut bytes = Vec::new();
    fs::File::open(path).map_err(|_| "Could not open saved input.")?.take((MAX_BYTES + 30) as u64)
        .read_to_end(&mut bytes).map_err(|_| "Could not read saved input.")?;
    let payload: serde_json::Value = serde_json::from_slice(&decrypt(&key(dir)?, scope, &bytes)?)
        .map_err(|_| "The saved input format is invalid.")?;
    if payload["revision"].as_u64().is_none() || !payload["items"].is_array() {
        return Err("The saved input format is invalid.".into());
    }
    Ok(payload)
}

#[tauri::command]
pub fn input_drafts_load(app: tauri::AppHandle, state: tauri::State<'_, AuthState>) -> Result<serde_json::Value, String> {
    let scope = scope(&state)?;
    let _guard = IO.lock().map_err(|_| "Private input storage is busy.")?;
    let dir = directory(&app)?;
    let _file_lock = lock_directory(&dir)?;
    let payload = load(&dir, &scope)?;
    Ok(serde_json::json!({ "scope": scope, "revision": payload["revision"], "items": payload["items"] }))
}

#[tauri::command]
pub fn input_drafts_save(app: tauri::AppHandle, scope_id: String, items: serde_json::Value,
    expected_revision: u64, state: tauri::State<'_, AuthState>) -> Result<u64, String> {
    let current = scope(&state)?;
    if current != scope_id { return Err("The workspace changed. Input was not saved to another workspace.".into()); }
    if !items.is_array() || items.as_array().is_some_and(|items| items.len() > 100) {
        return Err("Too many pending messages. Send or discard some before continuing.".into());
    }
    let revision = expected_revision.checked_add(1).ok_or("Invalid input revision.")?;
    let bytes = serde_json::to_vec(&serde_json::json!({ "revision": revision, "items": items })).map_err(|_| "Invalid input draft.")?;
    if bytes.len() > MAX_BYTES { return Err("Pending messages are too large. Send or discard some before continuing.".into()); }
    let _guard = IO.lock().map_err(|_| "Private input storage is busy.")?;
    // Recheck after waiting. Scope is derived from native authentication, never a caller path.
    if scope(&state)? != current { return Err("The workspace changed.".into()); }
    let dir = directory(&app)?;
    let _file_lock = lock_directory(&dir)?;
    if load(&dir, &current)?["revision"].as_u64() != Some(expected_revision) {
        return Err("Pending input changed in another client. Reload to recover it before saving.".into());
    }
    let encrypted = encrypt(&key(&dir)?, &current, &bytes)?;
    let path = dir.join(format!("{current}.bin"));
    let temporary = dir.join(format!("{current}.pending"));
    // Serialized writes leave only this exact recoverable temporary file after a crash.
    if temporary.exists() { fs::remove_file(&temporary).map_err(|_| "Could not replace the interrupted draft write.")?; }
    let result = (|| {
        let mut file = private_options().open(&temporary).map_err(|_| "Could not save pending input.")?;
        file.write_all(&encrypted).and_then(|_| file.sync_all()).map_err(|_| "Could not finish saving input.")?;
        fs::rename(&temporary, &path).map_err(|_| "Could not commit pending input.")?;
        sync_directory(&dir)?;
        Ok(revision)
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encrypted_draft_requires_exact_scope_and_rejects_tampering() {
        let key = LessSafeKey::new(UnboundKey::new(&AES_256_GCM, &[7; 32]).unwrap());
        let plain = br#"[{"text":"Synthetic workshop question"}]"#;
        let encrypted = encrypt(&key, "scope-one", plain).unwrap();
        assert!(!encrypted.windows(plain.len()).any(|w| w == plain));
        assert_eq!(decrypt(&key, "scope-one", &encrypted).unwrap(), plain);
        assert!(decrypt(&key, "scope-two", &encrypted).is_err());
        let mut corrupt = encrypted.clone();
        corrupt[20] ^= 1;
        assert!(decrypt(&key, "scope-one", &corrupt).is_err());
        assert_ne!(encrypted, encrypt(&key, "scope-one", plain).unwrap());
    }
}
