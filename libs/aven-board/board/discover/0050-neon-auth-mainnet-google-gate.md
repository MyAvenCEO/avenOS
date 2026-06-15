---
title: Neon Auth Google sign-in gates the mainnet/alberobello chat
summary: Managed Neon Auth (hosted Better Auth) protects the mainnet mocked chat behind Google sign-in; no self-hosted server, no betterauth lib.
owner: claude
created: 2026-06-15
updated: 2026-06-15
tags: [auth, mainnet, app]
goal: "`bun run check` and `bun run lint` exit 0; the mainnet/alberobello branch renders a sign-in gate (no session ⇒ Continue-with-Google, session ⇒ MainnetChat) wired to the Neon Auth client; and a Google sign-in produces a row in `neon_auth.user` proven by a `SELECT … FROM neon_auth.user` via the Neon MCP. No libs/betterauth package is created. Every Acceptance criterion below is checked."
---

# Neon Auth Google sign-in gates the mainnet/alberobello chat

## Context

The app now opens on a **Select Network** intro (shipped on this branch, commit
`96326d58`): `testnet/abagana` keeps the full existing Secure-Enclave crypto signup
and all current features, untouched; `mainnet/alberobello` is a separate world that
currently renders a mocked local-echo chat reusing `IntentComposer`.

We want the mainnet chat to be a **protected screen**: entering mainnet requires a
**Google sign-in first**. Authentication is delivered by **managed Neon Auth** —
Neon's hosted service "powered by Better Auth" (Better Auth v1.4.18, Beta) — running
**alongside Neon Postgres**. Decisions confirmed during discovery:

- **Gate target:** mainnet/alberobello only (testnet is untouched).
- **Auth server:** none self-hosted. Neon Auth hosts the Better Auth REST service and
  manages the `neon_auth` schema in our Neon database. We integrate via the client SDK.
- **No `libs/betterauth` package** — the integration is ~10 lines of app-local glue,
  not a workspace package. (Original "bun/hono + kysely-neon" plan is dropped.)
- **Google creds:** Neon-managed shared Google OAuth (works out-of-the-box in dev,
  no `GOOGLE_CLIENT_ID/SECRET` needed yet). Our own Google app is a later, production
  concern (see Out of scope).
- **OAuth mechanism:** to be finalized at build (see Risks). The user's stated
  preference is system-browser + Tauri deep-link, but Neon Auth's HttpOnly session
  cookie favors completing the redirect **inside the Tauri WebView**.

Builds on the Select Network work; gates `MainnetChat.svelte` and the `+layout.svelte`
mainnet branch.

## Goal

Entering mainnet/alberobello shows a Neon-Auth sign-in gate; after a successful Google
sign-in the user lands on the existing mocked chat, and their account exists in
`neon_auth.user` in our Neon Postgres.

**Completion condition** (identical to frontmatter `goal`):

> `bun run check` and `bun run lint` exit 0; the mainnet/alberobello branch renders a
> sign-in gate (no session ⇒ Continue-with-Google, session ⇒ MainnetChat) wired to the
> Neon Auth client; and a Google sign-in produces a row in `neon_auth.user` proven by a
> `SELECT … FROM neon_auth.user` via the Neon MCP. No libs/betterauth package is
> created. Every Acceptance criterion below is checked.

- **End state:** mainnet is auth-gated by Neon Auth Google sign-in; testnet unchanged.
- **Proof:** `bun run check` + `bun run lint` exit 0; `SELECT id, email, "createdAt"
  FROM neon_auth.user` returns the signed-in user (run via the Neon MCP `run_sql`).
- **Constraints:** no `libs/betterauth/` directory; testnet branch byte-unchanged;
  no `GOOGLE_CLIENT_ID/SECRET` introduced.

## Approach

**Prerequisite (setup, not code):** enable Neon Auth on the project's branch (Console
or Neon API), then copy the **Auth Base URL** (e.g.
`https://ep-xxx.neonauth.<region>.aws.neon.tech/neondb/auth`). This requires the
user's Neon project + credentials; do it with the user (or via Neon MCP `run_sql` /
the manage-auth API) before the live-verification step.

**Client glue (app-local, no lib):**
- `app/src/lib/auth/neon-auth.ts` — `export const authClient =
  createAuthClient(import.meta.env.VITE_NEON_AUTH_URL)` from
  `@neondatabase/neon-js/auth`, plus a small `$state`-backed session store
  (`getSession()` on load; `signInWithGoogle()` → `authClient.signIn.social({ provider:
  'google', callbackURL: <origin> })`; `signOut()`).
- `app/src/lib/shell/NeonAuthGate.svelte` — protected wrapper: while loading show a
  spinner; no session ⇒ a centered "Continue with Google" screen (brand-styled, like
  `NetworkSelect`); session ⇒ render the slotted children.

**Wire the gate into the mainnet branch** of `app/src/routes/+layout.svelte`:
`{:else if $selectedNetwork === 'mainnet'}` now renders `<NeonAuthGate><MainnetChat
/></NeonAuthGate>` instead of `<MainnetChat />` directly. testnet branch unchanged.

**Desktop OAuth callback (Tauri):** register the app to receive the post-OAuth
redirect and refresh the session in the WebView. Exact mechanism decided at build
(see Risks) — web preview uses the in-context redirect; desktop likely completes the
redirect inside the Tauri WebView (loopback/in-app), not the system browser.

**Env:** add `VITE_NEON_AUTH_URL` to `.env` + document it in `.env.example`.

## Steps

1. Enable Neon Auth on the Neon branch; capture the Auth Base URL → `VITE_NEON_AUTH_URL`
   in `.env` and `.env.example`. (setup w/ user)
2. `bun add @neondatabase/neon-js` in `app/`.
3. `app/src/lib/auth/neon-auth.ts` — `authClient` + reactive session store.
4. `app/src/lib/shell/NeonAuthGate.svelte` — loading / signed-out (Continue with Google)
   / signed-in states; i18n strings (`mainnet.auth.*`) in `en.json` + `de.json`.
5. Wire `NeonAuthGate` around `MainnetChat` in the mainnet branch of `+layout.svelte`.
6. Tauri deep-link / in-WebView redirect handling for the OAuth callback (`src-tauri`)
   — finalize mechanism (Risks), then refresh session on return.
7. `bun run check` + `bun run lint`; fix until green.
8. Live verify: sign in with Google in the running app → lands on chat; confirm
   `neon_auth.user` row via Neon MCP.

**Checkpoint:** stop after step 5 (gate compiles + renders in web preview) for review
before the Tauri-native callback wiring in step 6.

## Files to touch

- `app/.env` / `.env.example` — add `VITE_NEON_AUTH_URL`.
- `app/package.json` — add `@neondatabase/neon-js`.
- `app/src/lib/auth/neon-auth.ts` — NEW: auth client + session store.
- `app/src/lib/shell/NeonAuthGate.svelte` — NEW: the protected-screen gate.
- `app/src/routes/+layout.svelte` — wrap mainnet branch in `NeonAuthGate`.
- `app/languages/en.json`, `app/languages/de.json` — `mainnet.auth.*` strings.
- `app/src-tauri/*` — deep-link/redirect callback wiring (step 6).

## Acceptance criteria

- [ ] `bun run check` exits 0 — proven by its terminal output.
- [ ] `bun run lint` exits 0 — proven by its terminal output.
- [ ] No `libs/betterauth/` exists — proven by `ls libs/betterauth` failing / `git status`.
- [ ] Mainnet branch renders `NeonAuthGate` (signed-out ⇒ Continue with Google; signed-in
      ⇒ MainnetChat) — proven by preview screenshots of both states.
- [ ] testnet branch unchanged — proven by `git diff` showing only the mainnet `{:else if}` arm changed.
- [ ] A Google sign-in creates a user — proven by `SELECT id, email, "createdAt" FROM
      neon_auth.user` returning the row via Neon MCP `run_sql`.

## Verification

```bash
bun run check        # svelte-kit sync + svelte-check + docs word count
bun run lint         # biome
ls libs/betterauth   # must fail: directory does not exist
# live (HITL): run the app, pick mainnet, Continue with Google, land on chat, then:
#   Neon MCP run_sql: SELECT id, email, "createdAt" FROM neon_auth.user ORDER BY "createdAt" DESC LIMIT 5;
```

## Risks / open build decisions

- **OAuth in Tauri vs cookie model (load-bearing):** Neon Auth sets an HttpOnly
  cookie (`__Secure-neonauth.session_token`) on the Neon Auth origin. Opening the
  system browser strands that cookie outside the Tauri WebView. Recommend completing
  the redirect **inside the WebView** (the WebView is a real browser context) and
  reserving deep-link only if a native handoff is unavoidable. Confirm at build.
- **Trusted domains:** production `callbackURL` origins must be allowlisted in Neon
  Auth; a custom deep-link scheme may not be accepted — another reason to favor an
  http(s)/loopback callback.
- **Beta:** Neon Auth + Better Auth is Beta; APIs may shift.

## Out of scope

- Own Google OAuth app / consent-screen branding (`GOOGLE_CLIENT_ID/SECRET` in the Neon
  Console) — production follow-on.
- Gating testnet, or replacing testnet's Secure-Enclave signup.
- Wiring Neon Auth sessions into avenDB identities / RLS / Data API.
- Persisting mainnet chat or giving it a real backend (still a local-echo mock).

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

- `2026-06-15` — Discovery: interviewed; confirmed managed Neon Auth (no self-hosted
  server), Neon-managed Google, mainnet-only gate; dropped the `libs/betterauth`
  package as unnecessary glue. Made the goal measurable (`neon_auth.user` row via Neon
  MCP + check/lint). Moved ideate → discover.
