---
title: Reject low-order / all-zero X25519 shared secret in KEK derivation
summary: After the static-static X25519 ECDH in derive_kek_x25519, constant-time reject an all-zero (low-order point) shared secret before feeding it into HKDF, so a malicious peer cannot force a predictable KEK with a crafted low-order Ed25519 key.
owner: Claude Code
created: 2026-06-08
updated: 2026-06-08
tags: [aven-caps, security, crypto]
goal: cargo test -p aven-caps passes AND a new regression test derive_kek_rejects_low_order_shared_secret proves derive_kek_x25519 returns Err("low_order_dh") (instead of a usable KEK) when the peer Ed25519 key decompresses to a low-order Montgomery point that forces an all-zero ECDH output — proven by `cargo test -p aven-caps derive_kek_rejects_low_order_shared_secret` exiting 0 and `cargo build -p aven-caps` exiting 0.
---

# Reject low-order / all-zero X25519 shared secret in KEK derivation

## Context

`derive_kek_x25519` performs a static-static X25519 `diffie_hellman` and feeds the
raw output **straight** into `hkdf_kek` with no contributory-behaviour / all-zero /
low-order point check. `x25519-dalek`'s `StaticSecret::diffie_hellman` does NOT
return an error or flag when the peer public point is of small order — it silently
returns the (possibly all-zero) shared secret. The peer Ed25519 public key is
converted to Montgomery form via `ed25519_pk_to_curve25519_pk`, which decompresses
ANY valid Edwards point and calls `to_montgomery()`; small-order Edwards points
(and points whose Montgomery image is a known low-order u-coordinate) decompress
fine with no torsion/order filtering. This is confirmed crypto-audit finding **#1**
(`docs/security/crypto-audit-2026-06-08.md`, Medium, aven-caps/crypto).

**Attack (carried over so this doc stands alone):** under the threat model's
"malicious PEER that holds a valid identity", a peer registers/advertises an Ed25519
public key that decompresses to a low-order Montgomery point. When this device wraps
a DEK to that peer via `derive_kek_x25519(my_ed_sk, attacker_pk) -> hkdf_kek`, the
ECDH output is a fixed low-order value (e.g. all zeros) **independent of my secret**.
The KEK = `HKDF-SHA256(empty-salt, all-zero, KEYSHARE_INFO)` is then a constant the
attacker can compute offline. Combined with the relay-tamperable `wrapper_did`
selection in the hydrate path, this hands an attacker a predictable KEK to either
forge or trivially unwrap a keyshare without performing real ECDH — breaking the
confidentiality the keyshare envelope is supposed to provide.

**Precise file:line evidence:**

- `libs/aven-caps/src/crypto.rs:79-80` —
  `let shared = my_x25519.diffie_hellman(&XPub::from(peer_montgomery));`
  `Ok(hkdf_kek(shared.as_bytes()))` — the result of `diffie_hellman` is passed
  straight to HKDF with **no** check that `shared.as_bytes()` is non-zero / that
  `peer_montgomery` is not low-order.
- `libs/aven-caps/src/crypto.rs:59-63` — `ed25519_pk_to_curve25519_pk` decompresses
  any peer key (`y.decompress()?`) and returns `pt.to_montgomery().to_bytes()` with
  no torsion/order filtering — so a low-order peer point reaches the ECDH.

**Honest "belt-and-suspenders" note (per the audit summary line ~41):** the audit's
summary credits recent hardening for "low-order/all-zero key rejection" landing
elsewhere, but a direct read of `crypto.rs` and `git log -- libs/aven-caps/src/crypto.rs`
(latest touching commit `4797d8f`, no low-order guard) confirms **no such guard
exists on the `derive_kek_x25519` ECDH path today** — `shared.as_bytes()` flows
unguarded into `hkdf_kek`. So #1 is a real residual, not a no-op: this item ADDS the
explicit all-zero `ct_eq` guard plus a regression test. If a future read finds a
guard already merged, this item degrades to confirming that an explicit all-zero
`ct_eq` guard plus a passing regression test exist (do not remove an existing guard;
keep/strengthen it and ensure the named test is present and green).

Related items: complements **0011** (reader-authoritative cell AAD) and **0015**
(pin genesis/issuer trust root) — all three close relay/peer-tamperable inputs into
the keyshare/biscuit crypto. This item is independent of 0011/0015 and touches only
`libs/aven-caps/src/crypto.rs`.

## Goal

After the X25519 ECDH in `derive_kek_x25519`, the all-zero (low-order point) shared
secret is rejected in constant time with `Err("low_order_dh")` before any KEK is
derived, and a regression test proves a crafted low-order peer key can no longer
yield a usable KEK.

**Completion condition** (identical to frontmatter goal):
> `cargo test -p aven-caps passes AND a new regression test derive_kek_rejects_low_order_shared_secret proves derive_kek_x25519 returns Err("low_order_dh") (instead of a usable KEK) when the peer Ed25519 key decompresses to a low-order Montgomery point that forces an all-zero ECDH output — proven by `cargo test -p aven-caps derive_kek_rejects_low_order_shared_secret` exiting 0 and `cargo build -p aven-caps` exiting 0.`

## Approach

Single-file change in `libs/aven-caps/src/crypto.rs`. In `derive_kek_x25519`, after
the `diffie_hellman` call and before `hkdf_kek`, constant-time compare the shared
secret bytes against `[0u8; 32]` and return `Err("low_order_dh".to_string())` on a
match. Use the `subtle` crate's `ConstantTimeEq` (`shared.as_bytes().ct_eq(&[0u8; 32])`)
so the rejection branch does not leak timing about the secret. The all-zero shared
secret is the canonical witness of every small-order/low-order peer point under
RFC 7748 X25519 (clamped scalar × small-order point ⇒ identity ⇒ all-zero output),
so the all-zero `ct_eq` check is sufficient to block the attack class for the
contributory property; we choose it over `was_contributory()` because `was_contributory`
is gated behind a non-default `x25519-dalek` feature, whereas the all-zero `ct_eq`
check needs no new x25519-dalek feature and is the exact mitigation the audit names.

`subtle` is already in the dalek dependency tree but is not a direct dependency of
`aven-caps`; add `subtle = "2"` to `[dependencies]` in `libs/aven-caps/Cargo.toml`
so the import is explicit and version-pinned (matching the curve25519/x25519-dalek v4/v2
line, which both depend on `subtle` 2.x).

The regression test forges a peer Ed25519 public key whose Montgomery image is the
canonical low-order point that yields an all-zero ECDH. The torsion point of order 8
on Ed25519 with Montgomery u-coordinate 0 is the compressed Edwards Y =
`0x0000…0000` (all zeros), i.e. `CompressedEdwardsY([0u8; 32])` decompresses to a
valid small-order point whose `to_montgomery()` is `[0u8; 32]`; an X25519 ECDH against
u=0 returns the all-zero shared secret. The test calls
`derive_kek_x25519(&any_signing_key, &[0u8; 32])` and asserts it returns
`Err("low_order_dh")` rather than `Ok(_)`. (Sanity-guard the test: first assert
`ed25519_pk_to_curve25519_pk(&[0u8; 32])` is `Some([0u8; 32])` so the test fails
loudly if a future dalek bump changes decompression behaviour, rather than passing
vacuously.)

**Trade-offs / out of scope:** we do not enumerate the full known-low-order
u-coordinate blocklist (e.g. the 12 RFC 7748 low-order points) — the all-zero
shared-secret check after ECDH catches all of them by construction, which is simpler
and keeps the rejection at the point where it matters (the derived secret) rather than
on the input encoding. We do not switch to `was_contributory()` (feature-gated). We
do not change `ed25519_pk_to_curve25519_pk`'s signature or callers. No other crates
change.

## Steps

1. Add `subtle = "2"` to `[dependencies]` in `libs/aven-caps/Cargo.toml`.
2. In `libs/aven-caps/src/crypto.rs`, add `use subtle::ConstantTimeEq;` to the
   imports.
3. In `derive_kek_x25519` (currently lines 72-81), between the `diffie_hellman` call
   and the `hkdf_kek` call, insert:
   ```rust
   let shared = my_x25519.diffie_hellman(&XPub::from(peer_montgomery));
   if bool::from(shared.as_bytes().ct_eq(&[0u8; 32])) {
       return Err("low_order_dh".to_string());
   }
   Ok(hkdf_kek(shared.as_bytes()))
   ```
4. Add a regression test `derive_kek_rejects_low_order_shared_secret` to the `tests`
   module in `crypto.rs`:
   - import `ed25519_pk_to_curve25519_pk` into the test `use super::{…}` list;
   - assert `ed25519_pk_to_curve25519_pk(&[0u8; 32]) == Some([0u8; 32])` (decompresses
     to the u=0 low-order point — loud sanity guard);
   - `let me = SigningKey::from_bytes(&[5u8; 32]);`
   - assert `derive_kek_x25519(&me, &[0u8; 32])` is `Err` and the error string is
     `"low_order_dh"`;
   - (positive control) assert `derive_kek_x25519(&me, &SigningKey::from_bytes(&[9u8; 32]).verifying_key().to_bytes())`
     is `Ok` — a normal peer key still derives a KEK.
5. Build and test (see Verification). If `cargo build` reports the all-zero peer key
   no longer decompresses to `Some([0u8;32])` on a future dalek version, adjust the
   forged low-order witness to another known small-order point whose ECDH is all-zero
   (the all-zero shared-secret guard itself stays unchanged).

## Files to touch

- `libs/aven-caps/Cargo.toml` — add `subtle = "2"` as a direct dependency (explicit,
  version-pinned constant-time compare).
- `libs/aven-caps/src/crypto.rs` — add `use subtle::ConstantTimeEq;`; insert the
  all-zero `ct_eq` rejection in `derive_kek_x25519` (lines 72-81); add the
  `derive_kek_rejects_low_order_shared_secret` regression test (and add
  `ed25519_pk_to_curve25519_pk` to the test module's `use super::{…}`).

## Acceptance criteria

- [x] `derive_kek_x25519` rejects a peer key forcing an all-zero ECDH output — proven by `cargo test derive_kek_rejects_low_order_shared_secret` (1 passed). **The guard already exists on main** (`was_contributory()` at crypto.rs:83-85), added by parallel hardening — the *stronger* form the plan anticipated. Per the plan's degradation clause this item adds the named regression test rather than a duplicate guard; no `subtle` dep was needed and the error string is `kek_non_contributory_peer_key` (the guard's own, not the planned `low_order_dh`).
- [x] A normal (high-order) peer key still derives a KEK (positive control inside the same test) — proven by the same test.
- [x] No regression in existing keyshare crypto — proven by `cargo test` in `libs/aven-caps` (33 passed).
- [x] Crate builds — proven by `cargo build` in `libs/aven-caps` (Finished). (No Cargo.toml change: `was_contributory()` is available without an extra dep.)

## Verification

```bash
# exact commands; their output is the proof /goal reads
cd /Users/samuelandert/Documents/Development/avenOS/.claude/worktrees/jolly-taussig-f2dcdd

# 1. crate builds with the new guard and subtle dependency
cargo build -p aven-caps

# 2. the new regression test proves the low-order attack is rejected
cargo test -p aven-caps derive_kek_rejects_low_order_shared_secret

# 3. full aven-caps suite stays green (no keyshare-crypto regression)
cargo test -p aven-caps
```

## Hand-off

```
/aven-build 0016-reject-low-order-x25519
```

## Progress log

Newest first.
- `2026-06-09` — **Verified + closed (ready for test column).** On re-grounding, `derive_kek_x25519` ALREADY carries the low-order guard on main — `if !shared.was_contributory() { return Err("kek_non_contributory_peer_key") }` (crypto.rs:83-85), landed by parallel crypto hardening since this was planned. `was_contributory()` is the stronger, exactly-right form (the plan only proposed an all-zero `ct_eq` to dodge a feature flag that turns out to be available), so per the plan's degradation clause I kept it and added the named regression test `derive_kek_rejects_low_order_shared_secret` (small-order peer key `[0u8;32]` → Err; normal key → Ok). No code/Cargo change beyond the test. Verified: test ✅, aven-caps 33/33 ✅. Moved plan → test.
- `2026-06-08` — Planned from crypto audit (docs/security/crypto-audit-2026-06-08.md, finding #1). Verified against current source: `derive_kek_x25519` (crypto.rs:72-81) feeds `shared.as_bytes()` into `hkdf_kek` with NO all-zero/low-order/contributory guard; `git log -- libs/aven-caps/src/crypto.rs` (latest `4797d8f`) confirms no such guard was previously merged on this path. Created in plan.
