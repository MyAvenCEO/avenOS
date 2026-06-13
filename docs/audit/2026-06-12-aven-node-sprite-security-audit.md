---
title: aven-node (Sprite relay) security audit — June 2026
scope: libs/aven-node, libs/aven-p2p (transport/challenge), scripts/deploy-aven-node-sprite.ts
focus: access control + data / system / file exposure to unauthorized parties
---

# aven-node Sprite relay — security audit (2026-06-12)

Analysis-only audit of the **hosted relay** as actually deployed to Sprites
(`scripts/deploy-aven-node-sprite.ts`, `wss://<sprite>.sprites.app/sync`). It does
**not** re-audit the device/app stack — see `docs/audit/2026-06-10-technical-audit.md`
and `docs/security/` for that. Findings cite `file:line`. The question being answered:
*does the relay leak data, files, or system access to unauthorized people, and is the
access control sound?*

## TL;DR

The relay's design is a **blind replica**: it stores and forwards end-to-end
ciphertext and (by design) cannot decrypt user content, holds no user keyshares,
runs as a non-root container user, and exposes only `/health` + `/sync`. The
encryption boundary is sound and content confidentiality holds even against a fully
compromised relay — for **user** identities.

The real exposure is **not** plaintext content; it is that **authentication is not
authorization**. Any party that can generate an ed25519 keypair passes the `/sync`
handshake, and once connected can (a) pull every identity's ciphertext **and all
plaintext routing/relationship metadata**, and (b) inject rows the relay forwards to
real members. Two design choices deserve an explicit, conscious sign-off rather than
being inherited silently: the **trust-on-first-use admin grant** (whoever connects
first to a fresh relay becomes network admin) and the **server-held avenCEO DEK**
(the relay is *not* blind to its own control identity, so the env seed is a
network-takeover key). None of these are bugs in the crypto; they are access-control
and operational-secret properties that should be named.

Severity legend: **High** = exploitable exposure or takeover; **Medium** = real
weakness, bounded or needs a precondition; **Low** = hygiene / hardening.

---

## Findings

### A1 — [High] Any keypair authenticates; there is no peer allowlist
`libs/aven-node/src/ws_server.rs:154` (`verify_client`), `:106`.

The `/sync` handshake proves only that the connecting peer *controls the private key
for the DID it presents*. There is no allowlist, invite check, or membership gate on
**who may connect** — `verify_client` checks nonce freshness + signature and returns
the `PeerId`. The `ServerApplyGate::may_sync` returns `Allow` unconditionally
(`main.rs:126-134`), so the relay imposes no read scoping either.

Consequence: anyone on the internet who generates a keypair can complete the
handshake and begin syncing. Confidentiality of **content** still holds (it is
ciphertext the relay can't decrypt), but see A2 for what that authenticated stranger
*does* learn, and A3 for what they can push. "Unauthorized people" in the colloquial
sense — non-members — are not kept off the relay; they are merely kept from
*decrypting*. That is the intended blind-relay model, but it means the relay is a
fully open read/replicate surface and every confidentiality guarantee rests entirely
on the E2E encryption and on client-side membership enforcement, never on the relay.

> Recommendation: if the network is meant to be closed, add a connection-level
> allowlist (e.g. peers that present a valid avenCEO membership proof, or an
> invite-bound token) or rely on an upstream proxy ACL. If it is meant to be open,
> document that explicitly so the property is a decision, not an accident.

### A2 — [High] Plaintext routing & relationship metadata is readable by any authenticated peer
`libs/aven-node/src/aven_ceo.rs:339-344` (the "PLAINTEXT routing columns" comment),
keyshare rows at `:211-217` / `:387-394`.

The blind relay can only route because several columns are deliberately **not**
sealed: `type`, `owner`, `wrap_did`, `recipient_did`, `wrapper_did`, `dek_version`,
and the various `*_at_ms` timestamps. The relay reads these without any DEK — and so
can every other authenticated peer it forwards to (A1). That exposes, in cleartext,
to any stranger who connects:

- the set of identity UUIDs and their `type` (`human` / `aven`),
- the **social graph**: which DIDs hold keyshares for which identities
  (`recipient_did` ⇄ `owner`), i.e. who is a member of / shares with whom,
- DEK version history and row/identity creation timestamps (activity inference).

No message *content* leaks, but the **metadata graph does**. For a "private by
default" product this is the most likely real-world privacy surprise: an outsider
learns the org chart and activity timing without decrypting a single cell.

> Recommendation: treat the plaintext routing set as a documented, minimized
> allow-list of columns, and review whether `recipient_did`/`wrapper_did` can be
> blinded (e.g. salted/HMAC'd routing tags) so the membership graph isn't world-
> readable. At minimum, document this in `docs/security/trust-boundaries-*` — the
> current table stops at the device and never states what the relay exposes to peers.

### A3 — [Medium] Unsigned / unbound rows bypass both the integrity gate and the storage quota
`libs/aven-node/src/main.rs:135-190`.

`verify_on_apply` is fail-**open** for rows that carry no owner-binding proof:
`let Some(proof) = proof else { return CapDecision::Allow };` (`:144-146`). And
`quota_for` returns `None` when there is no binding (`:185-190`), which the engine
treats as "no quota key" — so an unbound row is counted against **no** identity's
10 MiB budget. The two interact badly: a stranger (A1) can stream **bindingless**
rows that (1) skip the signature check entirely and (2) are not quota-limited,
turning the relay into an unbounded sink and a forwarding amplifier toward real
members (who will reject them client-side, but only after receiving them).

The `None → Allow` branch is intentional blind-relay semantics (it mirrors the app
gate, and the 2026-06-10 audit's M0.2 calls for asserting it explicitly). The gap is
that the **quota** does not cover the same path, so the "one identity can't make this
an unbounded sink" guarantee in the `quota_for` doc-comment (`:181-184`) does not hold
for *unowned* writes. This compounds the already-filed S2/P1 (unbounded frame
allocation in `aven-p2p/src/transport.rs`, and non-expiring quota maps).

> Recommendation: give unbound/unsigned inbound rows a shared fallback quota bucket
> (e.g. a single `"_unbound"` key with a tight cap) so the fail-open apply path can't
> be turned into unbounded storage, and/or reject bindingless rows above a small
> size. Pair with the S2 frame cap.

### A4 — [Medium] Trust-on-first-use: whoever connects first to a fresh relay becomes network admin
`libs/aven-node/src/aven_ceo.rs:305-361`, `main.rs:314-342`.

`grant_first_human_admin` grants the **first** `type=human` SAFE that syncs in
co-ownership of avenCEO (the network's root of trust), then is idempotent forever
after. On a **fresh or `WIPE=1`** deploy (`deploy-aven-node-sprite.ts:208-216`) the
store starts empty, so this is a literal race: the first human SAFE to land — not
necessarily the operator's — is made network admin. There is no out-of-band binding
of the legitimate first admin (no expected DID, no operator-supplied bootstrap pin).
Combined with A1 (anyone can connect), an attacker who wins the race on a freshly
wiped relay obtains avenCEO admin over the whole network.

The exposure window is small (the relay is normally seeded by the operator's own
device immediately on deploy) and `WIPE=1` is a deliberate operator action, so this
is Medium rather than High — but it is an unauthenticated path to the most powerful
grant in the system, and it is silent.

> Recommendation: gate the first-admin grant on an operator-supplied expected human
> DID (env var) or a one-time bootstrap secret, so "first to connect" can't be
> hijacked. At minimum, log loudly and document that a wiped relay must be re-seeded
> by the operator's device before any other peer is allowed to reach it.

### A5 — [High, operational] The env seed is an avenCEO network-takeover key — and the relay is NOT blind to avenCEO
`libs/aven-node/src/main.rs:222-241`, `aven_ceo.rs:155-251` (`ensure_avenceo_owned`),
`:273-303` (`read_server_dek`).

The "blind replica holds no keyshares" framing (`main.rs:6-8`) is true for **user**
identities but **not** for avenCEO: the server mints avenCEO's genesis with its own
biscuit key and **wraps the avenCEO content DEK to itself** (`aven_ceo.rs:206-224`),
then reads it back via `read_server_dek`. So the relay *can* decrypt all avenCEO
control content, and `AVEN_SERVER_SEED` is simultaneously: the relay's transport
identity, the avenCEO owner/issuer key, and the key that unwraps the avenCEO DEK.

Whoever holds that 64-hex seed *is* the network's control identity and can mint
admin grants. It lives in `.env` (gitignored — verified: `.gitignore:26-28`, and no
`.env` is tracked) and in the Sprite service env. That is a reasonable place, but the
blast radius of a single leaked value should be stated: seed compromise ≠ "relay
impersonation," it = **avenCEO takeover + decryption of all control-plane data**.

> Recommendation: document the seed as a crown-jewel secret with that blast radius;
> ensure the Sprite service env is not readable by other tenants/processes; and
> consider whether avenCEO's owner key needs to be separable from the relay's
> transport key so a relay host compromise doesn't equal control-identity
> compromise. Rotation is supported (`deploy` doc) but requires re-sharing — make
> that a documented incident-response step.

### A6 — [Low] `fly.toml` describes a different, insecure-by-comparison deployment than the one shipping
`libs/aven-node/fly.toml` vs `libs/aven-node/src/main.rs` and
`scripts/deploy-aven-node-sprite.ts`.

`fly.toml` claims a stateless, in-process-rustls, raw-TCP-passthrough relay on
`:4290` with health on `/healthz` (`fly.toml:1-6,26-53`). The **actual** shipping
binary terminates no TLS itself (TLS is the Sprite proxy's, channel binding is empty —
`ws_server.rs:29-31`), is **stateful** (durable RocksDB at `AVEN_SERVER_DATA_DIR`,
`main.rs:248-279`), serves health at **`/health`** not `/healthz` (`main.rs:347`), and
is deployed via Sprites, not Fly. A stale deployment manifest that contradicts the
running security model is a misconfiguration trap: anyone who `fly deploy`s this would
get a health check that never passes and a different TLS story than the audited one.

> Recommendation: delete or clearly mark `fly.toml` as obsolete, or fix it to match
> the Sprite reality (and the `/health` path). Same for the unused `AVEN_SERVER_PIN_FILE`
> below.

### A7 — [Low] Dead/unused security-relevant config: `AVEN_SERVER_PIN_FILE`, `AVEN_SERVER_BIND`
`scripts/deploy-aven-node-sprite.ts:31,187` set `AVEN_SERVER_PIN_FILE` and
`AVEN_SERVER_BIND`; the binary's `Config::from_env` (`main.rs:44-74`) reads neither —
it only binds `AVEN_SERVER_HEALTH_BIND` (`:66`). `PIN_FILE` is a leftover from the
cert-pinned Fly path and is never consumed (verified: no `PIN`/`pin` reference in
`libs/aven-node/src`). Harmless today, but unused security knobs invite false
confidence ("we pin certs" — we don't, on this path) and config drift.

> Recommendation: drop the unused env from the deploy script, or wire it if pinning
> is intended for the raw-TCP path.

---

## Sprites platform considerations

Folded in from the Sprites documentation (`https://docs.sprites.dev`,
`https://sprites.dev/api`). Note: that host is **not on this environment's network
egress allowlist**, so these were gathered from the public docs via search rather than
read directly — re-verify against the live docs before acting on A8/A9.

Platform baseline (good): Sprites run in **Firecracker microVMs on isolated networks**,
and "nothing can connect to your Sprite directly" — the *only* ingress is the public
URL, which proxies to **port 8080** inside the VM. That means the relay's entire remote
attack surface is exactly `/health` + `/sync` on 8080 (`main.rs:344-351`); there is no
stray listener, and the `fly.toml` raw-TCP `:4290` path (A6) is not reachable on this
platform. Each Sprite has a **100 GB persistent filesystem that survives shutdown**,
which is what actually backs the durable RocksDB store (`main.rs:248-279`) — confirming
A6: the `fly.toml` "stateless by design" comment is simply wrong for the shipping
deployment.

### A8 — [Medium] The production sync endpoint rides a Sprites "public URL," which the platform scopes to non-sensitive use
The app dials `wss://<sprite>.sprites.app/sync`
(`scripts/build-appstore-macos.ts:204`, `tauri-ios-asc.ts:257`), i.e. the relay is
exposed through a Sprites **public URL** (`sprite url … --auth public`). The Sprites
docs state plainly that public URLs "expose your Sprite to the internet … should only
be used for demos, webhooks, or non-sensitive work" and "should never expose secrets,
environment variables, or sensitive data via HTTP." Here the public URL *is* the
production transport for the whole network's sync. That is workable **only because**
the app-layer did:key challenge + E2E encryption carry the security — but it also means
the platform-level access gate is set to "anyone on the internet," and the open-to-all
property in A1 is not incidental, it is how the endpoint is configured. Sprites also
offers an **authenticated** URL mode; using it (or a signed-token gate at the proxy)
would add a second, platform-enforced barrier in front of the did:key handshake if the
network is meant to be closed.

> Recommendation: decide consciously between "public URL + app-layer auth only" (then
> document it, and lean on A1/A3 hardening) vs. switching to Sprites authenticated URLs
> as defence-in-depth. Either way, confirm the relay's URL auth mode in the deploy
> runbook rather than leaving it implicit.

### A9 — [Medium, operational] The avenCEO seed and all env vars are captured by Sprite checkpoints and live on the persistent disk
The relay's `AVEN_SERVER_SEED` is delivered as a **Sprite service env var**
(`deploy-aven-node-sprite.ts:183-190`). Per the Sprites docs, **checkpoints capture the
entire environment including env vars and disk state**, and the 100 GB filesystem
persists across shutdowns. So the crown-jewel seed of A5 is not only in `.env` and the
live service env — it is also captured in any checkpoint/snapshot and resident on
durable Sprite storage. Anyone with access to the Sprite account, a checkpoint, or a
disk image therefore obtains avenCEO takeover (A5's blast radius). This is a property
of *where the secret lives*, not a code bug.

> Recommendation: treat Sprite checkpoints/snapshots of this relay as secret-bearing
> artifacts (same handling as the seed itself); restrict who can create/restore/export
> them; and include "rotate `AVEN_SERVER_SEED` + re-share sparks" in the incident
> runbook for any suspected checkpoint or account exposure.

---

## What's solid (so the next reader doesn't re-litigate it)

- **Content E2E encryption holds against a hostile relay.** User content is sealed
  per-cell under identity DEKs the relay never receives; the relay stores ciphertext
  (`main.rs:246-259`). A compromised relay cannot read user spark content.
- **Inbound authenticity gate for *bound* rows is correct and fail-closed.**
  `verify_on_apply` rejects forged/relabeled owner-bindings and digest-mismatched
  edit-signatures before storing or forwarding (`main.rs:135-179`,
  `aven-caps/src/ownership.rs:191-215`, with tests at `ownership.rs:255-344`). A relay
  cannot silently rewrite a bound row in flight.
- **Anti-relay mutual handshake is implemented and tested.** The server attests
  `(client_nonce, server_nonce, client_did)` so an on-path relay can't complete both
  sides on the proxy-terminated wss path (`challenge.rs:145-175`, test
  `wss_relay_cannot_complete_mutual_handshake` at `:249-306`). Challenge has a 5-min
  TTL and is expiry-checked (`ws_server.rs:155`).
- **No secret material in logs.** The server logs DIDs/UUIDs (public) and never the
  seed, DEKs, or keyshares (`main.rs:226-241,249`, `aven_ceo.rs:249,407`).
- **Least-privilege runtime.** The container runs as non-root `aven` uid 10001,
  slim base, no shell tooling shipped (`Dockerfile:33-42`).
- **Secret hygiene.** `.env` (which holds `AVEN_SERVER_SEED`) is gitignored and not
  tracked; the deploy ships the seed via Sprite service env, not the image
  (`.gitignore:26-28`, `deploy-aven-node-sprite.ts:8-12,58-63`).
- **Graceful shutdown + self-heal** avoid a corrupt store becoming a crash-loop, and
  the store is a re-pullable ciphertext cache (`main.rs:261-278,356-384`).

---

## Priority

1. **A4 + A1** — close the unauthenticated path to avenCEO admin on a wiped relay
   (operator-bound first-admin), or accept-and-document the open model.
2. **A3** — quota the fail-open unbound apply path so it can't be a free sink.
3. **A5** — document the seed blast radius; decide whether transport key and avenCEO
   owner key should be separable.
4. **A2** — document and, where possible, minimize the world-readable routing/
   relationship metadata.
5. **A8 / A9** — confirm the Sprite URL auth mode (public vs authenticated) in the
   runbook, and treat checkpoints/snapshots as seed-bearing secrets.
6. **A6 / A7** — remove the contradictory `fly.toml` and dead config.

None of these require touching the crypto core; they are access-control scoping,
quota, and config-hygiene changes plus two documentation decisions.
