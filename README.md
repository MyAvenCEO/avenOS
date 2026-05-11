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

# or from the package folder
cd projects/aven-ceo && bun run dev
```

**Note:** `bun run dev:jaensen-bot` runs **Flue**, which currently requires **Node.js ≥ patch 22.18** (or newer) for TypeScript config. If the CLI exits with a version error, upgrade Node and retry.

Env for the **Svelte app**, **OCR CLI**, and **jaensen-bot**: keep **`.env`** at the **repo root** (see **`.env.example`**). `projects/aven-ceo` and `bun run dev:ocr-example` load it via Bun **`--env-file=../../.env`**; **`bun run dev:jaensen-bot`** passes **`flue dev --env ../../.env`**; Python also reads that path plus optional **`projects/ocr-example/.env`** overrides (see `projects/ocr-example/README.md`).

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
