mod crypto;
mod demo_mesh;
mod network;
mod jazz;
mod jazz_auth;
mod log_ring;
mod peers;
mod schema_manifest;
mod schema_migrations;
mod spark_acc;
mod spark_sync;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Listener, Manager, RunEvent, Window};
#[cfg(target_os = "macos")]
use tauri::{LogicalPosition, LogicalSize, Rect, Runtime, Webview, WebviewUrl};
#[cfg(target_os = "macos")]
use url::Url;

/// Prevents duplicated drain work when [`RunEvent::ExitRequested`] fires more than once.
static JAZZ_EXIT_DRAINING: AtomicBool = AtomicBool::new(false);

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

/// Mirrors `buildCspHeader` in `libs/aven-vibe-sandbox/sandbox/serve.ts`.
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
			"../../libs/aven-vibe-sandbox/sandbox/dist/{relative}"
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
		"../../libs/aven-vibe-sandbox/sandbox/dist/{relative}"
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
					b"Missing ext-apps.js; run `bun run build` in libs/aven-vibe-sandbox."
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
					b"Missing sandbox.html; run `bun run build` in libs/aven-vibe-sandbox."
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

#[cfg(target_os = "macos")]
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

	macos_round_child_webview(&webview);

	Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn create_sandbox_webview(
	_window: Window,
	_label: String,
	_rect: SandboxRect,
	_host_origin: String,
	_csp_json: Option<String>,
) -> Result<(), String> {
	Err(
		"Native vibe-sandbox child webviews require macOS. iOS/Linux shells should use iframe-based sandboxes.".into(),
	)
}

#[cfg(target_os = "macos")]
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

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn set_sandbox_webview_rect(
	_window: Window,
	_label: String,
	_rect: SandboxRect,
) -> Result<(), String> {
	Err("sandbox webview layout is unsupported on this platform.".into())
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

#[cfg(target_os = "macos")]
#[tauri::command]
async fn destroy_sandbox_webview(window: Window, label: String) -> Result<(), String> {
	let webview = window
		.webviews()
		.into_iter()
		.find(|w| w.label() == label.as_str())
		.ok_or_else(|| format!("sandbox webview not found: {label}"))?;

	webview.close().map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn destroy_sandbox_webview(_window: Window, _label: String) -> Result<(), String> {
	Err("sandbox webviews are unsupported on this platform.".into())
}

const VAULT_EMBED_LABEL: &str = "vault-embed";

#[cfg(target_os = "macos")]
#[tauri::command]
async fn create_vault_embed_webview(
	window: Window,
	rect: SandboxRect,
	url: String,
) -> Result<(), String> {
	let rect = clamp_sandbox_rect(&window, rect);
	let parsed: Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;

	for webview in window.webviews() {
		if webview.label() == VAULT_EMBED_LABEL {
			let _ = webview.close();
		}
	}

	let webview = window
		.add_child(
			tauri::WebviewBuilder::new(
				VAULT_EMBED_LABEL,
				WebviewUrl::External(parsed),
			),
			LogicalPosition::new(rect.x, rect.y),
			LogicalSize::new(rect.w, rect.h),
		)
		.map_err(|e| e.to_string())?;

	macos_round_child_webview(&webview);
	Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn create_vault_embed_webview(
	_window: Window,
	_rect: SandboxRect,
	_url: String,
) -> Result<(), String> {
	Err("Native vault embed webviews require macOS.".into())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn set_vault_embed_webview_rect(window: Window, rect: SandboxRect) -> Result<(), String> {
	let rect = clamp_sandbox_rect(&window, rect);
	let webview = window
		.webviews()
		.into_iter()
		.find(|w| w.label() == VAULT_EMBED_LABEL)
		.ok_or_else(|| format!("vault embed webview not found: {VAULT_EMBED_LABEL}"))?;

	webview
		.set_bounds(Rect {
			position: LogicalPosition::new(rect.x, rect.y).into(),
			size: LogicalSize::new(rect.w, rect.h).into(),
		})
		.map_err(|e| e.to_string())?;
	Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn set_vault_embed_webview_rect(
	_window: Window,
	_rect: SandboxRect,
) -> Result<(), String> {
	Err("vault embed webview layout is unsupported on this platform.".into())
}

#[cfg(target_os = "macos")]
#[tauri::command]
async fn destroy_vault_embed_webview(window: Window) -> Result<(), String> {
	let webview = window
		.webviews()
		.into_iter()
		.find(|w| w.label() == VAULT_EMBED_LABEL)
		.ok_or_else(|| format!("vault embed webview not found: {VAULT_EMBED_LABEL}"))?;

	webview.close().map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn destroy_vault_embed_webview(_window: Window) -> Result<(), String> {
	Ok(())
}

#[tauri::command]
fn avenos_recent_rust_logs() -> Vec<String> {
	log_ring::recent_lines()
}

/// Install the global `log` subscriber.
///
/// Without this, every `log::debug!` / `log::warn!` in this crate is a no-op,
/// so `RUST_LOG=avenos::jazz=debug` produces nothing — leaving us blind whenever
/// SurrealKV / ObjectManager state diverges and we ask the user for diagnostics.
///
/// Default filter prints `info` everywhere plus `debug` for our own `avenos::*`
/// targets so dev runs always show the Jazz lifecycle. Users can override via
/// `RUST_LOG` (standard `env_logger` semantics).
///
/// macOS/iOS TestFlight builds route through `os_log` (subsystem `ceo.aven.os`) and an in-app ring
/// buffer (`avenos_recent_rust_logs`) because iPhone Console streaming is unreliable off-device.
#[cfg(any(target_os = "ios", target_os = "macos"))]
struct AppleRingLogger {
	subsystem: String,
}

#[cfg(any(target_os = "ios", target_os = "macos"))]
impl log::Log for AppleRingLogger {
	fn enabled(&self, metadata: &log::Metadata) -> bool {
		metadata.level() <= log::max_level()
	}

	fn log(&self, record: &log::Record) {
		if !self.enabled(record.metadata()) {
			return;
		}
		let message = format!("{}", record.args());
		let line = format!("{} {}: {}", record.level(), record.target(), message);
		log_ring::push_line(line.clone());
		let oslog = oslog::OsLog::new(&self.subsystem, record.target());
		oslog.with_level(record.level().into(), &message);
	}

	fn flush(&self) {}
}

#[cfg(any(target_os = "ios", target_os = "macos"))]
fn apple_os_log_raw(category: &str, message: &str) {
	use oslog::Level;
	log_ring::push_line(format!("FAULT {category}: {message}"));
	oslog::OsLog::new("ceo.aven.os", category).with_level(Level::Fault, message);
}

#[cfg(any(target_os = "ios", target_os = "macos"))]
fn init_apple_os_logging() -> Result<(), log::SetLoggerError> {
	use log::LevelFilter;
	log::set_max_level(LevelFilter::Debug);
	log::set_boxed_logger(Box::new(AppleRingLogger {
		subsystem: "ceo.aven.os".to_string(),
	}))
}

fn init_logging() {
	#[cfg(any(target_os = "ios", target_os = "macos"))]
	if let Err(e) = init_apple_os_logging() {
		eprintln!("avenos: oslog init failed: {e}");
	}

	#[cfg(not(any(target_os = "ios", target_os = "macos")))]
	{
		let _ = env_logger::Builder::from_env(
			env_logger::Env::default().default_filter_or("info,avenos=debug,groove::sync_manager=debug"),
		)
		.format_timestamp_millis()
		.try_init();
	}

	// Forward `tracing::*` events from groove into the `log` crate (Apple ring + os_log).
	log_ring::init_tracing_bridge();

	log::info!(
		target: "avenos",
		"Rust logging ready (Console filter: subsystem:ceo.aven.os)",
	);
}

/// Idempotently drain JazzClient + flush RocksDB.
///
/// `JAZZ_EXIT_DRAINING` is a single-shot guard: if `Ok(false)` was previously
/// observed, this is the first call and we run the drain. Otherwise we no-op
/// (e.g. SIGINT then a follow-up `ExitRequested`).
async fn drain_jazz_async(app_handle: AppHandle) {
	if JAZZ_EXIT_DRAINING.swap(true, Ordering::SeqCst) {
		log::debug!("drain_jazz_async: already draining, skipping");
		return;
	}
	log::info!("shutdown: draining JazzClient + SurrealKV before exit");
	let actor = jazz::runtime::groove_actor(&app_handle);
	// Hard cap the drain. If `reset_connection` is wedged on a Mutex /
	// `runtime.flush()` deadlock, blocking forever just trades one bad
	// shutdown (no flush) for a worse one (no exit at all, and the dev
	// supervisor escalates to SIGKILL anyway). 5s is plenty for an idle
	// client and short enough to detect a wedge in tests.
	let drain_start = std::time::Instant::now();
	let drain = tokio::time::timeout(
		std::time::Duration::from_secs(5),
		actor.reset_connection(),
	);
	match drain.await {
		Ok(()) => log::info!(
			"shutdown: drain complete in {:?}",
			drain_start.elapsed()
		),
		Err(_) => log::error!(
			"shutdown: drain TIMED OUT after 5s — SurrealKV may not be fully flushed (likely deadlock on JazzClient/runtime flush)"
		),
	}
}

/// Same as [`drain_jazz_async`] but **blocks** the calling thread.
///
/// Safe to call only from a thread that is **not** already inside a tokio
/// runtime — typically the Tauri main thread from a `RunEvent::ExitRequested`
/// callback. Calling this from within a tokio task would deadlock.
fn drain_jazz_blocking(app_handle: &AppHandle) {
	let ah = app_handle.clone();
	tauri::async_runtime::block_on(drain_jazz_async(ah));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	#[cfg(any(target_os = "ios", target_os = "macos"))]
	apple_os_log_raw("boot", "avenOS Rust runtime starting");

	init_logging();

	#[cfg(any(target_os = "ios", target_os = "macos"))]
	apple_os_log_raw("boot", "avenOS Rust logging initialized");

	tauri::Builder::default()
		.plugin(tauri_plugin_self::init())
		.plugin(tauri_plugin_vault::init())
		.plugin(tauri_plugin_sandbox_quickjs::init())
		.plugin(tauri_plugin_clipboard_manager::init())
		.manage(jazz::ManagedJazz::default())
		.setup(|app| {
			if let Err(e) = schema_manifest::install_runtime_schema_files(app.handle()) {
				log::error!("schema runtime install: {e}");
			}

			app.manage(jazz::runtime::spawn_groove_actor(app.handle().clone()));
			app.manage(jazz::ui_drain::spawn_ui_table_drain(app.handle().clone()));

			// Start the table-change drain so peer-sync deltas reach the webview without
			// requiring a manual refresh. Local CRUD already calls `snapshot_broadcast`
			// inline; this drain is what closes the loop for *remote* writes.
			let mj_drain = app.state::<jazz::ManagedJazz>();
			if let Some(rx) = mj_drain.take_change_rx() {
				let handle_for_drain = app.handle().clone();
				tauri::async_runtime::spawn(jazz::run_table_change_drain(handle_for_drain, rx));
			} else {
				log::warn!(
					target: "avenos::jazz",
					"table-change drain receiver already taken; webview will only refresh on local writes",
				);
			}

			let handle_for_lock = app.handle().clone();
			let _lock_listen = app.listen("self:did-lock", move |_event| {
				let handle = handle_for_lock.clone();
				tauri::async_runtime::spawn(async move {
					#[cfg(target_os = "macos")]
					if let Some(main) = handle.get_webview_window("main") {
						for (label, w) in main.webviews() {
							if label == VAULT_EMBED_LABEL {
								let _ = w.close();
							}
						}
					}
					jazz::runtime::groove_actor(&handle).reset_connection().await;
				});
			});

			// CRITICAL: A bare `Ctrl+C` (SIGINT) bypasses Tauri's `ExitRequested`
			// path and kills the process before our async shutdown can flush
			// SurrealKV. The result on next boot is the very symptom we have
			// been chasing for hours: commits visible on read (`get_or_load`
			// reconstructs branches from the durable commit log), but writes
			// fail with `ObjectNotFound` because index pages, branch tips, or
			// catalogue entries written in the same transaction never reached
			// disk. Catch SIGINT/SIGTERM on macOS/Linux dev hosts so `Ctrl+C` matches window-close drain.
			#[cfg(any(target_os = "macos", target_os = "linux"))]
			{
				let handle_for_signal = app.handle().clone();
				tauri::async_runtime::spawn(async move {
					use tokio::signal::unix::{signal, SignalKind};
					let (mut sigint, mut sigterm) = match (
						signal(SignalKind::interrupt()),
						signal(SignalKind::terminate()),
					) {
						(Ok(i), Ok(t)) => (i, t),
						(int_res, term_res) => {
							log::warn!(
								"signal handler install failed (int={:?} term={:?}); Ctrl+C will skip Jazz flush",
								int_res.err(), term_res.err()
							);
							return;
						}
					};
					tokio::select! {
						_ = sigint.recv() => log::info!("SIGINT received → draining Jazz"),
						_ = sigterm.recv() => log::info!("SIGTERM received → draining Jazz"),
					}
					drain_jazz_async(handle_for_signal.clone()).await;
					handle_for_signal.exit(130);
				});
			}

			Ok(())
		})
		.register_uri_scheme_protocol("vibe-sandbox", |ctx, request| {
			serve_vibe_sandbox(ctx.app_handle(), &request)
		})
		.invoke_handler(tauri::generate_handler![
			avenos_recent_rust_logs,
			demo_mesh::demo_peer_mesh_status,
			create_sandbox_webview,
			set_sandbox_webview_rect,
			destroy_sandbox_webview,
			create_vault_embed_webview,
			set_vault_embed_webview_rect,
			destroy_vault_embed_webview,
			network::network_seed,
			jazz::groove_runtime,
			jazz::self_storage_paths,
			jazz::self_clear_jazz_database,
			jazz::self_clear_aven_os_data,
		])
		.build(tauri::generate_context!())
		.expect("error while building tauri application")
		.run(|app_handle, event| {
			match event {
				RunEvent::ExitRequested { api, code, .. } => {
					// JazzClient owns a SurrealKV handle that requires an
					// explicit async flush (`shutdown()` → `runtime.flush()` →
					// `storage.flush()`). If the process exits while that flush
					// is still in flight, the next boot opens a half-written
					// store: commits are visible on read but `add_commit` index
					// updates / branch-tip writes are missing → every `update`
					// / `delete` fails with the misleading
					// `QueryError::ObjectNotFound`. Block here (we're on the
					// main thread, no tokio runtime is active locally) so we
					// only return after the drain finishes.
					if JAZZ_EXIT_DRAINING.load(Ordering::SeqCst) {
						return;
					}
					api.prevent_exit();
					let exit_code = code.unwrap_or(0);
					drain_jazz_blocking(app_handle);
					app_handle.exit(exit_code);
				}
				_ => {}
			}
		});
}
