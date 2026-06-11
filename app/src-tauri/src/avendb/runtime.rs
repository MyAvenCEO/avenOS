//! Single-mailbox serialization for avenDB: IPC, mesh, and **all** `ManagedAvenDb::conn` access.
//! UI table-change drains run on [`super::ui_drain::UiTableDrainHandle`] instead.

use tauri::{AppHandle, Manager};
use tauri_plugin_self::state::SelfState;
use tokio::sync::{mpsc, oneshot};

use crate::avendb::avendb_runtime_dispatch;
use crate::avendb::{avenDBRuntimeEnvelope, ManagedAvenDb};

enum avenDBActorMsg {
	Runtime {
		window: tauri::Window,
		envelope: avenDBRuntimeEnvelope,
		reply: oneshot::Sender<Result<serde_json::Value, String>>,
	},
	PublishMesh,
	ResetConnection {
		reply: oneshot::Sender<()>,
	},
}

#[derive(Clone)]
pub struct avenDBActorHandle {
	tx: mpsc::Sender<avenDBActorMsg>,
}

impl avenDBActorHandle {
	pub async fn runtime_invoke(
		&self,
		window: tauri::Window,
		envelope: avenDBRuntimeEnvelope,
	) -> Result<serde_json::Value, String> {
		let (reply, rx) = oneshot::channel();
		self.tx
			.send(avenDBActorMsg::Runtime {
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
		let _ = self.tx.send(avenDBActorMsg::PublishMesh).await;
	}

	pub async fn reset_connection(&self) {
		let (reply, rx) = oneshot::channel();
		if self
			.tx
			.send(avenDBActorMsg::ResetConnection { reply })
			.await
			.is_ok()
		{
			let _ = rx.await;
		}
	}

}

const ACTOR_CAPACITY: usize = 512;

pub fn spawn_avendb_actor(app: AppHandle) -> avenDBActorHandle {
	let (tx, mut rx) = mpsc::channel::<avenDBActorMsg>(ACTOR_CAPACITY);
	let app_loop = app.clone();
	tauri::async_runtime::spawn(async move {
		while let Some(msg) = rx.recv().await {
			let avendb = app_loop.state::<ManagedAvenDb>();
			let self_state: tauri::State<'_, SelfState> = app_loop.state::<SelfState>();
			let ss = self_state.inner();

			match msg {
				avenDBActorMsg::Runtime {
					window,
					envelope,
					reply,
				} => {
					let out =
						avendb_runtime_dispatch(&app_loop, window, &avendb, ss, envelope).await;
					let _ = reply.send(out);
				}
				avenDBActorMsg::PublishMesh => {
					super::execute_publish_mesh(&app_loop, &avendb, ss).await;
				}
				avenDBActorMsg::ResetConnection { reply } => {
					avendb.reset_connection().await;
					let _ = reply.send(());
				}
			}
		}
	});
	avenDBActorHandle { tx }
}

pub(crate) fn avendb_actor(app: &AppHandle) -> avenDBActorHandle {
	app.state::<avenDBActorHandle>().inner().clone()
}
