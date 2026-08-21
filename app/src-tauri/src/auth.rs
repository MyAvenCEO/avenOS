use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const DEVICE_CLIENT_ID: &str = "ceo.aven.os";
const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
const IDENTITY_BASE_URL: &str = match option_env!("AVEN_IDENTITY_BASE_URL") {
	Some(url) => url,
	None => "https://id.next.aven.ceo",
};

#[derive(Default)]
pub struct AuthState(Mutex<AuthInner>);

#[derive(Default)]
struct AuthInner {
	pending: Option<PendingAuthorization>,
	session: Option<NativeSession>,
}

#[derive(Clone)]
struct PendingAuthorization {
	device_code: String,
	verification_uri_complete: String,
	user_code: String,
	expires_at: Instant,
	interval_seconds: u64,
}

struct NativeSession {
	token: String,
	user: AuthUser,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
	id: String,
	name: String,
	email: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
	authenticated: bool,
	user: Option<AuthUser>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginAuthorization {
	verification_uri_complete: String,
	user_code: String,
	expires_in: u64,
	interval: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollAuthorization {
	status: &'static str,
	user: Option<AuthUser>,
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
	device_code: String,
	verification_uri_complete: String,
	user_code: String,
	expires_in: u64,
	interval: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
	access_token: String,
	token_type: String,
}

#[derive(Deserialize)]
struct SessionResponse {
	user: AuthUser,
}

#[derive(Deserialize)]
struct ErrorResponse {
	error: Option<String>,
	code: Option<String>,
	error_description: Option<String>,
	message: Option<String>,
}

enum TokenExchange {
	Pending,
	Authenticated { token: String, user: AuthUser },
}

fn endpoint(path: &str) -> String {
	format!("{}/api/auth{path}", IDENTITY_BASE_URL.trim_end_matches('/'))
}

fn agent() -> ureq::Agent {
	ureq::AgentBuilder::new()
		.timeout(Duration::from_secs(15))
		.build()
}

fn parse_json<T: for<'de> Deserialize<'de>>(response: ureq::Response) -> Result<T, String> {
	let body = response
		.into_string()
		.map_err(|error| format!("Could not read identity response: {error}"))?;
	serde_json::from_str(&body).map_err(|error| format!("Invalid identity response: {error}"))
}

fn error_message(response: ureq::Response, fallback: &str) -> (Option<String>, String) {
	let parsed = response
		.into_string()
		.ok()
		.and_then(|body| serde_json::from_str::<ErrorResponse>(&body).ok());
	let code = parsed
		.as_ref()
		.and_then(|body| body.error.clone().or_else(|| body.code.clone()));
	let message = parsed
		.and_then(|body| body.error_description.or(body.message))
		.unwrap_or_else(|| fallback.to_string());
	(code, message)
}

fn issue_device_code() -> Result<PendingAuthorization, String> {
	let body = serde_json::json!({ "client_id": DEVICE_CLIENT_ID }).to_string();
	let response = agent()
		.post(&endpoint("/device/code"))
		.set("content-type", "application/json")
		.send_string(&body)
		.map_err(|error| match error {
			ureq::Error::Status(status, response) => {
				let (code, message) =
					error_message(response, "Could not start device authorization.");
				if status == 404 || code.as_deref() == Some("ORIGIN_NOT_ALLOWED") {
					"The identity service has not been updated for avenOS authentication yet."
						.to_string()
				} else {
					message
				}
			}
			ureq::Error::Transport(error) => format!("Identity service unavailable: {error}"),
		})?;
	let issued: DeviceCodeResponse = parse_json(response)?;
	Ok(PendingAuthorization {
		device_code: issued.device_code,
		verification_uri_complete: issued.verification_uri_complete,
		user_code: issued.user_code,
		expires_at: Instant::now() + Duration::from_secs(issued.expires_in),
		interval_seconds: issued.interval.max(1),
	})
}

fn verify_session(token: &str) -> Result<AuthUser, String> {
	let response = agent()
		.get(&endpoint("/get-session"))
		.set("authorization", &format!("Bearer {token}"))
		.call()
		.map_err(|error| match error {
			ureq::Error::Status(_, response) => {
				error_message(response, "The new session could not be verified.").1
			}
			ureq::Error::Transport(error) => format!("Identity service unavailable: {error}"),
		})?;
	Ok(parse_json::<SessionResponse>(response)?.user)
}

fn exchange_device_code(pending: &PendingAuthorization) -> Result<TokenExchange, String> {
	if Instant::now() >= pending.expires_at {
		return Err("The device authorization expired. Start again.".to_string());
	}
	let body = serde_json::json!({
		"grant_type": DEVICE_GRANT_TYPE,
		"device_code": pending.device_code,
		"client_id": DEVICE_CLIENT_ID
	})
	.to_string();
	let result = agent()
		.post(&endpoint("/device/token"))
		.set("content-type", "application/json")
		.send_string(&body);
	let response = match result {
		Ok(response) => response,
		Err(ureq::Error::Status(_, response)) => {
			let (code, message) = error_message(response, "Device authorization failed.");
			return match code.as_deref() {
				Some("authorization_pending" | "slow_down") => Ok(TokenExchange::Pending),
				_ => Err(message),
			};
		}
		Err(ureq::Error::Transport(error)) => {
			return Err(format!("Identity service unavailable: {error}"));
		}
	};
	let token: TokenResponse = parse_json(response)?;
	if !token.token_type.eq_ignore_ascii_case("bearer") || token.access_token.is_empty() {
		return Err("Identity service returned an invalid session token.".to_string());
	}
	let user = verify_session(&token.access_token)?;
	Ok(TokenExchange::Authenticated {
		token: token.access_token,
		user,
	})
}

#[tauri::command]
pub fn auth_status(state: tauri::State<'_, AuthState>) -> Result<AuthStatus, String> {
	let inner = state
		.0
		.lock()
		.map_err(|_| "Authentication state is unavailable.".to_string())?;
	Ok(AuthStatus {
		authenticated: inner.session.is_some(),
		user: inner.session.as_ref().map(|session| session.user.clone()),
	})
}

#[tauri::command]
pub async fn auth_begin(state: tauri::State<'_, AuthState>) -> Result<BeginAuthorization, String> {
	let pending = tauri::async_runtime::spawn_blocking(issue_device_code)
		.await
		.map_err(|error| format!("Could not start authentication: {error}"))??;
	let response = BeginAuthorization {
		verification_uri_complete: pending.verification_uri_complete.clone(),
		user_code: pending.user_code.clone(),
		expires_in: pending.expires_at.saturating_duration_since(Instant::now()).as_secs(),
		interval: pending.interval_seconds,
	};
	let mut inner = state
		.0
		.lock()
		.map_err(|_| "Authentication state is unavailable.".to_string())?;
	inner.pending = Some(pending);
	inner.session = None;
	Ok(response)
}

#[tauri::command]
pub async fn auth_poll(state: tauri::State<'_, AuthState>) -> Result<PollAuthorization, String> {
	let pending = state
		.0
		.lock()
		.map_err(|_| "Authentication state is unavailable.".to_string())?
		.pending
		.clone()
		.ok_or_else(|| "No device authorization is pending.".to_string())?;
	let exchange = tauri::async_runtime::spawn_blocking(move || exchange_device_code(&pending))
		.await
		.map_err(|error| format!("Could not finish authentication: {error}"))??;
	match exchange {
		TokenExchange::Pending => Ok(PollAuthorization {
			status: "pending",
			user: None,
		}),
		TokenExchange::Authenticated { token, user } => {
			let mut inner = state
				.0
				.lock()
				.map_err(|_| "Authentication state is unavailable.".to_string())?;
			inner.pending = None;
			inner.session = Some(NativeSession {
				token,
				user: user.clone(),
			});
			Ok(PollAuthorization {
				status: "authenticated",
				user: Some(user),
			})
		}
	}
}

#[tauri::command]
pub async fn auth_logout(state: tauri::State<'_, AuthState>) -> Result<(), String> {
	let token = {
		let mut inner = state
			.0
			.lock()
			.map_err(|_| "Authentication state is unavailable.".to_string())?;
		inner.pending = None;
		inner.session.take().map(|session| session.token)
	};
	if let Some(token) = token {
		tauri::async_runtime::spawn_blocking(move || {
			let _ = agent()
				.post(&endpoint("/sign-out"))
				.set("authorization", &format!("Bearer {token}"))
				.set("content-type", "application/json")
				.send_string("{}");
		})
		.await
		.map_err(|error| format!("Could not finish logout: {error}"))?;
	}
	Ok(())
}
