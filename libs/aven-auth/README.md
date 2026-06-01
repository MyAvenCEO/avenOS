# aven-auth

Headless Better Auth API for Aven Self device registration (`did:key` ppK + invite links).

## Env (repo root)

All scripts load **`../../.env`** from the monorepo root (same as `app/` and `aven-website`).

Required in repo-root `.env`:

```env
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=   # openssl rand -base64 32
AVEN_AUTH_DB_PATH=./data/aven-auth.db
```

See [`../../.env.example`](../../.env.example) and [`.env.example`](./.env.example).

## Local dev

```bash
# from repo root
bun run migrate:aven-auth   # first time
bun run dev:aven-auth       # http://localhost:3000
```

Runs Vite under **Node** (`better-sqlite3` is not supported in Bun).

## Smoke test

```bash
# terminal A
bun run dev:aven-auth

# terminal B
bun run test:aven-auth
```

One-shot (starts server, runs smoke, exits):

```bash
bun run --cwd libs/aven-auth test:once
```

## API (under `/api/auth`)

| Method | Path |
|--------|------|
| GET | `/aven-auth/site/status` |
| POST | `/aven-auth/nonce` |
| POST | `/aven-auth/verify` |
| POST | `/aven-auth/invite/create` (admin session) |
| GET | `/aven-auth/invite/check?token=…` |
| GET | `/health` |
