# Identity Architecture: Signers + SAFEs
## Execution Plan — `did:key` + `did:safe`

---

## Canonical Terminology

| Term | DID | Private key? |
|---|---|---|
| **Signer** | `did:key:z<ed25519>` | ✅ SE-backed device key |
| **SAFE** | `did:safe:<uuid>` | ❌ controlled by signers or other SAFEs |

SAFEs have a `type` column with type-safe labels: `human` | `aven` | `spark` | ...

---

## The Stack

```
did:key:z<ed25519>              Signer
       │ N signers control
       ▼
did:safe:<uuid>  type=human     humanSAFE
       │ N humanSAFEs control
       ▼
did:safe:<uuid>  type=aven      avenSAFE
       │ N avenSAFEs control
       ▼
did:safe:<uuid>  type=spark     sparkSAFE
```

The chain is recursive and uniform. The `type` label enforces application-layer constraints on which DID kinds are valid controllers. The biscuit protocol is identical at every SAFE level.

---

## Current State (Audit)

| | Today |
|---|---|
| Table | `identities` — types `"human"` and `"aven"` only |
| Ownership | `owns(vault.signer_did, "identity:<id>")` — signer IS the SAFE, no separation |
| Delegation | `attenuate_add_owner_third_party()` — accepts `signer_did` (signers) only |
| Authorization | `authorize()` — single hop, `signer_did` → resource |
| Resource prefix | `"identity:<uuid>:"` throughout |
| SAFE DID | Does not exist — only `did:key:` (signer-level) DIDs |
| Spark type | Does not exist |

---

## Target Schema

### `safes` (renamed from `identities`)

```json
{
  "owner":               "uuid",    // routing — unchanged
  "type":                "text",    // type-safe label: "human" | "aven" | "spark" | ...
  "safe_did":            "text",    // NEW — "did:safe:<uuid>", plaintext routing column
  "username_slug":       "text",    // null for aven/spark
  "name":                "sealed",
  "issuer_pubkey_b64":   "sealed",  // founding controller's signer key (genesis authority)
  "genesis_b64":         "sealed",  // biscuit rooted at founding controller's key
  "current_dek_version": "bigint"
}
```

### `safe_controllers` (new table)

```json
{
  "safe_id":        "uuid",    // the SAFE being controlled
  "controller_did": "text",    // did:key:z... OR did:safe:<uuid>
  "role":           "text",    // "owner" | "delegate" | "executor" | "reader"
  "added_at_ms":    "bigint"
}
```

### Roles

| Role | Caps | Notes |
|---|---|---|
| `owner` | read, write, delete, admit, rotate_dek | Full admin |
| `delegate` | read, write, admit | Can act and admit, no DEK rotation |
| `executor` | scoped write | avenSAFE operational access (tasks, messages) |
| `reader` | read | Observer / audit |

Roles expand to `grant(did, op, prefix)` biscuit facts at mint time — no new verification logic needed.

---

## Target Code (`caps.rs`)

### Constants

```rust
pub const SAFE_DID_PREFIX: &str      = "did:safe:";
pub const SAFE_RESOURCE_PREFIX: &str = "safe:";
```

### Helpers

```rust
pub fn safe_did(id: Uuid) -> String           // "did:safe:<uuid>"
pub fn safe_resource(id: Uuid) -> String      // "safe:<uuid>:"
pub fn resolve_safe_did(did: &str) -> Option<Uuid>
```

### Biscuit resource strings

```
"identity:<uuid>:"  →  "safe:<uuid>:"   (everywhere)
```

### Genesis split

**Signer-rooted** (humanSAFE):
```rust
owns(signer_did, "safe:<id>")
right("read",  "safe:<id>:")
right("write", "safe:<id>:")
...
```

**SAFE-rooted** (avenSAFE / sparkSAFE):
```rust
owns(safe_did, "safe:<id>")
grant(founding_signer_did, "write", "safe:<id>:tasks:")  // executor only
```

### N-hop `authorize()`

```
authorize(signer_did, op, safe_X)
  → is signer_did a direct controller of safe_X?      (1 hop — existing path)
  → or: signer_did controls safe_Y controls safe_X?   (2 hops)
  → or: ... up to depth 8 (existing group limit)
```

- `did:key:` → check directly against SAFE biscuit (existing path, unchanged)
- `did:safe:` in biscuit → resolve controllers, recurse to `did:key:` anchor
- Enforce max depth 8 (same as current group inheritance, `caps.rs:590`)

### `attenuate_add_owner_third_party()`

Extended to accept `did:safe:` alongside `did:key:` as the `new_signer_did` argument.

---

## Recovery Model

| Scenario | Outcome |
|---|---|
| One signer (device) lost | Other signers of that humanSAFE still work |
| humanSAFE fully lost | Other humanSAFE admins of the avenSAFE still work |
| avenSAFE fully lost | Other avenSAFE admins of the sparkSAFE still work |
| One controller remains | Can add new controllers, rotate DEK, rebuild biscuit |
| All controllers lost | SAFE is unrecoverable — same as SAFE with all keyholders gone |

---

## Implementation Phases

- [x] **Phase 1 — Terminology sweep** ✅
  - Renamed `identities` → `safes` in schema, Rust code, and frontend
  - Replaced `"identity:<uuid>:"` with `"safe:<uuid>:"` in all biscuit resource strings
  - Added `SAFE_DID_PREFIX` / `SAFE_RESOURCE_PREFIX` constants + `safe_did()` /
    `safe_resource()` / `resolve_safe_did()` helpers
  - ⚠️ Breaking: biscuits/keyshares/rows minted by pre-rename builds no longer
    validate or decrypt — dev databases need a reset

- [x] **Phase 2 — Schema** ✅
  - Added `safe_did text` column to `safes` (stamped `did:safe:<uuid>` on every create path)
  - Added `safe_controllers` table (schema only — not yet populated; the biscuit
    chain is the live source of truth for controllers)
  - `"spark"` accepted as a `type` label end-to-end (create IPC + UI)

- [x] **Phase 3 — Genesis split** ✅
  - `mint_safe_genesis(vault, id)` — signer-rooted (humanSAFE; was `mint_genesis_identity`)
  - `mint_safe_genesis_with_controller(vault, id, controller_did)` — SAFE-rooted;
    `owns(did:safe:<controller>)`, chain still anchored at the founding signer's biscuit key
  - `createIdentity` picks the variant by `type`: aven → controlled by the creator's
    humanSAFE, spark → controlled by the creator's avenSAFE (errors if none exists)

- [x] **Phase 4 — N-hop `authorize()`** ✅
  - `authorize()` walks `did:safe:` entries in the owns set: subject controls the
    controller SAFE (recursively) → inherits its authority on this SAFE
  - `subject_controls_safe(vault, safe_id, did)` — public transitive-controller check
  - Bounded by the same `MAX_GROUP_DEPTH = 8`; controller cycles terminate as deny
  - Resolution is purely from loaded `vault.safes` biscuits (offline); cross-device
    controller-chain distribution rides on Phase 5
  - **Type enforcement at member-add** (application gate, `enforce_member_type_rule`):
    humanSAFE admits signers only · avenSAFE admits humanSAFE DIDs only ·
    sparkSAFE admits avenSAFE DIDs only · replicate grants are signer-only

- [ ] **Phase 5 — DEK propagation** (NEXT)
  - A SAFE member has no pubkey — its **signers** need the keyshares. On adding a
    `did:safe:` member: enumerate the controller SAFE's (transitive) signers and wrap
    the DEK to each
  - Distribute the controller SAFE's `safes` row (genesis) alongside, so members can
    resolve the chain for verify-on-apply (today resolution is vault-local only)
  - On `rotate_dek`: re-wrap for all current controllers' signers, exclude revoked
  - Auto-propagate: when signer added to humanSAFE, propagate keyshares to controlled avenSAFEs

- [ ] **Phase 6 — UI / Onboarding**
  - "Create humanSAFE" — select signers, assign roles
  - "Create avenSAFE" — select humanSAFE controllers, assign roles
  - "Create sparkSAFE" — select avenSAFE controllers, assign roles
  - Controller management: add controller, remove controller, change role, transfer ownership
  - SAFE detail: show full controller chain + controlled SAFEs list

- [ ] **Phase 7 — Member management UI (legacy identities screens → SAFEs)**
  - Rename the legacy "identities" screens to SAFEs end-to-end (routes, labels, i18n)
  - Replace "add members" (today: raw signer DIDs only) with **SAFE-in-SAFE delegation**:
    - On an **avenSAFE**: add member = pick a **humanSAFE `did:safe:`** (not a signer DID)
    - On a **sparkSAFE**: add member = pick an **avenSAFE `did:safe:`**
  - Add a third category row **Sparks** to the SAFE list/picker — three rows total:
    | Row | Lists | Members are |
    |---|---|---|
    | Humans | humanSAFEs | signers |
    | Avens | avenSAFEs | humanSAFE DIDs |
    | Sparks | sparkSAFEs | avenSAFE DIDs |
  - Member picker filters candidates by the target SAFE's type label (recursive ACC caps delegation)
  - Role selector per added member (`owner` / `delegate` / `executor` / `reader`)

---

## avenCEO (node sync server) — Interim Simplification

The node sync server currently runs the network-control identity **avenCEO** (deterministic
v5 UUID from the network seed, `aven_ceo_identity()`), today typed as an aven.

**Interim decision:** retype avenCEO as a **`human`-type SAFE** (name stays "avenCEO").

- humanSAFEs keep the **direct signer caps path** (signer-rooted genesis, 1-hop authorize) —
  exactly what the node uses today, so nothing in the sync/roster flow changes
- Avoids making the network-control identity depend on N-hop SAFE-rooted authorization
  before Phase 4 lands
- The **admin claim logic** (who may claim/control avenCEO, claim-once semantics, possible
  later move to a SAFE-rooted model) is explicitly **deferred** — revisit after Phases 3–4

---

## What Does NOT Change

| Component | Status |
|---|---|
| Signer key derivation (SE → root → Ed25519) | Unchanged |
| `OwnerBinding` and `EditSignature` in `ownership.rs` | Unchanged |
| `rebuild_identity_biscuit_excluding()` | Resource prefix string update only |
| `replicate` / SYNC peer model | Unchanged |
| DEK / KEK / keyshare derivation in `crypto.rs` | Unchanged |

---

## Open Questions

1. **Type label constraints** — enforce at schema level that avenSAFE controllers must resolve to humanSAFEs? Suggest: yes, application-layer check on `safe_controllers.controller_did` resolved `type`.
2. **Cross-level control** — humanSAFE directly controlling a sparkSAFE (skipping avenSAFE)? Suggest: allowed by protocol, blocked by application validation.
3. **DEK chain auto-propagation** — new signer added to humanSAFE that controls avenSAFEs: do avenSAFE keyshares auto-propagate? Suggest: yes, triggered by `admit` op.
4. **`did:safe:` offline resolution** — must resolve from local `safes` table with no network call.

---

## References

- `libs/aven-caps/src/caps.rs` — biscuit genesis, delegation, N-hop group chain (depth=8)
- `libs/aven-caps/src/ownership.rs` — OwnerBinding, EditSignature
- `libs/aven-caps/src/crypto.rs` — DEK, KEK, keyshare derivation
- `libs/aven-schema/schema.manifest.json` — identities (→ safes), keyshares, peers
- `docs/self/developers/06-ed25519-derivation.md` — signer key derivation pipeline
- `docs/sparks/developers/04-grant-flow.md` — delegation flow
- [GitHub Issue #12](https://github.com/MyAvenCEO/avenOS/issues/12)
