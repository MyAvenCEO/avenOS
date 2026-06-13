---
title: Capabilities — who may read, write, and sync
---

# Capabilities — who may read, write, and sync

Sealed cells keep data **private**; capabilities decide **who's allowed to touch it at all** — read
it, write it, replicate it. avenDB's authority model is **biscuit** tokens evaluated as datalog
(`libs/aven-caps`). It's **closed by default**: nothing is permitted unless a capability explicitly
grants it.

> One-liner: **you carry signed permission slips (biscuits); a tiny rules engine checks "does this
> slip cover this exact action on this exact resource?" — deny otherwise.**

---

## Biscuits = attenuable permission slips

A **biscuit** is a cryptographic token that says what its holder may do. Two properties make them
ideal here:

- **Offline-verifiable** — a peer can check a biscuit with no server call (local-first).
- **Attenuable** — you can hand someone a *narrower* copy (e.g. "read-only, just this prefix") by
  appending a block; you can never widen one.

Authorization is a little **datalog** program. Roughly:

```
allow if subject($p), trusted_admin($p), op($op), resource($r),
         right($op, $prefix), $r.starts_with($prefix);
deny if true;                       // closed by default
```

i.e. *allow only if* the caller is a trusted admin holding a `right` for this op whose prefix
covers the resource — otherwise deny. (`aven-caps` builds this and runs `authorize`.)

> **Practical note (board): the datalog has a budget.** biscuit-auth defaults to ~1 ms / 1000 facts;
> under load that produced spurious `biscuit_deny:RunLimit(Timeout)`. avenDB raises it to
> 100 ms / 10k facts / 1k iterations — still instant, immune to scheduler jitter.

## Ownership flows through SAFEs (transitive)

You don't grant rights to a raw device key. You grant them to a **SAFE** — a human-owned identity —
and a device's signer **inherits** them by being a member of that SAFE. So:

```
device signer  ──member of──▶  human SAFE  ──owns / reads / replicate──▶  resource
```

Authorization walks this chain (N hops), so *every device of a person* reads as the same owner. This
is why adding a new phone "just works" once it joins your SAFE — it inherits your rights.

## Three kinds of grant

| Grant | Can do | Holds the key? |
|-------|--------|----------------|
| **owns / admin** | read + write + grant to others | yes (keyshare) |
| **reads (member)** | read | yes (keyshare → can decrypt) |
| **replicate** | store + forward batches | **no** — ciphertext only (blind relay) |

The split between *reads* and *replicate* is what lets a backup/relay server **hold and sync your
data without being able to read it**: it has a `replicate` grant (so sync delivers to it) but **no
keyshare**, so every cell stays sealed to it (see [Sealed cells](03-sealed-cells)).

## Keyshares — how a member gets the key

A capability says you *may* read; a **keyshare** is how you actually *can*. The identity's DEK is
**wrapped (encrypted) to each authorized recipient**. When you're granted membership, the owner
wraps the DEK to your key; you unwrap it locally. Non-members and replicas are never sent a
keyshare, so "may not read" and "cannot read" line up.

## Invite-only networks (avenCEO)

A whole AvenOS network is gated by membership of its **avenCEO** identity: the aven-node
auto-admits the first peer and vouches the rest in. Membership = "do I hold an avenCEO cap in my
vault?" — a **local** check (no roundtrip): once you've been invited, the SYNC/reads (or admin) cap
sits in your local vault biscuit and answers instantly forever after. The app itself is local-first
and not gated; only the **sync/server layer** cares about this membership.

## Writes are signed (fail-closed apply)

Reading is gated by *can you reach + decrypt*; **writing** is gated by an **edit signature** — an
authoring node must sign its batches, and the inbound-apply gate rejects a batch whose signature /
owner-binding doesn't verify. A node without an `EditSigner` can't land authored writes at all
(fail-closed). This stops a peer from forging or relabeling batches it shouldn't author.

---

| Idea here | In avenOS |
|-----------|-----------|
| Permission slip | biscuit token (`aven-caps`) |
| The rules check | datalog `authorize(subject, op, resource)` — closed by default |
| Inherit rights across devices | SAFE membership (transitive `owns`) |
| Store-but-can't-read | `replicate` grant + no keyshare (blind relay) |
| Actually decrypt | wrapped **keyshare** of the DEK |
| Network admission | avenCEO membership (local vault check, invite-only) |
| Forge-proof writes | EditSignature inbound-apply gate |

Together with [Sealed cells](03-sealed-cells), this is avenDB's privacy story: **encrypted so only
the key-holder can read, and gated so only the authorized can touch.**
