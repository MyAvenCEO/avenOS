---
title: Private-by-default threat model
---

# Private-by-default threat model

Scope: local identity + Stronghold secrets + Groove data on device + P2P sync between AvenOS peers. Not a formal security audit.

For the full tier table (SE, Rust RAM, disk, main vs vault webview), see [Trust boundaries & sensitive material](trust-boundaries-and-sensitive-material.md).

## Assets

- Device signing root (Secure Enclave → `device_root_secret` after Touch ID)
- User secrets in `vault/strong.hold` (API keys, passwords, env values)
- Spark row payloads (messages, todos, files, spark metadata)
- Per-spark DEKs and biscuit chains (`sparks`, `keyshares`)

## Adversary model

| Adversary | Capability |
| --------- | ---------- |
| **Other AvenOS peer** | Hyperswarm P2P, receives only gated sync frames |
| **Local attacker (locked device)** | Reads `storage.rocksdb`, `strong.hold`, SE blobs on disk |
| **Local attacker (unlocked session)** | Same as user process; IPC + UI + Rust memory |
| **Main webview XSS** | `plugin:self` if unlocked; **not** `plugin:vault` (capability deny) |
| **Vault webview XSS** | `plugin:vault|secrets_reveal` while unlocked |

We do **not** model: global internet anonymous read, cloud vault RBAC (Infisical/HCP-style).

## Controls

| Threat | Mitigation |
| ------ | ---------- |
| Peer receives spark data without grant | Biscuit-gated outbound transport |
| Peer decrypts without DEK | Keyshare per recipient DID |
| Disk dump while locked | Sealed Jazz columns; `strong.hold` ciphertext; SE blob needs biometrics |
| Main UI XSS steals user secrets | `vault:*` denied on `main` window |
| Vault UI XSS exfiltrates secrets | Re-auth on reveal; rate limits; minimal vault bundle |
| Disk dump while unlocked | Full decrypt possible — same as any local app with unlocked keys |
| UI bypass of Jazz gates | Table IPC through Rust + `authorize_gate` |

## Explicit non-goals

- No “public spark” product mode.
- No cloud org vault / team RBAC / central audit log.
- No password recovery for SE identity — biometric re-enroll invalidates keys.
- No automatic migration when sealing policy tightens — **identity wipe** may be required.

## Related docs

- [Trust boundaries & sensitive material](trust-boundaries-and-sensitive-material.md)
- [Vault plugin architecture](../vault/developers/01-architecture.md)
- [Private by default](../sparks/founders/04-private-by-default.md)
- [Plaintext routing columns](../sparks/developers/05-plaintext-routing-columns.md)
