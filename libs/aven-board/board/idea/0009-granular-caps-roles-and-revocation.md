---
title: Granular caps clustered with roles (UI ≈ Datalog facts) + a real revocation model (biscuit + DEK, learning from Matrix/Signal)
summary: Two linked design questions surfaced while building the Members caps UI. (1) We want FULL per-cap granularity AND human role grouping, with the UI always reflecting the actual biscuit Datalog facts — never inventing a cap/role that isn't a function of the facts. (2) Revocation in a biscuit (attenuation-only, offline-verifiable) + DEK (encryption) world needs a clear model; cross-learn from biscuit revocation-IDs and from Matrix (megolm) / Signal (sender keys + ratchet).
owner: unassigned
created: 2026-06-06
updated: 2026-06-06
tags: [caps, biscuit, dek, revocation, ux, security, admin-spark]
goal: A design doc `docs/CapsAndRevocation.md` exists capturing (a) the granular-caps-clustered-with-roles model with UI≈facts invariant, and (b) the revocation model (biscuit + DEK, with the Matrix/Signal cross-learnings), AND a recorded decision on whether granular per-cap grants land before or after admin-spark Phase A. Provable by the file existing + a decision line.
---

# Granular caps clustered with roles + a real revocation model

> **Why capture now:** both questions came up while building the Members page
> (2-tab caps view, DRY single-source from the biscuit — branch
> `feat/aven-auth-into-server`). They shape `admin-spark` Phase A but shouldn't
> block starting it. Park here so we don't forget the thinking.

## Context — what we already established

- **Biscuit has no built-in notion of "role" or "capability."** Confirmed from the
  biscuit Datalog reference: facts/rules/checks/policies are the only primitives;
  `right()`, `role()`, etc. are *application-defined conventions*. So in avenOS the
  cap vocabulary (`owns`, `reads`, `replicate`, `right(op, prefix)`) is *our* Datalog,
  defined once in [`spark_acc.rs`](../../../../app/src-tauri/src/spark_acc.rs).
- **Single source of truth = the biscuit chain** in `sparks.genesis_b64` (synced like
  any row). `spark_cap_report` reads it → the Members UI renders those facts and
  defines no caps of its own. "Role" (Owner/Member/Relay) is currently a **display
  label** over which grant fact a DID holds — presentation, not architecture.
- **Today there are only 3 grant bundles:** `owns` (full), `reads` (read-only),
  `replicate` (blind). Mutually exclusive. You cannot currently grant "write but not
  read."

## Part 1 — Full granularity, clustered with roles, UI ≈ Datalog facts

**The want:** à-la-carte caps (the real `right(op, resource)` facts) **and** a
human role grouping for comprehension — without the UI ever drifting from the facts.

**Proposed model — "role = a named, canonical bundle of facts":**
- Define roles **once** in the cap schema (`spark_acc.rs`) as exact cap-sets, e.g.
  `Owner = {read,write,delete,admit,rotate_dek}`, `Member = {read}`,
  `Relay = {replicate}`. This is the *only* place roles exist.
- A subject's **display** is derived from its *actual* caps: if its fact-set equals a
  known bundle → show the role label; otherwise → show **"Custom"** + the explicit
  cap chips. **Invariant: the UI never shows a role that isn't an exact function of
  the facts, and never hides a cap.** Role is *recognition*, never *authority*.
- **Granting UI:** role presets (one click = apply the bundle) **plus** a per-cap
  multiselect (granular). Both mint the *exact* `right(op, resource)` facts. The
  multiselect we deferred in the Members UI becomes real here.

**What this needs (backend):**
- The **authorize-DSL generalization** (already flagged in
  `docs/AvenServerPlan.md` §4.0): mint individual delegated `right(op, prefix)` facts
  per DID, and make `authorize` honor a delegated right for a non-owner (today only
  `reads`/`replicate` bypass the owner check; generalize to any granted right).
- A `spark_grant_caps(did, caps[])` minter (third-party block with the selected
  `right` facts) + **per-cap revoke** (re-mint without those facts).
- `spark_cap_report` already returns `caps[]` per subject — extend it to report the
  *granular* rights, and add role-matching (caps==bundle → role label, else Custom).
- Optional finer scope: caps can be per-table/row via the resource prefix
  (`spark:UUID:table:row`) — the authorizer already does `starts_with` matching.

**Principle to write down:** *the displayed access is a pure function of the Datalog
facts in the chain; roles are a recognized clustering of those facts, applied in one
place, with "Custom" as the honest fallback.* That is how UI/UX and actual access
stay universally legible.

## Part 2 — Revocation in a biscuit + DEK world

**The hard truth:** a biscuit is attenuation-only and offline-verifiable — you cannot
"un-issue" a token the holder already has. And reading is gated by the DEK
(encryption), not the biscuit. So revocation has **two independent halves**, and is
**forward-only by physics**:

1. **Stop future *authorization*** (biscuit): the revoked DID must no longer pass the
   sync/biscuit gate.
2. **Stop future *decryption*** (DEK): rotate the data key so the revoked DID can't
   read new data.
3. **The past is past:** anything the peer already decrypted (or holds as ciphertext
   + an old DEK) stays readable to it. Not retroactive.

**What avenOS does today** (`rebuild_spark_biscuit_excluding` + the revoke IPC):
re-mint the spark biscuit *without* the DID (re-root the chain) + rotate the DEK to
v+1 + keyshare v+1 to *remaining* members only + delete the revoked peer's keyshares.
This is forward-only and correct. The Members UI now says "Stop sharing" (single
click) and wording is honest about "future, not past."

**Cross-learnings to evaluate:**

| Source | Mechanism | What to adopt |
|---|---|---|
| **Biscuit** | **Revocation identifiers** (one per block, from the signature) + a verifier-checked **revocation list**; also short-TTL + renewal | A **fast edge-gate**: the server denies a revoked biscuit immediately from a revocation list, without waiting for the re-mint to propagate. Consider TTL+renewal for promptly-revocable caps. |
| **Matrix (megolm)** | Rotate the **group session key** on membership change; removed member keeps history, loses future | Canonical **trigger = any membership change → rotate** (we already rotate on revoke). Same physics; validates our model. |
| **Signal (Sender Keys + double ratchet)** | Re-key group on removal; **forward secrecy via ratcheting** so a leaked old key doesn't expose new messages | **Ratchet the DEK forward** (periodic + on-revoke), not just bump on revoke — limits blast radius of a leaked key. |

**Honest limit to document (set UX expectations):** you cannot delete ciphertext a
peer already received — *no* E2EE system can (Signal/Matrix included). "Revoke" =
deny future caps + rotate the key + accept the past.

**Open questions for the doc:**
- Do we even need biscuit revocation-IDs + a revocation list, given our **star
  topology** (every device dials the aven, which gates on the *current* biscuit, and
  re-mint propagates via frontier sync)? Re-mint + sync convergence may suffice for
  single-issuer; revocation-IDs matter more for multi-issuer / offline-verifier
  cases. **Decide and record.**
- Should DEK rotation be a **ratchet** (forward-secret) or a simple version bump?
- Where does revocation surface in the **admin-spark roster** (Phase A)? A `status:
  revoked` row + the re-mint, consistent with the per-spark revoke.

## Approach / sequencing

- **Likely after admin-spark Phase A** (so we have the roster + membership model to
  hang granular caps + revocation UX on), but the *authorize-DSL generalization* is a
  shared dependency that could land earlier if granular caps are wanted in Phase A.
- Deliverable: `docs/CapsAndRevocation.md` (the model + decisions), then implement
  granular grants (`spark_grant_caps` + authorize generalization + per-cap revoke +
  role-matching in `spark_cap_report`) and the revocation hardening (edge-gate /
  ratchet) as follow-on work items.

## Out of scope (here)

The Members UI already renders backend caps DRY-ly; this item is about *extending the
cap model itself* (granularity + roles-as-bundles) and *hardening revocation* — not
re-litigating the UI single-source-of-truth, which is done.
