//! The avenCITY desktop/mobile shell.
//!
//! Card 0121 stripped this crate back to what hosting a webview game needs. The
//! game is entirely webview-side (three.js), so there are no commands, no managed
//! state, and no plugins beyond opening external URLs. The exit drain went with
//! avenDB — there is no store left to flush, so the process can just exit.
//!
//! Logging survives on purpose: a silent Rust side is what makes a TestFlight
//! build undebuggable.

mod asr;
mod artifacts;
mod assets;
mod auth;
mod tts;

use tauri::Manager;

/// Load the official shared ONNX Runtime before either speech engine creates a
/// session. Linux uses dynamic loading because the crate's static distribution
/// requires a newer glibc/libstdc++ ABI than our Ubuntu 22.04 baseline.
///
/// CUDA is registered on the environment, so every ASR, VAD, and TTS session
/// attempts GPU execution first. ONNX Runtime keeps unsupported graph nodes on
/// CPU and falls back to CPU entirely when the CUDA provider or its libraries
/// are unavailable.
#[cfg(target_os = "linux")]
fn init_onnxruntime(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
	let bundled = app
		.path()
		.resource_dir()?
		.join("onnxruntime")
		.join("libonnxruntime.dylib");
	let path = std::env::var_os("ORT_DYLIB_PATH")
		.map(std::path::PathBuf::from)
		.filter(|path| path.is_file())
		.unwrap_or(bundled);
	if !path.is_file() {
		return Err(std::io::Error::new(
			std::io::ErrorKind::NotFound,
			format!("ONNX Runtime shared library not found at {}", path.display()),
		)
		.into());
	}
	let gpu_mode = std::env::var("AVEN_SPEECH_GPU")
		.unwrap_or_else(|_| "auto".to_string())
		.to_ascii_lowercase();
	let request_cuda = match gpu_mode.as_str() {
		"auto" | "cuda" => true,
		"cpu" | "off" | "0" => false,
		other => {
			log::warn!(
				target: "avenos::voice",
				"unknown AVEN_SPEECH_GPU={other:?}; using auto"
			);
			true
		}
	};
	let runtime_has_cuda = path
		.parent()
		.is_some_and(|dir| dir.join("libonnxruntime_providers_cuda.so").is_file());
	let try_cuda = request_cuda && runtime_has_cuda;
	if request_cuda && !runtime_has_cuda {
		log::info!(
			target: "avenos::voice",
			"CUDA execution provider is not bundled; speech will use CPU"
		);
	}

	let mut runtime = ort::init_from(&path)?
		.with_name("avenos-speech")
		.with_telemetry(false);
	if try_cuda {
		runtime = runtime.with_execution_providers([ort::ep::CUDA::default().build()]);
	}
	runtime.commit();
	log::info!(
		target: "avenos::voice",
		"ONNX Runtime loaded from {}; speech compute preference: {}",
		path.display(),
		if try_cuda { "CUDA with CPU fallback" } else { "CPU" }
	);
	Ok(())
}

/// WebKitGTK does not provide permission UI for an embedded application. Its
/// default `permission-request` handler therefore rejects `getUserMedia`, even
/// though capture works in a normal browser. Enable the media features and
/// grant only audio-only user-media requests from our main webview.
#[cfg(target_os = "linux")]
fn configure_linux_microphone(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
	let webview = app.get_webview("main").ok_or_else(|| {
		std::io::Error::new(std::io::ErrorKind::NotFound, "main webview not found")
	})?;
	webview.with_webview(|webview| {
		use webkit2gtk::glib::prelude::Cast;
		use webkit2gtk::{
			PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
			UserMediaPermissionRequestExt, WebViewExt,
		};

		let inner = webview.inner();
		if let Some(settings) = inner.settings() {
			settings.set_enable_webrtc(true);
			settings.set_enable_media_stream(true);
			settings.set_media_playback_requires_user_gesture(false);
		}
		inner.connect_permission_request(|_, request| {
			let Some(media) = request.downcast_ref::<UserMediaPermissionRequest>() else {
				return false;
			};
			if media.is_for_audio_device() && !media.is_for_video_device() {
				request.allow();
				log::info!(target: "avenos::voice", "granted microphone permission");
				true
			} else {
				false
			}
		});
	})?;
	Ok(())
}

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

	let builder = tauri::Builder::default()
		// Open external URLs in the system browser so the game window stays put.
		.plugin(tauri_plugin_opener::init());
	#[cfg(target_os = "macos")]
	let builder = builder.plugin(tauri_plugin_macos_passkey::init());
	#[cfg(target_os = "ios")]
	let builder = builder.plugin(tauri_plugin_ios_passkey::init());

	builder
		// On-device German speech, both directions. Both engines are built lazily
		// on first use, so a session that never speaks or listens pays nothing.
		.manage(tts::TtsState::default())
		.manage(asr::AsrState::default())
		.manage(auth::AuthState::default())
		.manage(artifacts::LlmStreamState::default())
		.invoke_handler(tauri::generate_handler![
			artifacts::artifact_upload,
			artifacts::artifact_processing_status,
			artifacts::llm_model_list,
			artifacts::llm_complete,
			artifacts::llm_openai_complete,
			artifacts::llm_openai_stream,
			artifacts::llm_openai_stream_cancel,
			artifacts::intent_list,
			artifacts::intent_get,
			artifacts::intent_append_contribution,
			artifacts::intent_create,
			artifacts::intent_update,
			artifacts::intent_lifecycle,
			artifacts::intent_delete,
			artifacts::artifact_content_get,
			artifacts::artifact_get,
			artifacts::artifact_evidence_get,
			artifacts::artifact_store_list,
			auth::auth_status,
			auth::auth_names,
			auth::billing_me,
			auth::billing_subscribe,
			auth::billing_cancel,
			auth::billing_resume,
			auth::billing_invoice_download,
			auth::billing_orders,
			auth::billing_checkout,
			auth::billing_checkout_window,
			auth::auth_passkey_begin,
			auth::auth_passkey_finish,
			auth::auth_begin,
			auth::auth_poll,
			auth::auth_logout,
			tts::tts_prepare,
			tts::tts_speak,
			asr::asr_prepare,
			asr::asr_push,
			asr::asr_reset,
			asr::asr_output_active
		])
		.setup(|app| {
			#[cfg(target_os = "linux")]
			{
				init_onnxruntime(app)?;
				configure_linux_microphone(app)?;
			}

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
