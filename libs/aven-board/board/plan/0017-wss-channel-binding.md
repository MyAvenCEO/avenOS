---
title: Add channel binding (mutual handshake) to wss peer-auth
summary: The wss peer-auth uses NO_CHANNEL_BINDING="" so a compromised Sprites proxy inside the TLS boundary can relay a victim's ClientAuth to the backend; add an application-layer mutual handshake (client-chosen nonce + server signature over client_nonce||server_nonce||client_did) so a relay cannot complete both sides.
owner: Claude Code
created: 2026-06-08
updated: 2026-06-08
tags: [aven-p2p, security, transport]
goal: cargo test -p aven-p2p passes AND a new regression test wss_relay_cannot_complete_mutual_handshake proves (a) a ClientAuth captured against one ServerHello fails verify against a different server nonce (no live relay of the client proof), and (b) a server AuthResult signature over (client_nonce||server_nonce||client_did) fails to verify when the client_nonce or server_nonce is substituted by a relay — proven by `cargo test -p aven-p2p wss_relay_cannot_complete_mutual_handshake` exiting 0, `cargo build -p aven-p2p` exiting 0, and `cargo build -p aven-node` exiting 0.
---

# Add channel binding (mutual handshake) to wss peer-auth

## Context

The `wss://<host>/sync` peer-auth handshake has **zero channel binding**. On the
wss transport, TLS terminates at the **Sprites proxy**, so the proxy is *inside*
the TLS trust boundary and sees the cleartext WebSocket handshake. This is confirmed
crypto-audit finding **#21** (`docs/security/crypto-audit-2026-06-08.md`, Medium,
transport, "wss peer-auth has zero channel binding, so a malicious proxy inside the
TLS boundary can relay the client's challenge response to the backend").

**Precise evidence (carried over so this doc stands alone):**

- `libs/aven-p2p/src/ws_client.rs:7-11` (doc) — "the device's TLS ends at the proxy
  … Replay is instead prevented by the server's single-use, TTL nonce
  (`channel_binding = ""`, agreed by both ends)." This is the explicit acknowledgement
  that the wss challenge cannot bind to the TLS session.
- `libs/aven-p2p/src/ws_client.rs:38` — `const NO_CHANNEL_BINDING: &str = "";`
- `libs/aven-p2p/src/ws_client.rs:83` —
  `let message = build_message(&hello, &did, NO_CHANNEL_BINDING);` — the client signs
  with the empty channel binding.
- `libs/aven-node/src/ws_server.rs:30` — `const NO_CHANNEL_BINDING: &str = "";`
- `libs/aven-node/src/ws_server.rs:140` (in `verify_client`, lines 135-143) —
  `let message = build_message(hello, &auth.did, NO_CHANNEL_BINDING);` then
  `verify(&pubkey, &message, &auth.signature)?;`. The backend verifies the client
  signature against **the same nonce it issued** and the empty channel binding, then
  stamps `Source::Client(peer)` (`ws_server.rs:107` / `:87`, the authorization anchor
  for `may_sync`).
- `libs/aven-p2p/src/challenge.rs:95-115` — `build_message` signs only
  `(domain, uri, network, did, nonce, issued, exp, channel_binding)`. With an empty
  channel binding, nothing ties the signature to the specific connection it traveled on.
- **Contrast — the raw-TLS path defends correctly:** `libs/aven-p2p/src/transport.rs:113-120`
  reads a real TLS-exporter channel binding via
  `conn.export_keying_material([0u8;32], CB_LABEL, None)` and
  `libs/aven-p2p/src/transport.rs:126` signs `build_message(&hello, &did, &cb)` with
  that binding. Because the exporter yields identical bytes only on a genuine end-to-end
  TLS session, a relayed signature fails — the existing test
  `challenge::tests::wrong_channel_binding_fails` (challenge.rs:176-187) already proves
  this for the raw path. The wss path has no equivalent.

**Attack scenario.** A compromised Sprites proxy (or an on-path attacker who has
MITM'd the wss link before the proxy) accepts the victim device's WebSocket and
*simultaneously* dials the real `aven-node` backend. It reads the backend's
`ServerHello` (with the backend's fresh nonce), forwards that exact `ServerHello`
verbatim to the victim client, receives the victim's `ClientAuth`, and replays it on
the backend connection. The backend's `verify_client` verifies the signature against
the same nonce it issued and the empty channel binding, accepts the relayed proof, and
stamps `Source::Client(victim)`. The relay is now authenticated to the backend **as the
victim**, anchoring the downstream biscuit `may_sync` gate to the victim's identity —
bypassing per-peer outbound/inbound capability scoping for any resource the victim can
reach. **The TTL nonce does not stop this**: it only prevents *delayed* replay, not
*live* forwarding, because the relay forwards the backend's own fresh nonce to the
client in real time.

**Constraints / cross-links.**

- **Scope: wss path only.** Do NOT touch the raw-TLS exporter binding
  (`transport.rs:113-120,126`) — it is correct and stays as-is. This item only adds an
  application-layer mutual handshake for the proxy-terminated wss path.
- **Do not rely on the TTL nonce as anti-relay.** The single-use/TTL nonce is a
  delayed-replay defense, not a live-relay defense; the fix must make a relay unable to
  complete *both* sides of the handshake.
- This is the transport-layer sibling of the apply-gate findings (0010 wire-edit-sig,
  0013 authenticate-delete-state): those harden *what the receiver trusts about row
  contents*; this hardens *which peer identity the connection is stamped with*. They are
  complementary — even with this fix, the apply gate must still authorize every frame.
- The IPC `sign` oracle item **0014** is related but distinct: 0014 stops a compromised
  WebView from minting a peer-auth signature on demand (sign-domain separation); 0017
  stops an on-path relay from *forwarding* a legitimately-produced signature. Both are
  needed; neither subsumes the other. Cross-link 0014.

## Goal

When done, the wss peer-auth is a mutual handshake: the client contributes a fresh
client-chosen nonce that is folded into the signed ClientAuth, and the server signs its
`AuthResult` over `(client_nonce || server_nonce || client_did)` so the client detects a
substituted backend — meaning a relay that forwards the backend's `ServerHello` to the
victim can no longer both (a) get the client to sign a proof the *backend* will accept
and (b) convince the client the connection terminates at the real backend.

**Completion condition** (identical to frontmatter goal):
> `cargo test -p aven-p2p passes AND a new regression test wss_relay_cannot_complete_mutual_handshake proves (a) a ClientAuth captured against one ServerHello fails verify against a different server nonce (no live relay of the client proof), and (b) a server AuthResult signature over (client_nonce||server_nonce||client_did) fails to verify when the client_nonce or server_nonce is substituted by a relay — proven by `cargo test -p aven-p2p wss_relay_cannot_complete_mutual_handshake` exiting 0, `cargo build -p aven-p2p` exiting 0, and `cargo build -p aven-node` exiting 0.`

## Approach

Introduce an **application-layer mutual handshake** in `challenge.rs` that both
transports can reuse, but wire it only into the wss path. Two pieces:

1. **Client-chosen nonce folded into the signed ClientAuth.** Add a `client_nonce:
   String` field to `ClientAuth` (challenge.rs:55-59). The client generates a fresh
   32-byte nonce (`random_nonce_b64`) and includes it both in the wire `ClientAuth` and
   in the bytes it signs. Extend `build_message` to fold the client nonce into the
   canonical message (a new `Client-Nonce:` line, kept *alongside* the existing
   `Channel-Binding:` line so the raw-TLS path is byte-compatible when it passes an empty
   client nonce). The server, in `verify_client`, rebuilds the message using the
   `client_nonce` *from the received ClientAuth* — so the client proof is now bound to a
   value the client picked, not just the backend's nonce. (This alone does not stop a
   live relay of the client proof, because the relay can forward the client nonce too;
   its purpose is to give the client a value the *server* must echo back under signature
   in step 2.)

2. **Server signs the AuthResult (mutual binding) — the actual anti-relay.** Add a
   `signature: Option<String>` field to `AuthResult` (challenge.rs:63-68). After the
   server authenticates the client, it signs the tuple
   `(client_nonce || server_nonce || client_did)` with the **server's own** signing key
   and returns that signature in `AuthResult`. The client, on receiving `AuthResult`,
   verifies that signature against the `server_did` it is told to register **and against
   the `client_nonce it itself chose` plus the `server_nonce from the ServerHello it
   saw`**. A relay sitting between client and backend has two distinct connections with
   two distinct `(client_nonce, server_nonce)` pairs: to make the backend accept the
   client proof it must forward the *backend's* server_nonce to the client, but then the
   backend's `AuthResult` signature is over the *backend-side* tuple — and the relay
   cannot forge the backend's signature over the *client-side* tuple, nor can it get the
   client to accept a tuple that does not match the nonces the client saw. The relay
   cannot complete both sides.

**Why a canonical signing helper.** Add a single
`server_attestation_message(client_nonce, server_nonce, client_did) -> String` in
`challenge.rs` so both ends derive identical bytes (mirroring `build_message`'s
"identical on both ends → identical bytes" property). Reuse the existing `sign` / `verify`
primitives (Ed25519). The server already has its DID/signing key in `WsServerListener`
(`server_did` field, ws_server.rs:40,55) — the **signing key** must be threaded in (today
only the *did string* is stored). The client already learns `server_did` from
`AuthResult` (ws_client.rs:93-99) and can derive the pubkey via
`ed25519_public_from_peer_did`.

**Shape of change.**
- `challenge.rs`: `ClientAuth` gains `client_nonce`; `AuthResult` gains
  `signature: Option<String>`; `build_message` gains a `client_nonce` line (empty-string
  back-compat for the raw path); new `server_attestation_message(...)`; new
  `verify_server_attestation(server_pubkey, client_nonce, server_nonce, client_did, sig)`.
- `ws_client.rs`: generate a client nonce, pass it to `build_message`, put it in
  `ClientAuth`, and after `AuthResult` arrives verify the server attestation before
  trusting `server_did` / proceeding (reject the connection on mismatch).
- `ws_server.rs`: `WsServerListener` gains a server `SigningKey`; `verify_client` rebuilds
  the message with `auth.client_nonce`; after auth, sign the attestation tuple and put it
  in `AuthResult.signature`.

**Trade-offs / out of scope.**
- This is **not** a TLS-exporter binding for wss (option (2) in the audit fix list —
  terminating TLS at aven-node or passing the exporter through a trusted proxy header).
  That is a deployment/architecture change; this item delivers the audit's option (3),
  the application-layer mutual handshake, which is self-contained in app code and
  testable. Note that as future work in the progress log.
- The raw-TLS path keeps its real exporter binding and is unchanged (it will pass an
  empty `client_nonce` to `build_message`, preserving its existing signed-bytes shape via
  the same empty-string convention already used for back-compat — verify the existing
  `challenge::tests` still pass).
- Wire-format change: `ClientAuth` / `AuthResult` gain fields. Both ends ship together
  (client = `app` via `aven-p2p`, server = `aven-node`), so there is no mixed-version
  window in practice; making `AuthResult.signature` an `Option` keeps `serde` tolerant if
  an older peer is ever encountered.

## Steps

1. In `libs/aven-p2p/src/challenge.rs`: add `pub client_nonce: String` to `ClientAuth`
   (default to `""` semantics for the raw path). Extend `build_message` to fold a
   `Client-Nonce: {client_nonce}` line into the canonical text (append after the
   `Channel-Binding:` line). Update the existing `build_message` call in
   `transport.rs:126` to pass `""` for the new client nonce (raw-TLS path keeps an empty
   client nonce; its anti-relay is the exporter binding).
2. In `challenge.rs`: add `pub signature: Option<String>` to `AuthResult`. Add a pure
   helper `server_attestation_message(client_nonce: &str, server_nonce: &str, client_did:
   &str) -> String` and `verify_server_attestation(server_pubkey: &[u8;32], client_nonce:
   &str, server_nonce: &str, client_did: &str, sig_b64: &str) -> Result<(), String>`
   (reuse `verify`). Sign with the existing `sign(&server_signing_key, &msg)`.
3. In `libs/aven-node/src/ws_server.rs`: add a `server_signing_key: SigningKey` to
   `WsServerListener` and its `new` constructor (thread it from the host loop; the server
   already owns its identity key to produce `server_did`). In `verify_client`, rebuild the
   message with `build_message(hello, &auth.did, NO_CHANNEL_BINDING, &auth.client_nonce)`.
   After `let peer = verdict?;`, compute the attestation
   `server_attestation_message(&auth.client_nonce, &hello.nonce, &auth.did)`, sign it with
   `server_signing_key`, and set `AuthResult.signature = Some(sig)`.
4. In `libs/aven-p2p/src/ws_client.rs`: generate `let client_nonce = random_nonce_b64();`,
   pass it into `build_message(&hello, &did, NO_CHANNEL_BINDING, &client_nonce)`, and put
   it in the `ClientAuth { did, signature, client_nonce }`. After receiving `AuthResult`
   and deriving `server_peer`, verify the server attestation:
   `verify_server_attestation(&server_pubkey, &client_nonce, &hello.nonce, &did,
   result.signature.as_deref().ok_or(...)?)` and return
   `Err(P2pError::Handshake("server attestation missing/invalid"))` on failure — *before*
   starting the frame pumps.
5. Add the regression test `wss_relay_cannot_complete_mutual_handshake` in
   `challenge.rs` `#[cfg(test)]` with two asserts modeling the live relay:
   (a) a `ClientAuth` signed against `ServerHello{nonce: A}` (client message built with
   server nonce A) fails `verify` when the server rebuilds the message with a different
   server nonce B — i.e. the relay cannot move the client proof onto a connection whose
   server nonce differs from what the client signed; and
   (b) a server attestation signed over `(client_nonce=c1, server_nonce=s1, client_did)`
   fails `verify_server_attestation` when checked against a substituted `client_nonce=c2`
   OR a substituted `server_nonce=s2` (the two relay-side vs client-side tuples), proving
   the client detects a substituted backend / relayed attestation.
6. `cargo test -p aven-p2p` (includes the new test + the existing
   `wrong_channel_binding_fails` / `sign_then_verify_roundtrips`), `cargo build -p
   aven-p2p`, and `cargo build -p aven-node` to prove green; record outputs in the
   progress log.

## Files to touch

- `libs/aven-p2p/src/challenge.rs` — add `client_nonce` to `ClientAuth`,
  `signature: Option<String>` to `AuthResult`, a `Client-Nonce:` line in `build_message`,
  and the new `server_attestation_message` / `verify_server_attestation` helpers. Add the
  `wss_relay_cannot_complete_mutual_handshake` test.
- `libs/aven-p2p/src/transport.rs` — update the `build_message` call (~126) to pass an
  empty `client_nonce` (raw-TLS path unchanged in behavior; exporter binding stays).
- `libs/aven-p2p/src/ws_client.rs` — generate the client nonce (~80-85), thread it into
  `build_message` (~83) and `ClientAuth` (~85), and verify the server attestation from
  `AuthResult` (~87-99) before starting pumps.
- `libs/aven-node/src/ws_server.rs` — add `server_signing_key` to `WsServerListener` /
  `new` (~40-58); rebuild the client message with `auth.client_nonce` and sign the
  attestation into `AuthResult.signature` in `accept_inner` / `verify_client` (~80-87,
  135-143). Update the `new(...)` call site in the host loop that constructs the listener.

## Acceptance criteria

- [ ] A `ClientAuth` proof bound to server nonce A is rejected when verified against a
  different server nonce B (relay cannot move the client proof live) — proven by
  `cargo test -p aven-p2p wss_relay_cannot_complete_mutual_handshake`.
- [ ] A server attestation over `(client_nonce, server_nonce, client_did)` fails to verify
  when either nonce is substituted (client detects a substituted backend) — proven by
  `cargo test -p aven-p2p wss_relay_cannot_complete_mutual_handshake`.
- [ ] The existing challenge tests still pass, confirming the raw-TLS path is unbroken by
  the new `Client-Nonce:` line + empty-string back-compat — proven by
  `cargo test -p aven-p2p` (includes `wrong_channel_binding_fails`,
  `sign_then_verify_roundtrips`).
- [ ] `aven-p2p` compiles with the new fields/helpers — proven by `cargo build -p aven-p2p`.
- [ ] `aven-node` compiles with the server signing key + attestation wiring — proven by
  `cargo build -p aven-node`.

## Verification

```bash
# 1. New regression test proves the relay cannot complete both sides (exit 0)
cargo test -p aven-p2p wss_relay_cannot_complete_mutual_handshake

# 2. Full aven-p2p suite stays green — raw-TLS path unbroken by the new field (exit 0)
cargo test -p aven-p2p

# 3. aven-p2p compiles with the new ClientAuth/AuthResult fields + helpers (exit 0)
cargo build -p aven-p2p

# 4. aven-node compiles with the server signing key + attestation signing (exit 0)
cargo build -p aven-node
```

## Hand-off

```
/board-goal 0017-wss-channel-binding
```

## Progress log

Newest first.
- `2026-06-08` — Planned from crypto audit (docs/security/crypto-audit-2026-06-08.md, finding #21). Grounded Approach/Steps in real code: `NO_CHANNEL_BINDING=""` at ws_client.rs:38 / ws_server.rs:30, signed with empty binding at ws_client.rs:83 and verify_client at ws_server.rs:135-143, `build_message` canonical text at challenge.rs:95-115, and the correct raw-TLS exporter binding at transport.rs:113-120,126 (kept as-is). Chose audit fix option (3): application-layer mutual handshake (client-chosen nonce folded into ClientAuth + server signs (client_nonce||server_nonce||client_did) into AuthResult) so a relay cannot complete both sides; explicitly NOT relying on the TTL nonce as anti-relay. Scope = wss path only. Cross-links: complementary to 0010/0013 (apply-gate integrity); distinct from but related to 0014 (sign IPC oracle). Created in plan.
