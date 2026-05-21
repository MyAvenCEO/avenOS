//! Single-mailbox serialization for Groove: IPC, drain, mesh, and **all** `ManagedJazz::conn` access.

use std::collections::HashSet;

use tauri::{AppHandle, Manager};
use tauri_plugin_self::state::SelfState;
use tokio::sync::{mpsc, oneshot};

use crate::jazz::groove_runtime_dispatch;
use crate::jazz::{GrooveRuntimeEnvelope, ManagedJazz};

enum GrooveActorMsg {
	Runtime {
		window: tauri::Window,
		envelope: GrooveRuntimeEnvelope,
		reply: oneshot::Sender<Result<serde_json::Value, String>>,
	},
	Drain {
		pending: HashSet<String>,
	},
	MeshRefresh {
		reply: oneshot::Sender<Result<u32, String>>,
	},
	MeshReconcile {
		reply: oneshot::Sender<Result<(), String>>,
	},
	PublishMesh,
	ResetConnection {
		reply: oneshot::Sender<()>,
	},
	ApplyPeerInvite {
		payload: String,
		reply: oneshot::Sender<Result<(), String>>,
	},
}

#[derive(Clone)]
pub struct GrooveActorHandle {
	tx: mpsc::Sender<GrooveActorMsg>,
}

impl GrooveActorHandle {
	pub async fn runtime_invoke(
		&self,
		window: tauri::Window,
		envelope: GrooveRuntimeEnvelope,
	) -> Result<serde_json::Value, String> {
		let (reply, rx) = oneshot::channel();
		self.tx
			.send(GrooveActorMsg::Runtime {
				window,
				envelope,
				reply,
			})
			.await
			.map_err(|_| "groove actor mailbox closed".to_string())?;
		rx.await
			.map_err(|_| "groove actor reply dropped".to_string())?
	}

	pub async fn enqueue_drain(&self, pending: HashSet<String>) -> Result<(), String> {
		self.tx
			.send(GrooveActorMsg::Drain { pending })
			.await
			.map_err(|_| "groove actor mailbox closed".to_string())
	}

	pub async fn mesh_refresh(&self) -> Result<u32, String> {
		let (reply, rx) = oneshot::channel();
		self.tx
			.send(GrooveActorMsg::MeshRefresh { reply })
			.await
			.map_err(|_| "groove actor mailbox closed".to_string())?;
		rx.await
			.map_err(|_| "groove actor reply dropped".to_string())?
	}

	pub async fn mesh_reconcile(&self) -> Result<(), String> {
		let (reply, rx) = oneshot::channel();
		self.tx
			.send(GrooveActorMsg::MeshReconcile { reply })
			.await
			.map_err(|_| "groove actor mailbox closed".to_string())?;
		rx.await
			.map_err(|_| "groove actor reply dropped".to_string())?
	}

	pub async fn publish_mesh(&self) {
		let _ = self.tx.send(GrooveActorMsg::PublishMesh).await;
	}

	pub async fn reset_connection(&self) {
		let (reply, rx) = oneshot::channel();
		if self
			.tx
			.send(GrooveActorMsg::ResetConnection { reply })
			.await
			.is_ok()
		{
			let _ = rx.await;
		}
	}

	pub async fn apply_peer_invite(&self, payload: String) -> Result<(), String> {
		let (reply, rx) = oneshot::channel();
		self.tx
			.send(GrooveActorMsg::ApplyPeerInvite { payload, reply })
			.await
			.map_err(|_| "groove actor mailbox closed".to_string())?;
		rx.await
			.map_err(|_| "groove actor reply dropped".to_string())?
	}
}

const ACTOR_CAPACITY: usize = 512;

pub fn spawn_groove_actor(app: AppHandle) -> GrooveActorHandle {
	let (tx, mut rx) = mpsc::channel::<GrooveActorMsg>(ACTOR_CAPACITY);
	let app_loop = app.clone();
	tauri::async_runtime::spawn(async move {
		while let Some(msg) = rx.recv().await {
			let jazz = app_loop.state::<ManagedJazz>();
			let self_state: tauri::State<'_, SelfState> = app_loop.state::<SelfState>();
			let ss = self_state.inner();

			match msg {
				GrooveActorMsg::Runtime {
					window,
					envelope,
					reply,
				} => {
					let out =
						groove_runtime_dispatch(&app_loop, window, &jazz, ss, envelope).await;
					let _ = reply.send(out);
				}
				GrooveActorMsg::Drain { pending } => {
					super::execute_drain_batch(&app_loop, &jazz, ss, pending).await;
				}
				GrooveActorMsg::MeshRefresh { reply } => {
					let out = super::execute_mesh_refresh_full(&app_loop, &jazz).await;
					let _ = reply.send(out);
				}
				GrooveActorMsg::MeshReconcile { reply } => {
					let out = super::execute_mesh_reconcile(&app_loop, &jazz).await;
					let _ = reply.send(out);
				}
				GrooveActorMsg::PublishMesh => {
					super::execute_publish_mesh(&app_loop, &jazz, ss).await;
				}
				GrooveActorMsg::ResetConnection { reply } => {
					jazz.reset_connection().await;
					let _ = reply.send(());
				}
				GrooveActorMsg::ApplyPeerInvite { payload, reply } => {
					let out = super::execute_apply_peer_invite(&app_loop, &jazz, ss, &payload).await;
					let _ = reply.send(out);
				}
			}
		}
	});
	GrooveActorHandle { tx }
}

pub(crate) fn groove_actor(app: &AppHandle) -> GrooveActorHandle {
	app.state::<GrooveActorHandle>().inner().clone()
}
