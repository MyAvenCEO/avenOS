# aven-self

Headless Better Auth API for Aven Self device registration (`did:key` ppK + invite links).

## Env (repo root)

All scripts load **`../../.env`** from the monorepo root (same as `app/` and `aven-website`).

Required in repo-root `.env`:

```env
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=   # openssl rand -base64 32
AVEN_SELF_DB_PATH=./data/aven-self.db
```

See [`../../.env.example`](../../.env.example) and [`.env.example`](./.env.example).

## Local dev

```bash
# from repo root
bun run migrate:aven-self   # first time
bun run dev:aven-self       # http://localhost:3000
```

Runs Vite under **Node** (`better-sqlite3` is not supported in Bun).

## Smoke test

```bash
# terminal A
bun run dev:aven-self

# terminal B
bun run test:aven-self
```

One-shot (starts server, runs smoke, exits):

```bash
bun run --cwd libs/aven-self test:once
```

## API (under `/api/auth`)

| Method | Path |
|--------|------|
| GET | `/aven-self/site/status` |
| POST | `/aven-self/nonce` |
| POST | `/aven-self/verify` |
| POST | `/aven-self/invite/create` (admin session) |
| GET | `/aven-self/invite/check?token=…` |
| GET | `/health` |
