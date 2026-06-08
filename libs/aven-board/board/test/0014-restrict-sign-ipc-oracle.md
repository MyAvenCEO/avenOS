---
title: Remove or domain-gate the bare `sign` IPC signing oracle
summary: Kill the WebView-reachable raw-bytes Ed25519 oracle (`plugin:self|sign`) so a compromised renderer can no longer forge owner-bindings, edit-sigs, biscuits, or auth challenges with the device identity key.
owner: Claude Code
created: 2026-06-08
updated: 2026-06-08
tags: [tauri-plugin-self, security, signing]
goal: `cargo test -p tauri-plugin-self sign_prepends_reserved_domain_disjoint_from_protocols` passes AND `cargo build -p tauri-plugin-self` succeeds, with all acceptance boxes checked.
---

# Remove or domain-gate the bare `sign` IPC signing oracle

## Context
Audit findings **#14 / #10 / #30** (`docs/security/crypto-audit-2026-06-08.md`) are three verifier records of the *same* defect, flagged independently across dimensions (the report calls them out as duplicates: "**#14 = #10 = #30** — bare `sign` IPC oracle").

**The defect.** `tauri-plugin-self` exposes a generic `sign` IPC command that signs ANY caller-supplied byte vector with the device identity Ed25519 key, applying **no** domain-separation tag and **no** context binding:

```rust
// libs/tauri-plugin-self/src/commands.rs:51-54
#[tauri::command]
pub async fn sign(state: State<'_, SelfState>, message: Vec<u8>) -> Result<Vec<u8>, String> {
	state.with_root(|root| Ok(derive::sign(root, &message)?.to_vec()))
}
```
```rust
// libs/tauri-plugin-self/src/derive.rs:44-47
pub fn sign(root: &[u8; 32], message: &[u8]) -> Result<[u8; 64], String> {
	let sk = signing_key_from_root(root)?;
	Ok(ed25519_dalek::Signer::sign(&sk, message).to_bytes())
}
```

That exact key — `signing_key_from_root(root)` — is the single key reused everywhere in the trust layer:
- **owner-bindings**, signed over `b"avenos:owner-binding:v1\0" ‖ value_id ‖ owner` (`libs/aven-caps/src/ownership.rs:37,51-56`), verified on apply by `verify_owner_binding` (`ownership.rs:75-81`);
- **edit-sigs**, signed over `b"avenos:edit-sig:v1\0" ‖ batch_digest ‖ author_did` (`ownership.rs:38,128-134`), verified by `verify_signed_batch` (`ownership.rs:146-154`);
- the **p2p peer-auth challenge**, signed over the raw UTF-8 of `build_message(...)` with **no binary domain prefix at all** (`libs/aven-p2p/src/challenge.rs:95-115` builds the message, `challenge.rs:118-120` signs it), verified by `challenge::verify` (`challenge.rs:124-136`);
- biscuit issuance (same device key, via `jazz_auth.rs:26-27 → signing_key_from_root`).

The domain separators these consumers use give **zero** protection against `sign`, because `sign` signs raw bytes: a caller simply supplies the full prefixed byte string (`b"avenos:owner-binding:v1\0" ‖ target_value_id ‖ victim_identity`) and receives a signature that the on-apply verifiers accept as authentic. The challenge has no binary prefix at all, so even a "naive" caller can forge a ClientAuth.

**Exposure.** `allow-sign` (and `allow-verify`) sit in `self:default` (`libs/tauri-plugin-self/permissions/default.toml:13-14`), and `self:default` is granted to window `main` (`app/src-tauri/capabilities/default.json:12`). So the command is reachable from the main WebView with no per-call scoping. `state.with_root` reads the already-cached root — **no biometric / SE prompt** is required per call.

**Attack scenario (carried over from the audit).** A compromised WebView context — malicious renderer-loaded JS, XSS in a rendered note, or a hostile QuickJS sandbox escape that can reach the IPC bridge — invokes `plugin:self|sign` with:
- the bytes `b"avenos:owner-binding:v1\0" ‖ target_value_id ‖ victim_identity_uuid` → packages the 64-byte result into an `OwnerBinding`, **forging authorship/ownership** of a value under another identity's namespace (passes `verify_owner_binding` on every relay and member); or
- the `build_message(...)` challenge string with the server's nonce/domain/uri → **replays it as a ClientAuth**, authenticating to the relay/server **as the device** without ever touching the SE/biometric unlock again; or
- `b"avenos:edit-sig:v1\0" ‖ digest ‖ did` → a valid `EditSignature` once that machinery is wired.

A compromised renderer becomes a universal forging oracle for the entire trust layer.

**Reality check (this repo, confirmed by grep).** There are **no** frontend callers of `plugin:self|sign` or `plugin:self|verify` anywhere in `app/` or `libs/` (`*.ts|*.tsx|*.js|*.svelte`). The only `self` signing commands the UI actually uses are `signing_public_key` and `signing_peer_did` (`app/src/lib/settings/self-context.svelte.ts:92,100`). All real challenge/auth signing happens **Rust-side** via `jazz_auth.rs` → `signing_key_from_root`, never through the IPC. So the `sign`/`verify` IPC surface is dead weight that exists only as an attack surface — it can be removed without breaking a real flow.

**Relation to other items.** This is one of the two "cheap, independent, outsized-blast-radius" fixes the audit's executive summary names (the other is enforcing `Delete` on inbound, item **0006**). Complementary to the caps-layer hardening in **0010** / **0011** (which protect the verifiers); this item removes the oracle that lets the WebView *produce* forged inputs in the first place.

## Goal
The WebView can no longer obtain a device-key signature over attacker-chosen bytes that any protocol verifier (owner-binding, edit-sig, challenge, biscuit) will accept.

**Completion condition** (identical to frontmatter goal):
> `cargo test -p tauri-plugin-self sign_prepends_reserved_domain_disjoint_from_protocols` passes AND `cargo build -p tauri-plugin-self` succeeds, with all acceptance boxes checked.

## Approach
Two reinforcing changes, both small and both verifiable in `tauri-plugin-self`:

1. **Remove the IPC oracle from the WebView surface (primary).** Drop the `sign` and `verify` commands from the `generate_handler!` lists in `libs/tauri-plugin-self/src/lib.rs` (both the macOS/iOS block ~line 74 and the dev/other-platform block ~line 118), and drop `allow-sign` + `allow-verify` from `self:default` in `libs/tauri-plugin-self/permissions/default.toml:13-14`. Confirmed safe: grep shows zero frontend callers; only `signing_public_key` / `signing_peer_did` are consumed by the UI, and all real auth signing is Rust-side via `jazz_auth.rs`. This alone converts "WebView compromise = forge anything" back to "forge nothing useful."

2. **Defense in depth: domain-gate `derive::sign` itself (belt-and-suspenders).** Even though the public IPC is removed, the `pub fn sign` in `derive.rs` remains a callable primitive. Make it **unconditionally prepend a reserved domain prefix** `b"avenos:webview-sign:v1\0"` that is **disjoint** from every protocol domain (`avenos:owner-binding:v1\0`, `avenos:edit-sig:v1\0`, the un-prefixed challenge text, and the biscuit domain). Keep the *raw* (un-prefixed) signing primitive private and renamed (e.g. `sign_raw`) so the genuine Rust-side signers (`mint_owner_binding`, `sign_batch`, `challenge::sign`) — which all sign through `ed25519_dalek::SigningKey` directly via `signing_key_from_root`, **not** through `derive::sign` — are unaffected. This guarantees that any signature the (now-removed, or any future re-added) generic path could ever produce lives in a domain no verifier trusts.

   Verified non-impact: `mint_owner_binding`/`sign_batch` call `author_sk.sign(...)` directly (`ownership.rs:69,139`) and `challenge::sign` calls `signing_key.sign(...)` directly (`challenge.rs:119`); none route through `derive::sign`. The only callers of `derive::sign` are `commands::sign` (being removed) and tests.

**Trade-offs / out of scope.** We are *not* introducing typed purpose-specific IPC commands (`sign_auth_challenge`, etc.) in this item — the audit lists that as the "best" long-term shape, but it is unnecessary now because no UI flow needs WebView-side signing at all. If a future feature genuinely needs WebView-initiated signing, it should add a typed, server-reconstructed command in a follow-up; this item deliberately removes the surface rather than re-scoping it. Also out of scope: the dev-insecure root file integrity issue (audit #30's *second* record at report line 230 — separate finding) and the `Delete`-on-inbound fix (**0006**).

## Steps
1. Read `libs/tauri-plugin-self/src/derive.rs`, `src/commands.rs`, `src/lib.rs`, and `permissions/default.toml` to confirm current line numbers (they may have shifted).
2. In `derive.rs`: rename the existing raw `pub fn sign` to a private `fn sign_raw(root, message)`, and add a new `pub fn sign(root, message)` that prepends `const WEBVIEW_SIGN_DOMAIN: &[u8] = b"avenos:webview-sign:v1\0";` to `message` before calling `sign_raw`. Expose `WEBVIEW_SIGN_DOMAIN` (or a `pub const`) so the test can assert disjointness.
3. In `lib.rs`: remove `commands::sign` and `commands::verify` from **both** `generate_handler!` blocks (macOS/iOS ~line 74; dev/other ~line 118).
4. In `commands.rs`: delete the `sign` and `verify` `#[tauri::command]` fns (lines ~50-72), or `#[cfg(test)]`-gate them if a test needs them — they are no longer registered, so leaving them registered would fail the build. (Keep `signing_public_key` / `signing_peer_did` untouched — the UI uses them.)
5. In `permissions/default.toml`: delete the `"allow-sign"` and `"allow-verify"` lines (currently lines 13-14). Leave the autogenerated `permissions/autogenerated/commands/sign.toml` / `verify.toml` definitions in place (they are harmless when not referenced) OR regenerate; do not block on regeneration.
6. Add a **new regression test** in `derive.rs` (`#[cfg(test)] mod tests`) named `sign_prepends_reserved_domain_disjoint_from_protocols` that proves the attack is now blocked (see Acceptance criteria for the exact assertions).
7. Re-grep `app/` and `libs/` for `plugin:self|sign` / `plugin:self|verify` to re-confirm zero callers after the change.
8. `cargo build -p tauri-plugin-self` and run the new test. Run `cargo test -p aven-caps` to confirm the caps verifiers are untouched and still green.

## Files to touch
- `libs/tauri-plugin-self/src/derive.rs` — rename raw `sign`→`sign_raw` (private); new `pub fn sign` prepends reserved `WEBVIEW_SIGN_DOMAIN`; add `pub const WEBVIEW_SIGN_DOMAIN`; add the regression test.
- `libs/tauri-plugin-self/src/commands.rs` — remove the `sign` and `verify` `#[tauri::command]` fns (lines ~50-72); leave `signing_public_key`/`signing_peer_did`.
- `libs/tauri-plugin-self/src/lib.rs` — drop `commands::sign` and `commands::verify` from both `generate_handler!` lists (~line 74 and ~line 118).
- `libs/tauri-plugin-self/permissions/default.toml` — delete `"allow-sign"` and `"allow-verify"` (lines 13-14) so `self:default` no longer grants the oracle to window `main`.
- `app/src-tauri/capabilities/default.json` — no change needed (it references `self:default`, which after step above no longer contains the oracle); note in progress log.

## Acceptance criteria
- [x] The new test `sign_prepends_reserved_domain_disjoint_from_protocols` exists in `derive.rs` and proves the attack is blocked — proven by `cargo test sign_prepends_reserved_domain_disjoint_from_protocols` (1 passed). It asserts ALL of:
  - signing the owner-binding payload `b"avenos:owner-binding:v1\0" ‖ value_id ‖ owner` through `derive::sign` yields a signature that is **NOT** the signature `signing_key_from_root(root).sign(payload)` would produce (i.e. the domain prefix is actually applied), and therefore would **fail** `aven_caps`-style verification of that raw payload;
  - `WEBVIEW_SIGN_DOMAIN` is byte-disjoint from `b"avenos:owner-binding:v1\0"`, `b"avenos:edit-sig:v1\0"`, and is not a prefix of any of them (and they are not a prefix of it);
  - a round-trip: `derive::verify(pub, &(WEBVIEW_SIGN_DOMAIN ‖ msg), &derive::sign(root, msg))` is `Ok(true)` while `derive::verify(pub, msg, &derive::sign(root, msg))` is `Ok(false)` (the bare message no longer verifies under its own un-prefixed bytes).
- [x] `sign`/`verify` are no longer registered IPC commands — `commands::sign`/`commands::verify` removed from BOTH `generate_handler!` blocks and the `#[tauri::command]` fns deleted from `commands.rs`; proven by `cargo build` in `libs/tauri-plugin-self` (Finished) and `cargo check` on `aven-os-app` (Finished — capability validation passes; `capabilities/default.json` references only `self:default`).
- [x] `"allow-sign"` and `"allow-verify"` are gone from `self:default` — proven by `grep -nE '"allow-sign"|"allow-verify"' permissions/default.toml` returning nothing.
- [x] No frontend regression — `grep` for `plugin:self|sign`/`verify` across `app`/`libs` (.ts/.svelte) returns zero; only `signing_public_key`/`signing_peer_did` are used.
- [x] The caps verifiers are unaffected — `cargo test` in `libs/aven-caps` (31 passed).

## Verification
```bash
cd /Users/samuelandert/Documents/Development/avenOS/.claude/worktrees/jolly-taussig-f2dcdd

# 1. Plugin compiles with the oracle commands removed from generate_handler!
cargo build -p tauri-plugin-self

# 2. New regression test: domain prefix is applied + disjoint from every protocol domain
cargo test -p tauri-plugin-self sign_prepends_reserved_domain_disjoint_from_protocols

# 3. Permission grant removed from the default capability set
grep -nE 'allow-sign|allow-verify' libs/tauri-plugin-self/permissions/default.toml || echo "OK: oracle perms removed"

# 4. No frontend caller depended on the removed IPC
grep -rnE "plugin:self\|(sign|verify)\b" app libs --include='*.ts' --include='*.svelte' || echo "OK: no callers"

# 5. Caps verifiers still green (untouched by this change)
cargo test -p aven-caps
```

## Hand-off
```
/board-goal libs/aven-board/board/plan/0014-restrict-sign-ipc-oracle.md
```

## Progress log
Newest first.
- `2026-06-08` — **Implemented + verified (ready for test column).** Removed the `sign`/`verify` `#[tauri::command]` fns (commands.rs) and dropped them from both `generate_handler!` blocks (lib.rs) and from `self:default` (permissions/default.toml). Defense in depth: renamed the raw primitive to private `derive::sign_raw` and made `pub derive::sign` unconditionally prefix `WEBVIEW_SIGN_DOMAIN = b"avenos:webview-sign:v1\0"` (disjoint from owner-binding/edit-sig/challenge/biscuit domains). Verified non-breaking: the genuine signers (`mint_owner_binding`, `sign_batch`, `challenge::sign`, biscuit issuance) sign via `SigningKey`/`signing_key_from_root` directly, never through `derive::sign`; zero frontend callers of the IPC; `capabilities/default.json` references only `self:default`. Verified: `cargo test sign_prepends_reserved_domain_disjoint_from_protocols` ✅, tauri-plugin-self build ✅, app `cargo check` ✅ (capability validation passes), aven-caps 31/31 ✅. Moved plan → test.
- `2026-06-08` — Planned from crypto audit (docs/security/crypto-audit-2026-06-08.md), findings #14/#10/#30 (duplicates of one defect). Grep-confirmed zero frontend callers of `plugin:self|sign`/`verify`; only `signing_public_key`/`signing_peer_did` are used by the UI (self-context.svelte.ts), and all real auth signing is Rust-side (jazz_auth.rs → signing_key_from_root). Verified genuine signers (`mint_owner_binding`, `sign_batch`, `challenge::sign`) sign via `SigningKey` directly, not via `derive::sign`, so domain-gating `derive::sign` is non-breaking. Created in plan. Complementary to 0010/0011 (verifier hardening); pairs with 0006 (Delete-on-inbound) as the audit's two outsized-blast-radius fixes.
