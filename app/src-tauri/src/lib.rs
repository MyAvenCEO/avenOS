//! The avenCITY desktop/mobile shell.
//!
//! Card 0121 stripped this crate back to what hosting a webview game needs. The
//! game is entirely webview-side (three.js), so there are no commands, no managed
//! state, and no plugins beyond opening external URLs. The exit drain went with
//! avenDB — there is no store left to flush, so the process can just exit.
//!
//! Logging survives on purpose: a silent Rust side is what makes a TestFlight
//! build undebuggable.

mod tts;

use tauri::Manager;

/// macOS/iOS route through `os_log` (subsystem `ceo.aven.os`) because iPhone
/// Console streaming is unreliable off-device.
#[cfg(any(target_os = "ios", target_os = "macos"))]
struct AppleLogger {
	subsystem: String,
}

#[cfg(any(target_os = "ios", target_os = "macos"))]
impl log::Log for AppleLogger {
	fn enabled(&self, metadata: &log::Metadata) -> bool {
		metadata.level() <= log::max_level()
	}

	fn log(&self, record: &log::Record) {
		if !self.enabled(record.metadata()) {
			return;
		}
		let oslog = oslog::OsLog::new(&self.subsystem, record.target());
		oslog.with_level(record.level().into(), &format!("{}", record.args()));
	}

	fn flush(&self) {}
}

#[cfg(any(target_os = "ios", target_os = "macos"))]
fn apple_os_log_raw(category: &str, message: &str) {
	use oslog::Level;
	oslog::OsLog::new("ceo.aven.os", category).with_level(Level::Fault, message);
}

#[cfg(any(target_os = "ios", target_os = "macos"))]
fn init_apple_os_logging() -> Result<(), log::SetLoggerError> {
	use log::LevelFilter;
	log::set_max_level(LevelFilter::Debug);
	log::set_boxed_logger(Box::new(AppleLogger {
		subsystem: "ceo.aven.os".to_string(),
	}))
}

/// Install the global `log` subscriber. Without this every `log::*` call in this
/// crate is a no-op. Override the filter with `RUST_LOG` (env_logger semantics).
fn init_logging() {
	#[cfg(any(target_os = "ios", target_os = "macos"))]
	if let Err(e) = init_apple_os_logging() {
		eprintln!("avenos: oslog init failed: {e}");
	}

	#[cfg(not(any(target_os = "ios", target_os = "macos")))]
	{
		let _ = env_logger::Builder::from_env(
			env_logger::Env::default().default_filter_or("info,avenos=debug"),
		)
		.format_timestamp_millis()
		.try_init();
	}

	log::info!(target: "avenos", "avenCITY shell starting");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	#[cfg(any(target_os = "ios", target_os = "macos"))]
	apple_os_log_raw("boot", "avenCITY Rust runtime starting");

	init_logging();

	tauri::Builder::default()
		// Open external URLs in the system browser so the game window stays put.
		.plugin(tauri_plugin_opener::init())
		// On-device German speech. The engine is built lazily on first use, so
		// this costs nothing for a session that never turns the voice on.
		.manage(tts::TtsState::default())
		.invoke_handler(tauri::generate_handler![tts::tts_prepare, tts::tts_speak])
		.setup(|app| {
			// The webview is the whole surface, so give it focus on launch —
			// otherwise the first click is spent activating the window.
			if let Some(window) = app.get_webview_window("main") {
				let _ = window.set_focus();
			}
			Ok(())
		})
		.run(tauri::generate_context!())
		.expect("error while running avenCITY");
}
