---
title: AvenOS technical audit — June 2026
---

# AvenOS Technical Audit — 2026-06-10

Analysis-only audit of the full monorepo (no code was modified). Every finding cites file:line; findings verified directly by the auditor are marked **[verified]**; findings from delegated deep-dives that were not independently re-checked are marked [reported].

---

## 1. Executive Summary

**Overall health: B.** This is a far more disciplined codebase than its pre-1.0 version numbers suggest: the 84k-line database core (`libs/aven-db`) has 747 passing-by-design tests and no production panics, the crypto layer (`libs/aven-caps`) uses standard primitives correctly (AAD-bound keyshares, contributory-key checks, OsRng nonces, DEK rotation tests), and there is a written threat model. What keeps it out of the A range is that **none of this quality is enforced by automation** — the repo has zero CI for tests or lint — and the single most security-critical file in the stack, the Biscuit access-control gate, has zero tests.

**Top 3 risks:**
1. `app/src-tauri/src/biscuit_resolver.rs` is the *only* row-level access control in the system (the database engine deliberately runs permissive) and is completely untested.
2. No CI: tests, lint, and type checks only run when a human remembers to run them; the only GitHub workflow deploys a package (`libs/aven-server`) that does not exist in the repo.
3. An authenticated peer can OOM any node with a single forged frame-length prefix (`libs/aven-p2p/src/transport.rs:76`).

**Top 3 opportunities:** a one-day CI workflow that locks in the existing high test quality; three S-sized hardening one-liners (frame cap, CSP, sandbox limits) that close most of the attack-surface findings; a documentation refresh, since the docs culture is already strong but the top-level entry points (README, UPSTREAM.md) have drifted from reality.

---

## 2. Repo Map

**Purpose:** AvenOS is a local-first, private-by-default "AI chief-of-staff" platform: a Tauri (Rust) + SvelteKit desktop/iOS app with on-device AI (LLM/STT/TTS via ONNX & llama.cpp), per-device cryptographic identity (Secure Enclave), encrypted P2P sync between peers, and a blind-relay server node. A SvelteKit marketing site rides along. Maturity: **late prototype heading to TestFlight** (active TestFlight docs, testnet relay, daily commits as of 2026-06-08).

**Stack:** Bun monorepo (workspaces), TypeScript + Svelte 5 frontend, Rust 1.93.1 backend (Tauri 2), RocksDB storage, Biome for lint/format, biscuit-auth + ed25519/x25519/XChaCha20 crypto, fly.io for the relay.

**Architecture sketch:**

```
SvelteKit UI (app/src) ──Tauri IPC──> app/src-tauri
  │                                      ├── jazz/ (engine host, 4.2k-line mod.rs)
  │                                      ├── biscuit_resolver.rs  ← ONLY row ACL gate
  │                                      ├── llm.rs / asr.rs / tts.rs ──> libs/aven-ai
  │                                      └── plugins: self (SE identity), vault
  │                                            (Stronghold), sandbox-quickjs
  └── libs/aven-ui, aven-city, aven-board, aven-skills (workspace TS deps)

libs/aven-db ("groove", permanent fork of jazz-tools) ── storage/sync/query engine,
   RowPolicyMode::PermissiveLocal — relies on app-layer gate above
libs/aven-caps ── biscuit capabilities + DEK keyshare crypto (shared app ↔ node)
libs/aven-p2p  ── TLS-pinned, did:key-challenged sync transport
libs/aven-node ── headless blind relay (fly.io), 10 MB/identity quota
```

**Key directories:**

| Path | What it is |
|------|------------|
| `libs/aven-db` (84.7k lines Rust) | Local-first DB core; permanent fork of jazz-tools alpha.50; ReBAC & WS stack stripped |
| `app` (27.5k lines) | Tauri + SvelteKit shell: identity, sparks, voice, LLM tools, vault UI |
| `libs/aven-caps` (2.2k) | Capability + envelope-encryption layer (biscuit, X25519/HKDF/XChaCha20) |
| `libs/aven-p2p` / `aven-node` | Sync transport / blind relay server |
| `libs/aven-ai` (2.7k) | On-device STT/LLM/TTS, HuggingFace model downloads |
| `libs/aven-ui`, `aven-city`, `aven-board`, `aven-skills`, `aven-schema` | UI components, hex-city sim, git-based kanban, data ingestor, schemas |
| `libs/aven-website` (2.9k) | Marketing site + waitlist API |
| `libs/tauri-plugin-{self,vault,sandbox-quickjs}` | Device identity, Stronghold secrets, QuickJS vibe sandbox |
| `docs/` | In-app docs **plus** real engineering docs incl. threat model (`docs/security/`) |
| `scripts/` (18 files) | Dev/release automation, incl. manual `verify-aven-db-gates.sh` |
| `ARCHIVE/` | Parked packages (OCR example, passkey plugin) |

**Surprises:** (a) a genuine threat model and trust-boundary doc exist (`docs/security/threat-model-private-default.md`) — rare at this maturity; (b) the database fork stripped its own access control on purpose, concentrating all authorization in one untested app file; (c) the only CI workflow deploys a package that isn't in the tree; (d) README describes a different repo than the one that exists.

Depth note: `aven-db`, `aven-caps`, `aven-p2p`, `aven-node`, app Rust, and the Tauri plugins received deep review. `aven-ui`, `aven-city`, `aven-board`, `aven-skills`, frontend Svelte components, and `ARCHIVE/` received lighter review (low risk surface).

---

## 3. Audit Report

### Security

| # | Sev | Finding |
|---|-----|---------|
| S1 | **High** | **The sole row-level access gate is untested.** `app/src-tauri/src/biscuit_resolver.rs` (`may_sync` :39, `verify_on_apply` :92) is, per `libs/aven-db/UPSTREAM.md`, the only row-level authorization in the stack — the engine runs `RowPolicyMode::PermissiveLocal`. The file has **0** `#[test]` functions **[verified]**. A regression here silently grants every peer access to every row, and nothing would catch it. (Fact: 0 tests. Judgment: this is the highest-leverage risk in the repo.) |
| S2 | **High** | **Unbounded sync-frame allocation → remote OOM.** `libs/aven-p2p/src/transport.rs:72-82`: `read_frame` reads a u32 length prefix and does `vec![0u8; len]` with no cap — up to 4 GiB per frame. The 64 KB cap at :63 protects only the handshake. Any peer that passes the did:key challenge (an open network) can kill a relay or a mobile device **[verified]**. |
| S3 | Medium | **CSP disabled in the app webview.** `app/src-tauri/tauri.conf.json:27` sets `"csp": null` **[verified]**. No concrete XSS was found — all doc `{@html}` sinks are DOMPurify-sanitized (`app/src/lib/docs/render-doc.ts:39`) — but an XSS anywhere in the main webview reaches `plugin:self` IPC per the project's own threat model, so CSP is the cheap second wall. |
| S4 | Medium | **QuickJS vibe sandbox has no CPU or memory bounds.** `libs/tauri-plugin-sandbox-quickjs/src/session.rs:92-128`: `Runtime::new()` + `ctx.eval(logic)` with no `set_memory_limit` / interrupt handler **[verified]**. QuickJS has no OS APIs (no escape), but vibe logic can infinite-loop or balloon memory in-process. Matters more as vibes become third-party content. |
| S5 | Medium | **Dev-insecure identity is honored in release builds.** `libs/tauri-plugin-self/src/dev_insecure.rs:74-95` stores the device root secret (root of all signing keys) plaintext on disk; `AVENOS_DEV_INSECURE_IDENTITY=1` enables it even in release [reported]. Warnings are logged, but no release-pipeline check refuses to ship with it. |
| S6 | Low | LLM tool dispatch (`app/src/lib/llm/tools.ts:393-400`) routes by name without schema-validating arguments; today's 5 tools are identity-scoped and safe by design [reported], but the framework offers no guard rail for the next tool added. |
| S7 | Low | Vault secret-ID validation is minimal (`libs/tauri-plugin-vault/src/commands.rs:64-69` — only non-empty, no `/`, not `__index__`) [reported]. |
| S8 | Low | Hardcoded testnet relay/seed in `libs/tauri-plugin-self/src/network.rs:11,17` [reported] — fine for testnet, needs a release-build guard. |
| S9 | Info | No hardcoded secrets/keys anywhere in the tree (pattern scan came back clean) **[verified]**. `.env` properly gitignored (`.gitignore:26-28`). |

### Correctness & error handling

| # | Sev | Finding |
|---|-----|---------|
| C1 | Medium | **Waitlist signups can be silently lost.** `libs/aven-website/src/routes/api/waitlist/+server.ts:36-42,47`: webhook failure is swallowed (`.catch(() => {})`) and the user still receives `{ ok: true }` **[verified]**. For a marketing site, lost signups are the worst silent failure available. |
| C2 | Low | `app/src-tauri/src/lib.rs:264` panics via `.expect()` if the Tauri builder fails; ~158 `unwrap()`s across app Rust, mostly benign mutex locks (`llm.rs:298-332`) [reported]. |
| C3 | Low | Transactional batch conflicts are correctly rejected by the engine (`libs/aven-db/src/sync_manager/inbox.rs:148-216`) but no client retry path was found [reported] — possible stuck writes under concurrency. |

### Architecture & design

| # | Sev | Finding |
|---|-----|---------|
| A1 | Medium | **God-file:** `app/src-tauri/src/jazz/mod.rs` is 4,199 lines / 42 fns **[verified]** — the engine host, schema wiring, sync orchestration, and capability plumbing in one module. Every risky change (including the active caps/keyshare work, see recent commits) lands here. |
| A2 | Medium | **All-or-nothing trust topology (deliberate, document it):** engine-side ReBAC stripped (`libs/aven-db/UPSTREAM.md` "Stripped from fork"), so the architecture is "encrypt everything + one gate at the app boundary." Sound for the threat model, but it makes S1 a single point of failure — that coupling should be stated in the threat model doc. (Judgment.) |
| A3 | Low | `aven-db` is a permanent one-way fork of an alpha upstream (UPSTREAM.md) — you own 84k lines forever. The team clearly knows; noted for cost accounting, not for action. |

### Performance

| # | Sev | Finding |
|---|-----|---------|
| P1 | Medium | Unbounded quota/rate maps on relays: `libs/aven-db/src/sync_manager/mod.rs:74,81-82` (`inbound_rate`, `quota_row_bytes`, `quota_owner_bytes`) have no expiry [reported] — long-lived relay memory grows with distinct peers/rows. |
| P2 | Low | Engine hot paths are clean: no N+1 patterns found; `runtime_tokio.rs:94-122` releases locks before awaits [reported]. Healthy — nothing else to report. |

### Testing

| # | Sev | Finding |
|---|-----|---------|
| T1 | **High** | **Test coverage is inverted relative to risk.** `libs/aven-db`: 747 tests, excellent. `libs/aven-caps`: strong crypto tests. But the app layer — where the only ACL gate (S1), vault IPC, and LLM tool dispatch live — has 6 small TS test files (`app/tests/`) covering IPC retry, table stores, and audio, and `biscuit_resolver.rs` / app `crypto.rs` have 0 Rust tests **[verified]**. |
| T2 | Medium | The gate script `scripts/verify-aven-db-gates.sh` is solid but **manual and macOS-bound** (`cargo check --target aarch64-apple-ios` at :27) — it cannot serve as portable CI as-is **[verified]**. |

### Dependencies

Healthy in one sentence each: lockfiles committed (`bun.lock`, both `Cargo.lock`s); Rust deps are current, mainstream crates (ed25519-dalek 2, blake3, rocksdb 0.48 — `libs/aven-db/Cargo.toml`); JS deps current (Svelte 5, Vite 8, Tauri 2); no unmaintained or duplicate heavyweights found. One flag: **license inconsistency** — root `LICENSE` is GPLv3 while AvenOS-owned crates declare `MIT OR Apache-2.0` (`libs/aven-db/Cargo.toml:6`, `libs/aven-caps/Cargo.toml:6`) **[verified]** (Low; matters the moment anyone external consumes a crate).

### DevEx & operations

| # | Sev | Finding |
|---|-----|---------|
| D1 | **High** | **No CI whatsoever for tests/lint/types.** `.github/workflows/` contains exactly one workflow **[verified]** — a manual fly.io deploy. Biome and the 747-test suite exist but nothing runs them on push/PR. All the quality found in this audit is one unlucky merge away from regressing undetected. |
| D2 | **High** | **The one workflow is broken.** `deploy-aven-server-mini.yml:38` deploys `--config libs/aven-server/fly.toml --dockerfile libs/aven-server/Dockerfile`, but `libs/aven-server/` does not exist in the tree **[verified]**. Either the package was removed without the workflow (and `docs/deploy/aven-server-mini.md`) following, or it lives elsewhere — either way, deploys from this repo fail today. |

### Documentation

| # | Sev | Finding |
|---|-----|---------|
| O1 | Medium | **README describes a repo that doesn't exist.** `README.md:11-12` lists `libs/aven-vibes` and `libs/aven-vibe-sandbox` (absent); :18 claims `bun install` attaches `../MaiaOS/libs/*` as workspaces, contradicted by `package.json:5-10` **[verified]**; and 9 real packages (`aven-ai`, `aven-caps`, `aven-city`, `aven-board`, `aven-skills`, `aven-node`, `aven-schema`, `aven-ui`, sandbox plugin) are missing from the table. First-day onboarding starts with false information. |
| O2 | Low | `libs/aven-db/UPSTREAM.md` access-control table names `spark_acc.rs`, `peer_sync_gate.rs`, `spark_sync.rs` — none exist; the live implementation is `biscuit_resolver.rs` **[verified]**. This is the document a security reviewer would trust first. |

### Strengths (preserve these)

1. **`aven-db` engineering quality**: 747 tests, zero production panics, digest verification (`sync_manager/inbox.rs:61-68`), inbound rate/size caps (:1032-1072), three-state capability gate that never drops frames during ACL hydration (`capability.rs:155-181`) [reported, spot-checked].
2. **Crypto done by the book** in `aven-caps`: standard primitives, AAD-bound keyshare wrapping, low-order-key rejection, DEK-rotation isolation tests [reported] — and recent commits (`7daa711`) show active, thoughtful hardening.
3. **Transport security**: TLS cert pinning + did:key challenge with TLS-exporter channel binding (`aven-p2p`) [reported].
4. **Security thinking in writing**: `docs/security/threat-model-private-default.md` with an explicit adversary table.
5. **Hygiene**: clean working tree, 11 TODOs across ~130k lines **[verified]**, Biome configured repo-wide, no secrets, lockfiles committed.

---

## 4. Improvement Strategy

### Theme 1 — Nothing is enforced (explains D1, D2, T2, and the *risk* behind every other finding)
**Target state:** every push/PR runs Biome, `cargo test` for `aven-db`/`aven-caps`/`aven-p2p`, `bun test` + `svelte-check` for `app`, on Linux runners; merges blocked on red. **Principle:** quality that isn't enforced is a snapshot, not a property.

### Theme 2 — Authorization is a single untested point (S1, A2, T1)
**Target state:** `biscuit_resolver.rs` has a behavioral test suite (grant/deny/revoke/regrant matrices mirroring `aven-caps`' own tests), and the threat model documents that this file is the only gate. **Principle:** test depth should be proportional to blast radius — today it's inversely proportional.

### Theme 3 — Trust boundaries lack resource bounds (S2, S4, P1)
**Target state:** every input from a remote peer or third-party content has an explicit cap: max sync frame bytes, QuickJS memory + interrupt limits, expiring quota maps. **Principle:** authenticate *and* budget; authentication doesn't stop resource exhaustion.

### Theme 4 — Docs drift at the entry points (O1, O2, D2)
**Target state:** README and UPSTREAM.md match the tree; broken deploy workflow removed or repointed. **Principle:** the docs culture is already strong — the fix is a refresh pass plus deleting falsifiable claims, not new process.

### Explicitly NOT recommended
- **Re-adding engine-level ReBAC** — the permissive-engine + app-gate design fits the threat model; testing the gate is cheaper than rebuilding policy evaluation.
- **Breaking up `storage/memory.rs` (3.7k lines) or other aven-db big files** — well-tested, cohesive, stable; refactor risk exceeds payoff.
- **Sweeping the ~158 app-layer `unwrap()`s** — mostly benign mutex locks; fix only `lib.rs:264` and any on network/user input paths.
- **Enterprise observability/deployment infra** — premature before there is a deployed server package.
- **Validating S6 further now** — current tools are safe by design; add dispatcher-level schema validation when the next tool lands.

### Definition of done (measurable)
- CI red on lint/type/test failure; required for merge.
- `biscuit_resolver.rs` test count ≥ 12 covering allow/deny/revoke/regrant/owner-binding paths.
- `read_frame` rejects frames above a configured cap; test proves it.
- Zero High findings open; README/UPSTREAM contain no statements contradicted by the tree.

---

## 5. Task Plan

### Quick wins (do immediately, all S)
| QW | Task | Files |
|----|------|-------|
| QW1 | Cap sync frame size in `read_frame` | `libs/aven-p2p/src/transport.rs:72-82` |
| QW2 | Log + alert on waitlist webhook failure; return degraded status | `libs/aven-website/src/routes/api/waitlist/+server.ts:36-47` |
| QW3 | Enable a baseline CSP | `app/src-tauri/tauri.conf.json:27` |
| QW4 | Fix or delete the broken deploy workflow | `.github/workflows/deploy-aven-server-mini.yml` |
| QW5 | README + UPSTREAM.md refresh | `README.md`, `libs/aven-db/UPSTREAM.md` |

### Milestone 0 — Safety net
| ID | Task | Areas | Acceptance | Effort | Risk | Deps |
|----|------|-------|------------|--------|------|------|
| M0.1 | **CI workflow**: Biome + Rust tests (`aven-db --features client-p2p`, `aven-caps`, `aven-p2p`) + `bun test`/`svelte-check` for app, Linux runners, branch protection | `.github/workflows/ci.yml` | PR with failing test cannot merge | M | Low (additive) | — |
| M0.2 | **Biscuit gate test suite**: behavioral tests for `may_sync`/`verify_on_apply` — owner, reader, revoked, regranted, unknown peer, missing owner-binding | `app/src-tauri/src/biscuit_resolver.rs` | ≥12 tests, deny-by-default asserted | L | Low (tests only) | M0.1 |
| M0.3 | Decouple iOS check from the portable gate script (flag or separate script) so M0.1 can reuse it | `scripts/verify-aven-db-gates.sh` | Script passes on Linux | S | Low | — |

### Milestone 1 — Critical fixes (security/correctness)
| ID | Task | Areas | Acceptance | Effort | Risk | Deps |
|----|------|-------|------------|--------|------|------|
| M1.1 | QW1 frame cap + unit test (oversized prefix → clean error, connection drop) | `aven-p2p/src/transport.rs` | Test proves rejection; relay survives forged prefix | S | Low | M0.1 |
| M1.2 | QW3 CSP: start `default-src 'self'` + the asset/ipc sources Tauri needs; verify all views incl. vault webview | `app/src-tauri/tauri.conf.json` | App fully functional with CSP on; documented in threat model | S–M | **Medium** (can break webview features — test every route) | — |
| M1.3 | QW2 waitlist failure handling | `aven-website` waitlist route | Webhook failure logged + non-`ok` telemetry path | S | Low | — |
| M1.4 | Release-build guard for `AVENOS_DEV_INSECURE_IDENTITY` (compile-out or hard-fail in release unless explicit override), and release-checklist item for testnet relay constants | `libs/tauri-plugin-self/src/dev_insecure.rs`, `network.rs`, `scripts/release-app.ts` | Release build with flag set refuses to start (or strips path) | S | Low | — |

### Milestone 2 — High-leverage improvements
| ID | Task | Areas | Acceptance | Effort | Risk | Deps |
|----|------|-------|------------|--------|------|------|
| M2.1 | QuickJS limits: `set_memory_limit` (~32 MB) + interrupt-handler deadline (~2s) per eval | `tauri-plugin-sandbox-quickjs/src/session.rs` | Infinite-loop fixture aborts with error, UI stays live; test included | S | Low | M0.1 |
| M2.2 | Expiry/compaction for relay quota & rate maps | `aven-db/src/sync_manager/mod.rs:74-82` | Bounded memory under churn test | M | Medium (sync core) | M0.1 |
| M2.3 | Split `jazz/mod.rs` (4.2k lines) along existing seams (engine host / schema wiring / sync orchestration / caps plumbing), no behavior change | `app/src-tauri/src/jazz/` | No file >1.5k lines; `cargo check` + existing tests green | L | Medium | M0.1, M0.2 |
| M2.4 | Schema-validate LLM tool arguments in the dispatcher (single choke point) | `app/src/lib/llm/tools.ts:393` | Malformed args rejected pre-executor; test per tool | M | Low | M0.1 |
| M2.5 | QW4: restore `libs/aven-server` (if it should exist) or remove workflow + stale deploy docs | `.github/workflows/`, `docs/deploy/aven-server-mini.md` | Workflow either succeeds or is gone | S (delete) / XL (restore) | Low | Owner decision (OQ1) |

### Milestone 3 — Quality & polish
| ID | Task | Effort |
|----|------|--------|
| M3.1 | QW5 docs refresh: README package table, drop MaiaOS workspace claim, fix UPSTREAM.md ACL table to name `biscuit_resolver.rs` | S |
| M3.2 | Resolve license inconsistency (GPLv3 root vs MIT/Apache crates) — pick intent, align metadata | S |
| M3.3 | Replace `lib.rs:264` startup `.expect()` with logged graceful exit; audit unwraps on network/user-input paths only | S |
| M3.4 | Tighten vault secret-ID validation (length cap + charset) | S |
| M3.5 | Document client behavior on `transaction_conflict` rejection (retry or surface) | S–M |
| M3.6 | Stricter waitlist email validation | S |

### Implementation sketches — top 3

**M0.1 CI workflow.** Two jobs in `ci.yml`: `js` (oven-sh/setup-bun → `bun install` → `bunx biome ci .` → `cd app && bun test tests` → `bun run check` minus `docs:words` if it's noisy) and `rust` (dtolnay/rust-toolchain@1.93.1 + Swatinem/rust-cache → `cargo test -p aven-db --features client-p2p` → `cargo test -p aven-caps -p aven-p2p`). Gotchas: repo uses a shared cargo target dir (`.cargo/config.toml` → `target/rust`) — fine on CI but make the cache key match; `app check` runs `docs:words` which may be a word-count gate you don't want blocking; **don't** run `cargo check` for `app/src-tauri` initially (needs WebKitGTK system deps — add the apt list from README.md:58-71 in a later iteration); skip the iOS target check entirely (M0.3).

**M1.1 Frame cap.** Add `const MAX_SYNC_FRAME_BYTES: usize = 32 * 1024 * 1024;` (size it from the engine's own 64 MiB row cap — frames carry batches, so confirm against `sync_manager` M5 limits and pick the smaller envelope that still fits a max batch). In `read_frame`, return `None` (or better, switch to `Result` so the caller can log peer + len before dropping) when `len > MAX`. Also prefer `read_exact` into a capped, pre-zeroed buffer as today — the fix is purely the bound. Add a unit test writing a `0xFFFF_FFFF` prefix into a duplex stream. Gotcha: both client (`ServerSyncTransport`) and server (`ServerListener`) read loops use this helper — one fix covers both; verify nothing legitimately sends >32 MiB by checking existing codec tests (`libs/aven-db/tests/sync_transport_codec.rs`).

**M0.2 Biscuit gate tests.** Build a `#[cfg(test)]` harness in `biscuit_resolver.rs` constructing the resolver from in-memory biscuit chains via `aven-caps` helpers (its own tests at `libs/aven-caps/src/caps.rs` show how to mint genesis/delegate/revoke). Matrix: owner read/write allow; delegated reader read-allow/write-deny; revoked member deny; revoke→regrant allow (the bug class fixed in commit `80455a1` — encode it as a regression test); unknown peer deny; `verify_on_apply` with valid/missing/forged owner-binding. Gotcha: `verify_on_apply` currently allows when `proof` is `None` by design (blind-relay semantics, mirrored in `libs/aven-node/src/main.rs:126-144`) — assert that behavior *explicitly* so any future tightening is a conscious choice.

---

## 6. Open Questions

1. **`libs/aven-server`** — was it removed deliberately? The deploy workflow, `docs/deploy/aven-server-mini.md`, and README's MaiaOS references suggest history this audit can't see. Decides M2.5 (delete vs restore). Is `aven-node` its successor?
2. **License intent** — is GPLv3 the real license for AvenOS-owned crates, or the repo-level default? Affects crate metadata and any future external consumers.
3. **Production relay topology** — who runs relays at mainnet? P1 (quota map growth) and M1.1 sizing depend on expected peer counts and whether an upstream proxy enforces connection-level rate limits (aven-node currently assumes it does).
4. **Linux as a release target** — dev-insecure identity is the only Linux identity path today. If Linux ships to users, a keyring/TPM-backed store becomes a roadmap item, not a footnote.
5. **Third-party vibes** — will vibe logic ever come from untrusted sources? If yes, M2.1 sandbox limits escalate from Medium to High priority and need fuel-style metering, not just a deadline.
6. **`docs:words` gate** — is the word-count check (`app` `check` script) meant to block CI or stay advisory?
