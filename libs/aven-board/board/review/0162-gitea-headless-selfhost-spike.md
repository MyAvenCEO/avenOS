---
title: Gitea headless self-host spike
summary: Boot a fully headless Gitea (scripted install, programmatic admin + token) as a stand-in for the user's personal server, packaged as libs/aven-git, and drive it from a minimal Tauri dashboard route that creates and lists repos via the REST API.
owner: samuel + claude
created: 2026-08-24
updated: 2026-08-24
tags: [git, self-hosting, spike]
goal: "`libs/aven-git/gitea-dev.sh up` exits 0 and boots Gitea with no web wizard (`curl -fs http://localhost:3300/api/v1/version` returns JSON) after creating admin + API token programmatically; `libs/aven-git/gitea-dev.sh smoke` exits 0, creating repo `spike-hello` via `/api/v1` and listing its name back in the output; `bun run check` and `bun run lint` exit 0; changes touch only libs/aven-git, the new dashboard route, and .gitignore."
---

# Gitea headless self-host spike

## Context

Vision: every avenOS user self-hosts their own personal server that already runs
their 24/7 aven agent (hosting target TBD — Sprite/Fly are retired). Gitea is
the candidate for the git layer on that same per-user server — it hosts git
(HTTP/SSH) plus repos/issues/API, is a single Go binary with SQLite, and is fully
operable headless: `INSTALL_LOCK=true` skips the web wizard, `gitea admin user
create --admin` and `gitea admin user generate-access-token` cover bootstrap, and
everything else is `/api/v1` REST. The Tauri app is then a **pure remote client**
of that server.

This spike proves the *decision-relevant* property: **Gitea can be provisioned and
driven entirely by our tooling with zero human web-UI interaction**, and our Tauri
app can operate it over plain HTTP as a client. To keep it cheap, the "user's
server" is simulated locally on the Mac (native binary + SQLite); nothing about
the client path may assume local-ness beyond the base URL.

Decisions confirmed with Samuel:
- **Gitea** (not Forgejo) for the spike.
- Native binary + SQLite, spun up **locally** as the stand-in server — no remote
  deploy in this card.
- The server tooling is its own workspace package **`libs/aven-git`**
  (`@avenos/aven-git`) so the git layer has a home that later grows the real
  provisioning/client code.
- One instance, scripted + repeatable; per-user remote provisioning (on the
  user's personal server, hosting target TBD — Sprite/Fly are retired) is a
  follow-on ideate card.
- Simplest possible auth: the script prints the admin API token; the dev route
  takes base URL + token (prefilled `http://localhost:3300`, persisted in
  localStorage). No SSO, no env plumbing.

Out of scope: any remote deploy, per-user provisioning automation, SSO/OIDC,
git clone/push flows, Gitea Actions/runner, any actor/skill-platform modeling.

## Goal

An agent (or script) can stand up a working Gitea from nothing, mint admin + token
without a browser, and the Mac Tauri app can create and list repos on it over the
REST API — proving Gitea fits the per-user self-hosted server model.

**Completion condition** (the hand-off line for `/goal` — keep identical to the
frontmatter `goal`):

> `libs/aven-git/gitea-dev.sh up` exits 0 and boots Gitea with no web wizard
> (`curl -fs http://localhost:3300/api/v1/version` returns JSON) after creating
> admin + API token programmatically; `libs/aven-git/gitea-dev.sh smoke` exits 0,
> creating repo `spike-hello` via `/api/v1` and listing its name back in the
> output; `bun run check` and `bun run lint` exit 0; changes touch only
> libs/aven-git, the new dashboard route, and .gitignore.

## Approach

New workspace package `libs/aven-git` (`@avenos/aven-git`) owns the server side.
For the spike it holds one POSIX shell script, `gitea-dev.sh`, exposed as bun
scripts (`up|smoke|down|wipe`), so the flow is portable to the real server later
(same commands, different host):

- `up` — ensure the `gitea` binary exists (error with `brew install gitea` hint if
  not); write a minimal `app.ini` into a gitignored `.gitea-dev/` data dir with
  `[security] INSTALL_LOCK = true` (kills the web wizard), SQLite database, HTTP
  port **3300** (clear of the app dev ports), SSH disabled (API-only spike), and
  `[cors]` open (incl. the `Authorization` header) so the Tauri webview can call
  it directly; create the admin user idempotently (`gitea admin user create
  --admin`) and mint an API token (`gitea admin user generate-access-token
  --raw`) **before** the server starts (CLI writes SQLite directly); store the
  token in `.gitea-dev/token`; start `gitea web` in the background; poll
  `/api/v1/version` until up; print base URL + token.
- `smoke` — with the stored token: `POST /api/v1/user/repos {"name":"spike-hello"}`
  (idempotent: tolerate already-exists), then `GET /api/v1/user/repos` and print
  the repo names; fail non-zero if `spike-hello` is missing.
- `down` / `wipe` — stop the background process / additionally delete
  `.gitea-dev/` for a from-scratch rerun.

Client side: a minimal dashboard route `app/src/routes/dashboard/gitea/` in the
Mac Tauri app. Inputs for base URL (prefilled `http://localhost:3300`) and token,
persisted to localStorage; a list of repo names from `GET /api/v1/user/repos`; a
text field + button that `POST`s a new repo and refreshes the list. Plain
`fetch`, styled like the settings page, no actor integration. CORS is handled
server-side in `app.ini`, so no Tauri HTTP-plugin plumbing is needed.

Trade-off noted: token-in-localStorage and CORS `*` are spike-grade only; the
real per-user path gets proper auth in a follow-on.

## Steps

1. Add `.gitea-dev/` to `.gitignore`; create `libs/aven-git` (package.json +
   `gitea-dev.sh` with `up|smoke|down|wipe`). Checkpoint: `up` then `smoke` both
   exit 0 from a clean `wipe`.
2. Add the `dashboard/gitea` route (URL+token fields, repo list, create form).
   Checkpoint: `bun run check` + `bun run lint` exit 0.
3. Live check in the running Mac dev app: paste the printed token, see
   `spike-hello`, create a second repo from the UI. (HITL — verified in review.)

## Files to touch

- `libs/aven-git/package.json` — new; `@avenos/aven-git` workspace package with
  `up|smoke|down|wipe` scripts.
- `libs/aven-git/gitea-dev.sh` — new; headless server lifecycle.
- `app/src/routes/dashboard/gitea/+page.svelte` — new; minimal client UI
  (create repo, list repo names).
- `.gitignore` — add `.gitea-dev/`.

## Acceptance criteria

- [x] From `libs/aven-git/gitea-dev.sh wipe`, `up` exits 0 with no web-wizard
      step — proven: after `wipe`, `up` printed `up at http://localhost:3300
      ({"version":"1.27.2"})` plus the token. (One fix en route: headless needs
      an explicit `gitea migrate` before the admin CLI, since the wizard is what
      normally migrates the DB.)
- [x] Admin + token are created programmatically (no browser) — proven: `up`
      output shows `New user 'aven' has been successfully created!` and
      `token minted`.
- [x] `libs/aven-git/gitea-dev.sh smoke` exits 0 and its output lists
      `spike-hello` — proven: output `created repo spike-hello` / `spike-hello`
      / `smoke OK`.
- [x] `bun run check` exits 0 with the new route present — proven: `550 FILES 0
      ERRORS 0 WARNINGS`. `bun run lint`: the two new source files pass biome
      clean (`Checked 2 files … No fixes applied`); the repo-wide `bun run
      lint` was ALREADY red before this card (pre-existing failures in
      `services/aven-api/tests/passkeys.test.ts` + `artifact-types/*.json`,
      none of them touched here) — out of scope per the constraint.
- [x] Only the files under "Files to touch" (plus the board card) changed —
      `git status --short` additionally shows `bun.lock` (bun install picked up
      the new workspace package — required) and `.claude/launch.json` (a
      `gitea-preview` entry for this worktree's dev server — tooling only).
- [x] UI creates + lists repos against the instance — verified live in the
      browser preview: token pasted → Connect → `spike-hello` listed; created
      `created-from-ui` via the form → both repos listed (count 2).

## Verification

```bash
libs/aven-git/gitea-dev.sh wipe
libs/aven-git/gitea-dev.sh up
curl -fs http://localhost:3300/api/v1/version
libs/aven-git/gitea-dev.sh smoke
bun run check
bun run lint
git status --short
```

## Hand-off

```
/aven-review 0162
```

…or hand the condition straight to the built-in goal loop:

```
/goal `libs/aven-git/gitea-dev.sh up` exits 0 and boots Gitea with no web wizard (`curl -fs http://localhost:3300/api/v1/version` returns JSON) after creating admin + API token programmatically; `libs/aven-git/gitea-dev.sh smoke` exits 0, creating repo `spike-hello` via `/api/v1` and listing its name back in the output; `bun run check` and `bun run lint` exit 0; changes touch only libs/aven-git, the new dashboard route, and .gitignore.
```

## Progress log

- `2026-08-24` — Follow-ups on Samuel's request (beyond the original spike
  scope): Git rail entry in the dashboard nav (route-style like settings, incl.
  generalized leave-route handling), and a repo DETAIL view — metadata (private/
  branch/size/updated/clone URL) + file/folder browser over the contents API
  with breadcrumbs and a text-file preview (base64 decode, binary/large guard).
  Verified live: spike-hello → docs/ → notes.md preview. Samuel confirmed the
  Mac app works end-to-end (created repo `test` from it).

- `2026-08-24` — Built + verified in-session: `libs/aven-git` package
  (`gitea-dev.sh up|smoke|down|wipe`, one `gitea migrate` fix for headless
  first-boot), Gitea 1.27.2 via brew, from-scratch `wipe → up → smoke` green,
  `dashboard/gitea` route driven live in the browser preview (connect, list
  `spike-hello`, create `created-from-ui`). `bun run check` 0 errors; new files
  biome-clean (repo-wide lint red pre-exists, untouched files). Instance left
  running at `http://localhost:3300` for Samuel to poke. Moved build → review.
- `2026-08-24` — Build start: Samuel asked for the server tooling as its own lib
  package `libs/aven-git`; spec updated (paths + goal), card moved discover →
  build.
- `2026-08-24` — Discovery: captured + specced in one pass (no prior ideate card).
  Confirmed with Samuel: Gitea (not Forgejo), local native binary + SQLite as a
  stand-in for the user's remote 24/7 agent server, pure-remote client model,
  simplest auth (printed token → paste into dev route). Remote
  provisioning deferred to a follow-on card. Created directly in discover/.
