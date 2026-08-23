# Aven API

Identity checkout service for name purchase, email setup login, passkey registration, downloads, and per-customer database provisioning.

## Commands

```sh
bun run dev
bun run dev:designer
bun run check
bun run test
bun run email:studio
bun run email:compile
bun run db:migrate
bun run worker:email
bun run worker:environment
bun run environment:status -- <name>
bun run environment:retry -- <name>
bun run environment:reconcile
```

`bun run dev:designer` starts a backend-free designer preview with mock data and a
persistent page, state, and session switcher. Every visible state has a shareable
`scenario` URL. `bun run build:designer` creates the equivalent designer build;
`bun run preview:designer` rebuilds that variant before serving it locally.

## Email templates

Email source lives in `email-templates/` and is compiled with Maizzle. From the
repository root, start the local editor with:

```sh
bun run email:studio
```

The same command also works from this service directory.

See [email-templates/README.md](email-templates/README.md) for the complete
editing workflow, template structure, placeholder contract, and instructions
for adding new emails.

Open the printed loopback URL. The editor provides HTML and plaintext previews,
desktop and mobile widths, fixture data, subject editing, and the Maizzle Vue
source. **Save and compile** validates the template, overwrites its `.vue` and
`.json` source files, and regenerates
`src/lib/server/email/templates.generated.ts`. Git remains the review and undo
mechanism for every saved edit.

Run `bun run email:preview` for Maizzle's own development preview, or
`bun run email:compile` after editing source files directly. `bun run
email:check` verifies that the committed generated file is current and is also
part of the test command. Do not edit the generated TypeScript file by hand.

Template metadata contains the subject and preview fixture. Fixture fields and
`{{field}}` subject placeholders must match the typed contract in
`src/lib/server/email/template-contract.ts`. Maizzle is only a development
dependency: production sends the committed, precompiled HTML and plaintext and
performs escaped token substitution at runtime.

## Local services

From this directory:

```sh
docker compose up --build
```

- API: `http://localhost:3000`
- Mailpit: `http://localhost:8025`
- PostgreSQL: `127.0.0.1:55432`

To run the API and Artifact Store together, add the local-only overlay:

```sh
docker compose \
  -f docker-compose.yml \
  -f docker-compose.artifact-store.yml \
  up --build -d
bun run artifact-store:smoke
```

The combined stack adds the Artifact Store at `http://localhost:8087`. Its local smoke
customer is the `cust_artifact_local` database in the same PostgreSQL cluster; new
purchased-name environments get their own database and Artifact Store schema
automatically. The smoke command creates an upload and
root publication, then verifies artifact metadata, content retrieval, and feed
replay. It is safe to rerun because every invocation uses new claim and
publication IDs.

From the repository root, the equivalent commands are `bun run
dev:api:artifacts` and, in another terminal, `bun run
test:artifact-store:smoke`. Stop the detached stack with:

```sh
docker compose \
  -f docker-compose.yml \
  -f docker-compose.artifact-store.yml \
  down
```

Override `APP_PORT`, `MAILPIT_HTTP_PORT`, `DB_PORT`, or `ARTIFACT_STORE_PORT` when a
host port is already occupied. The overlay injects the internal Artifact Store URL and
development credentials into Aven API and the environment worker. Aven API—not request
data—selects the exact customer database and stable scope. The shared bearer remains a
preview precursor to short-lived signed authorization decisions.

The migrator, API, email worker, environment worker, Artifact Store provisioner, and
Artifact Store runtime have separate responsibilities. The environment worker creates
one `cust_*` database and one `NOLOGIN` owner role per purchased name, installs the
Artifact Store before readiness, and revokes runtime connections on suspension.

All Compose services use Docker's `local` logging driver. Logs rotate at 10 MiB
per file with five files per container and compression enabled. Override
`DOCKER_LOG_MAX_SIZE`, `DOCKER_LOG_MAX_FILE`, or `DOCKER_LOG_COMPRESS` in the
Compose environment when a different local retention budget is required. The
`next` release workflow reads the same names from GitHub environment variables.

The production RP ID is configured with `WEBAUTHN_RP_ID`. The matching origin serves `/.well-known/apple-app-site-association` for the signed Tauri application.

The Tauri shell uses the RFC 8628 endpoints under `/api/auth/device`: `ceo.aven.os` is the only accepted public client, approval requires an existing passkey session and an owned name, and the device code is consumed once when exchanged for a bearer session. Run the `0006_device_authorization` migration before deploying this flow.
