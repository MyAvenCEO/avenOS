---
title: Architecture overview
---

# P2P sync — architecture overview

AvenOS uses **pure peer-to-peer Groove replication**: every paired device is a **peer** (`ClientRole::Peer`). There is no separate central “server” tier in the product; an aggregating node would still be a peer. The vendored Groove stack retains upstream `Destination::Server` / `add_server` APIs for compatibility, but AvenOS does not use them. Local row writes fan out to registered peer clients; **biscuit policy** is enforced per outbound frame in `BiscuitGatedPeerTransport` — being paired and online does *not* mean every table row syncs to every peer.

## Stack (crates)

```
app/src-tauri         — host binary (Tauri shell)
  └─ jazz/mod.rs          — jazz_connect() wires PeerTransport into JazzClient
  └─ jazz_auth.rs         — deterministic ClientId from Ed25519 pubkey

third_party/jazz-tools    — vendored fork of jazz-tools
  └─ peer_transport.rs    — PeerTransport trait + bincode framing helpers
  └─ client.rs            — JazzClient::connect_with_peer_transport()

projects/tauri-plugin-peer  — Hyperswarm integration
  └─ lib.rs               — Tauri plugin: joins swarm on self:did-unlock
  └─ hyperswarm_groove_bridge.rs  — implements PeerTransport over Noise streams
```

## Data path (outbound)

1. A local write on `JazzClient` creates a commit in the Groove CRDT store.
2. `SyncManager` computes the delta for each registered peer and emits an `OutboxEntry { destination: Destination::Client(peer_client_id), payload: SyncPayload }`.
3. The runtime sync callback routes it to `PeerTransport::send_to(peer_client_id, payload)`.
4. `HyperswarmGrooveBridge::send_to` looks up the `mpsc::UnboundedSender<Vec<u8>>` keyed by `peer_client_id`, serialises the payload as a length-prefixed bincode capsule via `encode_length_prefixed`, and sends it to the writer task for that connection.
5. The writer task calls `SecretStream::write(&capsule)` — the Noise stream encrypts it and writes it to the UDX socket.

## Data path (inbound)

1. A reader task calls `SecretStream::read()` in a loop, receiving plaintext frames from the peer's Noise stream.
2. Each frame is decoded with `decode_length_prefixed` to yield `(ClientId, SyncPayload)`.
3. The target `ClientId` is checked against the local Jazz `ClientId`; mismatches are dropped.
4. An `InboxEntry { source: Source::Client(from_peer_id), payload }` is forwarded to the shared `mpsc::UnboundedSender<InboxEntry>`.
5. `JazzClient`'s inbox drain task calls `runtime.push_sync_inbox(entry)`.
6. `SyncManager` deduplicates, merges, back-fills, and acks — the same Groove inbox path used for all Jazz sync transports.

## Peer identity mapping

Each device's Hyperswarm Noise static key is its **same Ed25519 key** derived from the Secure Enclave root via `derive_ed25519_seed` (same HKDF path used by `plugin-self`). The peer's Groove `ClientId` is:

```rust
fn groove_client_uuid_from_pubkey(pubkey: &[u8; 32]) -> Uuid {
    // SHA-256("ceo.aven.os/jazz/client-id-v1" || pubkey)[..16]
}
```

This matches `jazz_auth::client_uuid_from_ed_pubkey` used to derive the local `ClientId`, so the same function works on both sides. The deterministic mapping means no out-of-band exchange of UUIDs is required.

## Spark-scoped replication

Rows in tables such as **`todos`** reference a plaintext **`spark_id`** UUID (`libs/jazz-schema/schema.manifest.json`). Peer sync carries arbitrary Groove commits for the schema — **authorization** (`authorize_gate`, biscuit vault) and **decryption** (Spark DEKs resolved via **`keyshares`**) apply **per `(device, spark_id)`**.

Granting a paired peer **co-owner + DEK keyshare** for Spark **X** therefore unlocks policy-respecting read/write for **every manifest row carrying `spark_id = X`**, including todos today and future spark-linked tables. Transport registration (`jazz_sync_bridge_peers`) does not replace that cryptographic delegation.

## Topic derivation

```
discovery_key(b"ceo.aven.os/groove-p2p/v1-alpha")
```

All instances join a single shared dev topic for Groove sync discovery. **Optional pairing codes** use a separate topic prefix:

```
discovery_key(b"aven:pair:v1:" || normalized_six_char_code)
```

In a production Spark-scoped deployment the Groove topic would typically be derived per Spark (e.g. `b"aven:spark:v1:" || spark_urn`); the single shared Groove topic is the current implementation for the v1 alpha harness.

## Shell IPC & UI

| IPC command | Purpose |
|---|---|
| `plugin:peer|peer_transport_status` | Hyperswarm running flag, local key prefix, linked remote `ClientId`s (string form), pending pairing code if hosting |
| `plugin:peer|peer_pair_start` | Generate code + join pairing discovery topic |
| `plugin:peer|peer_pair_accept` `{ code }` | Join same pairing topic as joiner |
| `plugin:peer|peer_pair_cancel` | Leave pairing topic / clear session |
| `jazz_sync_bridge_peers` | Re-run `register_peer_sync_client` for every Hyperswarm-linked peer (handles peers that appeared after Jazz bootstrap) |
| `jazz_spark_grant_peer` `{ sparkId, peerDid }` | After unlock: biscuit third-party co-owner attenuation + DEK **keyshare** row for that Spark + snapshot broadcast (`sparks`, `keyshares`). Enables decrypt/sync for **all rows keyed to that spark** on the invitee once Groove merges |

The **Self → Sparks** route polls **`peer_transport_status`** (~2 s), exposes host/join controls, and invokes **`jazz_sync_bridge_peers`** when Jazz is ready and linked peers exist.

## Key crate types

| Type | Location | Role |
|---|---|---|
| `PeerTransport` trait | `third_party/jazz-tools/src/peer_transport.rs` | Async trait: `send_to`, `recv_inbound`, `shutdown` |
| `HyperswarmGrooveBridge` | `projects/tauri-plugin-peer/src/hyperswarm_groove_bridge.rs` | Implements `PeerTransport`; owns per-peer writer channels and shared inbound queue |
| `MaybePeerTransport` | `third_party/jazz-tools/src/client.rs` | `Off | Active(Arc<dyn PeerTransport>)` — guards cfg |
| `encode_length_prefixed` / `decode_length_prefixed` | `peer_transport.rs` | u32-LE-length + bincode `SyncFrameV1` |
| `InboxEntry` | `groove::sync_manager` | `{ source: Source::Client(ClientId), payload: SyncPayload }` |
