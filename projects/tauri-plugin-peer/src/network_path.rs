//! NWPathMonitor + app foreground bridge (macOS/iOS).

use std::ffi::CStr;
use std::os::raw::c_char;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkPathChangedPayload {
	pub satisfied: bool,
	pub expensive: bool,
	pub constrained: bool,
	pub interfaces: Vec<String>,
}

type PathCallback = extern "C" fn(u8, u8, u8, *const c_char, u64);
type ForegroundCallback = extern "C" fn(u64);

struct MonitorContext {
	app: AppHandle,
	debounce: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

extern "C" fn on_path_update(
	satisfied: u8,
	expensive: u8,
	constrained: u8,
	interfaces: *const c_char,
	context: u64,
) {
	let ctx = unsafe { &*(context as *const MonitorContext) };
	let iface_str = if interfaces.is_null() {
		String::new()
	} else {
		unsafe { CStr::from_ptr(interfaces).to_string_lossy().into_owned() }
	};
	let ifaces: Vec<String> = iface_str
		.split(',')
		.filter(|s| !s.is_empty())
		.map(str::to_string)
		.collect();
	let payload = NetworkPathChangedPayload {
		satisfied: satisfied != 0,
		expensive: expensive != 0,
		constrained: constrained != 0,
		interfaces: ifaces,
	};
	let app = ctx.app.clone();
	let debounce = ctx.debounce.clone();
	tauri::async_runtime::spawn(async move {
		let mut guard = debounce.lock().await;
		if let Some(h) = guard.take() {
			h.abort();
		}
		*guard = Some(tokio::spawn(async move {
			tokio::time::sleep(Duration::from_millis(400)).await;
			log::info!(
				target: "avenos::peeroxide",
				"peer_heal: path_change satisfied={} expensive={} constrained={} interfaces={:?}",
				payload.satisfied,
				payload.expensive,
				payload.constrained,
				payload.interfaces,
			);
			let _ = app.emit("peer:network-path-changed", &payload);
		}));
	});
}

extern "C" fn on_app_foreground(context: u64) {
	let ctx = unsafe { &*(context as *const MonitorContext) };
	log::info!(target: "avenos::peeroxide", "peer_heal: foreground");
	let _ = ctx.app.emit("peer:app-foreground", ());
}

extern "C" {
	fn network_path_start_monitor(
		path_cb: PathCallback,
		path_ctx: u64,
		foreground_cb: ForegroundCallback,
		foreground_ctx: u64,
	);
	fn network_path_stop_monitor();
}

static MONITOR_CTX: std::sync::OnceLock<Arc<MonitorContext>> = std::sync::OnceLock::new();

pub fn start_network_path_monitor(app: AppHandle) {
	let ctx = Arc::new(MonitorContext {
		app,
		debounce: Arc::new(Mutex::new(None)),
	});
	let _ = MONITOR_CTX.set(Arc::clone(&ctx));
	let ctx_ptr = Arc::as_ptr(&ctx) as u64;
	unsafe {
		network_path_start_monitor(on_path_update, ctx_ptr, on_app_foreground, ctx_ptr);
	}
}

pub fn stop_network_path_monitor() {
	unsafe {
		network_path_stop_monitor();
	}
}
