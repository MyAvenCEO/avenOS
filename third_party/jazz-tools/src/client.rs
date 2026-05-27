//! JazzClient implementation.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use crate::groove_tokio::{SubscriptionHandle as RuntimeSubHandle, TokioRuntime};
#[cfg(feature = "transport-http")]
use crate::jazz_transport::ServerEvent;
#[cfg(feature = "transport-http")]
use bytes::BytesMut;
#[cfg(feature = "transport-http")]
use futures::StreamExt;
use groove::query_manager::query::Query;
use groove::query_manager::session::Session;
use groove::query_manager::types::{RowDelta, Value};
use groove::schema_manager::SchemaManager;
use groove::storage::{Storage, StorageError, SurrealKvStorage};
use groove::sync_manager::{
	ClientId, Destination, InboxEntry, PersistenceTier, Source, SyncManager, SyncPayload,
};
#[cfg(feature = "transport-http")]
use groove::sync_manager::ServerId;
use tokio::sync::{RwLock, mpsc};

#[cfg(feature = "transport-http")]
use crate::transport::{AuthConfig, ServerConnection};
use crate::{AppContext, JazzError, ObjectId, Result, SubscriptionHandle, SubscriptionStream};

#[derive(Clone)]
pub(crate) enum MaybePeerTransport {
	Off,
	Active(std::sync::Arc<dyn crate::peer_transport::PeerTransport>),
}

impl Default for MaybePeerTransport {
	fn default() -> Self {
		Self::Off
	}
}

impl std::fmt::Debug for MaybePeerTransport {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			Self::Off => f.write_str("Off"),
			Self::Active(_) => f.write_str("Active(..)"),
		}
	}
}

/// Jazz client for building applications.
///
/// Combines local persistence with optional server sync (`transport-http`) and P2P sync.
pub struct JazzClient {
	runtime: TokioRuntime<SurrealKvStorage>,
	#[cfg(feature = "transport-http")]
	server_connection: Option<Arc<ServerConnection>>,
	subscriptions: Arc<RwLock<HashMap<SubscriptionHandle, SubscriptionState>>>,
	subscription_senders: Arc<RwLock<HashMap<RuntimeSubHandle, mpsc::Sender<RowDelta>>>>,
	next_handle: std::sync::atomic::AtomicU64,
	#[cfg(feature = "transport-http")]
	stream_listener_task: Option<tokio::task::JoinHandle<()>>,
	peer_transport: Option<Arc<dyn crate::peer_transport::PeerTransport>>,
	peer_inbound_task: Option<tokio::task::JoinHandle<()>>,
}

struct SubscriptionState {
	runtime_handle: RuntimeSubHandle,
}

type PeerOutboundFn = Arc<dyn Fn(ClientId, SyncPayload) + Send + Sync + 'static>;

fn build_peer_bundle(layer: &MaybePeerTransport) -> PeerOutboundFn {
	match layer {
		MaybePeerTransport::Off => Arc::new(|_peer_runtime_id, _payload| {}),
		MaybePeerTransport::Active(transport) => {
			let transport = transport.clone();
			Arc::new(move |peer_runtime_id, payload| {
				let tt = transport.clone();
				tokio::spawn(async move {
					if let Err(e) =
						crate::peer_transport::PeerTransport::send_to(&*tt, peer_runtime_id, payload)
							.await
					{
						tracing::warn!("PeerTransport::send_to failed: {e:?}");
					}
				});
			})
		}
	}
}

impl JazzClient {
	pub async fn connect(context: AppContext) -> Result<Self> {
		let layer = MaybePeerTransport::Off;
		let fwd = build_peer_bundle(&layer);
		Self::do_connect(context, fwd, layer).await
	}

	pub async fn connect_with_peer_transport(
		context: AppContext,
		peer_transport: Arc<dyn crate::peer_transport::PeerTransport>,
	) -> Result<Self> {
		let layer = MaybePeerTransport::Active(peer_transport);
		let fwd = build_peer_bundle(&layer);
		Self::do_connect(context, fwd, layer).await
	}

	pub fn register_peer_sync_client(&self, peer_id: ClientId) -> Result<()> {
		use groove::sync_manager::ClientRole;
		self.runtime
			.add_client(peer_id, None)
			.map_err(|e| JazzError::Sync(format!("add_client peer {peer_id}: {e}")))?;
		self.runtime
			.set_client_role(peer_id, ClientRole::Peer)
			.map_err(|e| JazzError::Sync(format!("set_client_role Peer {peer_id}: {e}")))?;
		Ok(())
	}

	pub fn rebroadcast_peer_catchup(&self, peer_id: ClientId) -> Result<()> {
		self.runtime
			.rebroadcast_peer_catchup(peer_id)
			.map_err(|e| JazzError::Sync(format!("rebroadcast_peer_catchup {peer_id}: {e}")))
	}

	pub async fn rebroadcast_all_peer_clients_and_flush(&self) -> Result<()> {
		self.runtime
			.rebroadcast_all_peer_clients_and_flush()
			.await
			.map_err(|e| JazzError::Sync(format!("rebroadcast_all_peer_clients_and_flush: {e}")))
	}

	pub async fn flush_peer_sync(&self) -> Result<()> {
		self.runtime
			.flush()
			.await
			.map_err(|e| JazzError::Sync(format!("flush: {e}")))
	}

	pub fn ingest_peer_sync(&self, from_peer_runtime_id: ClientId, payload: SyncPayload) -> Result<()> {
		let entry = InboxEntry {
			source: Source::Client(from_peer_runtime_id),
			payload,
		};
		self.runtime
			.push_sync_inbox(entry)
			.map_err(|e| JazzError::Sync(format!("push_sync_inbox: {e}")))
	}

	async fn do_connect(context: AppContext, peer_forwarder: PeerOutboundFn, peer_layer: MaybePeerTransport) -> Result<Self> {
		std::fs::create_dir_all(&context.data_dir)?;

		let client_id_path = context.data_dir.join("client_id");
		let client_id = if client_id_path.exists() {
			let id_str = std::fs::read_to_string(&client_id_path)?;
			ClientId::parse(id_str.trim()).unwrap_or_else(|| {
				let id = context.client_id.unwrap_or_default();
				let _ = std::fs::write(&client_id_path, id.to_string());
				id
			})
		} else if let Some(id) = context.client_id {
			std::fs::write(&client_id_path, id.to_string())?;
			id
		} else {
			let id = ClientId::new();
			std::fs::write(&client_id_path, id.to_string())?;
			id
		};

		tracing::debug!(client_id = %client_id, "Groove client identity persisted (sync inbox / peers)");

		let sync_manager = SyncManager::new();
		let mut schema_manager = SchemaManager::new(
			sync_manager,
			context.schema.clone(),
			context.app_id,
			"client",
			"main",
		)
		.map_err(|e| JazzError::Schema(format!("{:?}", e)))?;

		for old in &context.live_schemas {
			schema_manager
				.add_live_schema(old.clone())
				.map_err(|e| JazzError::Schema(format!("live_schema migration: {e:?}")))?;
		}

		#[cfg(feature = "transport-http")]
		let auth_config = AuthConfig::from_context(&context);
		#[cfg(feature = "transport-http")]
		let server_connection = if !context.server_url.is_empty() {
			match ServerConnection::connect(&context.server_url, auth_config).await {
				Ok(conn) => Some(Arc::new(conn)),
				Err(e) => {
					tracing::warn!("Failed to connect to server: {}", e);
					None
				}
			}
		} else {
			None
		};

		let db_path = context.data_dir.join("groove.surrealkv");
		let storage = {
			const MAX_ATTEMPTS: usize = 100;
			const RETRY_DELAY_MS: u64 = 25;

			let mut opened = None;
			let mut last_err = None;

			for attempt in 0..MAX_ATTEMPTS {
				match SurrealKvStorage::open(&db_path, 64 * 1024 * 1024) {
					Ok(storage) => {
						opened = Some(storage);
						break;
					}
					Err(err) => {
						let is_lock_error = matches!(
							&err,
							StorageError::IoError(msg) if msg.contains("already locked")
						);
						if !is_lock_error || attempt + 1 == MAX_ATTEMPTS {
							last_err = Some(err);
							break;
						}
						tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS)).await;
					}
				}
			}

			if let Some(storage) = opened {
				storage
			} else {
				let err = last_err.unwrap_or_else(|| {
					StorageError::IoError("surrealkv open failed without error details".to_string())
				});
				return Err(JazzError::Storage(format!("{:?}", err)));
			}
		};

		let peer_forward = peer_forwarder.clone();

		#[cfg(feature = "transport-http")]
		let server_conn_for_sync = server_connection.clone();
		#[cfg(feature = "transport-http")]
		let runtime = {
			let client_id_for_sync = client_id;
			TokioRuntime::new(schema_manager, storage, move |entry| {
				match &entry.destination {
					Destination::Server(_) => {
						eprintln!(
							"DEBUG [client sync_cb]: Sending to server: {:?}",
							entry.payload.variant_name()
						);
						if let Some(ref conn) = server_conn_for_sync {
							let conn = conn.clone();
							let payload = entry.payload.clone();
							let cid = client_id_for_sync;
							tokio::spawn(async move {
								if let Err(e) = conn.push_sync(payload, cid).await {
									tracing::warn!("Failed to push sync to server: {}", e);
								}
							});
						} else {
							eprintln!("DEBUG [client sync_cb]: No server connection!");
						}
					}
					Destination::Client(peer_runtime_id) => {
						peer_forward(*peer_runtime_id, entry.payload.clone());
					}
				}
			})
		};

		#[cfg(not(feature = "transport-http"))]
		let runtime = TokioRuntime::new(schema_manager, storage, move |entry| {
			match &entry.destination {
				Destination::Server(_) => {}
				Destination::Client(peer_runtime_id) => {
					peer_forward(*peer_runtime_id, entry.payload.clone());
				}
			}
		});

		runtime
			.persist_schema()
			.map_err(|e| JazzError::Storage(e.to_string()))?;

		#[cfg(feature = "transport-http")]
		if server_connection.is_some() {
			let server_id = ServerId::default();
			if let Err(e) = runtime.add_server(server_id) {
				tracing::warn!("Failed to register server with sync manager: {}", e);
			}
		}

		let subscription_senders: Arc<RwLock<HashMap<RuntimeSubHandle, mpsc::Sender<RowDelta>>>> =
			Arc::new(RwLock::new(HashMap::new()));

		#[cfg(feature = "transport-http")]
		let stream_listener_task = if let Some(ref conn) = server_connection {
			let base_url = conn.base_url().to_string();
			let client_id_str = client_id.to_string();
			let runtime_for_stream = runtime.clone();
			let stream_headers = conn.build_stream_headers();

			Some(tokio::spawn(async move {
				let http_client = reqwest::Client::new();
				loop {
					let url = format!("{}/events?client_id={}", base_url, client_id_str);

					tracing::info!("Connecting to server event stream: {}", url);

					match http_client
						.get(&url)
						.headers(stream_headers.clone())
						.send()
						.await
					{
						Ok(response) => {
							if !response.status().is_success() {
								tracing::warn!(
									"Event stream connection failed: {}",
									response.status()
								);
								tokio::time::sleep(Duration::from_secs(5)).await;
								continue;
							}

							tracing::info!("Event stream connected");

							let mut body = response.bytes_stream();
							let mut buffer = BytesMut::new();

							while let Some(chunk_result) = body.next().await {
								match chunk_result {
									Ok(chunk) => {
										buffer.extend_from_slice(&chunk);

										while buffer.len() >= 4 {
											let len =
												u32::from_be_bytes(buffer[..4].try_into().unwrap())
													as usize;
											if buffer.len() < 4 + len {
												break;
											}
											let json = &buffer[4..4 + len];

											match serde_json::from_slice::<ServerEvent>(json) {
												Ok(event) => {
													eprintln!(
														"DEBUG [client stream]: Parsed event: {:?}",
														event.variant_name()
													);
													if let Err(e) = handle_server_event(
														event,
														&runtime_for_stream,
													) {
														tracing::warn!(
															"Error handling server event: {}",
															e
														);
													}
												}
												Err(e) => {
													tracing::warn!(
														"Failed to parse server event: {}",
														e
													);
												}
											}

											let _ = buffer.split_to(4 + len);
										}
									}
									Err(e) => {
										tracing::warn!("Stream chunk error: {}", e);
										break;
									}
								}
							}
						}
						Err(e) => {
							tracing::warn!("Event stream connection error: {}", e);
						}
					}

					tracing::info!("Event stream disconnected, reconnecting in 5s...");
					tokio::time::sleep(Duration::from_secs(5)).await;
				}
			}))
		} else {
			None
		};

		let (peer_transport_stored, peer_inbox_task) = match peer_layer {
			MaybePeerTransport::Off => (None, None),
			MaybePeerTransport::Active(t) => {
				let inbound_runtime = runtime.clone();
				let tin = Arc::clone(&t);
				let task = tokio::spawn(async move {
					loop {
						match crate::peer_transport::PeerTransport::recv_inbound(&*tin).await {
							None => break,
							Some(entry) => {
								if let Err(err) = inbound_runtime.push_sync_inbox(entry) {
									tracing::warn!(
										"push_sync_inbox (peer inbound): {}",
										err
									);
								}
							}
						}
					}
				});
				(Some(t), Some(task))
			}
		};

		Ok(Self {
			runtime,
			#[cfg(feature = "transport-http")]
			server_connection,
			subscriptions: Arc::new(RwLock::new(HashMap::new())),
			subscription_senders,
			next_handle: std::sync::atomic::AtomicU64::new(1),
			#[cfg(feature = "transport-http")]
			stream_listener_task,
			peer_transport: peer_transport_stored,
			peer_inbound_task: peer_inbox_task,
		})
	}

	pub async fn subscribe(&self, query: Query) -> Result<SubscriptionStream> {
		self.subscribe_internal(query, None).await
	}

	async fn subscribe_internal(
		&self,
		query: Query,
		session: Option<Session>,
	) -> Result<SubscriptionStream> {
		let handle = SubscriptionHandle(
			self.next_handle
				.fetch_add(1, std::sync::atomic::Ordering::SeqCst),
		);

		let (tx, rx) = mpsc::channel::<RowDelta>(64);

		let senders = self.subscription_senders.clone();

		let runtime_handle = self
			.runtime
			.subscribe(
				query.clone(),
				move |delta| {
					if let Ok(senders_guard) = senders.try_read()
						&& let Some(sender) = senders_guard.get(&delta.handle)
					{
						let _ = sender.try_send(delta.delta);
					}
				},
				session,
			)
			.map_err(|e| JazzError::Query(e.to_string()))?;

		{
			let mut senders = self.subscription_senders.write().await;
			senders.insert(runtime_handle, tx);
		}

		{
			let mut subs = self.subscriptions.write().await;
			subs.insert(handle, SubscriptionState { runtime_handle });
		}

		Ok(SubscriptionStream::new(rx))
	}

	pub async fn query(
		&self,
		query: Query,
		settled_tier: Option<PersistenceTier>,
	) -> Result<Vec<(ObjectId, Vec<Value>)>> {
		let future = self
			.runtime
			.query(query, None, settled_tier)
			.map_err(|e| JazzError::Query(e.to_string()))?;
		future
			.await
			.map_err(|e| JazzError::Query(format!("{:?}", e)))
	}

	pub async fn create(&self, table: &str, values: Vec<Value>) -> Result<ObjectId> {
		self.runtime
			.insert(table, values, None)
			.map_err(|e| JazzError::Write(e.to_string()))
	}

	pub async fn update(&self, object_id: ObjectId, updates: Vec<(String, Value)>) -> Result<()> {
		self.runtime
			.update(object_id, updates, None)
			.map_err(|e| JazzError::Write(e.to_string()))
	}

	pub async fn delete(&self, object_id: ObjectId) -> Result<()> {
		self.runtime
			.delete(object_id, None)
			.map_err(|e| JazzError::Write(e.to_string()))
	}

	pub async fn unsubscribe(&self, handle: SubscriptionHandle) -> Result<()> {
		let mut subs = self.subscriptions.write().await;
		if let Some(state) = subs.remove(&handle) {
			let mut senders = self.subscription_senders.write().await;
			senders.remove(&state.runtime_handle);
			let _ = self.runtime.unsubscribe(state.runtime_handle);
		}
		Ok(())
	}

	pub async fn schema(&self) -> Result<groove::query_manager::types::Schema> {
		self.runtime
			.current_schema()
			.map_err(|e| JazzError::Query(e.to_string()))
	}

	#[cfg(feature = "transport-http")]
	pub fn is_connected(&self) -> bool {
		self.server_connection.is_some()
	}

	#[cfg(not(feature = "transport-http"))]
	pub fn is_connected(&self) -> bool {
		false
	}

	pub fn for_session(&self, session: Session) -> SessionClient<'_> {
		SessionClient {
			client: self,
			session,
		}
	}

	pub async fn shutdown(mut self) -> Result<()> {
		if let Some(h) = self.peer_inbound_task.take() {
			h.abort();
			let _ = h.await;
		}

		if let Some(t) = self.peer_transport.take() {
			if let Err(err) = t.shutdown().await {
				tracing::warn!("PeerTransport::shutdown failed: {err:?}");
			}
		}

		#[cfg(feature = "transport-http")]
		if let Some(handle) = self.stream_listener_task.take() {
			handle.abort();
			let _ = handle.await;
		}

		self.runtime
			.flush()
			.await
			.map_err(|e| JazzError::Connection(e.to_string()))?;

		self.runtime
			.with_storage(|storage| storage.flush())
			.map_err(|e| JazzError::Storage(e.to_string()))?;

		Ok(())
	}
}

pub struct SessionClient<'a> {
	client: &'a JazzClient,
	session: Session,
}

impl<'a> SessionClient<'a> {
	pub async fn create(&self, table: &str, values: Vec<Value>) -> Result<ObjectId> {
		self.client
			.runtime
			.insert(table, values, Some(&self.session))
			.map_err(|e| JazzError::Write(e.to_string()))
	}

	pub async fn update(&self, object_id: ObjectId, updates: Vec<(String, Value)>) -> Result<()> {
		self.client
			.runtime
			.update(object_id, updates, Some(&self.session))
			.map_err(|e| JazzError::Write(e.to_string()))
	}

	pub async fn delete(&self, object_id: ObjectId) -> Result<()> {
		self.client
			.runtime
			.delete(object_id, Some(&self.session))
			.map_err(|e| JazzError::Write(e.to_string()))
	}

	pub async fn query(
		&self,
		query: Query,
		settled_tier: Option<PersistenceTier>,
	) -> Result<Vec<(ObjectId, Vec<Value>)>> {
		let future = self
			.client
			.runtime
			.query(query, Some(self.session.clone()), settled_tier)
			.map_err(|e| JazzError::Query(e.to_string()))?;
		future
			.await
			.map_err(|e| JazzError::Query(format!("{:?}", e)))
	}

	pub async fn subscribe(&self, query: Query) -> Result<SubscriptionStream> {
		self.client
			.subscribe_internal(query, Some(self.session.clone()))
			.await
	}
}

#[cfg(feature = "transport-http")]
fn handle_server_event(event: ServerEvent, runtime: &TokioRuntime<SurrealKvStorage>) -> Result<()> {
	match event {
		ServerEvent::Connected {
			connection_id,
			client_id,
		} => {
			tracing::info!(
				"Stream connected with id: {:?}, client_id: {}",
				connection_id,
				client_id
			);
			Ok(())
		}
		ServerEvent::SyncUpdate { payload } => {
			let entry = InboxEntry {
				source: Source::Server(ServerId::default()),
				payload: *payload,
			};
			runtime
				.push_sync_inbox(entry)
				.map_err(|e| JazzError::Sync(e.to_string()))?;
			Ok(())
		}
		ServerEvent::Subscribed { query_id } => {
			tracing::debug!("Server acknowledged subscription: {:?}", query_id);
			Ok(())
		}
		ServerEvent::Error { message, code } => {
			tracing::error!("Server error {:?}: {}", code, message);
			Ok(())
		}
		ServerEvent::Heartbeat => {
			tracing::trace!("Heartbeat received");
			Ok(())
		}
	}
}
