use serde::Serialize;

#[derive(Serialize)]
pub struct FlyResponse {
	pub status: u16,
	pub body: String,
}

/// Device-side authenticated fetch to the Fly.io API (board 0055). The webview can't reach
/// `api.fly.io` / `api.machines.dev` (CSP + CORS), so every Fly call goes through here. The
/// decrypted token stays in the app process; we attach it as a Bearer header and return the raw
/// response for the client to parse. Read-only by construction (the client only issues GET +
/// GraphQL query POSTs); this command is a generic proxy and does not interpret the verb.
#[tauri::command]
pub async fn fly_fetch(
	method: String,
	url: String,
	token: String,
	body: Option<String>,
) -> Result<FlyResponse, String> {
	let m = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
	let mut req = reqwest::Client::new()
		.request(m, &url)
		.header("Authorization", format!("Bearer {token}"))
		.header("Content-Type", "application/json");
	if let Some(b) = body {
		req = req.body(b);
	}
	let res = req.send().await.map_err(|e| e.to_string())?;
	let status = res.status().as_u16();
	let body = res.text().await.map_err(|e| e.to_string())?;
	Ok(FlyResponse { status, body })
}
