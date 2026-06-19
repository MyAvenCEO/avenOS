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

### One-time setup

```sh
# 1. Create the app (name must match fly.toml's `app`).
fly apps create aven-api-next

# 2. Runtime secrets (NOT in git / not in GitHub — set directly on the app).
fly secrets set --app aven-api-next \
  BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  NEON_PG_KEY="postgresql://…neon…/neondb?sslmode=require" \
  GOOGLE_CLIENT_ID="…" \
  GOOGLE_CLIENT_SECRET="…" \
  TINFOIL_API_KEY="…" \
  POLAR_API_KEY="…"            # optional; omit to disable the Polar link

# 3. Custom domain + TLS.
fly certs add --app aven-api-next api.next.aven.ceo
#   then add the DNS record fly prints — typically:
#   CNAME  api.next  aven-api-next.fly.dev   (+ the _acme-challenge record fly shows)
```

### CI / GitHub

- **`FLY_API_TOKEN`** — add to the **`next` GitHub Environment** (Settings → Environments →
  next → secrets). Mint with `fly tokens create deploy -a aven-api-next`. CI uses only this;
  all other config lives in `fly.toml` (`[env]`) or `fly secrets`.

### Also required for the app to actually use it

- Bake **`PUBLIC_BETTER_AUTH_URL=https://api.next.aven.ceo`** into the `next` app builds
  (it currently defaults to `http://localhost:8787` for local dev).
- Add **`https://api.next.aven.ceo/api/auth/callback/google`** as an authorized redirect URI
  on the Google OAuth client.
- The prod Tauri origins (`tauri://localhost`, `http://tauri.localhost`) are already in
  `TRUSTED_ORIGINS`; add any new web origin there if one ships.

### Manual deploy

```sh
flyctl deploy --remote-only --ha=false \
  --config libs/betterauth/fly.toml --dockerfile libs/betterauth/Dockerfile .
```
