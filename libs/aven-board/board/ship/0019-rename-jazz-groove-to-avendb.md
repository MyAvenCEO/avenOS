---
title: rename jazz/groove → avenDB; colocate manifest parsing into aven-db
summary: Collapse the engine's three names (aven-db package, groove import alias, Jazz client/module/TS naming) into ONE — avenDB. Kill the groove alias in all 6 dependent crates, rename the public client types (JazzClient→AvenDbClient, JazzError→AvenDbError), the app's jazz/ module → avendb/, the TS $lib/jazz layer → $lib/avendb, and the groove_runtime IPC command → avendb_runtime. Colocate the tauri-free manifest-parsing core (manifest JSON → Schema) from app/src-tauri/schema_manifest.rs into a new aven_db::manifest module.
owner: agent
created: 2026-06-10
updated: 2026-06-10
tags: [aven-db, rename, cleanup, app]
goal: "grep -rn 'groove' across libs/*/src app/src-tauri/src app/src returns no code identifiers (jazz.tools heritage citations exempt); `cargo test --features client-p2p --lib` in libs/aven-db and `cargo test` in libs/aven-brain exit 0; `bun run check` exits 0 (app Rust compile verified on macOS — GTK blocks it in CI containers)."
---

# rename jazz/groove → avenDB; colocate manifest parsing into aven-db

## Context

The storage engine answers to three names: **aven-db** (the package), **groove** (the Cargo
import alias used by 6 crates + the `groove_runtime` IPC command), and **Jazz** (`JazzClient`/
`JazzError`, the app's `jazz/` Tauri module, the `$lib/jazz` TS layer — ~440 occurrences).
Nothing persisted or on the wire carries any of these names (the data dir is already `db`),
so the rename is purely mechanical and fully policed by the compiler + test suites.

Decision: **one name — avenDB.** No aliasing back to groove or jazz anywhere.

## Naming map

| Old | New |
|---|---|
| `groove = { package = "aven-db" }` (6 crates) | `aven-db = { path = … }`, imported as `aven_db` |
| `JazzClient` / `JazzError` | `AvenDbClient` / `AvenDbError` |
| `pub use runtime_tokio as groove_tokio` | `avendb_tokio` (or dropped if unused) |
| `app/src-tauri/src/jazz/` (module `jazz`) | `app/src-tauri/src/avendb/` (module `avendb`) |
| `ManagedJazz`, `JazzConn`, `Jazz*Reply` | `ManagedAvenDb`, `AvenDbConn`, `AvenDb*Reply` |
| `jazz_engine.rs` | `engine.rs` (sealing engine, inside `avendb/`) |
| IPC `groove_runtime`, `self_clear_jazz_database` | `avendb_runtime`, `self_clear_avendb_database` |
| `$lib/jazz` + `jazzStore/jazzTable/jazzStatus/jazzExplorer*` | `$lib/avendb` + `avenDb*` |
| prose "Groove"/"Jazz" in comments/strings | "avenDB" |
| jazz.tools heritage citations (11) | kept verbatim (external attribution) |

## Colocation (what moves into the actual aven-db lib)

Dependency scan of `app/src-tauri/src/jazz/*`: every file is tauri/vault-coupled — incl. the
sealing engine (DEK lookup goes through vault `SelfState`), so wholesale moves are NOT clean.
What IS clean now:

- **`aven_db::manifest` (new module)** ← the tauri-free parsing core of
  `app/src-tauri/src/schema_manifest.rs`: `ManifestColumn`/`ManifestTable`/`Manifest` serde
  types, `column_type_from_manifest` (incl. `vector`+`dim`), `manifest_to_schema`,
  `load_schema_from_manifest_str/path`. The app file shrinks to a thin wrapper: repo/sandbox
  paths, compile-time embeds, tauri install, exposeTs/sensitive-column maps (sealing policy =
  app concern).
- **Phase 2 (separate item, not now):** extract the pure AEAD value-sealing out of
  `avendb/engine.rs` behind a key-provider trait so it can live next to the engine's
  unseal-on-scan seam; blocked on disentangling vault `SelfState`.

## Verification

- `cargo test --features client-p2p --lib` in `libs/aven-db` (751 tests) — exit 0
- `cargo test` in `libs/aven-brain` (22), `cargo check` in aven-caps / aven-p2p / aven-node /
  schema-hash — exit 0
- `bun run check` (svelte-check) — exit 0
- `grep -rn 'groove\|Jazz' libs/*/src app/src` → only jazz.tools citations remain
- app/src-tauri Rust compile: **must be verified on macOS** (GTK system libs block the Tauri
  crate in Linux containers); the rename there is mechanical and TS-coupled names are checked
  by `bun run check`.

## Progress log

- `2026-06-10` — Spec'd + executed in one pass. Root cause found and removed: the
  package itself declared `[lib] name = "groove"` — dropped (lib is `aven_db` now);
  all 6 dependent crates import `aven-db` directly. Renames applied per the naming map,
  incl. persisted strings under the fresh-DB policy (`avendb:system` principal,
  `__avendb_store_manifest` + `AVENDBSTO1` store magic, `avendb-catalogue-*` digest
  domains, vault stamp filenames). Colocation: new **`aven_db::manifest`** module
  (manifest JSON → Schema incl. `vector`/`dim` + exposeTs slugs, with tests);
  `app/src-tauri/src/schema_manifest.rs` is now a thin host wrapper (paths, embeds,
  tauri install, policy maps). **Verified:** aven-db 753/753 (lib, +2 manifest tests),
  aven-brain 22/22, aven-caps 43/43, svelte-check 1705 files → only 1 pre-existing
  unrelated error (`aven-ui/brand-style.ts`, untouched), E0 schema harness PASSED.
  **Mac-verify:** app/src-tauri (GTK blocks Tauri builds in the container) and
  aven-p2p / aven-node / schema-hash full builds (rocksdb cold-build exceeds container
  budget; their rename surface was alias + a handful of mechanical refs, no compile
  errors surfaced). Zero non-heritage jazz/groove mentions remain (jazz.tools and the
  upstream `garden-co/jazz2` repo URL kept as attribution).
