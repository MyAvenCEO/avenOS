---
title: Self-hosted Better Auth (bun/hono + Neon kysely) gates the mainnet chat with Google
summary: New libs/betterauth package — a bun/hono Better Auth server on a Neon Postgres (kysely-neon dialect) — protects the mainnet/alberobello mocked chat behind Google sign-in.
owner: claude
created: 2026-06-15
updated: 2026-06-15
tags: [auth, mainnet, app]
goal: "`bun run check` and `bun run lint` exit 0; the libs/betterauth bun/hono server boots and `GET {BETTER_AUTH_URL}/api/auth/get-session` returns 200 JSON; Better Auth tables exist in Neon (proven by a `SELECT … FROM \"user\"` via the Neon MCP); the mainnet/alberobello branch renders a sign-in gate (no session ⇒ Continue-with-Google, session ⇒ MainnetChat); testnet is byte-unchanged; and a Google sign-in produces a row in the Better Auth `user` table (proven via the Neon MCP). Every Acceptance criterion below is checked."
---

# Self-hosted Better Auth gates the mainnet/alberobello chat with Google

## Context

The app opens on a **Select Network** intro (shipped on this branch, commit
`96326d58`): `testnet/abagana` keeps the full existing Secure-Enclave crypto signup
and all current features, untouched; `mainnet/alberobello` is a separate world that
renders a mocked local-echo chat reusing `IntentComposer`.

We want the mainnet chat to be a **protected screen**: entering mainnet requires
**Google sign-in first**. After weighing managed Neon Auth, we chose **self-hosted
Better Auth** for control + flexibility, with our own simple frontend.

Decisions confirmed during discovery:

- **Gate target:** mainnet/alberobello only (testnet untouched).
- **Auth stack:** our own **bun + Hono** server running **Better Auth**, in a new
  workspace package **`libs/betterauth`** (`@avenos/betterauth`).
- **Database:** **Neon Postgres remote** via **Kysely** using the community
  **`kysely-neon`** dialect; connection string from `NEON_PG_KEY`. Better Auth's
  tables are created with its CLI (`generate` → `migrate`).
- **Google:** our own OAuth app — `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- **Envs:** `BETTER_AUTH_SECRET` (already in `.env`), `BETTER_AUTH_URL`, `NEON_PG_KEY`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- **Frontend:** Better Auth's client (`better-auth/svelte`) in the Tauri/SvelteKit
  app + a simple "Continue with Google" gate around `MainnetChat`.
- **Scope:** local-dev first. Production deploy of the auth server (Sprite/fly like
  `aven-node`) is a follow-on (Out of scope).

Supersedes the discarded managed-Neon-Auth approach. Builds on the Select Network work.

## Goal

Entering mainnet/alberobello shows our own "Continue with Google" gate served by a
self-hosted Better Auth server; after a successful Google sign-in the user lands on the
mocked chat, and their account exists in the Better Auth `user` table in Neon Postgres.

**Completion condition** (identical to frontmatter `goal`):

> `bun run check` and `bun run lint` exit 0; the libs/betterauth bun/hono server boots
> and `GET {BETTER_AUTH_URL}/api/auth/get-session` returns 200 JSON; Better Auth tables
> exist in Neon (proven by a `SELECT … FROM "user"` via the Neon MCP); the mainnet
> branch renders a sign-in gate (no session ⇒ Continue-with-Google, session ⇒
> MainnetChat); testnet is byte-unchanged; and a Google sign-in produces a row in the
> Better Auth `user` table (proven via the Neon MCP). Every Acceptance criterion is checked.

- **End state:** mainnet is auth-gated by our Better Auth Google sign-in; testnet unchanged.
- **Proof:** check + lint exit 0; `curl {BETTER_AUTH_URL}/api/auth/get-session` → 200;
  `SELECT id, email, "createdAt" FROM "user"` returns the signed-in user (Neon MCP).
- **Constraints:** `libs/betterauth` is the only new package; testnet branch byte-unchanged.

## Approach

**New package `libs/betterauth` (`@avenos/betterauth`):**
- `src/db.ts` — Kysely instance over `kysely-neon`'s `NeonDialect` using `NEON_PG_KEY`.
- `src/auth.ts` — `betterAuth({ baseURL: BETTER_AUTH_URL, secret: BETTER_AUTH_SECRET,
  database: { dialect, type: 'postgres' } | kysely, socialProviders: { google: {
  clientId, clientSecret } }, trustedOrigins: [<app origin>] })`.
- `src/server.ts` — Hono app: CORS (`credentials: true`, app origin) registered
  **before** routes, then `app.on(['POST','GET'], '/api/auth/*', c =>
  auth.handler(c.req.raw))`; `export default { port, fetch: app.fetch }` for Bun.
- `package.json` — scripts: `dev` (bun run server, watch), `db:generate` + `db:migrate`
  (`bunx @better-auth/cli generate|migrate`), `check` (tsc --noEmit). tsconfig.

**Frontend (app-local, simple):**
- `app/src/lib/auth/auth-client.ts` — `createAuthClient({ baseURL:
  PUBLIC_BETTER_AUTH_URL })` from `better-auth/svelte` (exposes `useSession`,
  `signIn.social`, `signOut`).
- `app/src/lib/shell/AuthGate.svelte` — protected wrapper: loading spinner; no session
  ⇒ brand-styled "Continue with Google" screen (`signIn.social({ provider: 'google',
  callbackURL })`); session ⇒ render children. i18n `mainnet.auth.*`.
- `app/src/routes/+layout.svelte` — mainnet branch becomes
  `<AuthGate><MainnetChat /></AuthGate>`; testnet branch unchanged.

**Env wiring:** add `BETTER_AUTH_URL`, `NEON_PG_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET` to `.env` + document in `.env.example`; add
`PUBLIC_BETTER_AUTH_URL` for the SvelteKit client. Register
`{BETTER_AUTH_URL}/api/auth/callback/google` in Google Cloud Console.

**Root:** `libs/*` workspace already includes the package; add a `dev:auth` root script.

## Steps

1. Scaffold `libs/betterauth` (package.json, tsconfig, src/{db,auth,server}.ts).
2. Add deps: `better-auth`, `hono`, `kysely`, `kysely-neon` (+ `@neondatabase/serverless`).
3. Env: add `BETTER_AUTH_URL`, `NEON_PG_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `PUBLIC_BETTER_AUTH_URL` to `.env` + `.env.example`. (creds w/ user)
4. `bunx @better-auth/cli generate` then `migrate` → Better Auth tables land in Neon.
5. Boot the server; `curl {BETTER_AUTH_URL}/api/auth/get-session` → 200 JSON.
6. App: `auth-client.ts` + `AuthGate.svelte` + i18n strings; wire into mainnet branch.
7. `bun run check` + `bun run lint`; fix until green.
8. Live verify (HITL): mainnet → Continue with Google → land on chat; confirm `user`
   row via Neon MCP.

**Checkpoint:** stop after step 5 (server boots + tables migrated) for review before
the frontend gate.

## Files to touch

- `libs/betterauth/` — NEW package: `package.json`, `tsconfig.json`,
  `src/db.ts`, `src/auth.ts`, `src/server.ts`.
- `.env` / `.env.example` — `BETTER_AUTH_URL`, `NEON_PG_KEY`, `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `PUBLIC_BETTER_AUTH_URL`.
- `package.json` (root) — `dev:auth` script.
- `app/src/lib/auth/auth-client.ts` — NEW: Better Auth svelte client.
- `app/src/lib/shell/AuthGate.svelte` — NEW: Continue-with-Google gate.
- `app/src/routes/+layout.svelte` — wrap mainnet branch in `AuthGate`.
- `app/languages/en.json`, `app/languages/de.json` — `mainnet.auth.*` strings.

## Acceptance criteria

- [ ] `bun run check` exits 0 — proven by its terminal output.
- [ ] `bun run lint` exits 0 — proven by its terminal output.
- [ ] `libs/betterauth` typechecks — proven by `bun --cwd libs/betterauth run check` exit 0.
- [ ] Server boots; `curl {BETTER_AUTH_URL}/api/auth/get-session` returns HTTP 200 JSON.
- [ ] Better Auth tables exist in Neon — proven by `SELECT id, email FROM "user" LIMIT 1`
      via Neon MCP `run_sql` (returns 0+ rows, not a "relation does not exist" error).
- [ ] Mainnet branch renders `AuthGate` (signed-out ⇒ Continue with Google; signed-in ⇒
      MainnetChat) — proven by preview screenshots of both states.
- [ ] testnet branch unchanged — proven by `git diff` showing only the mainnet `{:else if}` arm changed.
- [ ] A Google sign-in creates a user — proven by `SELECT id, email, "createdAt" FROM
      "user" ORDER BY "createdAt" DESC` returning the row via Neon MCP.

## Verification

```bash
bun run check                       # svelte-kit sync + svelte-check + docs word count
bun run lint                        # biome
bun --cwd libs/betterauth run check # tsc --noEmit for the new package
bun run dev:auth &                  # boot the hono/bun Better Auth server
curl -fsS "$BETTER_AUTH_URL/api/auth/get-session"   # expect HTTP 200 JSON
# live (HITL): run the app, pick mainnet, Continue with Google, land on chat, then:
#   Neon MCP run_sql: SELECT id, email, "createdAt" FROM "user" ORDER BY "createdAt" DESC LIMIT 5;
```

## Risks / open build decisions

- **Cross-origin session cookie in Tauri (load-bearing):** Better Auth sets a session
  cookie on the auth server's origin. The Tauri app (custom protocol / vite dev origin)
  is a *different* origin from `BETTER_AUTH_URL`, so the cookie is cross-site: needs CORS
  `credentials: true`, `trustedOrigins`, and `SameSite=None; Secure` (⇒ https) in
  production. On `localhost` dev this is workable; the desktop `.app` origin is the risk.
  Decide the exact cookie/redirect handling (in-WebView vs loopback) at build.
- **kysely-neon dialect:** community dialect; confirm it works with Better Auth's CLI
  migrate (HTTP vs WebSocket driver). Fall back to `pg`/`Pool` dialect if needed.
- **Neon connection string:** `NEON_PG_KEY` must be the pooled/serverless URL the
  dialect expects.

## Out of scope

- Deploying the auth server to production (Sprite/fly) — follow-on card.
- Gating testnet, or touching testnet's Secure-Enclave signup.
- Linking Better Auth sessions into avenDB identities / RLS.
- Persisting mainnet chat / giving it a real backend (still a local-echo mock).
- Providers other than Google.

## Hand-off

```
/aven-build 0050
```

…or hand the condition straight to the goal loop:

```
/goal <paste the Completion condition above>
```

## Progress log

Newest entry first.

- `2026-06-15` — Re-spec: user reverted from managed Neon Auth to **self-hosted Better
  Auth** (bun/hono + kysely-neon → Neon PG) for control/flexibility. Restored the
  `libs/betterauth` package; own Google app; measurable goal now proves server boot +
  migrated tables + `user` row via Neon MCP. Renamed slug from `neon-auth-…`.
- `2026-06-15` — Discovery: interviewed; (earlier) explored managed Neon Auth; settled
  mainnet-only gate. Moved ideate → discover.
