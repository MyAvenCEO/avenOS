mod crypto;
mod genesis;
mod jazz;
mod jazz_auth;
mod log_ring;
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
mod peer_catchup;
mod peer_mesh_state;
mod peers;
mod peer_sync_gate;
mod schema_manifest;
mod schema_migrations;
mod spark_acc;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::path::BaseDirectory;
use tauri::{
	AppHandle, Listener, LogicalPosition, LogicalSize, Manager, Rect, Runtime, RunEvent, Webview,
	WebviewUrl, Window,
};

/// Prevents duplicated drain work when [`RunEvent::ExitRequested`] fires more than once.
static JAZZ_EXIT_DRAINING: AtomicBool = AtomicBool::new(false);
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
			"../../libs/vibe-app-sandbox/sandbox/dist/{relative}"
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
		"../../libs/vibe-app-sandbox/sandbox/dist/{relative}"
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

#[tauri::command]
fn avenos_recent_rust_logs() -> Vec<String> {
	log_ring::recent_lines()
}

/// DHT/announce lifecycle counters scraped from the `tracing` bridge in [`log_ring`].
///
/// Surfaced separately from `peer_transport_status` so the frontend can render them
/// even if the Hyperswarm actor hasn't booted yet. Equivalent JSON shape on macOS and iOS.
#[tauri::command]
fn avenos_dht_trace_snapshot() -> serde_json::Value {
	let s = log_ring::dht_trace_snapshot();
	serde_json::json!({
		"dhtBootstrapped": s.bootstrapped,
		"lastAnnounceClosest": s.last_announce_closest,
		"lastLookupPeerCount": s.last_lookup_peer_count,
		"discoveredPeerTotal": s.discovered_peer_total,
		"handshakeRelayForwardTotal": s.handshake_relay_forward_total,
		"swarmPeerConnectedTotal": s.swarm_peer_connected_total,
		"lastConnectRelayed": s.last_connect_relayed,
		"lastRemoteHolepunchable": s.last_remote_holepunchable,
		"holepunchBlindRelayFallbackTotal": s.holepunch_blind_relay_fallback_total,
	})
}

/// Compile-time / runtime central relay constants (public key is not secret).
#[tauri::command]
fn avenos_relay_identity_snapshot() -> serde_json::Value {
	fn first_non_empty(vars: &[&str]) -> Option<String> {
		for key in vars {
			if let Ok(v) = std::env::var(key) {
				let t = v.trim();
				if !t.is_empty() {
					return Some(t.to_string());
				}
			}
		}
		None
	}

	let relay_url = first_non_empty(&["AVEN_RELAY_URL"]).or_else(|| {
		option_env!("AVEN_RELAY_URL")
			.map(str::trim)
			.filter(|s| !s.is_empty())
			.map(str::to_string)
	});
	let relay_public_key_hex = first_non_empty(&["AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX"])
		.or_else(|| {
			option_env!("AVENOS_HYPERSWARM_RELAY_PUBKEY_HEX")
				.map(str::trim)
				.filter(|s| !s.is_empty())
				.map(str::to_string)
		});
	let dht_bootstrap = first_non_empty(&["AVENOS_DHT_BOOTSTRAP"]).or_else(|| {
		option_env!("AVENOS_DHT_BOOTSTRAP")
			.map(str::trim)
			.filter(|s| !s.is_empty())
			.map(str::to_string)
	});
	let relay_addr = first_non_empty(&["AVENOS_HYPERSWARM_RELAY_ADDR"]).or_else(|| {
		option_env!("AVENOS_HYPERSWARM_RELAY_ADDR")
			.map(str::trim)
			.filter(|s| !s.is_empty())
			.map(str::to_string)
	});

	serde_json::json!({
		"relayUrl": relay_url,
		"relayPublicKeyHex": relay_public_key_hex,
		"dhtBootstrap": dht_bootstrap,
		"relayAddr": relay_addr,
	})
}

/// One-shot HTTPS reachability probe to the configured relay host.
///
/// `peer_transport_status` shows whether `udp/<bootstrap>` is healthy (via DHT counters);
/// this command shows whether the *same network path* reaches the relay over TCP/443.
/// When TCP works and UDP doesn't, we know UDP is being dropped by the router / carrier
/// (the classic iOS-on-locked-down-WiFi failure mode).
#[tauri::command]
async fn avenos_relay_https_probe() -> serde_json::Value {
	let host = std::env::var("AVEN_RELAY_URL")
		.ok()
		.or_else(|| option_env!("AVEN_RELAY_URL").map(|s| s.to_string()))
		.unwrap_or_default();
	if host.trim().is_empty() {
		return serde_json::json!({
			"ok": false,
			"error": "AVEN_RELAY_URL unset (no compile-time embed, no runtime override)",
		});
	}
	let trimmed = host
		.trim()
		.trim_start_matches("https://")
		.trim_start_matches("http://")
		.trim_end_matches('/');
	let url = format!("https://{trimmed}/.well-known/aven-relay.json");

	let start = std::time::Instant::now();
	let client = match reqwest::Client::builder()
		.timeout(std::time::Duration::from_secs(6))
		.build()
	{
		Ok(c) => c,
		Err(e) => {
			return serde_json::json!({
				"ok": false,
				"error": format!("client build failed: {e}"),
				"url": url,
			});
		}
	};
	match client.get(&url).send().await {
		Ok(res) => {
			let status = res.status();
			let elapsed = start.elapsed().as_millis();
			serde_json::json!({
				"ok": status.is_success(),
				"status": status.as_u16(),
				"latencyMs": elapsed as u64,
				"url": url,
			})
		}
		Err(e) => serde_json::json!({
			"ok": false,
			"error": format!("{e}"),
			"latencyMs": start.elapsed().as_millis() as u64,
			"url": url,
		}),
	}
}

/// Install the global `log` subscriber.
///
/// Without this, every `log::debug!` / `log::warn!` in this crate is a no-op,
/// so `RUST_LOG=avenos::jazz=debug` produces nothing — leaving us blind whenever
/// SurrealKV / ObjectManager state diverges and we ask the user for diagnostics.
///
/// Default filter prints `info` everywhere plus `debug` for our own `avenos::*`
/// targets so dev runs always show the Jazz lifecycle. Per-frame P2P gate traffic
/// stays at `trace` (see `peer_sync_gate.rs`) so catch-up does not flood the terminal.
/// Users can override via `RUST_LOG` (standard `env_logger` semantics), e.g.
/// `RUST_LOG=avenos::peer_sync_gate=trace` or pipe to a file: `2>&1 | tee avenos.log`.
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

	// Forward `tracing::*` events from peeroxide / peeroxide-dht / groove into the `log`
	// crate. Without this, the announce/lookup/connect lifecycle logs were silently
	// dropped — leaving us blind during pairing rendezvous. The Apple `log::Log` impl
	// then forwards into the in-app ring buffer + `os_log`. Replaces the previous
	// `tracing_log::LogTracer::init()` call, which went the wrong direction (log → tracing).
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
		.plugin(tauri_plugin_peer::init())
		.plugin(tauri_plugin_clipboard_manager::init())
		.manage(genesis::GenesisState::default())
		.manage(jazz::ManagedJazz::default())
		.setup(|app| {
			if let Err(e) = schema_manifest::install_runtime_schema_files(app.handle()) {
				log::error!("jazz-schema runtime install: {e}");
			}

			app.manage(jazz::runtime::spawn_groove_actor(app.handle().clone()));
			#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
			app.manage(peer_catchup::spawn_peer_catchup_worker(app.handle().clone()));

			let state = app.state::<genesis::GenesisState>();
			if let Err(e) = genesis::bootstrap(&state) {
				log::error!("GENESIS_NETWORK_ID bootstrap: {e}");
			}

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
			let _vault_lock_listen = app.listen("self:did-lock", move |_event| {
				let handle = handle_for_lock.clone();
				tauri::async_runtime::spawn(async move {
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

			let h_invite = app.handle().clone();
			let _peer_invite_listen = app.listen("peer:invite-paired", move |event| {
				let hh = h_invite.clone();
				let payload = event.payload().to_string();
				tauri::async_runtime::spawn(async move {
					if let Err(e) = crate::jazz::apply_peer_invite_paired(&hh, &payload).await {
						log::warn!(target: "avenos::jazz", "peer:invite-paired: {e}");
					}
				});
			});

			// Hyperswarm can finish spawning *after* the first Jazz connect + allowlist rebuild.
			// In that narrow window `set_allowlist_and_join_pair_topics` returns early (no swarm
			// handle) and durable per-pair topic joins stay pending until the next reconcile tick.
			// The peer plugin emits this as soon as the swarm actor is alive so we eagerly re-run the
			// same mesh refresh Groove expects after pairing.
			let h_swarm_ready = app.handle().clone();
			let _hyperswarm_ready_mesh = app.listen("peer:hyperswarm-ready", move |_event| {
				let hh = h_swarm_ready.clone();
				tauri::async_runtime::spawn(async move {
					if let Err(e) = jazz::refresh_peer_mesh_primitives(&hh).await {
						log::debug!(
							target: "avenos::jazz",
							"peer:hyperswarm-ready mesh refresh skipped: {e}",
						);
					}
				});
			});

			let h_connect_ui = app.handle().clone();
			let _connect_ui_mesh = app.listen("peer:connect-ui-changed", move |_event| {
				let hh = h_connect_ui.clone();
				tauri::async_runtime::spawn(async move {
					crate::jazz::runtime::groove_actor(&hh).publish_mesh().await;
				});
			});

			let h_mesh_push = app.handle().clone();
			let _mesh_push = app.listen("peer:mesh-push", move |_event| {
				let hh = h_mesh_push.clone();
				tauri::async_runtime::spawn(async move {
					crate::jazz::runtime::groove_actor(&hh).publish_mesh().await;
				});
			});

			let h_path_heal = app.handle().clone();
			let _path_heal_mesh = app.listen("peer:network-path-changed", move |_event| {
				let hh = h_path_heal.clone();
				tauri::async_runtime::spawn(async move {
					if let Err(e) = jazz::peer_mesh_reconcile_tick(&hh, false).await {
						log::debug!(
							target: "avenos::jazz",
							"peer:network-path-changed mesh reconcile skipped: {e}",
						);
					}
				});
			});

			let h_fg_heal = app.handle().clone();
			let _fg_heal_mesh = app.listen("peer:app-foreground", move |_event| {
				let hh = h_fg_heal.clone();
				tauri::async_runtime::spawn(async move {
					if let Err(e) = jazz::peer_mesh_reconcile_tick(&hh, false).await {
						log::debug!(
							target: "avenos::jazz",
							"peer:app-foreground mesh reconcile skipped: {e}",
						);
					}
				});
			});

			// Hyperswarm connections form **asynchronously** after pairing/grant: by the time
			// `apply_peer_invite_paired` runs `refresh_peer_mesh_primitives`, the peer's
			// `SwarmConnection` usually hasn't reached `HyperswarmGrooveBridge.on_swarm_connection`
			// yet, so `register_peer_sync_client` is never called and Groove never replicates rows
			// to that peer (and vice versa). The bridge now fires `peer_set_changed_notify` every
			// time a peer is added/removed; mirror that into a mesh-refresh + an **adaptive** timer
			// (fast tick right after startup, slower steady-state) so new swarm links register with
			// Jazz sync without fixed 10s latency.
			#[cfg(any(target_os = "macos", target_os = "linux", target_os = "ios"))]
			{
				use groove::sync_manager::ClientId;
				use std::collections::HashSet;

				let h_mesh = app.handle().clone();
				tauri::async_runtime::spawn(async move {
					use std::time::{Duration, Instant};

					let bridge = h_mesh.state::<tauri_plugin_peer::HyperswarmGrooveBridge>();
					let notify = bridge.peer_set_changed_notify();
					let fast_until = Instant::now() + Duration::from_secs(90);
					let mut in_fast_phase = true;
					loop {
						let tick_dur = if in_fast_phase && Instant::now() < fast_until {
							Duration::from_secs(2)
						} else {
							in_fast_phase = false;
							Duration::from_secs(8)
						};
						let n = notify.clone();
						let tick = tokio::time::sleep(tick_dur);
						tokio::select! {
							_ = n.notified() => {}
							_ = tick => {}
						};
						let live_links =
							h_mesh.state::<std::sync::Arc<tauri_plugin_peer::PeerLinkCoordinator>>();
						let live: HashSet<ClientId> = live_links
							.snapshot_mux_ready_clients()
							.await
							.into_iter()
							.collect();
						let h_catch = h_mesh.state::<crate::peer_catchup::PeerCatchupHandle>();
						h_catch.live_clients_changed(live).await;
						if let Err(e) = jazz::peer_mesh_reconcile_tick(&h_mesh, true).await {
							log::debug!(
								target: "avenos::jazz",
								"peer-mesh reconcile skipped: {e}"
							);
						}
					}
				});
			}

			Ok(())
		})
		.register_uri_scheme_protocol("vibe-sandbox", |ctx, request| {
			serve_vibe_sandbox(ctx.app_handle(), &request)
		})
		.invoke_handler(tauri::generate_handler![
			avenos_recent_rust_logs,
			avenos_dht_trace_snapshot,
			avenos_relay_identity_snapshot,
			avenos_relay_https_probe,
			create_sandbox_webview,
			set_sandbox_webview_rect,
			destroy_sandbox_webview,
			genesis::genesis_network_id,
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
