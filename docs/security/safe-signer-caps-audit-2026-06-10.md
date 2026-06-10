# Security audit — SAFE/Signer architecture, capability ACC, private-by-default

Date: 2026-06-10. Scope: the Signers + SAFEs identity architecture
(`libs/aven-caps`, `app/src-tauri/src/jazz/*`, `libs/aven-node/src/aven_ceo.rs`,
`libs/aven-schema/schema.manifest.json`) as merged with main's hardening line
(boards 0010–0017, audits #3/#28/#31).

## 1. Architecture under audit

- **Signer** (`did:key:z<ed25519>`): SE-backed device key — the only level with
  private key material. All signatures (edit-sigs, owner bindings, challenge
  auth, biscuit third-party blocks) anchor here.
- **SAFE** (`did:safe:<uuid>`): multi-controller identity with NO key of its
  own; types `human | aven | spark`. Authority is resolved, never signed-as.
- **Recursive stack**: `signer → humanSAFE → avenSAFE → sparkSAFE`, enforced at
  member-add (`enforce_member_type_rule`): humanSAFEs admit signers only;
  avenSAFEs admit humanSAFE DIDs only; sparkSAFEs admit avenSAFE DIDs only.
- **Capabilities**: Biscuit chains per SAFE. `owns` / `reads` / `replicate` +
  scoped `grant(did, op, prefix)` facts. `authorize()` walks `did:safe:`
  entries in BOTH `owns` and `reads`, depth-capped at 8, cycle-safe (visited
  set → deny).
- **Genesis split**: humanSAFEs are signer-rooted (`owns(signer)`); aven/spark
  SAFEs are SAFE-rooted (`owns(did:safe:<controller>)`) — the founding device's
  biscuit key still signs the chain, but authority flows through the N-hop walk.
- **DEK layer**: per-SAFE content keys, X25519-KEK wrapped per recipient
  signer (`keyshares` rows; `wrapped_dek` is ciphertext by construction).
  SAFE members receive keyshares via `safe_transitive_signers` expansion.
- **Revoke = remove + rotate**: chain rebuilt excluding the member, DEK bumped
  to v+1, re-wrapped only to `chain_still_member(new_chain, …)` holders;
  cascade rotation re-keys every downstream-controlled SAFE using overlay
  resolution (`chain_still_member_with`) against the rebuilt parent chain.
- **Remote chain resolution**: `safe_controllers` rows carry sealed COPIES of
  controller genesis chains, owned by the controlled SAFE so they sync to
  exactly its members.

## 2. Findings — this session (all FIXED in this branch)

### F1 — CRITICAL: merge dropped private-by-default sealing (regression)
The mod.rs-split merge replaced six of main's seven sealing call sites in
`caps_ipc.rs` with cleartext writes:
genesis updates in `admin_add` / `reader_add` / `replicate_add` /
`aven_ceo_add_member`; the revoke's genesis+issuer patch; the `safes` row at
`aven_ceo_claim` / `create_identity` / `create_collection_group`; the roster
cells in `ensure_aven_ceo_owner_row` / `publish_profile`.
Impact: (a) trust-root and name/profile cells would ship cleartext to blind
relays (board 0009 violation); (b) worse, the hardened hydrate REFUSES a
cleartext trust root (`require_sealed`, board 0015 / audit #31), so every SAFE
written by these paths would be evicted from the vault — total functional
break. **Fix**: all writes routed back through `update_identity_genesis` /
`seal_sensitive_in_patch` / `seal_sensitive_in_row_with_dek`; mint paths seal
under the fresh DEK before the row exists (`fresh_dek` override).

### F2 — CRITICAL: AAD name drift between rename and hardening lines
`jazz_engine.rs` auto-merged into a hybrid: `seal_cell_with_dek` and two open
paths still called the removed `identity_urn`; `aad_row_for`,
`canon_cell_plaintext`, `find_identity_oid` and the hydrate `CellCoord`s still
said `"identities"` while rows live in `"safes"`. The server
(`aven_ceo.rs`) sealed under `urn=identity:{id}, table="identities"`.
Impact: compile errors where the symbol was gone; where it compiled, seal/open
AAD mismatch ⇒ permanently unopenable trust-root cells (vault eviction), and
server-sealed avenCEO cells unreadable by devices.
**Fix**: single convention end-to-end — `urn=safe:{id}`, `table="safes"`, AAD
row coordinate = identity uuid for `safes.genesis_b64|issuer_pubkey_b64`,
object-row uuid otherwise. Server and app now byte-identical.

### F3 — HIGH: controller-chain copies were cleartext and unverified-on-read
`safe_controllers.genesis_b64|issuer_pubkey_b64` are declared "sealed at rest"
(they are trust-root inputs for the N-hop walk) but `upsert_controller_copy_row`
wrote them cleartext, and the hydrate ingest used the old soft open (no
`require_sealed`).
Impact: chain copies leak membership topology to blind relays; a relay could
also strip-and-replace a copy to feed a forged controller chain to a member
that lacks the primary row (the biscuit signature check still binds the chain
to the issuer root, but the issuer cell itself rode cleartext).
**Fix**: copies sealed under the OWNING SAFE's DEK (so exactly its members can
open them); ingest now opens with `CellCoord` + `require_sealed=true` —
cleartext-downgraded copies are refused, mirroring board 0015.

## 3. Capability ACC review (aven-caps) — held

- **N-hop authorize**: depth-bounded (8), visited-set cycle termination
  (test: cycle → deny), walks `owns`+`reads`; reader chains delegate read-only
  (test: reader grant gives read-only). Type gates are app-layer
  (`enforce_member_type_rule`) — the biscuit protocol stays type-agnostic;
  acceptable since member-add is the only admission path and it is gated.
- **Genesis split**: SAFE-rooted genesis keeps the founding signer as chain
  issuer but `owns` subject = controller `did:safe:`; no path mints authority
  without an existing controlled SAFE (`find_controlled_safe_of_type` requires
  `subject_controls_safe(vault, sid, signer)`).
- **Revoke correctness**: membership for re-wrap judged against the REBUILT
  chain, not string inequality — a revoked `did:safe:` member's transitive
  signers are cut unless independently credentialed. Cascade rotation uses
  overlay resolution so downstream judgments use the new parent chain while
  the vault still holds the old one. Keyshare-row cleanup is cooperative only
  (revoked peers keep what they already decrypted — by design, revoke is not
  retroactive).
- **Version downgrade**: `current_dek_version` is plaintext routing but
  authenticated (row digest + edit-sig, boards 0010/0013); sealing uses
  `max(claimed, max_held)` and fail-closes when the device lacks the DEK.
  Residual: a fully-controlling relay can WITHHOLD a rotation (freeze a member
  on an old version) — availability→confidentiality tradeoff inherent to a
  single untrusted relay; mitigated by P2P paths, documented in
  `current_dek_version`.
- **37/37 aven-caps tests pass** (incl. 2-hop, 3-hop spark stack, cycle,
  did:safe: roundtrip, cascade overlay, transitive signers).

## 4. Private-by-default — confirmation

Rule: a column is SEALED unless the manifest marks it `plaintext: true`, and
`plaintext` is reserved for routing metadata the sync/ACL layer must read.
Post-fix, every content write path seals before materializing
(`sensitive_plaintext_cells` is manifest-driven — adding a column defaults it
to sealed). Plaintext today, all deliberate routing:

| Table | Plaintext (routing) | Sealed |
|---|---|---|
| safes | owner, type, safe_did, username_slug, current_dek_version, created_at_ms | name, genesis_b64, issuer_pubkey_b64 |
| safe_controllers | owner, controller_did, role, added_at_ms | genesis_b64, issuer_pubkey_b64 |
| peers | owner, signer_did, kind, status, added_at_ms | account_name, device_label |
| keyshares | all (wrapped_dek is already ciphertext by construction) | — |
| messages/todos/files | owner + routing ids | all content |

## 5. Residual risks / open items (not blockers)

- **R1**: the server writes avenCEO's `name` cell plaintext (well-known
  constant network label; pre-existing on main). Low value, low risk — align
  by sealing it server-side in a follow-up.
- **R2**: routing metadata (`type`, `controller_did`, `role`, membership DIDs
  in chain blocks) reveals GRAPH SHAPE to a relay even though content is
  sealed. Inherent to relay-routable sync; revisit if topology privacy becomes
  a requirement.
- **R3**: rotation-withholding by a fully-controlling relay (see §3) — design
  limitation, mitigated by multi-path sync.
- **R4**: `delegate` / `executor` grant bundles, explicit controller picker,
  ownership transfer, chain visualization — deferred UX/feature work, no
  security impact today.
- **R5**: type labels (`human|aven|spark`) are plaintext routing and feed
  `enforce_member_type_rule`; they are covered by the row digest + edit-sig,
  so a relay cannot flip a SAFE's type without breaking verify-on-apply.
