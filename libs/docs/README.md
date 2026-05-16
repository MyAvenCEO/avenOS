# @avenos/docs

Plain Markdown documentation, grouped by topic folder.

| Folder | Topic |
|--------|--------|
| `self/` | Device-bound identity: Secure Enclave, network anchor, signing. |

The app reads these files at **build time** via `import.meta.glob`. Do not move or rename files without updating the glob in `lib/app`.

Run **`bun run words:check`** from this package to ensure each chapter (intro + technical deep dive) stays under **850 words**.
