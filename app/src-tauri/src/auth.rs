use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DEVICE_CLIENT_ID: &str = "ceo.aven.os";
const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
const PASSKEY_RP_ID: &str = "id.next.aven.ceo";
const PASSKEY_ORIGIN: &str = "https://id.next.aven.ceo";
const IDENTITY_BASE_URL: &str = match option_env!("AVEN_IDENTITY_BASE_URL") {
	Some(url) => url,
	None => "https://id.next.aven.ceo",
};

#[derive(Default)]
pub struct AuthState(Mutex<AuthInner>);

#[derive(Default)]
struct AuthInner {
	pending: Option<PendingAuthorization>,
	pending_passkey: Option<PendingPasskeyAuthentication>,
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

struct PendingPasskeyAuthentication {
	cookie: String,
	expires_at: Instant,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginPasskeyAuthentication {
	available: bool,
	command: String,
	rp_id: String,
	challenge: Vec<u8>,
}

#[derive(Deserialize)]
pub struct NativePasskeyAssertion {
	id: String,
	raw_id: String,
	client_data_json: String,
	authenticator_data: String,
	signature: String,
	user_handle: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PasskeyAuthenticationOptions {
	challenge: String,
	rp_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProofOfWorkChallenge {
	id: String,
	nonce: String,
	purpose: String,
	difficulty_bits: u32,
	expires_at: u64,
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

/// `/api/names/mine` returns the rows themselves, not bare strings — the extra
/// columns are ignored here, the settings pane only shows which name it is.
#[derive(Deserialize)]
struct NamesResponse {
	names: Vec<OwnedName>,
}

#[derive(Deserialize)]
struct OwnedName {
	name: String,
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

pub(crate) fn api_endpoint(path: &str) -> String {
	format!("{}{path}", IDENTITY_BASE_URL.trim_end_matches('/'))
}

#[cfg(target_os = "macos")]
fn macos_supports_native_passkeys() -> bool {
	std::process::Command::new("/usr/bin/sw_vers")
		.arg("-productVersion")
		.output()
		.ok()
		.filter(|output| output.status.success())
		.and_then(|output| String::from_utf8(output.stdout).ok())
		.and_then(|version| version.split('.').next()?.parse::<u32>().ok())
		.is_some_and(|major| major >= 15)
}

/// AuthenticationServices refuses to run for a process without an
/// `application-identifier` entitlement — it fails with "The calling process
/// does not have an application identifier", which the passkey plugin reports
/// as a bare "Login failed". `tauri dev` runs an ad-hoc, linker-signed binary
/// with no team and no entitlements, so this is never satisfied in dev.
///
/// Ask the running process's own code signature, via the same Security
/// framework AuthenticationServices consults. Two tempting shortcuts are both
/// wrong: shelling out to `codesign` can be blocked by the App Sandbox, and
/// looking for `Contents/embedded.provisionprofile` fails on exactly the
/// builds that matter — Apple strips the profile from App Store and TestFlight
/// copies while keeping the entitlements in the signature, so a perfectly
/// entitled build would be pushed onto the browser fallback.
#[cfg(target_os = "macos")]
fn has_application_identifier() -> bool {
	use core_foundation::base::{CFType, CFTypeRef, TCFType};
	use core_foundation::string::{CFString, CFStringRef};
	use std::ffi::c_void;

	type SecTaskRef = *mut c_void;

	#[link(name = "Security", kind = "framework")]
	unsafe extern "C" {
		fn SecTaskCreateFromSelf(allocator: CFTypeRef) -> SecTaskRef;
		fn SecTaskCopyValueForEntitlement(
			task: SecTaskRef,
			entitlement: CFStringRef,
			error: *mut CFTypeRef,
		) -> CFTypeRef;
	}

	unsafe {
		let task = SecTaskCreateFromSelf(std::ptr::null());
		if task.is_null() {
			return false;
		}
		// Owns the task: released when this wrapper drops.
		let _task = CFType::wrap_under_create_rule(task as CFTypeRef);
		let key = CFString::new("com.apple.application-identifier");
		let mut error: CFTypeRef = std::ptr::null();
		let value = SecTaskCopyValueForEntitlement(task, key.as_concrete_TypeRef(), &mut error);
		if !error.is_null() {
			let _error = CFType::wrap_under_create_rule(error);
		}
		if value.is_null() {
			return false;
		}
		let _value = CFType::wrap_under_create_rule(value);
		true
	}
}

#[cfg(target_os = "macos")]
fn native_passkeys_available() -> bool {
	macos_supports_native_passkeys() && has_application_identifier()
}

#[cfg(target_os = "ios")]
fn native_passkeys_available() -> bool {
	true
}

#[cfg(not(any(target_os = "ios", target_os = "macos")))]
fn native_passkeys_available() -> bool {
	false
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

fn now_millis() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_millis() as u64
}

fn has_leading_zero_bits(digest: &[u8], bits: u32) -> bool {
	let complete_bytes = (bits / 8) as usize;
	if digest.iter().take(complete_bytes).any(|byte| *byte != 0) {
		return false;
	}
	let remaining_bits = bits % 8;
	remaining_bits == 0
		|| digest
			.get(complete_bytes)
			.is_some_and(|byte| byte & (0xff << (8 - remaining_bits)) == 0)
}

fn solve_proof_of_work(challenge: &ProofOfWorkChallenge) -> Result<String, String> {
	if challenge.purpose != "sign-in" || challenge.difficulty_bits > 28 {
		return Err(
			"The identity service returned an invalid proof-of-work challenge.".to_string(),
		);
	}
	let prefix = format!(
		"{}:{}:{}:",
		challenge.id, challenge.nonce, challenge.purpose
	);
	for counter in 0_u64.. {
		if now_millis() >= challenge.expires_at {
			return Err("The sign-in challenge expired. Try again.".to_string());
		}
		let digest = Sha256::digest(format!("{prefix}{counter}").as_bytes());
		if has_leading_zero_bits(&digest, challenge.difficulty_bits) {
			return Ok(format!("{}.{counter}", challenge.id));
		}
	}
	unreachable!()
}

fn proof_of_work() -> Result<String, String> {
	let response = agent()
		.get(&api_endpoint("/api/pow/challenge?purpose=sign-in"))
		.call()
		.map_err(|error| match error {
			ureq::Error::Status(_, response) => {
				error_message(response, "Could not create a sign-in challenge.").1
			}
			ureq::Error::Transport(error) => format!("Identity service unavailable: {error}"),
		})?;
	let challenge: ProofOfWorkChallenge = parse_json(response)?;
	solve_proof_of_work(&challenge)
}

fn passkey_cookie(response: &ureq::Response) -> Option<String> {
	response
		.all("set-cookie")
		.into_iter()
		.filter_map(|header| header.split(';').next())
		.find(|cookie| cookie.contains("better-auth-passkey="))
		.map(str::to_string)
}

fn request_passkey_authentication() -> Result<(BeginPasskeyAuthentication, String), String> {
	if IDENTITY_BASE_URL.trim_end_matches('/') != PASSKEY_ORIGIN {
		return Err(format!(
			"Native passkeys require the identity origin {PASSKEY_ORIGIN}."
		));
	}
	let response = agent()
		.get(&endpoint("/passkey/generate-authenticate-options"))
		.set("origin", PASSKEY_ORIGIN)
		.call()
		.map_err(|error| match error {
			ureq::Error::Status(_, response) => {
				error_message(response, "Could not request a passkey challenge.").1
			}
			ureq::Error::Transport(error) => format!("Identity service unavailable: {error}"),
		})?;
	let cookie = passkey_cookie(&response).ok_or_else(|| {
		"The identity service did not return passkey challenge state.".to_string()
	})?;
	let options: PasskeyAuthenticationOptions = parse_json(response)?;
	if options.rp_id != PASSKEY_RP_ID {
		return Err(format!(
			"The identity service returned RP ID {}, expected {PASSKEY_RP_ID}.",
			options.rp_id
		));
	}
	let challenge = URL_SAFE_NO_PAD
		.decode(options.challenge)
		.map_err(|_| "The identity service returned an invalid passkey challenge.".to_string())?;
	Ok((
		BeginPasskeyAuthentication {
			available: true,
			command: String::new(),
			rp_id: PASSKEY_RP_ID.to_string(),
			challenge,
		},
		cookie,
	))
}

fn passkey_response(assertion: &NativePasskeyAssertion) -> serde_json::Value {
	serde_json::json!({
		"id": assertion.id,
		"rawId": assertion.raw_id,
		"type": "public-key",
		"response": {
			"clientDataJSON": assertion.client_data_json,
			"authenticatorData": assertion.authenticator_data,
			"signature": assertion.signature,
			"userHandle": assertion.user_handle
		},
		"clientExtensionResults": {},
		"authenticatorAttachment": "platform"
	})
}

fn verify_passkey_authentication(
	pending: PendingPasskeyAuthentication,
	assertion: NativePasskeyAssertion,
) -> Result<(String, AuthUser), String> {
	if Instant::now() >= pending.expires_at {
		return Err("The passkey challenge expired. Try again.".to_string());
	}
	let proof = proof_of_work()?;
	let body = serde_json::json!({ "response": passkey_response(&assertion) }).to_string();
	let response = agent()
		.post(&endpoint("/passkey/verify-authentication"))
		.set("content-type", "application/json")
		.set("origin", PASSKEY_ORIGIN)
		.set("cookie", &pending.cookie)
		.set("x-proof-of-work", &proof)
		.send_string(&body)
		.map_err(|error| match error {
			ureq::Error::Status(_, response) => {
				error_message(response, "The passkey could not be verified.").1
			}
			ureq::Error::Transport(error) => format!("Identity service unavailable: {error}"),
		})?;
	let token = response
		.header("set-auth-token")
		.filter(|token| !token.is_empty())
		.map(str::to_string)
		.ok_or_else(|| "The identity service did not return an app session.".to_string())?;
	let user = parse_json::<SessionResponse>(response)?.user;
	Ok((token, user))
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

pub(crate) fn session_token(state: &tauri::State<'_, AuthState>) -> Result<String, String> {
	state
		.0
		.lock()
		.map_err(|_| "Authentication state is unavailable.".to_string())?
		.session
		.as_ref()
		.map(|session| session.token.clone())
		.ok_or_else(|| "No session is signed in.".to_string())
}

/// One authenticated round-trip to the identity API. Every billing command
/// goes through here with a HARDCODED path — the webview never chooses URLs,
/// and the Creem key never leaves the id service at all.
fn identity_api_call(
	token: String,
	method: &'static str,
	path: &'static str,
	body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
	let request = agent()
		.request(method, &api_endpoint(path))
		.set("authorization", &format!("Bearer {token}"));
	let response = match body {
		Some(json) => request
			.set("content-type", "application/json")
			.send_string(&json.to_string()),
		None => request.call(),
	}
	.map_err(|error| match error {
		ureq::Error::Status(_, response) => error_message(response, "The request failed.").1,
		ureq::Error::Transport(error) => format!("Identity service unavailable: {error}"),
	})?;
	parse_json::<serde_json::Value>(response)
}

/// The signed-in member's subscription standing (`null` before any tier).
#[tauri::command]
pub async fn billing_me(state: tauri::State<'_, AuthState>) -> Result<serde_json::Value, String> {
	let token = session_token(&state)?;
	tauri::async_runtime::spawn_blocking(move || {
		identity_api_call(token, "GET", "/api/billing/me", None)
	})
	.await
	.map_err(|error| format!("Could not load your subscription: {error}"))?
}

/// Open a checkout for a tier; returns the URL for the system browser.
#[tauri::command]
pub async fn billing_subscribe(
	tier: String,
	state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
	let token = session_token(&state)?;
	tauri::async_runtime::spawn_blocking(move || {
		identity_api_call(
			token,
			"POST",
			"/api/billing/subscribe",
			Some(serde_json::json!({ "tier": tier })),
		)
	})
	.await
	.map_err(|error| format!("Could not start the checkout: {error}"))?
}

/// Up- or downgrade to the other tier (proration charged immediately).
#[tauri::command]
pub async fn billing_upgrade(
	tier: String,
	state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
	let token = session_token(&state)?;
	tauri::async_runtime::spawn_blocking(move || {
		identity_api_call(
			token,
			"POST",
			"/api/billing/upgrade",
			Some(serde_json::json!({ "tier": tier })),
		)
	})
	.await
	.map_err(|error| format!("Could not change the plan: {error}"))?
}

/// Cancel at period end (Kündigungsbutton semantics — never silently immediate).
#[tauri::command]
pub async fn billing_cancel(
	state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
	let token = session_token(&state)?;
	tauri::async_runtime::spawn_blocking(move || {
		identity_api_call(
			token,
			"POST",
			"/api/billing/cancel",
			Some(serde_json::json!({})),
		)
	})
	.await
	.map_err(|error| format!("Could not cancel: {error}"))?
}

/// Undo a scheduled cancel / resume a paused subscription.
#[tauri::command]
pub async fn billing_resume(
	state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
	let token = session_token(&state)?;
	tauri::async_runtime::spawn_blocking(move || {
		identity_api_call(
			token,
			"POST",
			"/api/billing/resume",
			Some(serde_json::json!({})),
		)
	})
	.await
	.map_err(|error| format!("Could not resume: {error}"))?
}

/// Fallback for the inline checkout: when the provider refuses to be framed
/// inside the app, the same checkout opens in a dedicated avenOS window —
/// never the system browser. The URL was minted by the identity service;
/// this only re-opens it, and only if it really is the provider's checkout.
#[tauri::command]
pub async fn billing_checkout_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
	use tauri::Manager as _;
	let parsed = url
		.parse::<tauri::Url>()
		.map_err(|error| format!("The checkout link is invalid: {error}"))?;
	let host = parsed.host_str().unwrap_or_default();
	if parsed.scheme() != "https" || !(host == "creem.io" || host.ends_with(".creem.io")) {
		return Err("Only the payment provider's checkout may open here.".to_string());
	}
	if let Some(existing) = app.get_webview_window("billing-checkout") {
		let _ = existing.set_focus();
		return Ok(());
	}
	tauri::WebviewWindowBuilder::new(&app, "billing-checkout", tauri::WebviewUrl::External(parsed))
		.title("Checkout · avenOS")
		.inner_size(960.0, 760.0)
		.build()
		.map_err(|error| format!("Could not open the checkout window: {error}"))?;
	Ok(())
}

/// Meine Bestellungen — the signed-in member's orders.
#[tauri::command]
pub async fn billing_orders(
	state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
	let token = session_token(&state)?;
	tauri::async_runtime::spawn_blocking(move || {
		identity_api_call(token, "GET", "/api/billing/orders", None)
	})
	.await
	.map_err(|error| format!("Could not load your orders: {error}"))?
}

/// Pause the subscription; resume lifts it again.
#[tauri::command]
pub async fn billing_pause(
	state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
	let token = session_token(&state)?;
	tauri::async_runtime::spawn_blocking(move || {
		identity_api_call(
			token,
			"POST",
			"/api/billing/pause",
			Some(serde_json::json!({})),
		)
	})
	.await
	.map_err(|error| format!("Could not pause: {error}"))?
}

/// Where the member's latest checkout stands — polled while the inline
/// embed runs; the id stays server-side.
#[tauri::command]
pub async fn billing_checkout(
	state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
	let token = session_token(&state)?;
	tauri::async_runtime::spawn_blocking(move || {
		identity_api_call(token, "GET", "/api/billing/checkout", None)
	})
	.await
	.map_err(|error| format!("Could not read the checkout status: {error}"))?
}

/// The member's invoice history (dates, amounts, tax — documents live in the portal).
#[tauri::command]
pub async fn billing_invoices(
	state: tauri::State<'_, AuthState>,
) -> Result<serde_json::Value, String> {
	let token = session_token(&state)?;
	tauri::async_runtime::spawn_blocking(move || {
		identity_api_call(token, "GET", "/api/billing/invoices", None)
	})
	.await
	.map_err(|error| format!("Could not load your invoices: {error}"))?
}

/// The names reserved for whoever is signed in. Settings shows them so the
/// account you are looking at is the account you are actually in — the session
/// alone answers "who", not "which aven".
#[tauri::command]
pub async fn auth_names(state: tauri::State<'_, AuthState>) -> Result<Vec<String>, String> {
	let token = state
		.0
		.lock()
		.map_err(|_| "Authentication state is unavailable.".to_string())?
		.session
		.as_ref()
		.map(|session| session.token.clone())
		.ok_or_else(|| "No session is signed in.".to_string())?;
	tauri::async_runtime::spawn_blocking(move || {
		let response = agent()
			.get(&api_endpoint("/api/names/mine"))
			.set("authorization", &format!("Bearer {token}"))
			.call()
			.map_err(|error| match error {
				ureq::Error::Status(_, response) => {
					error_message(response, "Your reserved names could not be loaded.").1
				}
				ureq::Error::Transport(error) => format!("Identity service unavailable: {error}"),
			})?;
		Ok::<Vec<String>, String>(
			parse_json::<NamesResponse>(response)?
				.names
				.into_iter()
				.map(|owned| owned.name)
				.collect(),
		)
	})
	.await
	.map_err(|error| format!("Could not load your reserved names: {error}"))?
}

#[tauri::command]
pub async fn auth_passkey_begin(
	state: tauri::State<'_, AuthState>,
) -> Result<BeginPasskeyAuthentication, String> {
	if !native_passkeys_available() {
		return Ok(BeginPasskeyAuthentication {
			available: false,
			command: String::new(),
			rp_id: PASSKEY_RP_ID.to_string(),
			challenge: Vec::new(),
		});
	}
	let (response, cookie) = tauri::async_runtime::spawn_blocking(request_passkey_authentication)
		.await
		.map_err(|error| format!("Could not start native passkey authentication: {error}"))??;
	let mut inner = state
		.0
		.lock()
		.map_err(|_| "Authentication state is unavailable.".to_string())?;
	inner.pending = None;
	inner.pending_passkey = Some(PendingPasskeyAuthentication {
		cookie,
		expires_at: Instant::now() + Duration::from_secs(300),
	});
	inner.session = None;
	Ok(BeginPasskeyAuthentication {
		command: if cfg!(target_os = "ios") {
			"plugin:ios-passkey|login".to_string()
		} else {
			"plugin:macos-passkey|login_passkey".to_string()
		},
		..response
	})
}

#[tauri::command]
pub async fn auth_passkey_finish(
	assertion: NativePasskeyAssertion,
	state: tauri::State<'_, AuthState>,
) -> Result<AuthStatus, String> {
	let pending = state
		.0
		.lock()
		.map_err(|_| "Authentication state is unavailable.".to_string())?
		.pending_passkey
		.take()
		.ok_or_else(|| "No native passkey authentication is pending.".to_string())?;
	let (token, user) = tauri::async_runtime::spawn_blocking(move || {
		verify_passkey_authentication(pending, assertion)
	})
	.await
	.map_err(|error| format!("Could not finish native passkey authentication: {error}"))??;
	let mut inner = state
		.0
		.lock()
		.map_err(|_| "Authentication state is unavailable.".to_string())?;
	inner.session = Some(NativeSession {
		token,
		user: user.clone(),
	});
	Ok(AuthStatus {
		authenticated: true,
		user: Some(user),
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
		expires_in: pending
			.expires_at
			.saturating_duration_since(Instant::now())
			.as_secs(),
		interval: pending.interval_seconds,
	};
	let mut inner = state
		.0
		.lock()
		.map_err(|_| "Authentication state is unavailable.".to_string())?;
	inner.pending = Some(pending);
	inner.pending_passkey = None;
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
		inner.pending_passkey = None;
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn native_assertion_matches_webauthn_json_shape() {
		let response = passkey_response(&NativePasskeyAssertion {
			id: "credential".to_string(),
			raw_id: "credential".to_string(),
			client_data_json: "client".to_string(),
			authenticator_data: "authenticator".to_string(),
			signature: "signature".to_string(),
			user_handle: "user".to_string(),
		});
		assert_eq!(response["type"], "public-key");
		assert_eq!(response["rawId"], "credential");
		assert_eq!(response["response"]["userHandle"], "user");
	}

	#[test]
	fn proof_of_work_bit_check_handles_partial_bytes() {
		assert!(has_leading_zero_bits(&[0, 0b0000_1111], 12));
		assert!(!has_leading_zero_bits(&[0, 0b0001_0000], 12));
	}
}
