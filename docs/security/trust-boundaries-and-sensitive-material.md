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
| **`identities/<slug>/vault/`** | Disk | SE blobs, `strong.hold`, `manifest.json`, `settings.json` |
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

| Surface | Window | Routes | Allowed IPC | Secret values in JS |
| ------- | ------ | ------ | ----------- | ------------------- |
| **Main** | `main` | `/settings/*`, `/sparks/*`, LockGate | `plugin:self\|*`, jazz, peer — **not** `plugin:vault\|*` | **Never** |
| **Vault** | `vault` | `/vault/*` entire subtree | `plugin:vault\|secrets_*`, read-only `plugin:self\|peer_status`, `active_identity` | **Never persisted**; transient input on set only |

Navigating to `/vault/*` from main **opens/focuses the vault child window** — vault routes do not render inside main (capability isolation).

LockGate runs on **main** and calls `plugin:self\|unlock`. On lock: `plugin:self\|lock`, Stronghold save, vault window closed.

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
2. `plugin:self` opens `identities/<slug>/vault/strong.hold` with  
   `stronghold_key = HKDF(device_root_secret, info="{NETWORK_SEED}/stronghold/v1")`.
3. User opens **Vault** window (`/vault/secrets`). Main window cannot invoke `plugin:vault`.

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

## Related docs

- [Vault plugin architecture](../vault/developers/01-architecture.md)
- [Storage layout (self plugin)](../self/developers/05-storage-and-state.md)
- [Private-by-default threat model](threat-model-private-default.md)
- [Root derivation](../self/developers/04-root-derivation.md)
