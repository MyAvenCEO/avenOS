# AvenOS

Bun **monorepo** (layout inspired by [MaiaOS](https://github.com/)): active code under `libs/`, `app/`, and `docs/`; legacy or optional packages under `ARCHIVE/`.

| Package | Description |
|---------|-------------|
| **`libs/aven-website`** | `@avenos/aven-website` — SvelteKit marketing site — home, skills, pricing, waitlist |
| **`libs/tauri-plugin-peer`** | P2P / Hyperswarm Tauri plugin |
| **`libs/tauri-plugin-self`** | Device identity Tauri plugin |
| **`libs/aven-vibes`** | `@avenos/aven-vibes` — mini-app HTML catalog for intent HITL views |
| **`libs/aven-vibe-sandbox`** | `@avenos/aven-vibe-sandbox` — MCP app sandbox host (iframe / Tauri WebView) |
| **`docs`** | `@avenos/docs` — Markdown for in-app docs (self, network, sparks, deploy, content) |
| **`app`** | `@AvenOS/app` — Tauri + SvelteKit shell (identity, P2P, docs, vibe-apps) |
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

# or from the package folder
cd libs/aven-website && bun run dev
```

Env for the **marketing site** and **OCR CLI**: keep **`.env`** at the **repo root** (see **`.env.example`**). `libs/aven-website` loads it via Bun **`--env-file=../../.env`**; Python also reads that path plus optional **`ARCHIVE/ocr-example/.env`** overrides (see `ARCHIVE/ocr-example/README.md`).

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

## Reference — recreate Svelte app

```sh
bunx sv@0.15.2 create --template minimal --types ts --install bun .
```
