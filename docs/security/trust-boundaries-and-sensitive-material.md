---
title: Trust boundaries & sensitive material
---

# Trust boundaries & sensitive material

Developer handoff: where secrets live, what each webview can reach, and how user-managed credentials (passwords, API keys, env vars) flow through the stack. Not a formal security audit.

## Naming (three different “vault” words)

| Term | Layer | Meaning |
| ---- | ----- | ------- |
| **`tauri-plugin-self`** | Rust | Biometric SE unlock, `device_root_secret`, Ed25519 **self-signer**, DIDs. IPC: `plugin:self\|*` |
| **`tauri-plugin-vault`** | Rust | Stronghold secrets CRUD inside `strong.hold`. IPC: `plugin:vault\|secrets_*` |
| **`peers/<slug>/vault/`** | Disk | SE blobs, `strong.hold`, `manifest.json`, `settings.json` |
| **`/vault/*`** | Frontend | Isolated child webview for secrets UI only |
| **`/settings/*`** | Frontend | Main webview — peers, prefs, identity display, share, db viewer |

**Self** = who signs. **Vault** = where user secrets are stored and edited.

---

## Mental model

```
Touch ID / Face ID
       ↓
Secure Enclave (P-256 private key — never exported)
       ↓
device_root_secret (Rust RAM only, zeroized on lock)
       ├─→ HKDF → Ed25519 self-signer (derived per call, not stored)
       ├─→ HKDF → stronghold_key → opens vault/strong.hold
       └─→ Jazz DEK unwrap / sign ops while session unlocked

Main webview (/settings, /sparks)     Vault webview (/vault/*)
  plugin:self only                       plugin:vault secrets_*
  no secret values                       no secret values in $state
```

**Rule:** If a value can be re-derived from `device_root_secret` (Ed25519 seed), it stays in **Rust memory only**. If it cannot (Stripe API key, user password), it lives in **`strong.hold`**, encrypted at rest.

---

## Where sensitive material lives

| Secret / key | Secure Enclave | Rust memory (unlocked) | Disk encrypted | Disk plain | Main webview JS | Vault webview JS |
| ------------ | -------------- | ---------------------- | -------------- | ---------- | --------------- | ---------------- |
| P-256 device private key | **Yes** — non-exportable | No | Opaque `peer-id-*.se-blob` (handle, not raw key) | `.pub` (public) | **Never** | **Never** |
| `device_root_secret` (32 B) | No | **Yes** — `SelfState`, zeroized on lock | No | No | **Never** | **Never** |
| Ed25519 signing seed | No | **Derived on demand** from root | No | No | **Never** (signatures only via IPC) | **Never** |
| Stronghold key `HKDF(root, …/stronghold/v1)` | No | **Yes** while Stronghold session open | No | No | **Never** | **Never** |
| User password / API key / env value | No | **Briefly** during `secrets_set` / `secrets_reveal`; zeroized after | **Yes** — `vault/strong.hold` | No | **Never stored**; may transit IPC once on write | Same — never in reactive state |
| Secret metadata (name, id, tags) | No | No | **Yes** — inside `strong.hold` | No | **Yes** — list UI | **Yes** — list UI |
| Spark DEKs / sealed cell bytes | No | **Yes** while Jazz shell hydrated | **Yes** — `db/storage.rocksdb` | No | **Never** raw DEKs | **No Jazz access** |
| Routing / graph metadata | No | No | Partially in RocksDB | Some columns plaintext by policy | Display via gated IPC | No |
| `manifest.json`, locale, relay prefs | No | No | No | **Yes** — non-secret | Display / edit | No |
| `NETWORK_SEED` string | No | Compile-time constant | In binary (public identifier) | — | Read-only display | Read-only if shown |

---

## Frontend surfaces

| Surface | Window / webview | Routes | Allowed IPC | Secret values in JS |
| ------- | ---------------- | ------ | ----------- | ------------------- |
| **Main** | `main` | `/settings/*`, `/sparks/*`, `/vault/*` chrome (aside + embed host), LockGate | `plugin:self\|*`, jazz, peer — **not** `plugin:vault\|*` | **Never** |
| **Vault** | `vault-embed` child in `main` | `/vault/*?vaultEmbed=1` (content only) | `plugin:vault\|secrets_*`, read-only `plugin:self\|peer_status`, `active_identity` | **Never persisted**; transient input on set only |

Navigating to `/vault/*` from main renders vault chrome in the main webview and loads secrets UI in the **`vault-embed` child** — same pattern as vibe sandbox `vibe-sb-*` embeds. Main never receives `vault:*` capabilities.

LockGate runs on **main** and calls `plugin:self\|unlock`. On lock: `plugin:self\|lock`, Stronghold save, `vault-embed` child destroyed.

---

## Attack vectors by location

| Location | What an attacker learns | Typical vectors | Mitigations |
| -------- | ------------------------- | ----------------- | ----------- |
| **Secure Enclave** | Use P-256 key only after biometrics on this device | Coerced unlock; biometric re-enrollment invalidates key | `.biometryCurrentSet`; key never leaves chip |
| **Rust memory (unlocked)** | Root, open Stronghold, DEK cache, brief plaintext during reveal | Same-process malware; memory dump; debugger | Auto-lock; zeroize buffers; no secrets in webviews |
| **`vault/strong.hold` (offline)** | Ciphertext only | Stolen disk / backup | Useless without same-device biometric unlock + SE blob |
| **`se-blob` + `strong.hold` (offline)** | Still requires live biometric | Full identity folder copy | FileVault; device lock |
| **Main webview XSS** | Call `plugin:self` if unlocked; **cannot** call `plugin:vault` | XSS in Sparks / Settings | `vault:*` denied on `main` capability; CSP |
| **Vault webview XSS** | Spam `secrets_reveal` until session lock | XSS in secrets UI only | Re-auth on reveal; rate limits; minimal vault bundle |
| **`db/storage.rocksdb` (offline)** | Ciphertext for sealed columns; possible routing plaintext | Copy DB without unlock | Column sealing; biscuit + DEK model |
| **Dev / simulator** | Plain `dev-root-secret` on disk | Dev build in production | Never ship `dev_insecure` path |

**Weakest link while unlocked:** any webview with permission to call `secrets_reveal`, plus any code in the Rust process.

**Weakest link while locked:** unsealed Jazz columns + plaintext settings (non-secret by design).

---

## Example: storing `STRIPE_SECRET_KEY`

Same *ideas* as Infisical or HashiCorp Vault (local-first, device-bound — not a cloud HCP deployment).

### Prerequisites

1. User unlocks via Touch ID → `plugin:self\|unlock` → SE derives `device_root_secret`.
2. `plugin:self` opens `peers/<slug>/vault/strong.hold` with  
   `stronghold_key = HKDF(device_root_secret, info="{NETWORK_SEED}/stronghold/v1")`.
3. User opens **Vault** from main nav (`/vault/secrets`). The `vault-embed` child loads secrets UI; main cannot invoke `plugin:vault`.

### Store

```
Vault webview → plugin:vault|secrets_set {
  id: "stripe-live",
  name: "STRIPE_SECRET_KEY",
  value: "sk_live_...",   // one-shot IPC
  tags: ["prod", "payments"]
}

Rust (plugin:vault):
  - assert plugin:self unlocked
  - optional biometric re-prompt for write
  - encrypt into strong.hold
  - zeroize value buffer
  - return { ok: true }

Vault webview: clear input; $state holds { id, name, tags } only
```

### Reveal

```
Vault webview → plugin:vault|secrets_reveal { id: "stripe-live" }

Rust:
  - biometric re-prompt
  - decrypt from strong.hold
  - clipboard with TTL OR one-shot return
  - zeroize buffer

Vault webview: optional masked preview; never keep full string in $state
```

### Inject into child process (sandbox terminal)

Rust spawn path only — `secrets_get_for_child(id)` → inject `STRIPE_SECRET_KEY=…` into child environ. Full env blob never sent to either webview.

### Guarantees

| Guarantee | AvenOS |
| --------- | ------ |
| Values encrypted at rest | Yes — `strong.hold` |
| Values not in main app JS | Yes — capability split |
| Unlock requires biometrics (Apple prod) | Yes — SE path |
| Main UI XSS ≠ automatic secret IPC | Yes — `vault:*` denied on `main` |
| Org-wide RBAC / cloud audit / recovery | No — local-first by design |

---

## The hosted relay (aven-node) — what it can see, and who can reach it

The tables above stop at the device. The hosted **aven-node** relay (the Sprite at
`wss://<sprite>.sprites.app/sync`) is a separate trust boundary, so spell out what it
holds and what it exposes.

**avenCEO is the relay's access-control SSOT.** The relay *owns* the well-known avenCEO
control identity: it mints avenCEO's genesis and wraps the avenCEO DEK to itself, so it
**can** decrypt avenCEO and read its membership roster (admins from the biscuit chain;
members from avenCEO-keyshare `recipient_did`). All **node/server caps are enforced
against avenCEO**: connection admission (only avenCEO members get full sync; unknown DIDs
get a restricted onboarding tier), the per-identity upload quota, and rate limiting. The
`AVEN_SERVER_SEED` is therefore a crown-jewel secret — it is the avenCEO owner key, the
relay transport key, and the avenCEO-DEK unwrap key at once (see
`docs/audit/2026-06-12-aven-node-sprite-security-audit.md`, A5/A9).

**The relay is blind to user sparks.** Every *user* identity's content is sealed under
that identity's DEK, which the relay never holds; its capability chain (`genesis_b64`,
`issuer_pubkey_b64`) is sealed too. So the relay cannot decrypt user content and cannot
evaluate per-spark membership — that enforcement stays on the client
(`biscuit_resolver.rs`, fail-closed).

**What the relay (and, after admission, fellow members) can see in cleartext** — the
minimal routing/relationship metadata blind sync needs, never message content:

| Plaintext column | On table | Why it's unsealed |
| ---- | ---- | ---- |
| `owner` | identity-scoped tables | route a row to its identity's members |
| `type` | `safes` | distinguish `human` / `aven` identities for the roster |
| `recipient_did`, `wrapper_did` | `keyshares` | deliver a DEK to exactly its addressed recipient |
| `wrap_did` | `safes` | wrap the identity DEK to a SAFE's members |
| `dek_version`, `*_at_ms` | various | DEK rotation + ordering |

**Residual exposure (member-visible, not public):** the above lets a connected party
infer the membership graph (who holds keyshares for whom) and activity timing. Cap-gated
admission means this is exposed **only to avenCEO members**, not the public internet — a
non-member cannot open `/sync`. Tightening the member-visible graph further (e.g. salted
routing tags for `recipient_did`) is tracked as follow-on work; until then, treat the
member-visible metadata graph as a known, accepted residual.

**Public surface:** exactly one ingress — the Sprite public URL → port 8080 (`/sync` +
`/health`). `/health` returns only `ok`. Nothing else on the machine is reachable.

---

## Related docs

- [Vault plugin architecture](../vault/developers/01-architecture.md)
- [Storage layout (self plugin)](../self/developers/05-storage-and-state.md)
- [Private-by-default threat model](threat-model-private-default.md)
- [Root derivation](../self/developers/04-root-derivation.md)
