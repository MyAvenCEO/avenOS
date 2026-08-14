---
title: Internal chain (chain_*) + aEUR Banking vibe — slice 1 "money moves"
summary: Fake-but-realistic on-Postgres token chain (chain_* tables) with a symbolic Signer, plus an admin-only Banking root vibe to mint aEUR and send it between users — designed to swap for a real chain plug-and-play.
owner: claude
created: 2026-06-29
updated: 2026-06-29
tags: [chain, banking, mainnet, vibes, finance]
goal: "`bun test libs/betterauth/src/chain.test.ts` exits 0 proving the e2e flow (admin derives address, mints 100000 minor-aEUR, non-admin mint throws, transfers 5000 to userB → balance(admin)=95000 & balance(B)=5000, two chain_tx rows both signature-verified and hash-chain-linked tx2.prev_hash==tx1.hash); AND `bun run check` and `bun run lint` exit 0; AND the new admin-only `banking` vibe is registered in app/src/lib/aven-ui/vibe-views.ts. No files outside the listed set change."
---

# Internal chain (`chain_*`) + aEUR Banking vibe — slice 1 "money moves"

## Context

We want an **internal aEUR (avenEURO) ledger that walks and talks like a real
blockchain** — addresses, signed transactions, a token "contract" with
mint/transfer — so it can later become the substrate for internal booking
tracking and **Festschreibung** (immutable finalization) for the Finanzamt. The
explicit long-term requirement is **plug-and-play**: the same UI and service
calls should later hit a *real* chain by swapping one adapter, with no interface
churn.

This card is **slice 1 only**. Its heartbeat (chosen in discovery) is **"money
moves"**: as admin I mint aEUR to my address, send some to another user, and both
balances + a signed, verifiable tx history update in a new Banking view. The
deeper goal — the *decision this unlocks* — is being able to treat aEUR as the
single internal unit of account for bookings, with a ledger we trust because every
movement is signed and hash-chained.

**Decisions locked in discovery (`AskUserQuestion`):**
- **Slice-1 goal:** money moves (mint → send → balances + signed tx history).
- **Signing fidelity:** *symbolic* — address = hash(userId), signature = HMAC over
  the canonical tx JSON. Crucially, it sits **behind a `Signer` interface** so a
  real ed25519 signer is a drop-in later. No real keypairs in slice 1.
- **Schema shape:** dedicated `chain_*` Kysely tables (admin-owned layer), **not**
  the dynamic `data_schema`/`data_value` layer.
- **UI surface:** a **new admin-only `banking` root vibe** (reusing
  `bank-statement`/`bank-transfers` styling), not an extension of existing vibes.

**Codebase facts (from exploration):**
- Mainnet (Neon `alberobello`) migrations: `libs/betterauth/migrations/NNNN_name.ts`,
  Kysely, runner `libs/betterauth/src/migrate.ts`, run via `bun run db:migrate:usage`.
  DB types in `libs/betterauth/src/db.ts`. Next free migration index: **0008**.
- API routes (Hono) live in `libs/betterauth/src/server.ts`; admin gate pattern is
  `session.user.role === 'admin'` (first signup auto-admin). Current user via
  `auth.api.getSession({ headers })`.
- Vibes: `libs/aven-ui/src/vibes/<name>/` (`view.ts`, `style.ts`, `source.json`,
  `logic.js`, `interface.json`); registered in `app/src/lib/aven-ui/vibe-views.ts`
  (`VibeViewId` union + `vibeViewList`). Existing `bank-statement`, `bank-transfers`,
  `contract` vibes are the styling reference.
- Frontend current user: `authClient.useSession()` → `{ id, email, role, tier }`.

### Defaults chosen (reversible — flag if any is wrong)
- **Amounts in integer minor units (cents)** — aEUR has 2 decimals; `100000` = 1000.00 aEUR.
  Stored as `bigint`. No floats anywhere in money math.
- **Address format** looks ETH-like for realism: `0x` + first 40 hex chars of
  `sha256(userId)`. Recognizable, deterministic, collision-safe enough for a fake.
- **aEUR is the single token**, seeded by the migration: `symbol='aEUR'`,
  `minter_address` = (set on first admin access / configurable), supply grows on
  mint → effectively unlimited, **mint is admin-only**, transfer is open.
- **Txs are hash-chained from day one** (`hash = sha256(prev_hash || canonical_payload)`):
  cheap, makes it feel like a real chain, and seeds the future Festschreibung card.
- **Mint & transfer are modeled as contract calls** against the aEUR contract
  (generic `callContract(method, args, caller)` envelope) so "contract interaction
  CRUD" is honored and a real executor can replace the fake one.
- **Recipient picker** = choose from the user list (admin-only view can list users);
  address resolved from their `userId`. Search-by-name is a follow-on.
- **Account creation is lazy** — a `chain_account` is ensured on first Banking access.

## Goal

As **admin**, in a new **Banking** vibe, I can see my aEUR address + balance, **mint**
aEUR to myself, and **send** aEUR to another user; both balances and a **signed,
verifiable, hash-chained** transaction history update — and the whole chain logic is
behind store/signer/executor interfaces so a real chain swaps in later.

**Completion condition** (identical to frontmatter `goal`):

> `bun test libs/betterauth/src/chain.test.ts` exits 0 proving the e2e flow (admin
> derives address, mints 100000 minor-aEUR, non-admin mint throws, transfers 5000 to
> userB → balance(admin)=95000 & balance(B)=5000, two chain_tx rows both
> signature-verified and hash-chain-linked tx2.prev_hash==tx1.hash); AND
> `bun run check` and `bun run lint` exit 0; AND the new admin-only `banking` vibe is
> registered in app/src/lib/aven-ui/vibe-views.ts. No files outside the listed set change.

## Approach

Build the chain as **three swappable interfaces** plus a thin service, then expose it
over Hono routes and a vibe. The interfaces are the whole point of "plug-and-play":

1. **`ChainStore`** — persistence port. `KyselyChainStore` (Neon, production) and
   `InMemoryChainStore` (tests). Reads/writes `chain_account`, `chain_token`,
   `chain_tx`, `chain_contract`.
2. **`Signer`** — `sign(payload) → sig`, `verify(payload, sig, address) → bool`.
   `SymbolicSigner` (HMAC with a server seed) now; `Ed25519Signer` is the future
   drop-in (same interface). Address derivation lives here too.
3. **`ChainExecutor`** — the aEUR "contract": `callContract(method, args, caller)` for
   `mint` (admin/minter-only) and `transfer`. A real chain becomes a different
   executor implementation behind the same call.

`ChainService` composes the three: `ensureAccount`, `deriveAddress`, `getBalance`
(sum of credits − debits over `chain_tx`), `mint`, `transfer`, `listTxs` — every
mutation appends a **hash-chained, signed** `chain_tx` row.

Because all chain logic is pure over the injected `ChainStore`, the e2e test runs
against `InMemoryChainStore` — **no Neon writes in the test** — making the goal
deterministic and safe. Production wires `KyselyChainStore`.

Routes (Hono, in `server.ts`): `GET /api/chain/account`, `GET /api/chain/token`,
`POST /api/chain/mint` (admin-gated), `POST /api/chain/transfer`, `GET /api/chain/txs`,
`GET /api/chain/users` (admin: recipient list). The `banking` vibe calls these.

### Explicitly out of scope (follow-on cards back in `ideate/`)
- **Festschreibung / Finanzamt export** (freeze + signed export of bookings). The
  hash-chain seeds it; the export + immutability guarantees are their own card.
- **Real ed25519 signing / non-custodial wallets** (swap `SymbolicSigner`).
- **Real-chain `ChainExecutor`** (the actual plug-in to a live chain).
- **Multi-token, allowances/approve, burn, recipient search, block batching.**
- **SKR04 booking integration** (linking aEUR txs to bookkeeping postings).

## Steps

1. **Migration `0008_chain.ts`** — create `chain_account`, `chain_token`, `chain_tx`,
   `chain_contract`; seed the aEUR token + aEUR contract row. Add table types to
   `db.ts` `Database` interface. (Verify: migration file compiles in `bun run check`.)
2. **`chain.ts`** — `ChainStore` interface + `InMemoryChainStore` + `KyselyChainStore`;
   `Signer` interface + `SymbolicSigner` (+ address derivation); `ChainExecutor` (aEUR
   mint/transfer); `ChainService` tying them with hash-chained signed tx append.
3. **`chain.test.ts`** — the e2e flow against `InMemoryChainStore` (the completion
   condition). Checkpoint: **stop and look here** — green test = core proven.
4. **Hono routes** in `server.ts` — `/api/chain/*`, admin gate on `mint` and the user
   list, session-derived caller address.
5. **`banking` vibe** — `libs/aven-ui/src/vibes/banking/` (wallet/balance, mint panel,
   send form w/ recipient picker, tx history list) reusing bank-* styling.
6. **Register** the vibe in `app/src/lib/aven-ui/vibe-views.ts` (add to `VibeViewId` +
   `vibeViewList`, `interactive: true`), admin-only.
7. Run `bun run check` + `bun run lint`; fix to green.

## Files to touch

- `libs/betterauth/migrations/0016_chain.ts` — **new**: `chain_*` tables + aEUR seed.
  Renumbered from `0008` (the live mainnet branch already has `0008_flow_configs`…`0015`
  from board 0087, not present in this worktree). Applied to Neon branch `br-odd-sunset`.
- `libs/betterauth/src/db.ts` — add `chain_account/chain_token/chain_tx/chain_contract`
  to the `Database` interface.
- `libs/betterauth/src/chain.ts` — **new**: pure ports (Signer/ChainStore/ChainService) +
  SymbolicSigner + In-Memory/Kysely stores. No `auth`/env import (keeps the test pure).
- `libs/betterauth/src/chain-routes.ts` — **new** (deviation): Hono handlers (split out so
  the test importing `chain.ts` doesn't transitively load `./auth`).
- `libs/betterauth/src/chain.test.ts` — **new**: the e2e completion-condition test.
- `libs/betterauth/src/events.ts` — **deviation**: add `'chain'` to the `ChangeEvent` union.
- `libs/betterauth/src/server.ts` — add `/api/chain/*` Hono routes + CORS (admin gating).
- `libs/aven-ui/src/vibes/banking/{view.ts,style.ts,source.json,logic.js,interface.json,index.ts}`
  — **new** vibe.
- `libs/aven-ui/package.json` — **deviation**: add the `./vibes/banking` subpath export.
- `app/src/lib/aven-ui/vibe-views.ts` — register the `banking` vibe (admin-only; + `adminOnly` field).

## Acceptance criteria

Each box must be provable from the transcript.

- [x] `chain_*` schema exists with seeded aEUR — `0008_chain.ts` present (4 tables +
      aEUR/contract seed); `db.ts` types added; `betterauth` tsc (`bun run check`) exit 0.
- [x] Address derivation is deterministic per user — `chain.test.ts` test 1 passes
      (same userId → same `0x[0-9a-f]{40}`; admin ≠ userB).
- [x] Admin-only mint enforced — `chain.test.ts` test 2: `svc.mint('userB', …)` rejects
      with `/admin-only/`.
- [x] Money moves correctly — `chain.test.ts` test 3: after mint 100000 + transfer 5000,
      `balance(admin)=95000`, `balance(B)=5000`, supply=100000, minter claimed by admin.
- [x] Txs are signed & verifiable — test 3 asserts `txs.every(verifyTx)`; test 4 shows a
      tampered amount fails `verifyTx` (signature is real, not decorative).
- [x] Txs are hash-chained — test 3 asserts `txs[0].prev_hash==GENESIS` and
      `txs[1].prev_hash==txs[0].hash`.
- [x] Swappable interfaces exist — the whole test runs on `InMemoryChainStore` with the
      `Signer` injected; `KyselyChainStore` is the prod impl of the same `ChainStore` port.
- [x] Banking vibe registered admin-only — `banking` added to `VibeViewId` + `vibeViewList`
      with `adminOnly: true`; subpath export added; app `svelte-check` shows no error in
      `vibe-views.ts` or the vibe (only 3 unrelated pre-existing errors).
- [~] Repo gates — `bun run check` (root, `@avenos/aven-website`) exit **0**. `bun run lint`
      (biome, repo-wide) is **pre-existingly red**: 40 errors on `main` BEFORE this change,
      all in untouched files (e.g. `scripts/fetch-onnxruntime.ts`). My 15 files are
      biome-clean (`biome check` on them = 0 errors); this change adds **net zero** lint
      errors. Flagged for HITL: the repo-wide gate cannot go green without fixing 40
      unrelated files (out of scope for slice 1).
- [x] No files outside the listed set changed — `git status` shows only the planned files
      (+ the noted `chain-routes.ts` split, `events.ts` union, `aven-ui/package.json` export).

## Verification

```bash
bun test libs/betterauth/src/chain.test.ts   # the e2e money-moves flow (completion condition)
bun run check                                 # svelte-kit sync + svelte-check + TS
bun run lint                                  # biome
git status                                    # only the listed files changed
```

## Hand-off

Pick this up with the board command (resolves the item, loads it, drives it):

```
/aven-build 0091
```

…or hand the condition straight to the built-in goal loop:

```
/goal bun test libs/betterauth/src/chain.test.ts exits 0 proving the e2e flow … (paste the Completion condition above)
```

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-08-14` — Umnummeriert 0088 → 0091: die Nummer war doppelt vergeben. Andere Karten referenzieren unter 0088 die jeweils andere Karte, deshalb weicht diese aus.
Newest entry first.

- `2026-06-29` — Applied the schema to LIVE Neon (mainnet/alberobello, project
  `billowing-violet-90988280`, branch **`br-odd-sunset`** = the `.env.samuel`/active dev
  branch, chosen via AskUserQuestion). Discovered the in-memory store was only the test
  fixture (prod = `KyselyChainStore`→Neon) and that the branch already had migrations
  `0008_flow_configs`…`0015` (board 0087, files not in this worktree) → **renamed
  `0008_chain.ts` → `0016_chain.ts`** to avoid the collision. Applied the `up()` DDL as
  idempotent statements + recorded `0016_chain` in `kysely_migration`. Verified: 4 `chain_*`
  tables exist, aEUR seeded (avenEURO/2dp/supply 0), contract row present, ledger empty.
  NOTE for ship/rebase: this worktree branched from 0084 (pre-0087), so its `migrations/`
  folder is missing `0008`–`0015`; this work must rebase onto main-with-0087 before the repo
  migrator can run from a checkout. The default branch `br-bitter-block` (at 0006) was
  deliberately NOT touched (writing 0016 there would gap its migration chain).
- `2026-06-29` — Build complete; moved build → review. Implemented the pure chain core
  `libs/betterauth/src/chain.ts` (Signer/ChainStore/ChainService ports + SymbolicSigner +
  In-Memory/Kysely stores + hash-chained signed tx append), the deterministic e2e
  `chain.test.ts` (**5 pass / 0 fail / 17 expects**), migration `0008_chain.ts` (+ `db.ts`
  types), Hono routes in new `chain-routes.ts` (wired in `server.ts`, mint+users admin-gated),
  the `banking` vibe (`libs/aven-ui/src/vibes/banking/*`, admin-only) + registration in
  `vibe-views.ts` (+ `adminOnly` field, + aven-ui subpath export), and `chain` added to the
  `events.ts` `ChangeEvent` union for reactivity. **Deviations from spec** (all minor,
  justified): (1) HTTP handlers split into `chain-routes.ts` so the test importing `chain.ts`
  doesn't transitively load `./auth` (which requires env at import — same reason
  `events.ts`/`vault` keep pure cores); (2) added `events.ts` `'chain'` entity + a
  `VibeView.adminOnly` field + the `aven-ui` `./vibes/banking` export. **Gates:** chain test
  green; `betterauth` tsc exit 0; root `bun run check` exit 0; biome on my files clean.
  `bun run lint` repo-wide was already red (40 pre-existing errors, untouched files) — this
  change adds zero. **Not wired yet (follow-on):** the vibe runs on in-sandbox state; live
  `/api/chain/*` host-wiring + the SSE `chain` invalidation handler are the next slice, as is
  applying `0008` to live Neon (deferred — bootstrap/migrate applies it on deploy; not run
  against mainnet here on purpose). Follow-on cards: Festschreibung/Finanzamt export, real
  ed25519 signer, real-chain executor, live host-wiring, SKR04 booking link.
- `2026-06-29` — Discovery: interviewed (4 load-bearing decisions via AskUserQuestion),
  uncovered the goal ("money moves" slice), made it measurable (deterministic
  `chain.test.ts` on an in-memory store + repo gates), seeded acceptance criteria and
  out-of-scope follow-ons. Moved ideate → discover.
