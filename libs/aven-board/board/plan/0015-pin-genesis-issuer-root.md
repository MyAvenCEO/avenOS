---
title: Pin the genesis/issuer biscuit trust root; reject cleartext downgrade
summary: Pin the genesis verification root to the deterministic identity UUID, reject non-v1 genesis/issuer cells (no cleartext passthrough), and verify recovered cell AAD names the exact identities coordinate before trusting bytes as a biscuit trust root.
owner: Claude Code
created: 2026-06-08
updated: 2026-06-08
tags: [aven-caps, app, security, authz]
goal: cargo test -p aven-caps passes AND a new regression test genesis_issuer_root_downgrade_and_swap_rejected proves (a) a non-v1 (envelope-stripped) issuer/genesis cell is refused instead of passed through as cleartext, (b) an issuer pubkey not pinned to the identity UUID is rejected, and (c) a same-identity cross-cell AAD swap into the genesis/issuer coordinate fails to open — proven by `cargo test -p aven-caps genesis_issuer_root_downgrade_and_swap_rejected` exiting 0 and `cargo build -p app` exiting 0.
---

# Pin the genesis/issuer biscuit trust root; reject cleartext downgrade

## Context

During hydration, the per-identity genesis biscuit and its verification root
(`issuer_pubkey_b64`) are recovered from the relay-controlled `identities` row
and fed straight into the biscuit trust root with no pinning, no plaintext-downgrade
guard, and no coordinate (AAD) check. This is confirmed crypto-audit finding **#31**
(`docs/security/crypto-audit-2026-06-08.md`, High, capability-authz, 2 confirm / 1 refute).

**Precise evidence (carried over so this doc stands alone):**

- `app/src-tauri/src/jazz/jazz_engine.rs:110-133` — `open_sealed_text_for_identity`.
  Line 115-116 is a cleartext passthrough:
  `if !raw.starts_with(CELL_ENVELOPE_V1) { return Ok(raw.to_string()); }`.
  A relay that strips the `v1` envelope makes the genesis/issuer cell be read as
  unauthenticated plaintext (downgrade). For `v1` values it trial-decrypts across
  every DEK version of the identity and **never** checks that the recovered cell AAD
  names this identity's `identities.genesis_b64` / `identities.issuer_pubkey_b64`
  coordinate, so a same-identity cross-cell swap (the AAD finding) reaches the
  biscuit root selection.
- `app/src-tauri/src/jazz/jazz_engine.rs:663-692` — hydrate ingest. `genesis_b64`
  (line 663) and `issuer_opened` (line 673-685) are recovered via `hydrate_text_at`
  → `open_sealed_text_for_identity`, then handed to `ingest_genesis_opened`
  (line 686-692) together with the local fallback root `biscuit_root_pub`.
- `libs/aven-caps/src/caps.rs:525-545` — `ingest_genesis_opened`. Line 532-535:
  `let issuer_pk = match issuer_pubkey_b64 { Some(s) if !s.trim().is_empty() => decode_issuer_pubkey_b64(s)?, _ => local_fallback_issuer_pk };`
  Then line 536: `let biscuit = biscuit_from_storage(genesis_b64, issuer_pk)?;` —
  the verification ROOT is whatever bytes were opened, with **no binding to
  `owner: Uuid`**.
- `libs/aven-caps/src/caps.rs:563-569` — `biscuit_from_storage` calls
  `Biscuit::from(raw, root)` against that attacker-suppliable root.
- `libs/aven-caps/src/caps.rs:223-233` — `decode_issuer_pubkey_b64` decodes any
  Ed25519 pubkey bytes; it does not (and cannot, alone) know which UUID the root
  must belong to.

**Attack scenario.** A relay that controls the `identities` row sets
`issuer_pubkey_b64` and `genesis_b64` to a chain rooted in the attacker's own key
(or strips the envelope to plant plaintext). `open_sealed_text_for_identity`
returns the attacker bytes — via the cleartext passthrough at line 116, or via
same-identity cross-cell AAD confusion. `ingest_genesis_opened` decodes the
attacker pubkey and `biscuit_from_storage` validates the attacker chain against
the attacker root — verification "passes". The vault now holds an identity biscuit
whose owners/admins are attacker-chosen, escalating every `authorize()` /
`identity_peer_is_owner` decision. The only backstop today is the apply-gate having
rejected the tampered `identities` row earlier, but per the digest-discard finding
the `identities` `data` is not signature-bound on the wire.

**Constraints / cross-links.**

- This item **depends on 0011 (reader-authoritative AAD)** for the coordinate check:
  the reader must recompute the expected AAD (`cell_seal_aad(urn, "identities",
  "genesis_b64"|"issuer_pubkey_b64", row, dek_version, ty_slug)`,
  `libs/aven-caps/src/crypto.rs:251-265`) and refuse to trust a payload whose
  embedded AAD does not match that exact coordinate. The plaintext-downgrade and
  root-pinning guards in this item are the genesis-specific application of 0011's
  reader-authoritative rule plus a new trust-root pin. If 0011 lands first, reuse
  its AAD-equality helper here; if this lands first, introduce a local
  `verify_cell_aad_coordinate` and let 0011 generalize it.
- The AAD plaintext format (`{identity_urn}|{table}|{column}|{row}|{dek_version}|ty:{slug}|msv:{msv}`)
  is built by `cell_seal_aad` and embedded base64 in the `v1.<nonce>.<aad>.<ct>`
  envelope; `open_text_cell_payload` (`libs/aven-caps/src/crypto.rs:193-...`)
  decrypts using the *embedded* AAD and never asserts it equals the expected
  coordinate — that is the gap.

## Goal

When done, hydration refuses to seat an identity biscuit whose genesis/issuer
cell was downgraded to cleartext, whose AAD names a different coordinate, or whose
issuer pubkey is not pinned to the deterministic identity UUID — instead of silently
trusting attacker-chosen bytes as the biscuit verification root.

**Completion condition** (identical to frontmatter goal):
> `cargo test -p aven-caps passes AND a new regression test genesis_issuer_root_downgrade_and_swap_rejected proves (a) a non-v1 (envelope-stripped) issuer/genesis cell is refused instead of passed through as cleartext, (b) an issuer pubkey not pinned to the identity UUID is rejected, and (c) a same-identity cross-cell AAD swap into the genesis/issuer coordinate fails to open — proven by `cargo test -p aven-caps genesis_issuer_root_downgrade_and_swap_rejected` exiting 0 and `cargo build -p app` exiting 0.`

## Approach

Three layered guards, with the trust-root pin and the coordinate check pushed down
into `aven-caps` (testable, `cargo test`-green) and the cleartext-downgrade refusal
applied at the hydrate read path in `app`.

1. **Reject non-`v1` genesis/issuer cells (no cleartext passthrough).** Replace the
   unconditional `open_sealed_text_for_identity` passthrough *for the genesis/issuer
   coordinate specifically* with a strict opener that requires the `v1` envelope and
   returns `Err` when the prefix is absent. Do not change the generic passthrough
   for ordinary display cells in this item (out of scope, and some columns are
   legitimately cleartext); introduce a dedicated `open_required_sealed_cell` (or a
   `require_sealed: bool` flag) used only on the `genesis_b64` / `issuer_pubkey_b64`
   reads at `jazz_engine.rs:663,674`.

2. **Verify the recovered AAD names the exact coordinate.** After a successful
   `v1` decrypt, recompute the expected AAD for
   `(identity_urn, "identities", "genesis_b64" | "issuer_pubkey_b64", row, dek_version, ty_slug)`
   via `cell_seal_aad` and constant-time-compare it against the envelope's embedded
   AAD. This requires the reader to know the *row* uuid and the *dek_version* used —
   both are available at the hydrate call site (the `identities` row id and the
   per-version DEK loop). Refuse on mismatch. This is the 0011 reader-authoritative
   rule applied to the trust-root inputs; cross-link 0011.

3. **Pin the issuer/root to the deterministic identity UUID.** In
   `ingest_genesis_opened`, stop blindly trusting the opened `issuer_pubkey_b64` as
   the root. Add a pin: derive/expect the root from a higher-trust committed value
   keyed by `owner: Uuid` (the deterministic identity UUID), and reject when the
   opened issuer pubkey does not match the pinned root for that UUID. Concretely,
   add a `pinned_issuer_for(owner: Uuid) -> Option<PublicKey>` source (the local
   committed root / bootstrap anchor, NOT the self-describing row column) and require
   `decode_issuer_pubkey_b64(opened) == pinned` before calling `biscuit_from_storage`;
   if no pin exists, fall back to `local_fallback_issuer_pk` (the current safe
   default) rather than the row-supplied value. The row's `issuer_pubkey_b64` is thus
   demoted from "trust root" to "must equal the pinned root" — a relay can no longer
   inject its own root.

**Shape of change.** `ingest_genesis_opened` (`caps.rs:525-545`) gains a pinned-root
parameter and a strict equality gate; a new pure helper
`verify_cell_aad_coordinate(envelope, expected_aad) -> Result<(), String>` lands in
`aven-caps/crypto.rs` next to `open_text_cell_payload`. The hydrate path in
`jazz_engine.rs` switches the two genesis/issuer reads to the strict opener and
threads the row uuid + dek_version into the AAD check.

**Trade-offs / out of scope.** This does NOT fix the underlying unauthenticated-`data`
wire channel (the digest-discard / `EditSignature`-not-wired finding) — that is the
apply-gate item and is the real root cause; this item is the defense-in-depth read-side
pin so a tampered row cannot mint an attacker-rooted identity even if it slips past the
gate. It also does not change the generic cleartext passthrough for ordinary display
columns. Migration: existing legitimately-sealed `v1` cells already carry the correct
AAD, so the coordinate check is a no-op for honest data; the cleartext refusal only bites
genesis/issuer cells that were never supposed to be cleartext.

## Steps

1. Add `verify_cell_aad_coordinate(envelope: &str, expected_aad: &[u8]) -> Result<(), String>`
   in `libs/aven-caps/src/crypto.rs` (parse the `v1.<nonce>.<aad>.<ct>` envelope, decode
   the embedded AAD, constant-time compare against `expected_aad`, `Err("cell_aad_mismatch")`
   on mismatch). Unit-test it alongside the existing `cell_seal_aad` tests.
2. Add a strict opener variant for the genesis/issuer reads (e.g.
   `open_required_sealed_cell` in `jazz_engine.rs`, or a `require_sealed` flag on
   `open_sealed_text_for_identity`) that returns `Err("genesis_cleartext_downgrade")`
   when `raw` does not start with `CELL_ENVELOPE_V1`, and on success returns both the
   plaintext and the `dek_version` that opened it.
3. Wire the AAD check into the genesis/issuer reads at `jazz_engine.rs:663` and `:674`:
   recompute the expected AAD with `cell_seal_aad(&identity_urn, "identities",
   "genesis_b64" | "issuer_pubkey_b64", row_uuid, dek_version, ty_slug)` and call
   `verify_cell_aad_coordinate` before trusting the bytes. Thread the `identities` row
   uuid through to the call site (it is already iterated in `sparks_rows`).
4. Extend `ingest_genesis_opened` (`caps.rs:525`) with a pinned issuer source: add a
   `pinned_issuer_pk: Option<PublicKey>` param (resolved by `owner: Uuid`), and require
   the opened `issuer_pubkey_b64` to equal the pin (constant-time) before calling
   `biscuit_from_storage`; otherwise fall back to `local_fallback_issuer_pk`, never to
   the row-supplied root. Update the single call site in `jazz_engine.rs:686-692`.
5. Add the regression test `genesis_issuer_root_downgrade_and_swap_rejected` in
   `libs/aven-caps/src/` (crypto.rs and/or caps.rs `#[cfg(test)]`) with three asserts:
   (a) feeding an envelope-stripped (cleartext) issuer/genesis value to the strict
   opener returns `Err`; (b) `ingest_genesis_opened` with an opened issuer pubkey that
   does not match the pinned root for the UUID returns `Err` (and does NOT seat a
   biscuit); (c) an envelope whose embedded AAD names a different coordinate (e.g.
   table `"messages"` or a different row uuid) fails `verify_cell_aad_coordinate`.
6. `cargo build -p app` and `cargo test -p aven-caps` to prove green; record outputs in
   the progress log.

## Files to touch

- `libs/aven-caps/src/crypto.rs` — add `verify_cell_aad_coordinate` next to
  `open_text_cell_payload`/`cell_seal_aad`; add its unit coverage.
- `libs/aven-caps/src/caps.rs` — `ingest_genesis_opened` (~525-545): add the
  pinned-issuer param + constant-time equality gate; demote the row column from "root"
  to "must equal pin". Add the `genesis_issuer_root_downgrade_and_swap_rejected` test
  (or place it in crypto.rs).
- `app/src-tauri/src/jazz/jazz_engine.rs` — `open_sealed_text_for_identity` (~110-133):
  strict opener for genesis/issuer; hydrate ingest (~663-692): recompute + verify the
  AAD coordinate, thread row uuid + dek_version, pass the pinned issuer into
  `ingest_genesis_opened`.

## Acceptance criteria

- [ ] A non-`v1` (envelope-stripped) issuer/genesis cell is refused with an error
  (no cleartext passthrough) — proven by `cargo test -p aven-caps genesis_issuer_root_downgrade_and_swap_rejected`.
- [ ] An issuer pubkey not pinned to the identity UUID is rejected and no biscuit is
  seated — proven by `cargo test -p aven-caps genesis_issuer_root_downgrade_and_swap_rejected`.
- [ ] A same-identity cross-cell AAD swap into the genesis/issuer coordinate fails the
  AAD-coordinate check — proven by `cargo test -p aven-caps genesis_issuer_root_downgrade_and_swap_rejected`.
- [ ] The whole aven-caps suite stays green — proven by `cargo test -p aven-caps`.
- [ ] The app crate still builds with the new hydrate wiring — proven by `cargo build -p app`.

## Verification

```bash
# 1. New regression test proves all three attack vectors are blocked (exit 0)
cargo test -p aven-caps genesis_issuer_root_downgrade_and_swap_rejected

# 2. Full aven-caps suite stays green (known-green baseline; exit 0)
cargo test -p aven-caps

# 3. App crate compiles with the new strict-opener + AAD-coordinate + pinned-root wiring (exit 0)
cargo build -p app
```

## Hand-off

```
/board-goal 0015-pin-genesis-issuer-root
```

## Progress log

Newest first.
- `2026-06-08` — Planned from crypto audit (docs/security/crypto-audit-2026-06-08.md, finding #31). Grounded Approach/Steps in real code: `open_sealed_text_for_identity` cleartext passthrough at jazz_engine.rs:115-116, hydrate ingest at :663-692, `ingest_genesis_opened`/`decode_issuer_pubkey_b64`/`biscuit_from_storage` at caps.rs:223-233,525-545,563-569, AAD format from `cell_seal_aad` at crypto.rs:251-265. Depends on 0011 (reader-authoritative AAD) for the coordinate check. Created in plan.
