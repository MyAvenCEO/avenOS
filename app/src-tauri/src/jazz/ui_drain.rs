//! UI table-change drain — separate mailbox from [`super::runtime::GrooveActorHandle`].
//!
//! Peer mesh reconcile, IPC runtime, and invite apply stay on the Groove actor. Snapshot
//! republish + vault shell re-hydrate for the webview runs here so inbound sync deltas
//! cannot queue behind mesh work or block P2P handshake timing on the same task.

use std::collections::HashSet;

use tauri::{AppHandle, Manager};
use tauri_plugin_self::state::SelfState;
use tokio::sync::mpsc;

use crate::jazz::ManagedJazz;

#[derive(Clone)]
pub struct UiTableDrainHandle {
	tx: mpsc::Sender<HashSet<String>>,
}

impl UiTableDrainHandle {
	pub async fn enqueue(&self, pending: HashSet<String>) -> Result<(), String> {
		self.tx
			.send(pending)
			.await
			.map_err(|_| "ui table drain mailbox closed".to_string())
	}
}

const DRAIN_CAPACITY: usize = 256;

pub fn spawn_ui_table_drain(app: AppHandle) -> UiTableDrainHandle {
	let (tx, mut rx) = mpsc::channel::<HashSet<String>>(DRAIN_CAPACITY);
	let app_loop = app.clone();
	tauri::async_runtime::spawn(async move {
		while let Some(pending) = rx.recv().await {
			let jazz = app_loop.state::<ManagedJazz>();
			let self_state: tauri::State<'_, SelfState> = app_loop.state::<SelfState>();
			let ss = self_state.inner();
			super::execute_drain_batch(&app_loop, &jazz, ss, pending).await;
		}
	});
	UiTableDrainHandle { tx }
}

pub(crate) fn ui_table_drain(app: &AppHandle) -> UiTableDrainHandle {
	app.state::<UiTableDrainHandle>().inner().clone()
}
