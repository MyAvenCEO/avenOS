---
title: Private-by-default threat model
---

# Private-by-default threat model

Scope: local Groove vault on device + P2P sync between AvenOS peers. Not a formal security audit.

## Assets

- Spark row payloads (messages, todos, files, spark metadata)
- Per-spark DEKs and biscuit chains (`sparks`, `keyshares`)
- Device signing root (Secure Enclave after Touch ID)

## Adversary model

| Adversary | Capability |
| --------- | ---------- |
| **Other AvenOS peer** | Hyperswarm P2P, receives only gated sync frames |
| **Local attacker (locked device)** | Reads RocksDB files on disk |
| **Local attacker (unlocked session)** | Same as user process; IPC + UI |

We do **not** model: global internet anonymous read, server-side ReBAC (removed in P2P-only fork).

## Controls

| Threat | Mitigation |
| ------ | ---------- |
| Peer receives spark data without grant | Biscuit-gated outbound transport; destination must be `owns` admin for spark |
| Peer decrypts without DEK | Keyshare required per recipient DID; wrap uses X25519 + AAD |
| Disk dump while locked | Sensitive columns sealed; routing columns leak spark ids / peer graph only |
| Disk dump while unlocked | Full decrypt possible — same as any local app with unlocked keys |
| UI bypass of gates | All table IPC through Rust shell + `authorize_gate` |

## Explicit non-goals

- No “public spark” product mode.
- No whole-vault single KEK in this phase (per-spark DEK + column sealing).
- No automatic migration when sealing policy tightens — **vault wipe** required.

## Related docs

- [Private by default](../sparks/founders/04-private-by-default.md)
- [Plaintext routing columns](../sparks/developers/05-plaintext-routing-columns.md)
- [Biscuits as source of truth](../sparks/developers/02-biscuits-as-source-of-truth.md)
