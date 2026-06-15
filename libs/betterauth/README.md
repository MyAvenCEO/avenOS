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
