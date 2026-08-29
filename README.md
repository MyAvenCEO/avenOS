# AvenOS

Bun **monorepo**: active code lives under `libs/`, `app/`, `services/`, and `docs/`; legacy or optional packages live under `ARCHIVE/`.

| Package | Description |
|---------|-------------|
| **`libs/tauri-plugin-android-passkey`** | Android Credential Manager passkeys and runtime platform permissions |
| **`libs/tauri-plugin-ios-passkey`** | iOS Authentication Services passkey bridge |
| **`libs/aven-hosting`** | Static-site control-plane contracts shared by the app and facade |
| **`docs`** | `@avenos/docs` — Markdown for in-app docs (self, network, sparks, deploy, content) |
| **`app`** | `@AvenOS/app` — Tauri + SvelteKit shell (identity, local Groove, docs, vibe-apps) |
| **`services/identity`** | `@avenos/identity` — minimal `aven.id` signup, passkeys, sessions, device authorization, JWTs, and JWKS |
| **`services/checkout`** | `@avenos/checkout` — `my.aven.ceo` checkout webapp, billing, webhooks, and purchase email |
| **`services/aven-api`** | `@avenos/aven-api` — `api.aven.ceo` signed-token-verifying facade over server services |
| **`libs/aven-identity`** | Shared fail-closed JWT/JWKS verifier and internal account-provisioning client |
| **`services/static-site-host`** | Minimal verified static host used for `aven.ceo` and user-managed sites |
| **`infrastructure/platform`** | Pulumi — fresh, protected two-host Hetzner foundation for identity and platform |
| **`ARCHIVE/ocr-example`** | Python Gemini OCR/JSON extract CLI (optional; separate `pip` venv) |
| **`ARCHIVE/tauri-plugin-passkey`** | macOS passkey Tauri plugin (archived; not wired into `app` today) |

The normative contract for customer-owned databases, component manifests,
provisioning, reconciliation, routing, and new-service conformance is specified in
[Customer databases as a first-class platform boundary](docs/customer-database-platform.md).
Its concrete two-host Compose implementation is mapped in
[Planned customer-database system map](docs/customer-database-system-map.md).
The target no-hand-bootstrap deployment procedure is captured in
[Customer platform zero-to-hero runbook](docs/customer-platform-getting-started.md).
The earlier implementation discovery and service-specific tenant rail remain captured
in [Customer data-plane architecture](CUSTOMER-DATA-PLANE-ARCHITECTURE.md).
The four-origin service cut and passkey migration are specified in
[Identity, checkout, facade, and public-web cut](docs/identity-checkout-facade-cut.md).

## Install

From the **repo root**:

```sh
bun install
```

Python OCR example (optional): `cd ARCHIVE/ocr-example && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`

## Develop

```sh
bun run dev:app:all        # Tauri desktop app (macOS or Linux — auto)
bun run dev:app:mac        # Tauri desktop app on macOS
bun run dev:app:ios        # Tauri in iOS Simulator — `tauri ios dev [device]` (macOS + Xcode; run ios init once)
bun run dev:app:android    # Tauri on an Android device/emulator (Android Studio SDK + NDK)
bun run dev:identity       # aven.id identity service
bun run dev:checkout       # my.aven.ceo checkout webapp
bun run dev:api            # api.aven.ceo facade
bun run dev:app:linux      # Tauri desktop app on Linux
bun run dev:app            # SvelteKit only in browser (:1420), no Tauri shell
bun run build:app:android  # Signed debug APK in dist/android/
```

### Run and verify the split locally

Identity, checkout, and the product facade are independent processes. Start the
checkout development dependencies with:

```sh
bun run local:up
bun run local:account -- you@example.test
bun run local:app -- linux  # use "mac" on macOS
```

The account command prints a local identity setup URL. Create a `localhost`
passkey in the browser, then approve the Rust client's local device flow with
that passkey. See [the local guide](deploy/local/README.md) and run the complete
automated equivalent with `bun run test:e2e:platform`.

Production starts from the same fresh two-host Pulumi deployment described in
[the infrastructure guide](docs/infrastructure-getting-started.md). The managed
static host rebuilds `aven.ceo` from Git; there is no legacy apex cutover or old
hosting composition to preserve.

### Native passkey authentication

The Tauri app is gated on launch. On supported Apple devices and Android 9+ it requests a challenge for `aven.id`, opens the native system passkey sheet (Authentication Services or Android Credential Manager), and exchanges the assertion for a revocable Better Auth bearer session. Only platforms or OS versions without that native mechanism fall back to the HTTPS device-code approval flow in the system browser while avenOS shows a waiting screen. The bearer token is not exposed to the frontend or persisted in browser storage; this spike requires authentication again after an app restart.

The authentication spike accepts ordinary passkeys; WebAuthn PRF is optional until encrypted client data needs it. Firefox on Linux exposes WebAuthn but has no built-in platform passkey provider, so enrollment there requires a FIDO2 security key or a passkey-provider extension. The same setup link can instead be opened on a browser or device with a platform passkey provider.

Android signing, Digital Asset Links, prerequisites, and the on-device checklist are in [the Android APK guide](docs/deploy/android-apk.md).

For local development, use the isolated stack; it compiles the Rust client with
the exact local identity RP and facade origins:

```sh
bun run local:up
bun run local:account -- you@example.test
bun run local:app -- linux
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

Service verification runs from the root with the `check:*`, `test:*`, and
`build:*` scripts for identity, checkout, and the facade. See
[`services/aven-api/README.md`](services/aven-api/README.md) for the facade's
narrow routing contract.

Infrastructure validation runs with `bun run test:infra`. Provisioning and
deployment use protected GitHub Environment values and encrypted Pulumi state
in a private Hetzner Object Storage bucket; see
[`infrastructure/platform/README.md`](infrastructure/platform/README.md) and the
[zero-to-healthy guide](docs/infrastructure-getting-started.md). Do not commit
deployment `.env` files, Pulumi stack configuration/state, or credentials.

## Architecture notes

- [Generic authenticated LLM gateway](docs/llm-gateway.md) documents capability-based
  model discovery, explicit model selection, OpenAI-compatible streaming, schemas, tool
  calls, desktop transport, provider configuration, security, and operations.
- [Actor skills and goal-directed problem solving](docs/actor-skills-and-problem-solving.md)
  defines capabilities, generated plans, durable runs, and artifact-backed resumption.
- [Client-owned document ingestion](docs/client-document-ingest.md) documents the
  actor pipeline, generic LLM gateway integration, server-parity contract, durable
  publication boundary, migration plan, and operator smoke checklist.

## Reference — recreate Svelte app

```sh
bunx sv@0.15.2 create --template minimal --types ts --install bun .
```
