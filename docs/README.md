# @avenos/docs

Plain Markdown documentation, grouped by topic folder.

| Folder | Topic |
|--------|--------|
| `self/` | Device-bound identity: Secure Enclave, network seed, self-signer (`tauri-plugin-self`). |
| `vault/` | Stronghold secrets store, vault webview, `tauri-plugin-vault`. |
| `security/` | Trust boundaries, sensitive material tiers, threat model. |
| `content/` | Storytelling bible: overview, identity sheet, production, PAST framework, prompts (`overview/`, `sheet/`, `production/`, `storytelling/`, `prompts/`). |

Lives at the **repo root** (`docs/`). The app reads these files at **build time** via `import.meta.glob`. Do not move or rename files without updating the glob in `app`.

Run **`bun run words:check`** from this package to ensure each chapter (intro + technical deep dive) stays under **850 words**.
