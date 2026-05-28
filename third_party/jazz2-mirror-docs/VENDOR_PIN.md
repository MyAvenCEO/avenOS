# jazz2 upstream reference mirror

Read-only checkout of [garden-co/jazz2](https://github.com/garden-co/jazz2) for AvenOS re-vendor planning and iOS RocksDB spikes.

**Local clone (not in git):** `third_party/jazz2-upstream/` — nested `.git`; refresh with commands below.

| Field | Value |
|---|---|
| Git SHA | `232a9933c973f5b80ca9115e049706d9acd8fb77` |
| npm `jazz-tools` | **2.0.0-alpha.50** |
| Rust crate version | `2.0.0-alpha.0` (Cargo.toml — unchanged on crates.io label) |
| Pinned | 2026-05-28 |

AvenOS Tauri uses **only** `crates/jazz-tools` (Rust + RocksDB). Do not vendor npm packages, OPFS, SQLite, or TypeScript from this monorepo.

Update:

```bash
cd third_party/jazz2-upstream
git fetch origin main && git checkout main && git pull origin main
# refresh this file with new SHA + packages/jazz-tools/package.json version
```
