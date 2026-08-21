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

All Compose services use Docker's `local` logging driver. Logs rotate at 10 MiB
per file with five files per container and compression enabled. Override
`DOCKER_LOG_MAX_SIZE`, `DOCKER_LOG_MAX_FILE`, or `DOCKER_LOG_COMPRESS` in the
Compose environment when a different local retention budget is required. The
`next` release workflow reads the same names from GitHub environment variables.

The production RP ID is configured with `WEBAUTHN_RP_ID`. The matching origin serves `/.well-known/apple-app-site-association` for the signed Tauri application.

The Tauri shell uses the RFC 8628 endpoints under `/api/auth/device`: `ceo.aven.os` is the only accepted public client, approval requires an existing passkey session and an owned name, and the device code is consumed once when exchanged for a bearer session. Run the `0006_device_authorization` migration before deploying this flow.
