mod genesis;
mod jazz;
mod schema_manifest;

use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::{
	AppHandle, LogicalPosition, LogicalSize, Manager, Rect, Runtime, Webview, WebviewUrl, Window,
};
use url::Url;

/// Child sandbox webview bounds in **logical/CSS pixels**, i.e. raw host `getBoundingClientRect()`
/// (layout viewport). `PhysicalPosition` + JS `scaleFactor()` was able to disagree with wry’s
/// `backingScaleFactor`, which collapsed Y and drew the child above the host (over header/tabs).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxRect {
	pub x: f64,
	pub y: f64,
	pub w: f64,
	pub h: f64,
	pub min_y: Option<f64>,
}

fn clamp_sandbox_rect(window: &Window, mut rect: SandboxRect) -> SandboxRect {
	#[cfg(target_os = "macos")]
	{
		// Svelte's `getBoundingClientRect` is relative to the client area (below the titlebar).
		// Tauri/wry `add_child` positions the child webview relative to the full window top-left.
		// If the window has a standard titlebar, we must offset the Y coordinate by the titlebar height
		// so the native webview aligns with the DOM layout.
		if let (Ok(outer), Ok(inner), Ok(scale)) = (
			window.outer_size(),
			window.inner_size(),
			window.scale_factor(),
		) {
			if outer.height > inner.height {
				let titlebar_height = (outer.height - inner.height) as f64 / scale;
				rect.y += titlebar_height;
				if let Some(min) = rect.min_y.as_mut() {
					*min += titlebar_height;
				}
			}
		}
	}

	let Some(min_y) = rect.min_y else {
		return rect;
	};
	if rect.y >= min_y {
		return rect;
	}
	let bottom = rect.y + rect.h;
	let y = min_y;
	let h = (bottom - y).max(1.0);
	SandboxRect { y, h, ..rect }
}

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpUiResourceCsp {
	#[serde(default)]
	resource_domains: Vec<String>,
	#[serde(default)]
	connect_domains: Vec<String>,
	#[serde(default)]
	frame_domains: Vec<String>,
	#[serde(default)]
	base_uri_domains: Vec<String>,
}

fn sanitize_csp_domains(domains: &[String]) -> Vec<&str> {
	domains
		.iter()
		.filter(|d| !d.chars().any(|c| matches!(c, ';' | '\r' | '\n' | '\'' | '"' | ' ')))
		.map(|s| s.as_str())
		.collect()
}

/// Mirrors `buildCspHeader` in `libs/vibe-app-sandbox/sandbox/serve.ts`.
fn build_csp_header(csp: &McpUiResourceCsp) -> String {
	let resource_domains = sanitize_csp_domains(&csp.resource_domains).join(" ");
	let connect_domains = sanitize_csp_domains(&csp.connect_domains).join(" ");
	let frame_domains_joined = sanitize_csp_domains(&csp.frame_domains).join(" ");
	let base_uri_joined = sanitize_csp_domains(&csp.base_uri_domains).join(" ");

	let frame_directive = if frame_domains_joined.is_empty() {
		"frame-src 'none'".to_string()
	} else {
		format!("frame-src {frame_domains_joined}")
	};
	let base_uri_directive = if base_uri_joined.is_empty() {
		"base-uri 'none'".to_string()
	} else {
		format!("base-uri {base_uri_joined}")
	};

	let directives = [
		"default-src 'self' 'unsafe-inline'".to_string(),
		format!(
			"script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: {}",
			resource_domains
		),
		format!(
			"style-src 'self' 'unsafe-inline' blob: data: {}",
			resource_domains
		),
		format!("img-src 'self' data: blob: {}", resource_domains),
		format!("font-src 'self' data: blob: {}", resource_domains),
		format!("media-src 'self' data: blob: {}", resource_domains),
		format!(
			"connect-src 'self' ipc: http://ipc.localhost {}",
			connect_domains
		),
		format!("worker-src 'self' blob: {}", resource_domains),
		frame_directive,
		"object-src 'none'".to_string(),
		base_uri_directive,
	];

	directives
		.into_iter()
		.map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
		.collect::<Vec<_>>()
		.join("; ")
}

fn parse_csp_query(uri: &http::Uri) -> McpUiResourceCsp {
	let Some(query) = uri.query() else {
		return McpUiResourceCsp::default();
	};
	for pair in query.split('&') {
		let mut kv = pair.splitn(2, '=');
		let key = kv.next().unwrap_or("");
		if key != "csp" {
			continue;
		}
		let encoded = kv.next().unwrap_or("");
		let Ok(decoded) = urlencoding::decode(encoded) else {
			continue;
		};
		if let Ok(c) = serde_json::from_str::<McpUiResourceCsp>(&decoded) {
			return c;
		}
	}
	McpUiResourceCsp::default()
}

fn read_sandbox_asset(app: &AppHandle, relative: &str) -> std::io::Result<Vec<u8>> {
	// In debug (dev) builds, prefer the live source path so iterating on the
	// sandbox bundle doesn't require a Rust rebuild. In release builds, only the
	// bundled resource exists.
	if cfg!(debug_assertions) {
		let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
		let live = manifest_dir.join(format!(
			"../../../libs/vibe-app-sandbox/sandbox/dist/{relative}"
		));
		if live.exists() {
			return std::fs::read(live);
		}
	}

	if let Ok(resource_path) =
		app.path().resolve(format!("vibe-sandbox/{relative}"), BaseDirectory::Resource)
	{
		if resource_path.exists() {
			return std::fs::read(resource_path);
		}
	}

	let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
	let fallback = manifest_dir.join(format!(
		"../../../libs/vibe-app-sandbox/sandbox/dist/{relative}"
	));
	std::fs::read(fallback)
}

fn serve_vibe_sandbox(
	app: &AppHandle,
	request: &http::Request<Vec<u8>>,
) -> http::Response<Vec<u8>> {
	let uri = request.uri();
	let path_norm = uri.path().trim_start_matches('/');

	let cross_headers = [
		(
			http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
			http::HeaderValue::from_static("*"),
		),
		(
			http::HeaderName::from_static("cross-origin-opener-policy"),
			http::HeaderValue::from_static("same-origin"),
		),
		(
			http::HeaderName::from_static("cross-origin-embedder-policy"),
			http::HeaderValue::from_static("require-corp"),
		),
		(
			http::HeaderName::from_static("cross-origin-resource-policy"),
			http::HeaderValue::from_static("cross-origin"),
		),
	];

	if path_norm == "ext-apps.js" {
		return match read_sandbox_asset(app, "ext-apps.js") {
			Ok(bytes) => {
				let mut res = http::Response::builder()
					.status(http::StatusCode::OK)
					.header(
						http::header::CONTENT_TYPE,
						"text/javascript; charset=utf-8",
					)
					.header(
						http::header::CACHE_CONTROL,
						"public, max-age=31536000, immutable",
					);
				for (k, v) in cross_headers {
					res = res.header(k, v);
				}
				res.body(bytes).unwrap()
			}
			Err(_) => http::Response::builder()
				.status(http::StatusCode::SERVICE_UNAVAILABLE)
				.body(
					b"Missing ext-apps.js; run `bun run build` in libs/vibe-app-sandbox."
						.to_vec(),
				)
				.unwrap(),
		};
	}

	if path_norm.is_empty() || path_norm == "sandbox.html" {
		let csp_cfg = parse_csp_query(uri);
		let csp_header = build_csp_header(&csp_cfg);

		return match read_sandbox_asset(app, "sandbox.html") {
			Ok(bytes) => {
				let mut res = http::Response::builder()
					.status(http::StatusCode::OK)
					.header(http::header::CONTENT_TYPE, "text/html; charset=utf-8")
					.header(http::header::CONTENT_SECURITY_POLICY, csp_header)
					.header(http::header::CACHE_CONTROL, "no-cache, no-store, must-revalidate")
					.header(http::header::PRAGMA, "no-cache")
					.header(http::header::EXPIRES, "0");
				for (k, v) in cross_headers {
					res = res.header(k, v);
				}
				res.body(bytes).unwrap()
			}
			Err(_) => http::Response::builder()
				.status(http::StatusCode::SERVICE_UNAVAILABLE)
				.body(
					b"Missing sandbox.html; run `bun run build` in libs/vibe-app-sandbox."
						.to_vec(),
				)
				.unwrap(),
		};
	}

	http::Response::builder()
		.status(http::StatusCode::NOT_FOUND)
		.body(b"Not found".to_vec())
		.unwrap()
}

#[tauri::command]
async fn create_sandbox_webview(
	window: Window,
	label: String,
	rect: SandboxRect,
	host_origin: String,
	csp_json: Option<String>,
) -> Result<(), String> {
	let rect = clamp_sandbox_rect(&window, rect);
	let mut qs = format!(
		"tauri=1&vsLabel={}&hostOrigin={}",
		urlencoding::encode(&label),
		urlencoding::encode(&host_origin)
	);
	if let Some(ref csp) = csp_json {
		if !csp.is_empty() {
			qs.push_str("&csp=");
			qs.push_str(&urlencoding::encode(csp));
		}
	}

	let url: Url = format!("vibe-sandbox://localhost/sandbox.html?{qs}")
		.parse()
		.map_err(|e: url::ParseError| e.to_string())?;

	for webview in window.webviews() {
		if webview.label().starts_with("vibe-sb-") {
			let _ = webview.close();
		}
	}

	let webview = window
		.add_child(
			tauri::WebviewBuilder::new(label.clone(), WebviewUrl::CustomProtocol(url)),
			LogicalPosition::new(rect.x, rect.y),
			LogicalSize::new(rect.w, rect.h),
		)
		.map_err(|e| e.to_string())?;

	#[cfg(target_os = "macos")]
	macos_round_child_webview(&webview);

	Ok(())
}

#[tauri::command]
async fn set_sandbox_webview_rect(
	window: Window,
	label: String,
	rect: SandboxRect,
) -> Result<(), String> {
	let rect = clamp_sandbox_rect(&window, rect);
	let webview = window
		.webviews()
		.into_iter()
		.find(|w| w.label() == label.as_str())
		.ok_or_else(|| format!("sandbox webview not found: {label}"))?;

	webview
		.set_bounds(Rect {
			position: LogicalPosition::new(rect.x, rect.y).into(),
			size: LogicalSize::new(rect.w, rect.h).into(),
		})
		.map_err(|e| e.to_string())?;
	Ok(())
}

/// Match AvenOS `--radius-lg` (1rem ≈ 16px) on the native WKWebView layer.
#[cfg(target_os = "macos")]
fn macos_round_child_webview<R: Runtime>(webview: &Webview<R>) {
	const RADIUS: f64 = 16.0;
	if let Err(e) = webview.with_webview(|platform| {
		let ptr = platform.inner();
		if ptr.is_null() {
			return;
		}
		unsafe { macos_wkwebview_round_layer(ptr, RADIUS) }
	}) {
		log::warn!("sandbox webview rounded corners: {e}");
	}
}

#[cfg(target_os = "macos")]
unsafe fn macos_wkwebview_round_layer(wkwebview: *mut std::ffi::c_void, radius: f64) {
	use objc2::msg_send;
	use objc2::runtime::AnyObject;

	let view: *mut AnyObject = wkwebview.cast();
	if view.is_null() {
		return;
	}
	let () = msg_send![&*view, setWantsLayer: true];
	let layer: *mut AnyObject = msg_send![&*view, layer];
	if layer.is_null() {
		return;
	}
	let () = msg_send![&*layer, setCornerRadius: radius];
	let () = msg_send![&*layer, setMasksToBounds: true];
}

#[tauri::command]
async fn destroy_sandbox_webview(window: Window, label: String) -> Result<(), String> {
	let webview = window
		.webviews()
		.into_iter()
		.find(|w| w.label() == label.as_str())
		.ok_or_else(|| format!("sandbox webview not found: {label}"))?;

	webview.close().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_self::init())
		.manage(genesis::GenesisState::default())
		.manage(jazz::ManagedJazz::default())
		.setup(|app| {
			let state = app.state::<genesis::GenesisState>();
			if let Err(e) = genesis::bootstrap(&state) {
				log::error!("GENESIS_NETWORK_ID bootstrap: {e}");
			}
			Ok(())
		})
		.register_uri_scheme_protocol("vibe-sandbox", |ctx, request| {
			serve_vibe_sandbox(ctx.app_handle(), &request)
		})
		.invoke_handler(tauri::generate_handler![
			create_sandbox_webview,
			set_sandbox_webview_rect,
			destroy_sandbox_webview,
			genesis::genesis_network_id,
			jazz::jazz_bootstrap,
			jazz::jazz_status,
			jazz::jazz_list,
			jazz::jazz_get,
			jazz::jazz_create,
			jazz::jazz_update,
			jazz::jazz_delete,
			jazz::jazz_subscribe,
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}
