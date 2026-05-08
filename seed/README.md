# Seed → `.data`

Committed **defaults** for local runtime under **`.data/`** (gitignored). On first access, **`seed-service`** copies a file only if the destination path does **not** yet exist — your edits in `.data` are never overwritten.

| Seed (this tree) | Runtime (editable, local) |
|------------------|---------------------------|
| `agents/maia/SOUL.md` | `.data/agents/maia/SOUL.md` |
| `agents/maia/RULES.md` | `.data/agents/maia/RULES.md` |
| `memory/tools/memory.openai.json` | `.data/agents/maia/tools/memory.openai.json` |

**Tool schemas:** Talk / chat load OpenAI-style tool definitions from **`.data/agents/maia/tools/memory.openai.json`** after sync. The UI may compare against the same seed via import for client-side estimates; the source of truth at runtime is `.data`.
