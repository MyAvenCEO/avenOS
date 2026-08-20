# Aven API

Identity checkout service for name purchase, email setup login, passkey registration, downloads, and per-customer database provisioning.

## Commands

```sh
bun run dev
bun run check
bun run test
bun run db:migrate
bun run worker:email
bun run worker:environment
bun run environment:status -- <name>
bun run environment:retry -- <name>
bun run environment:reconcile
```

## Local services

From this directory:

```sh
docker compose up --build
```

- API: `http://localhost:3000`
- Mailpit: `http://localhost:8025`
- PostgreSQL: `127.0.0.1:55432`

The migrator, API, email worker, and environment worker use separate database roles. The environment worker creates one `cust_*` database and one `NOLOGIN` owner role per purchased name.

The production RP ID is configured with `WEBAUTHN_RP_ID`. The matching origin serves `/.well-known/apple-app-site-association` for the signed Tauri application.
