//! Customer-pinned transport for admitted chat work. Queueing, edits, cancellation
//! and execution stay in Intent Service and Actor Runner, not in this bridge.

use crate::artifacts::{chat_progress_json, intent_json, search_scope_key, valid_artifact_id};
use crate::auth::{api_endpoint, customer_session_identity, AuthState, CustomerSession};
use serde_json::Value;

fn scope(session: &CustomerSession, subject: &str) -> String {
    search_scope_key(
        &api_endpoint(&format!(
            "/api/environments/{}/intents",
            session.environment_id
        )),
        subject,
    )
}

#[tauri::command]
pub async fn intent_work_context(state: tauri::State<'_, AuthState>) -> Result<Value, String> {
    let (session, subject) = customer_session_identity(&state)?;
    Ok(serde_json::json!({"scope":scope(&session, &subject)}))
}

fn uuid(value: &str) -> bool {
    // Require the canonical path form; no encoded separators or caller-built URLs.
    valid_artifact_id(value) && !value.bytes().any(|byte| byte.is_ascii_uppercase())
}

fn allowed(method: &str, path: &str, body: Option<&Value>) -> bool {
    let Ok(url) = tauri::Url::parse(&format!("https://work.invalid{path}")) else {
        return false;
    };
    let canonical = format!(
        "{}{}",
        url.path(),
        url.query().map(|q| format!("?{q}")).unwrap_or_default()
    );
    if path != canonical || url.host_str() != Some("work.invalid") || url.fragment().is_some() {
        return false;
    }
    let parts: Vec<_> = url.path().split('/').collect();
    match (method, parts.as_slice()) {
        ("POST", ["", "input"]) => url.query().is_none() && body.is_some_and(Value::is_object),
        ("GET", ["", "input", input, revision]) => {
            body.is_none()
                && url.query().is_none()
                && uuid(input)
                && revision
                    .parse::<u32>()
                    .is_ok_and(|r| r > 0 && r <= 1_000_000 && r.to_string() == *revision)
        }
        ("GET", ["", intent, "turns"]) if uuid(intent) && body.is_none() => {
            let mut keys = std::collections::HashSet::new();
            url.query_pairs().all(|(key, value)| {
                keys.insert(key.to_string())
                    && match key.as_ref() {
                        "cursor" => !value.is_empty() && value.len() <= 2048,
                        "limit" => value.parse::<u32>().is_ok_and(|n| n > 0 && n <= 50),
                        _ => false,
                    }
            })
        }
        ("POST", ["", intent, "turns", turn, "stop"]) => {
            uuid(intent)
                && uuid(turn)
                && url.query().is_none()
                && body.is_some_and(Value::is_object)
        }
        _ => false,
    }
}

#[tauri::command]
pub async fn intent_work_request(
    scope: String,
    method: String,
    path: String,
    body: Option<Value>,
    state: tauri::State<'_, AuthState>,
) -> Result<Value, String> {
    let (session, subject) = customer_session_identity(&state)?;
    if scope != self::scope(&session, &subject) {
        return Err("The conversation workspace changed. Reopen it before continuing.".into());
    }
    if !allowed(&method, &path, body.as_ref()) {
        return Err("This conversation work request is not available.".into());
    }
    let encoded = body
        .map(|v| serde_json::to_string(&v))
        .transpose()
        .map_err(|_| "Invalid conversation work request.")?;
    if encoded
        .as_ref()
        .is_some_and(|value| value.len() > 256 * 1024)
    {
        return Err("The message is too large. It has not been sent.".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        intent_json(session, &method, format!("/api/intents{path}"), encoded)
    })
    .await
    .map_err(|error| format!("Conversation work request failed: {error}"))?;
    // The old customer request may already have committed. Do not expose its
    // result in a newly selected workspace, or describe it as definitely unsent.
    let current_scope = customer_session_identity(&state)
        .ok()
        .map(|(session, subject)| self::scope(&session, &subject));
    if current_scope.as_deref() != Some(scope.as_str()) {
        return Err("The conversation workspace changed while this request was in progress. It may already have been accepted. Reopen the original workspace to check its receipt.".into());
    }
    result
}

/// Fixed read of public execution metadata. No journal, caller-built URL or run ID.
#[tauri::command]
pub async fn intent_work_progress(
    scope: String,
    turn_id: String,
    state: tauri::State<'_, AuthState>,
) -> Result<Value, String> {
    let (session, subject) = customer_session_identity(&state)?;
    if scope != self::scope(&session, &subject) {
        return Err("The conversation workspace changed. Reopen it before continuing.".into());
    }
    if !uuid(&turn_id) {
        return Err("Invalid conversation turn identifier.".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || chat_progress_json(session, &turn_id))
        .await
        .map_err(|_| "Conversation progress could not be read.")?;
    let current_scope = customer_session_identity(&state)
        .ok()
        .map(|(session, subject)| self::scope(&session, &subject));
    if current_scope.as_deref() != Some(scope.as_str()) {
        return Err("The conversation workspace changed. Reopen it before continuing.".into());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "31d68301-aa27-4948-91fd-6c7521bd3d0a";

    #[test]
    fn only_fixed_work_operations_are_available() {
        let object = serde_json::json!({});
        assert!(allowed("POST", "/input", Some(&object)));
        assert!(allowed("GET", &format!("/input/{ID}/1"), None));
        assert!(allowed("GET", &format!("/{ID}/turns"), None));
        assert!(allowed(
            "GET",
            &format!("/{ID}/turns?limit=50&cursor=opaque%2Bpage"),
            None
        ));
        assert!(allowed(
            "POST",
            &format!("/{ID}/turns/{ID}/stop"),
            Some(&object)
        ));
        for path in [
            "/input/../commands".to_owned(),
            "//external.test/input".to_owned(),
            "/input?target=x".to_owned(),
            "/input#ignored".to_owned(),
            format!("/{ID}/turns/{ID}/stop?x=y"),
            format!("/{ID}/turns/{ID}/start"),
        ] {
            assert!(!allowed("POST", &path, Some(&object)), "{path}");
        }
        for path in [
            format!("/input/{ID}/01"),
            format!("/input/{ID}/0"),
            format!("/input/{ID}/1000001"),
            format!("/{ID}/turns?limit=51"),
            format!("/{ID}/turns?limit=1&limit=2"),
            format!("/{ID}/turns?cursor="),
            format!("/{ID}/turns?owner=x"),
            format!("/{ID}/turns?cursor={}", "x".repeat(2049)),
            format!("/%33{}/turns", &ID[1..]),
            format!("/{ID}/turns#fragment"),
        ] {
            assert!(!allowed("GET", &path, None), "{path}");
        }
        assert!(!allowed("GET", &format!("/{ID}/turns"), Some(&object)));
        assert!(!allowed("POST", "/input", None));
        assert!(!allowed("POST", "/input", Some(&serde_json::json!([]))));
        assert!(!allowed("DELETE", &format!("/{ID}/turns"), None));
    }
}
