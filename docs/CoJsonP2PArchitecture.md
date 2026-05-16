# CoJSON · Tauri · Hyperswarm — sovereign sync architecture

This document captures the **essential architecture** for AvenOS' offline‑first, server‑less data layer. It complements [AgentArchitecture.md](./AgentArchitecture.md) and [AvenOS.md](./AvenOS.md).

**Claim:** A single Ed25519 device key, **CoJSON in Rust** as the only CRDT engine, **RocksDB** as the master store, **Tauri IPC** as the internal sync transport, and **peeroxide** (Hyperswarm‑compatible) as the external P2P transport, together yield a fully sovereign, cross‑platform stack with no servers, no accounts, no cloud lock‑in.

---

## 1. North star

| Goal | Meaning |
|------|---------|
| **Offline‑first** | Every device works fully without any network. |
| **Server‑less** | No cloud, no relay, no account provider is *required* (only optional). |
| **Single CRDT engine** | CoJSON runs **once**, in Rust — never duplicated in JavaScript. |
| **Single source of truth per device** | RocksDB owned by the privileged Tauri Rust backend. |
| **Disposable agents** | Aven / worker WebViews hold ephemeral replicas only; their crash or close loses nothing authoritative. |
| **Cryptographic permissions** | Access control is enforced by CoJSON signatures, not by a server. |
| **Cross‑device P2P** | Mac, iOS, Linux, Windows devices belonging to the same human sync directly. |

---

## 2. High‑level architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                    AvenOS Tauri App (per device)             │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Rust Backend  —  the privileged master                │  │
│  │                                                        │  │
│  │   cojson crate  ── single CRDT engine                  │  │
│  │   RocksDB       ── SOURCE OF TRUTH (persistent)        │  │
│  │   Ed25519 key   ── device identity (Secure Enclave)    │  │
│  │                                                        │  │
│  │   Sync peers:                                          │  │
│  │     • Tauri IPC peers  ── local WebView agents         │  │
│  │     • peeroxide peers  ── remote devices (P2P)         │  │
│  │     • (optional) QUIC / WSS peers ── cloud relay       │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         │ Tauri IPC (invoke / emit)          │
│  ┌──────────────────────┴─────────────────────────────────┐  │
│  │  WebView Agent Pool — disposable shells                │  │
│  │                                                        │  │
│  │   Agent 1     Agent 2     Aven UI    …                 │  │
│  │   thin JS     thin JS     thin JS                      │  │
│  │   SQLite      SQLite      SQLite                       │  │
│  │   (memory or  (memory or  (memory or                   │  │
│  │    /tmp file) /tmp file)  /tmp file)                   │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
            │                                       ▲
            │ peeroxide (Hyperswarm DHT + UDP + Noise)
            ▼                                       │
┌──────────────────────────────────────────────────────────────┐
│                AvenOS Tauri App on other devices              │
│                (iPhone, second Mac, Linux box, …)             │
└──────────────────────────────────────────────────────────────┘
```

Three sync surfaces, **one CoJSON node**, **one RocksDB**, **one identity key** per device.

---

## 3. The two layers, one key

A single Ed25519 keypair, sealed in the OS keystore (Secure Enclave on Apple, Keystore on Android, DPAPI / TPM elsewhere), plays **two orthogonal roles** simultaneously.

| Layer | What the key proves | Provided by |
|-------|--------------------|-------------|
| **Transport identity** | "This network endpoint is *this* device." | **peeroxide** Noise XX handshake |
| **Data ownership** | "This signed transaction was authored by *this* device." | **CoJSON** `AgentSecret` / `AgentID` |

```rust
// One key, two adapters
let signing_key = SigningKey::generate(&mut rng);  // stored in Secure Enclave

let peeroxide_keypair = PeeroxideKeypair::from_bytes(signing_key.as_bytes());
let cojson_secret     = AgentSecret::from_bytes(signing_key.as_bytes());
let cojson_agent_id   = AgentID::from_public_key(signing_key.verifying_key());
```

**Effect:** the moment a peeroxide connection is authenticated, the CoJSON `AgentID` of the peer is *already known*. There is no separate login, session, or token — the SSH model, applied uniformly to transport and data.

---

## 4. CoJSON primitives — Accounts vs Groups

CoJSON ships **identity, ownership, and permissions** as first‑class primitives. This is the layer that makes the whole "no server" claim real: rights are enforced by signatures, not policy servers.

### Account = "I am"

An **Account** is a special CoValue representing a person or device.

```text
Account
├── AgentSecret  (private Ed25519 key)
├── AgentID      (public Ed25519 key)
└── itself a CoValue
      ├── profile  (publicly readable)
      └── root     (private to the owner)
```

Every device has one Account. The Account *is* the identity.

### Group = "Who may"

A **Group** is an access‑control container.

```text
Group
├── members:  AgentID → Role  (admin · writer · reader)
├── read key: symmetric XSalsa20 key (encrypts the group's CoValues)
└── itself a CoValue, owned by its creator
```

Groups and Accounts are **orthogonal**: one Account can be a member of many Groups; one Group can include many Accounts.

| Concept | Meaning |
|---------|---------|
| **Account** | *Passport* — proves who you are. |
| **Group**   | *Keyring* — determines which doors open for you. |

### Master Group pattern (per human)

For AvenOS each human owns one **Master Group** that aggregates all their devices and any temporary agents:

```text
Human "Samuel"
├── Account: Mac device      AgentID 0xABC…   (Secure Enclave)
├── Account: iPhone device   AgentID 0xDEF…   (Secure Enclave)
└── Master Group "Samuel's data"
    ├── admin:  AgentID 0xABC  (Mac)
    ├── admin:  AgentID 0xDEF  (iPhone)
    ├── writer: AgentID 0xGHI  (iPad)
    └── reader: AgentID 0xJKL  (Aven agent, ephemeral)

    CoValues owned by the Master Group:
    ├── sparks       (admins write, all read)
    ├── hearts       (encrypted with group read key)
    └── preferences  (admin‑only)
```

Each CoValue write must be signed by a key that the Group's rules accept. A reader‑only Aven Agent **physically cannot** produce an accepted write, because it does not hold the writer signing key. No server check is needed — the math forbids it.

---

## 5. Storage — RocksDB master, disposable replicas

### RocksDB (Rust backend) — Source of Truth

- Lives inside the privileged Tauri Rust process. Browser code cannot escape into it.
- Persists across crashes, restarts, browser cache clears, agent kills.
- Hosts the **only** authoritative `LocalNode` for CoJSON on this device.
- Per‑platform location follows Tauri's app‑data directory:

  | Platform | Path |
  |----------|------|
  | macOS    | `~/Library/Application Support/com.maia.os/rocksdb/` |
  | Linux    | `~/.local/share/com.maia.os/rocksdb/` |
  | Windows  | `%APPDATA%/com.maia.os/rocksdb/` |
  | iOS      | App container Documents/Application Support |

- On iOS, RocksDB builds in *Lite* mode — a small feature subset, but enough for a CoJSON key‑value store.

### WebView agents — disposable replicas

Each Aven/worker WebView is an **ephemeral CoJSON peer**:

- Identity: a fresh `AgentSecret` minted at agent boot, added to the Master Group with the role policy dictates (typically *reader*, rarely *writer*).
- Storage: SQLite `:memory:` or a `/tmp/agent-<id>.db` file.
- Lifetime: tied to the WebView. On close, the replica is discarded — no cleanup logic required.
- Isolation: each WebView gets its own `data_directory` (see `WebviewWindowBuilder::data_directory`), so OPFS / cache / SQLite for one agent is invisible to others.

```text
~/Library/Application Support/com.maia.os/
├── rocksdb/                      ← Rust master (persistent)
│   └── …
└── agents/
    ├── aven-1/                   ← WebView data_directory
    │   └── opfs / cache / sqlite (all ephemeral)
    ├── aven-2/
    └── aven-3/
```

### Why not OPFS as primary store?

Considered and rejected. OPFS:
- Cannot be relocated by the host app — only indirectly via the WebView's `data_directory`.
- Lives in the browser sandbox; vulnerable to user clear / WebView reset.
- Requires the **JS** CoJSON client, which duplicates the CRDT engine in the WebView.
- Pushes us into a 2‑replica architecture (Rust + browser) with a sync hop in between.

OPFS remains acceptable as a fallback ephemeral cache for WebView agents that prefer it over SQLite, but it is **never** the authoritative store.

---

## 6. Persistence is subscription‑driven

CoJSON does not persist "everything reachable." Storage is shaped by what the local node explicitly loads or subscribes to.

```text
CoValue lives somewhere in the network
        │
        ├── node.load(id)            → fetched + stored in RocksDB
        ├── node.subscribe(id, fn)   → updates streamed + stored
        └── (not referenced)         → never enters RocksDB
```

| Peer | Subscribes to | Effect |
|------|---------------|--------|
| **Rust master node** | Everything in the human's Master Group | Full local mirror in RocksDB. |
| **Aven WebView agent** | Only what its task needs | Tiny working set in `:memory:` SQLite. |
| **Remote device** (other Mac, iPhone) | Same Master Group | Same full mirror in its own RocksDB. |

Deduplication is automatic — the same CoValue subscribed twice in one node is loaded once.

---

## 7. Internal sync — Tauri IPC as the CoJSON transport

CoJSON cleanly separates **protocol** from **transport**. The standard transport is WebSocket; AvenOS replaces it locally with **Tauri IPC**.

### Why IPC over a localhost WebSocket

| Concern | localhost WebSocket | **Tauri IPC** |
|---------|---------------------|---------------|
| Overhead | TCP stack + HTTP upgrade | Native bridge, ~zero |
| Latency | Local but routed via TCP | Direct call into Rust |
| Open ports | Yes (`ws://127.0.0.1:4200`) | None |
| Security | Port is attackable | Tauri permission system per command |
| Setup | Embedded WS server | Built into Tauri |
| Cross‑platform | Yes | Yes — same primitive on macOS / Linux / Windows / iOS / Android |

### The peer adapter

CoJSON peers are defined by an `incoming()` stream of `SyncMessage` + a `send()` sink. Tauri's `invoke` / `emit` map onto these naturally.

```ts
// agent WebView — thin client
function createTauriIPCPeer(agentId: string) {
  return {
    id: agentId,
    role: "client",
    async send(message: SyncMessage) {
      await invoke("cojson_sync_message", {
        agentId,
        message: JSON.stringify(message),
      });
    },
    async *incoming(): AsyncGenerator<SyncMessage> {
      const queue: SyncMessage[] = [];
      let resolve: ((m: SyncMessage) => void) | null = null;
      listen<string>(`cojson:${agentId}`, (e) => {
        const msg = JSON.parse(e.payload) as SyncMessage;
        if (resolve) { resolve(msg); resolve = null; } else { queue.push(msg); }
      });
      while (true) {
        yield queue.length ? queue.shift()! : await new Promise<SyncMessage>(r => (resolve = r));
      }
    },
  };
}
```

```rust
// Rust master — accepts agent peers via Tauri command
#[tauri::command]
async fn cojson_sync_message(
    agent_id: String,
    message: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, MaiaNode>,
) -> Result<(), String> {
    let sync_msg: SyncMessage = serde_json::from_str(&message).map_err(|e| e.to_string())?;
    let responses = state.node.handle_message(&agent_id, sync_msg).map_err(|e| e.to_string())?;
    for response in responses {
        app.emit(&format!("cojson:{agent_id}"), serde_json::to_string(&response).unwrap())
           .map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

The agent sees a normal CoJSON peer. The Rust master sees a normal CoJSON peer. The wire is Tauri IPC; no port is opened.

---

## 8. External sync — peeroxide (Hyperswarm in Rust)

Across devices the same CoJSON sync protocol rides on **peeroxide**: a pure‑Rust, wire‑compatible implementation of the Hyperswarm stack (Kademlia DHT, Noise handshakes, UDP hole‑punching, BBR congestion control), with no C dependencies.

### Why peeroxide rather than alternatives

| Option | Verdict | Why |
|--------|---------|-----|
| **Pear / Hypercore (JS Bare runtime)** | ✗ | A competing app runtime, not embeddable in Tauri. App‑Store hostile on iOS. |
| **datrs `hyperswarm-rs`** | ✗ | DHT layer unfinished, not on crates.io, inactive. |
| **iroh** | ◎ | Solid production fallback (Rust QUIC + relay + holepunching, iOS support). Reserve as backup if peeroxide stalls. |
| **peeroxide** | ✓ | Pure Rust, Hyperswarm wire‑compatible, embeddable in the Tauri Rust backend, no server. The romantic *and* practical choice. Solo‑maintainer risk to monitor. |

### Topology

```text
iPhone Tauri App                       Mac Tauri App
─────────────────                      ─────────────────
Rust CoJSON node                       Rust CoJSON node
  RocksDB Lite                           RocksDB
  peeroxide endpoint  ◄── DHT ──►        peeroxide endpoint
  master Ed25519 key                     master Ed25519 key
        │                                       │
   Tauri IPC                               Tauri IPC
        │                                       │
   WebView agents                          WebView agents
   SQLite :memory:                         SQLite :memory:
```

### Mechanics

- **Topic** = `blake3(master_group_id)` (or `blake3(human_user_id)`). Every device of one human joins the same topic.
- **Connection** = Noise XX handshake yielding `AsyncRead + AsyncWrite`.
- **Payload** = CoJSON `SyncMessage`s, exactly the same envelope used over Tauri IPC.
- **Authentication** = peer public key is checked against the Master Group; non‑members get only the public CoValues, members get full sync.

```rust
let topic = blake3::hash(master_group_id.as_bytes());

let swarm = peeroxide::Swarm::bind().await?;
swarm.join(topic);

swarm.on_connection(|stream| async move {
    // stream: AsyncRead + AsyncWrite, Noise‑encrypted, peer's public key known
    let peer = cojson_stream_peer(stream);
    node.sync_manager.add_peer(peer);
});
```

peeroxide is **unopinionated** about payload — it carries arbitrary encrypted streams. CoJSON, RocksDB, group permissions: all our problem, none of peeroxide's.

### Optional remote relay

If/when convenient, the *same* CoJSON node can additionally talk to a remote relay over QUIC (`quinn`) or WSS. It is just another peer registered with the sync manager. Adding cloud reach never changes the data model — it only adds a third transport.

```text
Lokal       (immer)       Tauri IPC      → WebView agents
Lokal/LAN/P2P (online)    peeroxide       → other devices
Optional   (online)       QUIC / WSS      → maia.city relay
```

---

## 9. Write flow — Aven agent writes a CoValue

```text
Aven agent (WebView, ephemeral peer, reader/writer role)
    │
    │  webcm serial-port JSON request
    ▼
WebView JS — thin SDK
    │
    │  invoke("cojson_apply_change", { covalueId, change })
    ▼
Rust master CoJSON node
    │
    ├── verify signature against the Master Group's writer key
    ├── reject if agent lacks role (kryptographisch enforced)
    ├── apply CRDT mutation → RocksDB
    └── broadcast SyncMessage:
          • to all local Tauri IPC peers (other WebViews update)
          • to all peeroxide peers (other devices update)
```

A read is symmetric but lighter — the agent simply subscribes to a CoValue id and receives streamed updates over the IPC peer.

---

## 10. Component summary

| Layer | Choice | Role |
|-------|--------|------|
| **CRDT engine** | `cojson` Rust crate | Single source of truth for data semantics. |
| **Storage (device)** | RocksDB (Lite on iOS) | Persistent master replica. |
| **Storage (agent)** | SQLite `:memory:` or `/tmp` file (OPFS acceptable as fallback) | Disposable working set per WebView. |
| **Identity** | Ed25519 in Secure Enclave / OS keystore | One key, double‑used by CoJSON + peeroxide. |
| **Permissions** | CoJSON Accounts + Groups (admin / writer / reader) | Cryptographically enforced, no server. |
| **Local transport** | Tauri IPC (`invoke` / `emit`) | Zero‑port, native, cross‑platform. |
| **P2P transport** | peeroxide (Hyperswarm‑compatible) | Direct device‑to‑device sync, DHT + UDP holepunching. |
| **Optional remote** | QUIC (`quinn`) or WSS | Cloud relay if/when desired. |
| **App shell** | Tauri (macOS, Linux, Windows, iOS, Android) | Multi‑WebView agent host; privileged Rust core. |

---

## 11. Properties this gives us

- **No servers required.** Master Group + peeroxide + CoJSON = a fully self‑hosted human.
- **No accounts required.** Identity = device Ed25519 key; cross‑device pairing = adding a Public Key to the Master Group as admin.
- **End‑to‑end encrypted.** Noise on the wire, XSalsa20 group read‑keys at rest in transit.
- **Tamper‑proof permissions.** Writes are signed; unauthorized writes never validate, regardless of who tries to deliver them.
- **Truly offline‑first.** Every device runs the same Rust master locally; the network is an optimization, never a dependency.
- **Disposable agents.** A killed WebView leaves nothing to clean up; a fresh one re‑syncs in seconds.
- **One CRDT engine.** No double‑implementation between JS and Rust; one place to reason about correctness and merges.

---

## 12. Open questions / monitor

- **peeroxide maturity.** Solo‑maintained today; track release cadence, wire‑compat with the JS Hyperswarm DHT, and at least one independent production user before locking in. `iroh` remains a credible fallback (Rust‑native QUIC + relay + iOS support).
- **CoJSON Rust storage adapter for RocksDB.** Confirm the adapter shape (`get / set / entries`) against the current `cojson` crate and provide an in‑house `cojson-storage-rocksdb` if not yet upstream.
- **iOS Secure Enclave binding.** Verify a clean Rust path to non‑extractable Ed25519 keys on iOS via Tauri plugin (or pinned key‑material via Keychain when SE non‑extractable is impractical).
- **RocksDB Lite limits on iOS.** Validate that the disabled features (specific compactions, transactions, etc.) are not on our hot path; otherwise consider a Rust‑native LSM (e.g. `redb`, `sled`) for iOS only.
- **Cross‑platform Tauri IPC throughput.** Benchmark IPC frame sizes for large CoJSON sync bursts (initial replica seed) on each platform; chunk if necessary.

---

## 13. Minimal roadmap

1. **Spike** the Rust master: `cojson` + RocksDB adapter + one Tauri IPC peer + smoke test from a single WebView.
2. **Multi‑agent IPC**: spawn N WebViews, each as a CoJSON peer with its own ephemeral SQLite, all reading/writing a shared Master Group CoValue.
3. **Permissions**: introduce the Master Group with admin device key + reader Aven agent key; assert that a reader's signed write is cryptographically rejected.
4. **peeroxide**: stand up two Tauri apps on two machines; share a topic = `blake3(master_group_id)`; verify CoJSON sync converges with the network unplugged then reconnected.
5. **Mobile**: bring up the iOS Tauri app; RocksDB Lite + peeroxide + Secure Enclave key binding.
6. **Optional relay**: add a third QUIC/WSS peer to the sync manager for cloud reach, prove additive‑only.

---

**Bottom line.** CoJSON in Rust owns the data. RocksDB owns the bytes. Tauri IPC owns the local wire. peeroxide owns the long wire. One Ed25519 key owns the identity. WebView agents own nothing — and that is the point.
