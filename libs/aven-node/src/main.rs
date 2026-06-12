//! aven-node — a headless, durable **blind replica** aven.
//!
//! One process: an HTTP + WebSocket server on :8080 (TLS terminated at the Sprites
//! proxy) serving `GET /health` and `GET /sync` — the nonce-bound did:key sync
//! transport (`ws_server`) — feeding a full avenDB engine on **RocksDB** with the
//! real schema. A peer holding a `replicate` grant ships this server its identity's
//! encrypted batches; it stores them durably and forwards them, but holds **no
//! keyshares**, so everything it mirrors stays ciphertext it cannot decrypt.
//!
//! Reachability: the public Sprite URL routes to :8080, so devices dial
//! `wss://<sprite>.sprites.app/sync` with no `sprite proxy`. TLS is the proxy's;
//! the challenge is nonce-bound (no channel binding). Config is all env; the
//! identity seed is a Sprite secret; `AVEN_SERVER_DATA_DIR` is the persistent path.

mod admission;
mod aven_ceo;
mod ws_server;

use std::sync::Arc;

use aven_p2p::ChallengeParams;
use axum::extract::{ws::WebSocketUpgrade, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use ed25519_dalek::SigningKey;
use aven_db::{AppContext, AppId, EditSigner, AvenDbClient, ObjectId, PeerId};
use tokio::signal::unix::{signal, SignalKind};

use ws_server::WsServerListener;

struct Config {
    http_bind: String,
    domain: String,
    uri: String,
    network_seed: String,
    /// On-disk identity slug for THIS server (default `avenCEO`). The server is
    /// just another peer identity, stored under the same layout as devices:
    /// `<Documents>/.avenOS/<network…>/peers/<server_name>/db`.
    server_name: String,
    data_dir: std::path::PathBuf,
    seed: Option<[u8; 32]>,
}

impl Config {
    fn from_env() -> Self {
        let var = |k: &str| std::env::var(k).ok().filter(|s| !s.is_empty());
        let seed = var("AVEN_SERVER_SEED").and_then(|h| {
            let bytes = hex::decode(h.trim()).ok()?;
            let arr: [u8; 32] = bytes.try_into().ok()?;
            Some(arr)
        });
        // MUST equal the device's `tauri_plugin_self::network::NETWORK_SEED`: the
        // avenCEO identity id is `sha256("avenos:avenCEO:v1:" + network_seed)`, so a
        // mismatch makes the server mint avenCEO under a different id than devices
        // look for — they'd never converge and every device stays at the invite gate.
        let network_seed =
            var("AVEN_SERVER_NETWORK_SEED").unwrap_or_else(|| "ceo.aven/testnet/abagana".into());
        let server_name = var("AVEN_SERVER_NAME").unwrap_or_else(|| "avenCEO".into());
        // Explicit override (headless/Sprite) wins; otherwise place the server's
        // store as a sibling of the device identities, derived from the network seed.
        let data_dir = var("AVEN_SERVER_DATA_DIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| derive_identity_db_dir(&network_seed, &server_name));
        Self {
            // The HTTP+WS server binds the Sprites-routed port (8080).
            http_bind: var("AVEN_SERVER_HEALTH_BIND").unwrap_or_else(|| "0.0.0.0:8080".into()),
            domain: var("AVEN_SERVER_DOMAIN").unwrap_or_else(|| "aven.local".into()),
            uri: var("AVEN_SERVER_URI").unwrap_or_else(|| "https://aven.local".into()),
            network_seed,
            server_name,
            data_dir,
            seed,
        }
    }
}

/// `<Documents>/.avenOS/<network split on '/'>/peers/<server_name>/db` — the
/// same on-disk layout devices use (`paths.rs`), with the server as one more
/// identity. The network seed doubles as the path: `ceo.aven/testnet/abagana`
/// → `…/.avenOS/ceo.aven/testnet/abagana/peers/<server_name>/db`. Falls back
/// to the home dir then the temp dir when no Documents dir is resolvable (headless
/// boxes set `AVEN_SERVER_DATA_DIR` explicitly and never reach this path).
fn derive_identity_db_dir(network_seed: &str, server_name: &str) -> std::path::PathBuf {
    let docs = dirs::document_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Documents")))
        .unwrap_or_else(std::env::temp_dir);
    let mut base = docs.join(".avenOS");
    for seg in network_seed.split('/').filter(|s| !s.is_empty()) {
        base = base.join(seg);
    }
    base.join("vaults").join(server_name).join("db")
}

fn load_identity(cfg: &Config) -> SigningKey {
    match cfg.seed {
        Some(seed) => SigningKey::from_bytes(&seed),
        None => {
            tracing::warn!(
                "AVEN_SERVER_SEED unset — generated an ephemeral identity (set AVEN_SERVER_SEED \
                 for a stable DID across restarts)"
            );
            SigningKey::generate(&mut rand::rngs::OsRng)
        }
    }
}

async fn health() -> &'static str {
    "ok"
}

async fn sync_handler(
    ws: WebSocketUpgrade,
    State(listener): State<Arc<WsServerListener>>,
) -> Response {
    ws.on_upgrade(move |socket| async move { listener.accept(socket).await })
}

/// The always-on relay peer's inbound apply gate: relay-proof **authenticity**. The
/// server holds no content-identity biscuits, so it cannot check membership — but it CAN
/// reject a forged or relabeled row whose owner-binding signature is invalid, before
/// storing or forwarding it (members enforce membership on their side). Outbound stays
/// permissive: the relay stores & forwards ciphertext for everyone.
struct ServerApplyGate {
    /// Identity (SAFE) scoped tables — those carrying an `owner` column, derived once from
    /// the live schema (`aven_db::owner_scoped_table_names`). A row on one of these MUST
    /// carry an owner-binding to apply; the relay denies a bindingless one fail-closed,
    /// byte-for-byte with the client gate (`biscuit_resolver.rs`). Non-owner-scoped tables
    /// (local/non-E2E) are not gated here.
    spark_scoped: std::collections::HashSet<String>,
}

impl ServerApplyGate {
    fn new(schema: &aven_db::Schema) -> Self {
        Self {
            spark_scoped: aven_db::owner_scoped_table_names(schema).into_iter().collect(),
        }
    }

    fn is_spark_scoped(&self, table: &str) -> bool {
        self.spark_scoped.contains(table)
    }
}

impl aven_db::CapabilityResolver for ServerApplyGate {
    fn may_sync(
        &self,
        _subject: &aven_db::SyncTargetId,
        _op: aven_db::AccOp,
        _res: &aven_db::ResourceCoord,
    ) -> aven_db::CapDecision {
        aven_db::CapDecision::Allow
    }

    fn verify_on_apply(
        &self,
        _subject: &aven_db::SyncTargetId,
        _op: aven_db::AccOp,
        res: &aven_db::ResourceCoord,
        digest: &[u8; 32],
        proof: Option<&[u8]>,
        edit_sig: Option<&[u8]>,
    ) -> aven_db::CapDecision {
        // A3 — fail-closed, no exceptions: a spark/identity-scoped (owner-bearing) row MUST
        // carry an owner-binding to apply, exactly like the client gate (`biscuit_resolver.rs`).
        // The relay was the last fail-OPEN peer; this closes it. Non-owner-scoped tables
        // (local/non-E2E) carry no binding and stay permissive.
        let Some(proof) = proof else {
            if self.is_spark_scoped(&res.table) {
                tracing::warn!(
                    table = %res.table, row = %res.row_id.uuid(),
                    "relay-deny[no-binding]: spark-scoped row missing owner-binding"
                );
                return aven_db::CapDecision::DenyPermanent;
            }
            return aven_db::CapDecision::Allow;
        };
        let Ok(meta) = std::str::from_utf8(proof) else {
            return aven_db::CapDecision::DenyPermanent;
        };
        let binding = match aven_caps::ownership::OwnerBinding::from_meta_str(meta) {
            Ok(b) => b,
            Err(_) => return aven_db::CapDecision::DenyPermanent,
        };
        if binding.value_id != *res.row_id.uuid() {
            return aven_db::CapDecision::DenyPermanent;
        }
        if aven_caps::ownership::verify_owner_binding(&binding).is_err() {
            return aven_db::CapDecision::DenyPermanent;
        }
        // Content integrity at the relay (audit #29): a bound (identity-scoped) row MUST
        // carry an edit-signature that binds the digest the relay itself computed over
        // `data` + `metadata`. The relay holds no identity biscuit so it can't check
        // membership, but it CAN reject a row whose `data`/keyshare columns were tampered in
        // flight — before storing or forwarding it. Missing/invalid edit-sig → reject.
        let Some(edit_sig) = edit_sig else {
            return aven_db::CapDecision::DenyPermanent;
        };
        let Ok(es_str) = std::str::from_utf8(edit_sig) else {
            return aven_db::CapDecision::DenyPermanent;
        };
        let es = match aven_caps::ownership::EditSignature::from_meta_str(es_str) {
            Ok(e) => e,
            Err(_) => return aven_db::CapDecision::DenyPermanent,
        };
        match aven_caps::ownership::verify_signed_batch(&es, digest) {
            Ok(()) => aven_db::CapDecision::Allow,
            Err(_) => aven_db::CapDecision::DenyPermanent,
        }
    }

    /// M7-3: per-identity relay storage quota — the "Sync & Backup" bound. Maps a row's
    /// owner-binding → (owner-id key, 10 MiB). The engine accumulates distinct-row bytes
    /// per identity and **rejects** (never deletes) inbound writes over the limit, so one
    /// identity can't make this aven an unbounded sink. Unsigned/bindingless rows → no key.
    fn quota_for(&self, proof: Option<&[u8]>) -> Option<(String, u64)> {
        const AVEN_IDENTITY_QUOTA_BYTES: u64 = 10 * 1024 * 1024;
        let meta = std::str::from_utf8(proof?).ok()?;
        let binding = aven_caps::ownership::OwnerBinding::from_meta_str(meta).ok()?;
        Some((binding.owner.to_string(), AVEN_IDENTITY_QUOTA_BYTES))
    }
}

/// Server-side author **edit-signer** — the aven-node counterpart of the app's
/// `AppEditSigner`. Installed via [`aven_db::AvenDbClient::set_edit_signer`] so every row the
/// server authors (the avenCEO genesis in S.3 and the auto-admin grant in S.4) carries a
/// valid `_edit_sig` signed by the server identity. Without it, server-authored control
/// rows reach each peer with no edit-signature and die at the fail-closed `verify_on_apply`
/// gate — so the first user never receives its admin grant and stays on the onboarding wall.
struct ServerEditSigner {
    signing_key: SigningKey,
}

impl EditSigner for ServerEditSigner {
    fn sign_row(&self, _row_id: ObjectId, digest: &[u8; 32]) -> Option<(String, String)> {
        let es = aven_caps::ownership::sign_batch(&self.signing_key, digest).ok()?;
        Some((
            aven_caps::ownership::EDIT_SIG_META_KEY.to_string(),
            es.to_meta_string(),
        ))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cfg = Config::from_env();
    let identity = load_identity(&cfg);
    let server_peer = PeerId(identity.verifying_key().to_bytes());
    let server_did = aven_db::did_key::signer_did_from_ed25519(&server_peer.0)
        .map_err(|e| format!("server did: {e}"))?;
    tracing::info!(%server_did, "aven-node identity");

    // S.2 — a biscuit capability vault rooted in the server's key. The server is
    // the sole author/owner of the well-known avenCEO control identity; it will mint
    // its genesis (S.3) and auto-grant the first connecting peer admin (S.4). See
    // docs/ServerRootedAvenCeoPlan.md.
    let server_vault = aven_caps::caps::build_vault_from_signing_key(&identity)
        .map_err(|e| format!("server cap vault: {e}"))?;
    let avenceo_id = aven_caps::caps::aven_ceo_identity(&cfg.network_seed);
    tracing::info!(
        %avenceo_id,
        server_name = %cfg.server_name,
        network_seed = %cfg.network_seed,
        owner_did = %server_vault.signer_did,
        "avenCEO control identity — server is the owner"
    );

    let params = ChallengeParams::new(cfg.domain.clone(), cfg.uri.clone(), cfg.network_seed.clone());
    let (listener, mut new_peers) = WsServerListener::new(params, server_did, identity.clone());

    // Durable blind replica: a full RocksDB engine on the REAL schema, wired to the
    // WS listener. The real schema is required so the engine can persist & re-ship
    // replicated row batches; it holds NO keyshares, so every batch stays ciphertext.
    let schema =
        avenos_schema_hash::embedded_schema().map_err(|e| format!("load schema: {e}"))?;
    // Identity-scoped (owner-bearing) tables, derived once from the live schema — the relay
    // apply gate denies a bindingless row on any of these (A3, fail-closed). Computed before
    // `schema` is moved into the engine context below.
    let apply_gate = ServerApplyGate::new(&schema);
    let data_dir = cfg.data_dir.clone();
    tracing::info!(data_dir = %data_dir.display(), "durable storage (RocksDB)");
    let ctx = AppContext {
        app_id: AppId::from_name("ceo.aven.os"),
        client_id: Some(server_peer),
        schema,
        data_dir,
        live_schemas: vec![],
    };

    // Self-healing open: the local RocksDB is a re-pullable ciphertext cache, so if
    // it is ever unreadable (a hard crash that left it unfinalized) reset and re-open
    // rather than crash-loop; missing batches re-sync from peers. The graceful
    // shutdown below makes this path rare.
    let engine: Arc<AvenDbClient> =
        match AvenDbClient::connect_with_sync_transport(ctx.clone(), listener.clone(), None).await {
            Ok(engine) => Arc::new(engine),
            Err(e) if store_is_corrupt(&e) => {
                tracing::warn!(
                    error = %e,
                    data_dir = %ctx.data_dir.display(),
                    "blind replica store unreadable — resetting and re-pulling from peers"
                );
                let _ = std::fs::remove_dir_all(&ctx.data_dir);
                Arc::new(AvenDbClient::connect_with_sync_transport(ctx, listener.clone(), None).await?)
            }
            Err(e) => return Err(e.into()),
        };
    tracing::info!("blind replica engine connected (RocksDB, real schema)");

    // Phase 2 — every peer verifies. Install the relay-proof apply gate so a forged or
    // relabeled row is rejected on apply even in transit through the server.
    if let Err(e) = engine.set_resolver(std::sync::Arc::new(apply_gate)) {
        tracing::warn!("install server apply gate: {e}");
    }

    // Sign every row the server authors with the server identity, so the avenCEO genesis
    // and the auto-admin grants carry a valid `_edit_sig` and pass each peer's fail-closed
    // apply gate (the EditSignature hardening, board 0010). Must precede the genesis mint
    // below so those rows are signed at creation.
    if let Err(e) = engine.set_edit_signer(std::sync::Arc::new(ServerEditSigner {
        signing_key: identity.clone(),
    })) {
        tracing::warn!("install server edit signer: {e}");
    }

    // S.3 — the server is the avenCEO owner: mint its genesis on startup (idempotent).
    if let Err(e) =
        aven_ceo::ensure_avenceo_owned(&engine, &server_vault, &identity, avenceo_id, &cfg.server_name)
            .await
    {
        tracing::warn!("avenCEO mint: {e}");
    }

    // Register each newly-authenticated peer; hold the handle so we can stop it on
    // shutdown and reclaim its engine clone (to finalize RocksDB via sole ownership).
    let engine_for_peers = engine.clone();
    let grant_signing = identity.clone();
    let peer_task = tokio::spawn(async move {
        while let Some(peer) = new_peers.recv().await {
            if let Err(e) = engine_for_peers.register_peer_sync_client(peer) {
                tracing::warn!(%peer, "register peer: {e}");
            }
            // Admission (A8) — classify the peer against the avenCEO roster (the relay's ACL
            // SSOT). SHADOW MODE: log the tier the peer WOULD get; do not yet restrict sync.
            // Enforcement is gated behind AVEN_SERVER_ENFORCE_ADMISSION (default off) so this
            // can be deployed for telemetry and validated against real clients before the
            // fail-closed flip — see admission.rs + board 0023.
            match aven_db::did_key::signer_did_from_ed25519(&peer.0) {
                Ok(peer_did) => {
                    match admission::read_avenceo_member_signer_dids(&engine_for_peers, avenceo_id).await {
                        Ok(member_dids) => {
                            let roster = admission::Roster { member_signer_dids: member_dids };
                            let tier = admission::classify_peer(&peer_did, &roster);
                            tracing::info!(
                                %peer, tier = ?tier, roster_size = roster.member_signer_dids.len(),
                                enforce = admission::enforcement_enabled(),
                                "admission classification (shadow — not enforced)"
                            );
                        }
                        Err(e) => tracing::warn!(%peer, "admission roster read: {e}"),
                    }
                }
                Err(e) => tracing::warn!(%peer, "admission: peer did: {e}"),
            }
            // S.4 — grant the first human SAFE (not the device signer) admin on avenCEO.
            // The human SAFE is created AFTER first connect, so this also runs on a periodic
            // tick (below); here it catches the case where it's already synced on reconnect.
            if let Err(e) =
                aven_ceo::grant_first_human_admin(&engine_for_peers, &grant_signing, avenceo_id).await
            {
                tracing::warn!(%peer, "avenCEO human-admin grant: {e}");
            }
        }
    });

    // Periodic admin grant: the first admin's HUMAN SAFE is created on-device AFTER it first
    // connects, so a per-connect check alone would miss it. This tick grants the first human
    // SAFE that syncs in (idempotent once avenCEO has a non-server owner) so the device's
    // invite gate opens within seconds — no device reconnect required.
    let engine_for_tick = engine.clone();
    let tick_signing = identity.clone();
    let admin_tick = tokio::spawn(async move {
        let mut iv = tokio::time::interval(std::time::Duration::from_secs(5));
        iv.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            iv.tick().await;
            if let Err(e) =
                aven_ceo::grant_first_human_admin(&engine_for_tick, &tick_signing, avenceo_id).await
            {
                tracing::debug!("avenCEO human-admin tick: {e}");
            }
        }
    });

    // One HTTP server on :8080: /health + /sync (WS). Devices reach /sync via the
    // public Sprite URL (proxy-terminated TLS).
    let app = Router::new()
        .route("/health", get(health))
        .route("/sync", get(sync_handler))
        .with_state(listener.clone());
    let tcp = tokio::net::TcpListener::bind(&cfg.http_bind).await?;
    tracing::info!(bind = %cfg.http_bind, "http+ws sync server listening (/health, /sync)");

    // Graceful shutdown: Sprites sends SIGTERM on hibernate/stop/redeploy. Catching
    // it (rather than being killed) lets axum drain, then we finalize RocksDB so the
    // next boot reopens cleanly (orphan-WAL corruption otherwise — see git history).
    let shutdown = async {
        let mut sigterm = signal(SignalKind::terminate()).expect("install SIGTERM handler");
        let mut sigint = signal(SignalKind::interrupt()).expect("install SIGINT handler");
        tokio::select! {
            _ = sigterm.recv() => tracing::info!("SIGTERM received — shutting down"),
            _ = sigint.recv() => tracing::info!("SIGINT received — shutting down"),
        }
    };
    axum::serve(tcp, app).with_graceful_shutdown(shutdown).await?;

    // Stop the peer task, take sole ownership, run RocksDB Close via shutdown(self).
    tracing::info!("finalizing RocksDB store…");
    peer_task.abort();
    let _ = peer_task.await;
    admin_tick.abort();
    let _ = admin_tick.await;
    match Arc::try_unwrap(engine) {
        Ok(client) => {
            if let Err(e) = client.shutdown().await {
                tracing::warn!("graceful shutdown: {e}");
            }
        }
        Err(still_shared) => {
            tracing::warn!("engine still shared at shutdown; flushing WAL only");
            let _ = still_shared.flush_peer_sync().await;
        }
    }
    tracing::info!("clean shutdown complete (RocksDB finalized)");
    Ok(())
}

/// A storage-open failure a blind replica can recover from by resetting its
/// (re-pullable) cache — chiefly a RocksDB store left unfinalized by a hard crash.
fn store_is_corrupt(e: &impl std::fmt::Display) -> bool {
    let m = e.to_string();
    m.contains("Corruption") || m.contains("wal_dir") || m.contains("rocksdb open")
}

#[cfg(test)]
mod apply_gate_tests {
    //! A3 — the relay apply gate is fail-closed on identity (SAFE) scoped rows, byte-for-byte
    //! with the client gate: a spark-scoped row with no owner-binding is rejected; a
    //! non-spark-scoped row without one is allowed; a validly bound + edit-signed row is
    //! accepted; a forged/relabeled/tampered one is rejected.
    use super::ServerApplyGate;
    use aven_caps::ownership::{mint_owner_binding, sign_batch};
    use aven_db::{AccOp, CapDecision, CapabilityResolver, ObjectId, PeerId, ResourceCoord, SyncTargetId};
    use uuid::Uuid;

    /// A gate whose only identity-scoped table is `todos` (no schema needed for the unit).
    fn gate() -> ServerApplyGate {
        ServerApplyGate { spark_scoped: ["todos".to_string()].into_iter().collect() }
    }

    fn subject() -> SyncTargetId {
        SyncTargetId::Client(PeerId([7u8; 32]))
    }

    fn coord(table: &str, row: Uuid) -> ResourceCoord {
        ResourceCoord::new(format!("urn:{row}"), table.to_string(), ObjectId::from_uuid(row))
    }

    fn is_deny(d: CapDecision) -> bool {
        matches!(d, CapDecision::DenyPermanent)
    }
    fn is_allow(d: CapDecision) -> bool {
        matches!(d, CapDecision::Allow)
    }

    #[test]
    fn apply_gate_denies_spark_scoped_row_without_binding() {
        let g = gate();
        let res = coord("todos", Uuid::from_u128(0x11));
        let d = g.verify_on_apply(&subject(), AccOp::Write, &res, &[9u8; 32], None, None);
        assert!(is_deny(d), "spark-scoped row with no owner-binding must be denied");
    }

    #[test]
    fn apply_gate_allows_non_spark_scoped_without_binding() {
        let g = gate();
        let res = coord("humans", Uuid::from_u128(0x22)); // not owner-scoped → not gated
        let d = g.verify_on_apply(&subject(), AccOp::Write, &res, &[9u8; 32], None, None);
        assert!(is_allow(d), "non-spark-scoped row without a binding stays permissive");
    }

    #[test]
    fn apply_gate_allows_valid_bound_signed_row() {
        let g = gate();
        let sk = ed25519_dalek::SigningKey::from_bytes(&[3u8; 32]);
        let value = Uuid::from_u128(0x55);
        let owner = Uuid::from_u128(0xABCD);
        let digest = [9u8; 32];
        let binding = mint_owner_binding(&sk, value, owner).unwrap();
        let es = sign_batch(&sk, &digest).unwrap();
        let res = coord("todos", value);
        let d = g.verify_on_apply(
            &subject(),
            AccOp::Write,
            &res,
            &digest,
            Some(binding.to_meta_string().as_bytes()),
            Some(es.to_meta_string().as_bytes()),
        );
        assert!(is_allow(d), "an authentic owner-binding + edit-sig over the receiver digest is accepted");
    }

    #[test]
    fn apply_gate_rejects_forged_or_tampered_row() {
        let g = gate();
        let sk = ed25519_dalek::SigningKey::from_bytes(&[3u8; 32]);
        let value = Uuid::from_u128(0x55);
        let owner = Uuid::from_u128(0xABCD);
        let signed_digest = [9u8; 32];
        let binding = mint_owner_binding(&sk, value, owner).unwrap();
        let es = sign_batch(&sk, &signed_digest).unwrap();
        let res = coord("todos", value);

        // (a) Tampered in flight: the receiver recomputes a DIFFERENT digest than the one signed.
        let tampered = [10u8; 32];
        let d = g.verify_on_apply(
            &subject(),
            AccOp::Write,
            &res,
            &tampered,
            Some(binding.to_meta_string().as_bytes()),
            Some(es.to_meta_string().as_bytes()),
        );
        assert!(is_deny(d), "edit-sig over a different digest (data tampered) must be denied");

        // (b) Relabeled row: binding names a different row id than the one being applied.
        let other = coord("todos", Uuid::from_u128(0x66));
        let d2 = g.verify_on_apply(
            &subject(),
            AccOp::Write,
            &other,
            &signed_digest,
            Some(binding.to_meta_string().as_bytes()),
            Some(es.to_meta_string().as_bytes()),
        );
        assert!(is_deny(d2), "owner-binding for a different row id must be denied");

        // (c) Missing edit-sig on a bound spark-scoped row.
        let d3 = g.verify_on_apply(
            &subject(),
            AccOp::Write,
            &res,
            &signed_digest,
            Some(binding.to_meta_string().as_bytes()),
            None,
        );
        assert!(is_deny(d3), "a bound row with no edit-signature must be denied");
    }
}
