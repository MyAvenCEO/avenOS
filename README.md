# AvenOS

Bun **monorepo**: active code lives under `libs/`, `app/`, `services/`, and `docs/`; legacy or optional packages live under `ARCHIVE/`.

| Package | Description |
|---------|-------------|
| **`libs/aven-website`** | `@avenos/aven-website` — SvelteKit marketing site — home, skills, pricing, waitlist |
| **`libs/aven-db`** | Local-first Groove core (RocksDB, sync layer) |
| **`libs/aven-p2p`** | Placeholder for future sync transport |
| **`libs/tauri-plugin-self`** | Device identity Tauri plugin |
| **`libs/aven-vibes`** | `@avenos/aven-vibes` — mini-app HTML catalog for intent HITL views |
| **`libs/aven-vibe-sandbox`** | `@avenos/aven-vibe-sandbox` — MCP app sandbox host (iframe / Tauri WebView) |
| **`docs`** | `@avenos/docs` — Markdown for in-app docs (self, network, sparks, deploy, content) |
| **`app`** | `@AvenOS/app` — Tauri + SvelteKit shell (identity, local Groove, docs, vibe-apps) |
| **`services/aven-api`** | `@avenos/aven-api` — checkout, email setup login, passkeys, downloads, and customer environments |
| **`infrastructure/identity`** | Pulumi — Hetzner foundation and DNS for `id.next.aven.ceo` |
| **`ARCHIVE/ocr-example`** | Python Gemini OCR/JSON extract CLI (optional; separate `pip` venv) |
| **`ARCHIVE/tauri-plugin-passkey`** | macOS passkey Tauri plugin (archived; not wired into `app` today) |

**`bun install`** also attaches **`../MaiaOS/libs/*`** as workspaces so `@MaiaOS/*` / `@AvenOS/db` resolve. Clone [MaiaOS](https://github.com/) **next to** this repo (`Development/MaiaOS` alongside `Development/AvenOS`), or edit root `package.json` `workspaces` if your layout differs.

## Install

From the **repo root**:

```sh
bun install
```

Python OCR example (optional): `cd ARCHIVE/ocr-example && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`

## Develop

```sh
bun run dev:aven-website  # SvelteKit marketing site (default: bun run dev)
bun run dev:ocr-example    # prints CLI help (requires Python + venv above)
bun run dev:app:all        # Tauri desktop app (macOS or Linux — auto)
bun run dev:app:mac        # Tauri desktop app on macOS
bun run dev:app:ios        # Tauri in iOS Simulator — `tauri ios dev [device]` (macOS + Xcode; run ios init once)
bun run dev:app:linux      # Tauri desktop app on Linux
bun run dev:app            # SvelteKit only in browser (:1420), no Tauri shell
bun run dev:api            # Identity API and checkout UI

# or from the package folder
cd libs/aven-website && bun run dev
```

Env for the **marketing site** and **OCR CLI**: keep **`.env`** at the **repo root** (see **`.env.example`**). `libs/aven-website` loads it via Bun **`--env-file=../../.env`**; Python also reads that path plus optional **`ARCHIVE/ocr-example/.env`** overrides (see `ARCHIVE/ocr-example/README.md`).

### Run the full local service stack

Docker with Compose and Bun are required. From the repository root, start Aven
API, its email and environment workers, Mailpit, the Artifact Store, both
migrators, and their separate PostgreSQL databases:

```sh
bun run dev:api:artifacts
```

Leave that command running. Once the services report healthy, verify the full
Artifact Store path from a second terminal:

```sh
bun run test:artifact-store:smoke
```

A successful run prints JSON containing `"status": "ok"` after creating an
upload and root publication and verifying metadata, downloaded content, and
feed replay. The default local endpoints are:

| Service | Endpoint |
|---------|----------|
| Aven API | `http://localhost:3000` |
| Artifact Store | `http://localhost:8087` |
| Mailpit | `http://localhost:8025` |
| Aven API PostgreSQL | `127.0.0.1:55432` |
| Artifact Store PostgreSQL | `127.0.0.1:55433` |

If a port is occupied, override it for both commands. For example:

```sh
APP_PORT=13000 MAILPIT_HTTP_PORT=18025 DB_PORT=15432 \
ARTIFACT_STORE_PORT=18087 ARTIFACT_DB_PORT=15433 \
bun run dev:api:artifacts

ARTIFACT_STORE_PORT=18087 bun run test:artifact-store:smoke
```

Press Ctrl+C to stop the foreground stack. Remove its stopped containers and
network without deleting the database volumes with:

```sh
docker compose \
  -f services/aven-api/docker-compose.yml \
  -f services/aven-api/docker-compose.artifact-store.yml \
  down
```

The Tauri desktop application is run natively in a separate terminal; it is not
part of the Docker stack. See the commands above and the
[`services/aven-api` local-service documentation](services/aven-api/README.md#local-services)
for additional configuration and detached operation.

### Native passkey authentication

The Tauri app is gated on launch. On supported Apple devices it requests a challenge for `id.next.aven.ceo`, opens the native system passkey sheet, and exchanges the assertion for a revocable Better Auth bearer session. Only platforms or OS versions without that native mechanism fall back to the HTTPS device-code approval flow in the system browser while avenOS shows a waiting screen. The bearer token is not exposed to the frontend or persisted in browser storage; this spike requires authentication again after an app restart.

The authentication spike accepts ordinary passkeys; WebAuthn PRF is optional until encrypted client data needs it. Firefox on Linux exposes WebAuthn but has no built-in platform passkey provider, so enrollment there requires a FIDO2 security key or a passkey-provider extension. The same setup link can instead be opened on a browser or device with a platform passkey provider.

For local development, run the identity API and compile the app with its local origin:

```sh
bun run dev:api
AVEN_IDENTITY_BASE_URL=http://localhost:5173 bun run dev:app:linux
```

The intended next layer is name-scoped authorization: the authenticated dashboard lists every owned name, selecting one establishes that name as the active context, and API endpoints—not direct client PostgreSQL credentials—enforce the user's entitlement for every read and write. Name selection and customer-data operations are intentionally outside the current authentication spike.

## Scripts

See **[`scripts/README.md`](scripts/README.md)** for which root scripts are active vs manual maintenance.

## Linux desktop prerequisites

`bun run dev:app:linux` builds the Tauri shell against system WebKitGTK / GTK / DBus libraries. On a fresh Linux install, missing native packages usually show up as Cargo errors such as `pkg-config ... dbus-1` not found.

Ubuntu / Debian:

```sh
sudo apt update
sudo apt install -y \
  pkg-config \
  libdbus-1-dev \
  libgtk-3-dev \
  libsoup-3.0-dev \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  build-essential \
  curl \
  wget \
  file \
  libssl-dev
```

Fedora:

```sh
sudo dnf install \
  pkgconf-pkg-config \
  dbus-devel \
  gtk3-devel \
  libsoup3-devel \
  webkit2gtk4.1-devel \
  libappindicator-gtk3-devel \
  openssl-devel \
  curl \
  wget \
  file \
  gcc-c++
```

After installing the packages, retry:

```sh
bun run dev:app:linux
```

## Lint / format (repo root)

[Biome](https://biomejs.dev) applies across the tree.

```sh
bun run lint
bun run lint:fix
```

API verification runs from the root with `bun run check:api`, `bun run test:api`, and `bun run build:api`. See [`services/aven-api/README.md`](services/aven-api/README.md) for PostgreSQL, Mailpit, migrations, and workers.

Infrastructure validation runs with `bun run test:infra`. Provisioning and deployment use protected GitHub Environment values and encrypted Pulumi state in a private Hetzner Object Storage bucket; see [`infrastructure/identity/README.md`](infrastructure/identity/README.md). Do not commit deployment `.env` files, Pulumi stack configuration/state, or credentials.

## Reference — recreate Svelte app

```sh
bunx sv@0.15.2 create --template minimal --types ts --install bun .
```
