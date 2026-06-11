//! Single-mailbox serialization for avenDB: IPC, mesh, and **all** `ManagedAvenDb::conn` access.
//! UI table-change drains run on [`super::ui_drain::UiTableDrainHandle`] instead.

use tauri::{AppHandle, Manager};
use tauri_plugin_self::state::SelfState;
use tokio::sync::{mpsc, oneshot};

use crate::avendb::avendb_runtime_dispatch;
use crate::avendb::{AvenDbRuntimeEnvelope, ManagedAvenDb};

enum AvenDbActorMsg {
	Runtime {
		window: tauri::Window,
		envelope: AvenDbRuntimeEnvelope,
		reply: oneshot::Sender<Result<serde_json::Value, String>>,
	},
	PublishMesh,
	ResetConnection {
		reply: oneshot::Sender<()>,
	},
}

#[derive(Clone)]
pub struct AvenDbActorHandle {
	tx: mpsc::Sender<AvenDbActorMsg>,
}

impl AvenDbActorHandle {
	pub async fn runtime_invoke(
		&self,
		window: tauri::Window,
		envelope: AvenDbRuntimeEnvelope,
	) -> Result<serde_json::Value, String> {
		let (reply, rx) = oneshot::channel();
		self.tx
			.send(AvenDbActorMsg::Runtime {
				window,
				envelope,
				reply,
			})
			.await
			.map_err(|_| "avendb actor mailbox closed".to_string())?;
		rx.await
			.map_err(|_| "avendb actor reply dropped".to_string())?
	}

	pub async fn publish_mesh(&self) {
		let _ = self.tx.send(AvenDbActorMsg::PublishMesh).await;
	}

	pub async fn reset_connection(&self) {
		let (reply, rx) = oneshot::channel();
		if self
			.tx
			.send(AvenDbActorMsg::ResetConnection { reply })
			.await
			.is_ok()
		{
			let _ = rx.await;
		}
	}

}

const ACTOR_CAPACITY: usize = 512;

pub fn spawn_avendb_actor(app: AppHandle) -> AvenDbActorHandle {
	let (tx, mut rx) = mpsc::channel::<AvenDbActorMsg>(ACTOR_CAPACITY);
	let app_loop = app.clone();
	tauri::async_runtime::spawn(async move {
		while let Some(msg) = rx.recv().await {
			let avendb = app_loop.state::<ManagedAvenDb>();
			let self_state: tauri::State<'_, SelfState> = app_loop.state::<SelfState>();
			let ss = self_state.inner();

			match msg {
				AvenDbActorMsg::Runtime {
					window,
					envelope,
					reply,
				} => {
					let out =
						avendb_runtime_dispatch(&app_loop, window, &avendb, ss, envelope).await;
					let _ = reply.send(out);
				}
				AvenDbActorMsg::PublishMesh => {
					super::execute_publish_mesh(&app_loop, &avendb, ss).await;
				}
				AvenDbActorMsg::ResetConnection { reply } => {
					avendb.reset_connection().await;
					let _ = reply.send(());
				}
			}
		}
	});
	AvenDbActorHandle { tx }
}

pub(crate) fn avendb_actor(app: &AppHandle) -> AvenDbActorHandle {
	app.state::<AvenDbActorHandle>().inner().clone()
}
