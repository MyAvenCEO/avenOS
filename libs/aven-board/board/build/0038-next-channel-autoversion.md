---
title: CalVer "next" prerelease channel — auto tags + changelog (Milestone 1)
summary: On merge to a new `next` branch, a custom bun script derives a CalVer version (YY.M.micro, e.g. 26.6.1-next.1) from the date + existing tags, stamps ONE unified version across every package, generates the changelog from conventional commits, and pushes the prerelease tag — no app build, no deploy yet.
owner: claude
created: 2026-06-14
updated: 2026-06-14
tags: [ci, release, versioning, calver]
goal: "`bun run next-version --channel next` prints a CalVer prerelease matching `^[0-9]{2}\\.[0-9]{1,2}\\.[0-9]+-next\\.[0-9]+$` (today → 26.6.1-next.1), exits 0, and the value passes `semver.valid`; `bun run set-version 26.6.1-next.1` makes every workspace package.json, every Cargo.toml `[package].version`, and app/src-tauri/tauri.conf.json read `26.6.1-next.1` (grep) with `git diff --name-only` showing only version-bearing files; `bun run changelog` exits 0 and leaves a non-empty CHANGELOG.md; `echo 'feat: x' | bunx commitlint` exits 0 and `echo 'nope' | bunx commitlint` exits non-zero; `bunx --yes yaml-lint .github/workflows/release-next.yml .github/workflows/commitlint.yml` exit 0; `grep -iE 'altool|productbuild|\\.pkg|\\.ipa|testflight|release:app|deploy:server|sprite|semantic-release' .github/workflows/release-next.yml package.json` finds no build/deploy tooling; `bun run check` and `bun run lint` exit 0"
---

# CalVer "next" prerelease channel — auto tags + changelog (Milestone 1)

## Context

Today every workspace package (`app`, `libs/*`, `docs`) and every Rust crate is
hardcoded `0.0.1`; `app/src-tauri/tauri.conf.json` is `0.0.1`; there are **zero git
tags** and **no changelog tooling**. Commits already follow conventional-commits
style (`fix(scope):`, `feat`, `revert:`) but nothing enforces it.

We want a **`next` staging channel**: merging into a new `next` branch should
automatically compute the next version, stamp it everywhere, update a changelog, and
push a unique prerelease tag. Versioning is **CalVer** (date-based, continuous
release cycles) — not semver bump-from-commit-type.

**This card is Milestone 1 only: tags + changelog, fully automatic. NO app build,
NO upload, NO deploy.** Milestone 2 is a separate card ([[0039-next-channel-release-deploy]]).

### Decisions locked in discovery (all confirmed by the user)

- **CalVer, format `YY.M.MICRO`** — two-digit year, **unpadded** month, monthly-reset
  micro. Today (June 2026) → first next tag `v26.6.1-next.1`. Next June release →
  `26.6.2-next.1`; July rolls over → `26.7.1-next.1`.
  - **Why unpadded month is mandatory, not a preference:** semver forbids leading
    zeros, and `package.json` / `Cargo.toml` / `tauri.conf.json` all reject
    non-semver versions. `26.06.1` is therefore *illegal*; `26.6.1` is the legal
    form. Months still sort correctly (semver compares `6 < 10 < 12` numerically).
  - **Micro = "Nth release this month"**, derived by scanning git tags for the
    current `YY.M` and incrementing (start at 1 if none). No genesis/seed tag is
    needed — derivation handles the empty-repo case.
- **No major/minor/patch logic.** The number is a pure fact of *when* you shipped
  (`currentYear.currentMonth.countThisMonth`), never a judgment about *what* changed.
  The whole bump-decision problem (and the "explicit major marker" question) is gone.
- **Tooling = custom bun script + conventional-changelog** — semantic-release's
  engine *computes* a semver bump from commit types, which CalVer makes pointless.
  A small derive-version script + `conventional-changelog` for notes + `gh` for the
  release is simpler and fully controllable. **No semantic-release dependency.**
- **Prerelease suffix `-next.N`** — the `-next.N` counter climbs per merge while the
  micro is staged (`26.6.1-next.1`, `-next.2`, …); graduates to plain `v26.6.1` on
  `main` when stable (Milestone 2).
- **commitlint enforced in CI from day one** — conventional commits no longer drive
  the *version*, but they still drive a clean, grouped **changelog**, so we keep the
  PR gate.

**Assumption to confirm at review:** `next` is a prerelease branch cut from `main`;
`main` stays the future **stable** channel (`v26.6.1`, no suffix). This card only
wires the `next`-triggered workflow; stable-on-`main` is Milestone 2.

## Goal

Merging to `next` auto-produces a unique CalVer prerelease tag (`vYY.M.micro-next.N`)
+ an updated `CHANGELOG.md` + that same version stamped across the whole monorepo —
derived from the date + existing tags, with non-conventional commits blocked in CI.

**Completion condition** (identical to frontmatter `goal`):

> `bun run next-version --channel next` prints a CalVer prerelease matching
> `^[0-9]{2}\.[0-9]{1,2}\.[0-9]+-next\.[0-9]+$` (today → `26.6.1-next.1`), exits 0,
> and the value passes `semver.valid`; `bun run set-version 26.6.1-next.1` makes
> every workspace `package.json`, every `Cargo.toml` `[package].version`, and
> `app/src-tauri/tauri.conf.json` read `26.6.1-next.1` (grep) with
> `git diff --name-only` showing only version-bearing files; `bun run changelog`
> exits 0 and leaves a non-empty `CHANGELOG.md`; `echo 'feat: x' | bunx commitlint`
> exits 0 and `echo 'nope' | bunx commitlint` exits non-zero; both workflows pass
> `yaml-lint`; the `next` workflow + `package.json` contain no build/deploy/altool/
> testflight/semantic-release tooling; `bun run check` and `bun run lint` exit 0.

## Approach

A bun script computes the version purely from the current date + existing git tags,
so there's nothing semver-ish to "decide". The CI workflow on push to `next` chains:
derive → stamp everywhere → changelog → commit `[skip ci]` → tag → push → GitHub
prerelease.

**`scripts/next-version.ts`** (pure, side-effect-free → this is the dry-run proof):
- `YY = year % 100`, `M = month` (1–12, unpadded), from `new Date()` (a normal bun
  process — `Date` is available; this is not the Workflow-tool sandbox).
- Stable micro for this month: scan `git tag` for `vYY.M.<n>` (no suffix), take
  `max(n)`; base micro = that + 1, or `1` if none.
- `--channel next`: among `vYY.M.<baseMicro>-next.<k>` tags take `max(k)`; emit
  `YY.M.<baseMicro>-next.<k+1>` (or `…-next.1` if none). The micro stays fixed across
  the prerelease series until it graduates to stable on `main`.
- Validate the result with `semver.valid` before printing; exit non-zero if invalid.

**`scripts/set-version.ts`** (unified stamper — the "standardize across subpackages"
core): takes a version, rewrites only the version field in every `package.json`
matched by the workspace globs (`app`, `libs/*`, `docs`; skip `ARCHIVE/*` +
`node_modules`), every `Cargo.toml` with a `[package]` table, and `tauri.conf.json`.
Idempotent; touches nothing else (so the `git diff --name-only` constraint holds).
Runnable standalone so the metric is provable locally.

**Changelog**: `conventional-changelog-cli` prepends entries to `CHANGELOG.md` from
commits since the last tag (`bun run changelog`).

**`scripts/release-next.ts`** (the CI orchestrator): `next-version` → `set-version`
→ `changelog` → `git commit -m "chore(release): vX [skip ci]"` → `git tag vX` →
push commit + tag → `gh release create vX --prerelease --notes-file …`.

Local provability: `next-version` and `set-version` and `changelog` all run off-CI,
so the full mechanism is provable from the transcript without a real merge.

**Out of scope (this card):** any app build (`.pkg`/`.ipa`), altool upload,
TestFlight, sprite/node-server deploy, the stable-on-`main` workflow, build-number
(`CFBundleVersion`) wiring, and `Cargo.lock` checksum churn.

## Steps

1. Add devDeps to root `package.json`: `conventional-changelog-cli`, `semver`,
   `@commitlint/cli`, `@commitlint/config-conventional`. (No semantic-release.)
2. Write `scripts/next-version.ts` (pure CalVer derivation) + a `next-version`
   script entry. Verify it prints `26.6.1-next.1` today on a tagless repo.
3. Write `scripts/set-version.ts` (unified stamper) + a `set-version` entry. Verify
   it stamps all files and touches nothing else.
4. Add a `changelog` script entry (`conventional-changelog -p angular -i CHANGELOG.md -s`).
5. Write `scripts/release-next.ts` (derive → stamp → changelog → commit → tag →
   push → gh release) + a `release:next` entry.
6. Add `commitlint.config.cjs` (extends config-conventional). Verify good/bad msgs.
7. Add `.github/workflows/release-next.yml` — `on: push: branches: [next]`,
   `fetch-depth: 0`, runs `bun run release:next` with `GITHUB_TOKEN`. No build/deploy.
8. Add `.github/workflows/commitlint.yml` — PR gate that lints commit messages.
9. Run the full Verification block; confirm `check` + `lint` stay green.

## Files to touch

- `package.json` — devDeps + `next-version` / `set-version` / `changelog` / `release:next` script entries.
- `scripts/next-version.ts` — NEW pure CalVer derivation (date + git tags).
- `scripts/set-version.ts` — NEW unified version stamper (package.json + Cargo.toml + tauri.conf.json).
- `scripts/release-next.ts` — NEW CI orchestrator (derive → stamp → changelog → tag → push → gh release).
- `commitlint.config.cjs` — NEW.
- `.github/workflows/release-next.yml` — NEW (tag + changelog only).
- `.github/workflows/commitlint.yml` — NEW (PR commit-message gate).

## Acceptance criteria

Each box checkable from the transcript.

- [ ] `bun run next-version --channel next` exits 0 and prints a value matching `^[0-9]{2}\.[0-9]{1,2}\.[0-9]+-next\.[0-9]+$` (today → `26.6.1-next.1`) — proven by the command output.
- [ ] That value passes `node -e "process.exit(require('semver').valid(v)?0:1)"` — it's legal semver (no leading-zero month).
- [ ] `bun run set-version 26.6.1-next.1` then `grep -rl '26.6.1-next.1'` shows every workspace `package.json`, every `Cargo.toml`, and `app/src-tauri/tauri.conf.json`; `git diff --name-only` lists only version-bearing files.
- [ ] `bun run changelog` exits 0 and `CHANGELOG.md` is non-empty.
- [ ] `echo 'feat: x' | bunx commitlint` exits 0; `echo 'nope' | bunx commitlint` exits non-zero.
- [ ] `bunx --yes yaml-lint .github/workflows/release-next.yml .github/workflows/commitlint.yml` exits 0.
- [ ] `grep -iE 'altool|productbuild|\.pkg|\.ipa|testflight|release:app|deploy:server|sprite' .github/workflows/release-next.yml` returns nothing — Milestone 1 carries NO build/deploy.
- [ ] `grep -ri 'semantic-release' package.json .github/workflows/` returns nothing — semantic-release was dropped.
- [ ] `bun run check` and `bun run lint` exit 0 — no regression.

## Verification

```bash
# 1. CalVer derivation (pure, no push) — today, tagless → 26.6.1-next.1
V=$(bun run next-version --channel next); echo "$V"
echo "$V" | grep -Eq '^[0-9]{2}\.[0-9]{1,2}\.[0-9]+-next\.[0-9]+$' && echo "shape ok"
node -e "process.exit(require('semver').valid(process.argv[1])?0:1)" "$V" && echo "valid semver"

# 2. unified stamper writes everywhere, nothing else
bun run set-version 26.6.1-next.1
grep -rl '26.6.1-next.1' app/package.json libs/*/package.json docs/package.json \
  app/src-tauri/tauri.conf.json $(find . -name Cargo.toml -not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/ARCHIVE/*')
git diff --name-only        # expect: only version-bearing files
git checkout -- .           # reset the test stamp

# 3. changelog
bun run changelog && test -s CHANGELOG.md && echo "changelog non-empty"

# 4. commit-message gate
echo 'feat: x' | bunx commitlint                 # exit 0
echo 'nope'    | bunx commitlint ; echo "exit=$?"  # non-zero

# 5. workflows valid + scoped (no build/deploy, no semantic-release)
bunx --yes yaml-lint .github/workflows/release-next.yml .github/workflows/commitlint.yml
grep -iE 'altool|productbuild|\.pkg|\.ipa|testflight|release:app|deploy:server|sprite' \
  .github/workflows/release-next.yml || echo "clean: no build/deploy in M1"
grep -ri 'semantic-release' package.json .github/workflows/ || echo "clean: no semantic-release"

# 6. repo gates
bun run check
bun run lint
```

## Hand-off

```
/aven-build 0038
```

…or hand the condition straight to the goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-06-14` — Pivot to **CalVer**. Dropped semver bump-from-commit-type and semantic-release entirely; version is now `YY.M.micro` (unpadded month — `26.06.x` is invalid semver, `26.6.x` is legal), monthly-reset micro, derived by a pure bun script from date + git tags. No genesis tag needed. Tooling = custom bun derivation + conventional-changelog + `gh`. commitlint kept (now for changelog quality, not versioning). First next tag today → `v26.6.1-next.1`. Rewrote the card.
- `2026-06-14` — (superseded) explored semantic-release + commit-analyzer bump rules, genesis tag, and an "explicit major marker" before the CalVer pivot made bump-decisions moot.
- `2026-06-14` — Discovery: surveyed versioning (all `0.0.1`, zero tags, no changelog tooling, commits already conventional). Carved Milestone 1 (tags + changelog only) here; Milestone 2 (release + TestFlight + node deploy) → ideate card 0039. Moved ideate → discover.
