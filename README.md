# AvenOS

Bun **monorepo** (layout inspired by [MaiaOS](https://github.com/)): workspace packages under `projects/`.

| Package | Description |
|---------|-------------|
| **`projects/aven-ceo`** | SvelteKit + Jazz app (`seed/`, `src/`, `static/`, `.data/` vault) |
| **`projects/mail`** | `@avenos/mail` — SMTP ingest + store (depends on Maia `libs`) |
| **`projects/self`** | `@avenos/self` — passkey / WebAuthn PRF identity (depends on Maia `libs`) |
| **`projects/tauri-plugin-passkey`** | Rust/Cargo Tauri 2 plugin (macOS passkey); plugin id **`tauri-plugin-passkey`** |
| **`projects/ocr-example`** | Python Gemini OCR/JSON extract CLI (separate `pip` venv) |
| **`projects/jaensen-bot`** | `@avenos/jaensen-bot` — [Flue](https://github.com/withastro/flue) agent server (`flue dev`, port 3583) |
| **`app`** | `@AvenOS/app` — Tauri + SvelteKit shell (identity, P2P, docs, vibe-apps) |

**`bun install`** also attaches **`../MaiaOS/libs/*`** as workspaces so `@MaiaOS/*` / `@AvenOS/db` resolve. Clone [MaiaOS](https://github.com/) **next to** this repo (`Development/MaiaOS` alongside `Development/AvenOS`), or edit root `package.json` `workspaces` if your layout differs.

## Install

From the **repo root**:

```sh
bun install
```

Python OCR example (optional): `cd projects/ocr-example && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`

## Develop

```sh
bun run dev:aven-ceo      # SvelteKit (default: bun run dev)
bun run dev:ocr-example    # prints CLI help (requires Python + venv above)
bun run dev:jaensen-bot    # Flue dev server (Node target, loads repo-root .env)
bun run dev:app:all        # Tauri desktop app (macOS or Linux — auto)
bun run dev:app:mac        # Tauri desktop app on macOS
bun run dev:app:ios        # Tauri in iOS Simulator — `tauri ios dev [device]` (macOS + Xcode; run ios init once)
bun run dev:app:linux      # Tauri desktop app on Linux
bun run dev:app            # SvelteKit only in browser (:1420), no Tauri shell

# or from the package folder
cd projects/aven-ceo && bun run dev
```

**Note:** `bun run dev:jaensen-bot` runs **Flue**, which currently requires **Node.js ≥ patch 22.18** (or newer) for TypeScript config. If the CLI exits with a version error, upgrade Node and retry.

Env for the **Svelte app**, **OCR CLI**, and **jaensen-bot**: keep **`.env`** at the **repo root** (see **`.env.example`**). `projects/aven-ceo` and `bun run dev:ocr-example` load it via Bun **`--env-file=../../.env`**; **`bun run dev:jaensen-bot`** passes **`flue dev --env ../../.env`**; Python also reads that path plus optional **`projects/ocr-example/.env`** overrides (see `projects/ocr-example/README.md`).

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

## Reference — recreate Svelte app

```sh
bunx sv@0.15.2 create --template minimal --types ts --install bun .
```
