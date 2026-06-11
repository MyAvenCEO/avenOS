---
title: One universal schema-checked avenDB CRUD — eliminate positional writes
summary: A single name-keyed, schema-validated row-write surface in aven-db; positional Vec<Value> writes and all three duplicate row converters deleted repo-wide.
owner: claude
created: 2026-06-11
updated: 2026-06-11
tags: [aven-db, crud, consolidation, correctness]
# goal — the SINGLE completion condition Claude Code's built-in `/goal` works toward.
goal: "Positional row writes are eliminated repo-wide: `grep -rn \"vec_values_to_map\\|row_in_order\" libs/aven-db/src libs/aven-node/src app/src-tauri/src` returns no hits and `grep -n \"pub async fn create(\" libs/aven-db/src/avenos_client.rs` returns no hits (only create_checked* remains); `cargo test` exits 0 in libs/aven-db and libs/aven-brain; `cargo check` exits 0 for app/src-tauri and libs/aven-node; `git diff --stat libs/aven-schema/schema.manifest.json` is empty."
---

# One universal schema-checked avenDB CRUD — eliminate positional writes

## Context

The brain-memories outage (fixed in `43134b0` + `fa24d83`) exposed a structural
flaw: avenDB rows could be written **positionally** (`create(table, Vec<Value>)`),
zipped against the manifest's column order by index. Any drift between a caller's
hand-built value order and the manifest silently corrupted writes — the `embedding`
vector landed in a text column and every brain insert failed without a sound.

Three near-identical converters exist for the same job (name-keyed cells → row),
each with its own partial validation:

| Converter | Where | Validation | Flaw |
| --- | --- | --- | --- |
| `vec_values_to_map` | `libs/aven-db/src/avenos_client.rs` | exact count | positional — order drift corrupts |
| `insert_values` | `app/src-tauri/src/avendb/mod.rs` | missing/nullable | **silently ignores unknown keys**; outputs positional Vec |
| `row_in_order` | `libs/aven-node/src/aven_ceo.rs` | none | null-fills anything missing, typos vanish |

`create_checked` / `create_checked_with_id_and_metadata` + `resolve_named_row`
(added in `fa24d83`, brain already migrated) are the universal interface: name-keyed,
resolved against the **live schema** — unknown column → error, missing nullable →
Null, missing required → error, engine type-checks every value on encode.

The update path is already name-keyed and validated (`patch_updates` rejects
unknown columns; the engine type-checks on encode) — verify, don't rebuild.
Deletes take only an ObjectId — nothing to validate.

Per the compact/simplify/consolidate rule: this is **elimination, not layering** —
one universal generic DRY interface replaces three converters and the positional
API door is deleted entirely. 100% migration, no deprecation shims, no compat
wrappers.

## Goal

Every avenDB row write in the repo goes through the one name-keyed, schema-checked
surface co-located in aven-db; positional writes and the duplicate converters no
longer exist.

**Completion condition** (the hand-off line for `/goal` — identical to frontmatter
`goal`):

> Positional row writes are eliminated repo-wide: `grep -rn "vec_values_to_map\|row_in_order" libs/aven-db/src libs/aven-node/src app/src-tauri/src` returns no hits and `grep -n "pub async fn create(" libs/aven-db/src/avenos_client.rs` returns no hits (only create_checked* remains); `cargo test` exits 0 in libs/aven-db and libs/aven-brain; `cargo check` exits 0 for app/src-tauri and libs/aven-node; `git diff --stat libs/aven-schema/schema.manifest.json` is empty.

## Approach

The universal interface lives in aven-db (`resolve_named_row` + `create_checked` +
`create_checked_with_id_and_metadata`) because that's where the schema lives —
validation can never drift from it. Callers keep only what aven-db cannot know:
the app's JSON-decode (sealed strings, `exposeTs` logical types) and the
owner-binding/sealing stamps; the node's named cells.

Migration is compiler-guided: change each converter's output type to
`HashMap<String, Value>`, swap every `client.create(…)` /
`create_with_id_and_metadata(…)` call to the checked variant, then **delete** the
positional API + `vec_values_to_map` + `row_in_order`. The app's `insert_values`
additionally gains unknown-key rejection (today it silently drops typos) and loses
its missing/nullable logic (now owned solely by `resolve_named_row`).

Out of scope: changing the update/delete paths (already name-keyed + validated);
any schema/manifest change (the manifest must not move — constraint in the metric);
the relay's read paths; new abstraction layers of any kind.

## Steps

1. **aven-db**: delete positional `create` + `create_with_id_and_metadata` +
   `vec_values_to_map`; `create_checked*` is the only write surface. Compile.
2. **app**: `insert_values` returns `HashMap<String, Value>`, rejects unknown JSON
   keys, drops missing/nullable logic (resolve_named_row owns it). Migrate all
   call sites (≈33 across `signers.rs`, `avendb/{caps_ipc,crud_ipc,engine,mod}.rs`)
   to `create_checked*`. Compile.
3. **aven-node**: replace `row_in_order` with named-cell maps feeding
   `create_checked_with_id_and_metadata` at the 5 sites in `aven_ceo.rs`; delete
   `row_in_order`. Compile.
4. **Verify**: greps prove elimination; `cargo test` (aven-db, aven-brain),
   `cargo check` (app, aven-node); manifest untouched.

Checkpoint: stop and review after step 2 (the app is the biggest surface).

## Files to touch

- `libs/aven-db/src/avenos_client.rs` — delete positional create APIs + `vec_values_to_map`.
- `app/src-tauri/src/avendb/mod.rs` — `insert_values` → name-keyed map + unknown-key rejection.
- `app/src-tauri/src/avendb/{caps_ipc,crud_ipc,engine}.rs`, `app/src-tauri/src/signers.rs` — swap to `create_checked*`.
- `libs/aven-node/src/aven_ceo.rs` — named cells + `create_checked_with_id_and_metadata`; delete `row_in_order`.

## Acceptance criteria

- [ ] No positional write path remains — proven by `grep -rn "vec_values_to_map\|row_in_order" libs/aven-db/src libs/aven-node/src app/src-tauri/src` (no output) and `grep -n "pub async fn create(" libs/aven-db/src/avenos_client.rs` (no output).
- [ ] Unknown column names error at every boundary — proven by the aven-db test for `resolve_named_row` unknown-column rejection passing in `cargo test`.
- [ ] All writers compile against the universal surface — proven by `cargo check` exit 0 in `app/src-tauri` and `libs/aven-node`.
- [ ] Behavior preserved — proven by `cargo test` exit 0 in `libs/aven-db` and `libs/aven-brain` (25 brain tests include real writes).
- [ ] Schema untouched — proven by `git diff --stat libs/aven-schema/schema.manifest.json` (empty).

## Verification

```bash
grep -rn "vec_values_to_map\|row_in_order" libs/aven-db/src libs/aven-node/src app/src-tauri/src   # expect: no output
grep -n "pub async fn create(" libs/aven-db/src/avenos_client.rs                                    # expect: no output
cd libs/aven-db && cargo test                                                                       # expect: exit 0
cd ../aven-brain && cargo test                                                                      # expect: exit 0
cd ../../app/src-tauri && cargo check --no-default-features --features local-voice                  # expect: exit 0
cd ../../libs/aven-node && cargo check                                                              # expect: exit 0
git diff --stat libs/aven-schema/schema.manifest.json                                               # expect: empty
```

## Hand-off

```
/board-goal 0020
```

…or hand the condition straight to the built-in goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-06-11` — Discovery: goal uncovered (make schema-drift write corruption structurally impossible, not "add a helper"), metric made transcript-provable, scope confirmed with Samuel: full unification across ALL tables/types, universal interface co-located in aven-db, compact rule applied (eliminate positional path entirely, no shims). Brain already migrated (`fa24d83`); the memories column-order outage (`43134b0`) is the motivating incident. Created directly in discover/ — the ideate+interview happened in-session.
