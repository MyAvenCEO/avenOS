mod asr;
mod llm;
mod biscuit_resolver;
mod crypto;
mod mesh;
mod network;
mod jazz;
mod jazz_auth;
mod log_ring;
mod peers;
mod schema_manifest;
mod schema_migrations;
mod identity_acc;
mod identity_sync;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Listener, Manager, RunEvent};

/// Prevents duplicated drain work when [`RunEvent::ExitRequested`] fires more than once.
static JAZZ_EXIT_DRAINING: AtomicBool = AtomicBool::new(false);

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

			// NOTE: the on-device voice model is NOT auto-downloaded on launch. The
			// user starts it explicitly from Self → Settings → Models (the ~640 MB
			// download shouldn't happen unprompted). `asr::spawn_model_download` is
			// invoked on demand via the `asr_start_download` command.

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
		.invoke_handler(tauri::generate_handler![
			avenos_recent_rust_logs,
			network::network_seed,
			network::aven_ceo_identity,
			jazz::groove_runtime,
			jazz::self_storage_paths,
			jazz::self_clear_jazz_database,
			jazz::self_clear_aven_os_data,
			asr::asr_status,
			asr::transcribe_audio,
			asr::asr_local_models,
			asr::asr_cancel_download,
			asr::asr_start_download,
			asr::asr_delete_model,
			llm::llm_status,
			llm::llm_generate,
			llm::llm_local_models,
			llm::llm_cancel_download,
			llm::llm_start_download,
			llm::llm_delete_model,
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
