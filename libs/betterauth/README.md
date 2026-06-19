# @avenos/betterauth

Self-hosted [Better Auth](https://better-auth.com) server for avenOS — a standalone
**bun + [Hono](https://hono.dev)** service on **Neon Postgres** (via the
[`kysely-neon`](https://github.com/kysely-org/kysely-neon) dialect). It provides
Google sign-in for the `mainnet/alberobello` app and links each user to a
[Polar](https://polar.sh) customer (account connection only — products/checkout come
later). board 0050.

Everything the server needs lives in this folder; it runs on its own.

## Run it standalone

From this directory — the scripts load the repo-root `.env` automatically:

```sh
bun install          # once, from the repo root
bun run db:migrate   # create/upgrade the Better Auth tables in Neon
bun run dev          # watch-mode server on BETTER_AUTH_URL (default :8787)
# or: bun run start  # no watch
```

From the repo root you can also use the alias: `bun run dev:auth`.

Health check:

```sh
curl http://localhost:8787/api/auth/get-session   # → 200, body: null (no session)
```

## Env

Set these in the repo-root `.env` (see `.env.example`):

| Var | Purpose |
| --- | --- |
| `NEON_PG_KEY` | Neon Postgres pooled connection string |
| `BETTER_AUTH_SECRET` | Better Auth signing secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | This server's origin, e.g. `http://localhost:8787` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth web client; register `{BETTER_AUTH_URL}/api/auth/callback/google` |
| `POLAR_API_KEY` | Polar org access token (optional — plugin disabled if unset) |
| `POLAR_SERVER` | `sandbox` or `production`; must match the token's environment |

The app side reads `PUBLIC_BETTER_AUTH_URL` (same value as `BETTER_AUTH_URL`).

## Layout

- `src/auth.ts` — the Better Auth instance: Neon/kysely database, Google provider,
  Polar plugin, trusted origins, cross-origin cookie attributes.
- `src/server.ts` — the Hono app (CORS + `/api/auth/*` handler), Bun entrypoint.
- `src/index.ts` — exports `auth` + `TRUSTED_ORIGINS` for tooling/tests.

## Notes

- The app runs on a different origin than this server, so sessions use
  `SameSite=None; Secure` cookies and CORS reflects only `TRUSTED_ORIGINS`.
- The desktop (Tauri) OAuth callback origin still needs validation — see board 0050.

## Deploy (fly.io, `next` channel)

The `next`-branch CI (`.github/workflows/release-next.yml` → `deploy-auth`) deploys this
server to fly.io as a **single machine** (`--ha=false`) serving `https://api.next.aven.ceo`.
Config: [`fly.toml`](./fly.toml) + [`Dockerfile`](./Dockerfile) (build context = repo root).
Stateless — the schema self-bootstraps on boot, so every deploy is safe.

### One-time setup (infra only — NO secrets here)

This app lives in the **avenCEO** fly.io org (NOT the legacy "maia city" org). The org is
fixed at app-creation time, and the CI deploy token below is app-scoped — together that
guarantees CI can only ever touch this app in avenCEO.

```sh
# 0. Confirm the avenCEO org slug (the create flag needs the slug, not the display name).
fly orgs list                      # find avenCEO -> e.g. "avenceo"

# 1. Create the app IN the avenCEO org (name must match fly.toml's `app`).
fly apps create api-next-aven-ceo --org avenceo

# 2. Custom domain + TLS.
fly certs add --app api-next-aven-ceo api.next.aven.ceo
#   then add the DNS record fly prints — typically:
#   CNAME  api.next  api-next-aven-ceo.fly.dev   (+ the _acme-challenge record fly shows)

# 3. App-scoped deploy token -> store as FLY_API_TOKEN in the `next` GitHub Environment.
#    App-scoped (not org/personal) so CI is confined to THIS app in avenCEO.
fly tokens create deploy -a api-next-aven-ceo
```

Runtime secrets are NOT set by hand — CI stages them onto the app from the `next` GitHub
Environment on every deploy (see below).

### CI / GitHub — single source of truth for secrets

The `next` GitHub Environment (Settings → Environments → next → Secrets) holds everything;
the `deploy-auth` job stages these onto the fly app, then deploys. Add:

| Secret | Notes |
| --- | --- |
| `FLY_API_TOKEN` | avenCEO org token — `fly tokens create org -o avenceo`. Must be the avenCEO org, or flyctl can't see the app. Can live as an org-wide GitHub secret. |
| `BETTER_AUTH_SECRET` | session/token signing key — generate ONCE (`openssl rand -base64 32`) and keep STABLE; changing it logs everyone out |
| `NEON_PG_KEY` | Postgres connection string |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth web client |
| `TINFOIL_API_KEY` | private AI inference key |
| `POLAR_API_KEY` | optional — Polar link is disabled if absent |

Non-secret config (`BETTER_AUTH_URL`, `PUBLIC_BETTER_AUTH_URL`, `POLAR_SERVER`) lives in
`fly.toml` `[env]`, not here.

### Also required for the app to actually use it

- Bake **`PUBLIC_BETTER_AUTH_URL=https://api.next.aven.ceo`** into the `next` app builds
  (it currently defaults to `http://localhost:8787` for local dev).
- Google: the desktop app uses the **native idToken flow** (Google "Desktop app" client,
  loopback redirect — no redirect URI to register). The server verifies the idToken's
  audience against `GOOGLE_CLIENT_ID`, so the server's `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`
  MUST be the same Desktop client the app ships. Only a future **web** build needs
  `https://api.next.aven.ceo/api/auth/callback/google` added as an authorized redirect URI.
- The prod Tauri origins (`tauri://localhost`, `http://tauri.localhost`) are already in
  `TRUSTED_ORIGINS`; add any new web origin there if one ships.

### Manual deploy

```sh
flyctl deploy --remote-only --ha=false \
  --config libs/betterauth/fly.toml --dockerfile libs/betterauth/Dockerfile .
```
