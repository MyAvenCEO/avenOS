# Groove schema migrations (Jazz v2 lenses)

AvenOS keeps Groove data when the manifest changes. We register **live schemas** and auto lenses instead of wiping `db/` on hash change.

Docs: [jazz.tools/docs/schemas/migrations](https://jazz.tools/docs/schemas/migrations)

## What happens at unlock

1. Compare on-disk `groove_schema_hash` with the hash of `schema.manifest.json`.
2. If they differ, load the **previous** manifest from the vault (`db/schema_snapshots/<hash>.manifest.json`) or from bundled `registry.json`.
3. Build a lens with `generate_lens(old, new)` and pass the old schema as a live schema to Jazz (no wipe).
4. After connect, stamp the **current** manifest into `schema_snapshots/` for the next change.

Wipes still occur only for identity/lane mismatches (`client_id`, jazz lane), not for schema evolution.

## When you change the manifest

1. Edit `libs/aven-schema/schema.manifest.json`.
2. **Before** shipping, copy the current manifest to a snapshot (optional bundled fallback):

   ```bash
   cp libs/aven-schema/schema.manifest.json \
      libs/aven-schema/migrations/snapshots/before-<feature>.manifest.json
   ```

3. Compute its hash (for `registry.json` or notes):

   ```bash
   cargo run --manifest-path libs/aven-schema/crates/schema-hash/Cargo.toml -- \
     libs/aven-schema/migrations/snapshots/before-<feature>.manifest.json
   ```

4. Add an entry to `migrations/registry.json` if you want a **bundled** fallback for vaults that never stamped that hash (fresh installs upgrading from an old app build).

5. If `generate_lens` returns a **draft** (ambiguous table/column rename), add an explicit migration in Jazz terms or adjust the manifest change to be add-only.

Vault snapshots are the primary history; the registry is optional for releases that skipped a stamp.
