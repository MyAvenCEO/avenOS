# Aven second brain & memory architecture

Memory is **separate** from Aven’s **[agent / IPR / board orchestration](./AgentArchitecture.md)** and **[actor-machine vocabulary](./AgentMachine.md)**. Those layers coordinate *work*: here we only care about **durable Markdown knowledge** (“second brain”) and how humans + models **maintain it**.

**Design in one line:** Maia always sees a **fresh index** of vault paths and titles (like a live table of contents) and is instructed to **edit existing notes in place** (unique substring replace) instead of minting parallel files for the same entity. The rules live entirely in **`.data/agents/maia/RULES.md`**, seeded from **`seed/agents/maia/RULES.md`** at first boot — no external product names required to understand behavior.

## Seed vs runtime (`seed/`)

Committed defaults live in **`seed/`** (Maia **SOUL** / **RULES** / agent **README**, **memory tool** OpenAI JSON). The vault (**`.data/knowledge/`**) starts **empty** except for notes you or Maia create. The vault owner’s note **`Humans/OWNER_<slug>.md`** (e.g. **`## Identity`**, **`## Preferences`**) is **not** seeded — it lives only under **`.data/knowledge/`** and is injected each turn **before** RULES; Maia learns the **slug** from conversation (or you set **`AVEN_VAULT_OWNER_HUMANS_FILE`**). On startup of any path that needs them, **`ensureSeedRuntimeSynced()`** in **`projects/aven-ceo/src/lib/seed/seed-service.ts`** copies into **`.data/...` only if the destination file does not exist** (your edits stay). **`maia.agent.json`** points at **`.data`** for agent files; chat loads tool definitions from **`.data/agents/maia/tools/memory.openai.json`** after sync.

## 1. Separation of concerns

| Piece | Responsibility |
|--------|----------------|
| **`/memory`** | Browse/edit vault Markdown; **Display** viewer (wikilinks, GFM) or **Markdown** source; sidebar lists vault index, Maia docs, and (Messages tab) Talk transcript. |
| **`/talk`** | One continuous **Aven Maia** chat: transcript in **`.data/agents/maia/messages/conversation.json`**, reloaded on `/talk` with a live **context** summary; tools mutate the vault. |
| **`/me`** + `/api/aven/intent` | Intent classification → Jazz workers (**not** vault maintenance). |

All vault I/O resolves under **`projects/aven-ceo/.data/knowledge/`** (Svelte app root; see below).

---

## 2. Local storage (gitignored)

| Path | Role |
|------|------|
| **`.gitignore`** | Includes **`projects/aven-ceo/.data/`** — never committed. |
| **`.data/knowledge/`** | Canonical vault (`**/*.md`). Created on first use; **no default readme note** — only your Markdown files appear in the index. |
| **`.data/agents/maia/messages/`** | **`conversation.json`** restores the rolling chat; **`mN.md`** logs each completed assistant turn (Maia agent–scoped). |

**Folder convention:** **`Humans/`**, **`Sparks/`** (orgs + missions, visions, shared spaces, teams, companies, …), **`Projects/`**, **`Concepts/`** — a soft schema; Aven does **not** require rigid templates in v1. Prefer **one canonical note per entity** (aliases in the body) and **edit-in-place** using **`memory_edit`** when the path already exists in the injected snapshot.

**Runtime:** Paths are gated server-side (**no `..`**, resolved under vault root). **Local filesystem** implies: run **`bun run dev:aven-ceo`** from the monorepo root (or **`bun dev`** inside **`projects/aven-ceo`**) so `process.cwd()` points at the app package.

---

## 3. Conversational maintenance loop (`/talk`)

```mermaid
flowchart LR
  user["User_chat"]
  ui["Browser_/talk"]
  api["POST_api_aven_chat"]
  llm["Maia_inference"]
  tools["memory_*_tools"]
  vault["Filesystem_.data/knowledge"]

  user --> ui --> api --> llm
  llm -->|"tool_calls"| tools
  tools --> vault
  llm -->|"assistant_reply"| api --> ui --> user
```

1. **`GET /api/aven/conversation`** reloads the saved transcript and a **context scaffold** (vault index + messages + tool list) for the aside. **`POST /api/aven/chat`** (with **`stream: true`**) appends each successful reply to **`conversation.json`** and to **`mN.md`** under **`.data/agents/maia/messages/`**. NDJSON events include `context` / `status` / `done` / `error` so the UI can show **Maia**’s current step (thinking, which tool, etc.).
2. Server builds **system text** in order: **SOUL** → **vault owner** (conventions + live **`Humans/OWNER_*.md`**) → **RULES** → **live Markdown table** (`Path | Title`) → short **wikilink graph summary** (resolved / unresolved counts from **`[[wikilinks]]`**).
3. Model tools (OpenAI function JSON):

   - **`memory_list_notes`** — redundant JSON list after big edits.
   - **`memory_read_file`**
   - **`memory_edit`** — **primary** update: unique **`oldString`** → **`newString`** at an existing path (substring must occur exactly once in the file).
   - **`memory_write_file`** — **create** missing paths **or** deliberate **full replace** of one path when appropriate; not for duplicating an entity that already has a row in the snapshot.
   - **`memory_search`** — grep helper when titles are ambiguous.

Updating alias examples (“Sam” vs full name) should hit **`memory_edit`** on the canonical **`Humans/OWNER_*.md`**. Structure that file with **`##`** headings (e.g. **`## Identity`**, **`## Preferences`**). Vague bullets (“likes water”) attribute to **you** unless they name someone else.

4. Until the model emits a plain assistant message (tool round cap), repeat.

**Chat model:** Default is **`glm-5-1`** ([model details](https://tinfoil.sh/models/glm-5-1)), set in repo JSON [`tinfoil-chat.config.json`](../projects/aven-ceo/src/lib/aven/tinfoil-chat.config.json) under **`chatModel`**. The POST body may still pass **`model`** to override a single turn. Secrets stay in env: **`TINFOIL_API_KEY`** only (same pattern as the [JavaScript inference example](https://docs.tinfoil.sh/sdk/javascript-sdk)).

---

## 4. Direct browser API (Memory UI)

Implementation lives alongside Svelte routes:

| Method | Endpoint | Behaviour |
|--------|----------|-------------|
| `GET` | `/api/memory/notes` | `{ notes, vaultSnapshot }` — refreshes **derived vault wikilink graph** on the server |
| `GET` | `/api/memory/note?path=Rel/Path.md` | `{ content }` |
| `PUT` | `/api/memory/note` | `{ path, content }` — validates path; **rebuilds graph** |
| `GET` | `/api/memory/graph?path=Rel/Path.md` | Outgoing resolved links, backlinks, unresolved wikilink targets for that note |
| `GET` | `/api/memory/graph?full=1` | Full serialized graph (dev / inspection) |
| `GET` | `/api/memory/graph` | Aggregate stats only (`stats`, `generatedIso`) |

Same vault helpers (`$lib/memory/vault.ts`) as tool executor — **single source**.

---

## 5. Vault link graph (derived, no UI canvas)

| Artifact | Role |
|----------|------|
| **`.data/state/vault-graph.json`** | Built from all `[[wikilinks]]` in **`.data/knowledge`** (body after frontmatter). **Outgoing**, **backlinks**, **unresolved** targets; rebuilt on **`memory_edit` / `memory_write_file`**, **`PUT /api/memory/note`**, and **`GET /api/memory/notes`**. |
| **Talk** | [live-context.ts](../projects/aven-ceo/src/lib/aven/live-context.ts) appends a **short graph summary** after the Path \| Title snapshot. |
| **Memory UI** | Text panels **Links to / Backlinks / Unresolved** for the selected vault note via `GET /api/memory/graph?path=`. |

Shared parsing: [`wikilink-parse.ts`](../projects/aven-ceo/src/lib/memory/wikilink-parse.ts) (same rules as preview injection in [`markdown-view.ts`](../projects/aven-ceo/src/lib/memory/markdown-view.ts)).

---

## 6. Deferred extensions

- **Ingestion graph** — optional importers under **`.data/inbox/`** when you add sources.
- **Live “tracks”** — event-router over streams — extension point; **out of MVP**.

---

## 7. Constraints & next steps

- **Hosting:** ephemeral serverless mounts may lack durable `.data`; for production you’d mount a disk or migrate to synced storage (**Jazz** CoValues vs DB is product decision later).
- **Importers:** reserved **`.data/inbox/`** (document only until implemented).
- **Distillation:** overlaps with **`skill` → `tool` lifecycle** in [AgentMachine.md](./AgentMachine.md) once you automate prompt mining.

---

## See also

- [AgentArchitecture.md](./AgentArchitecture.md) — IPR surfaces.  
- [AgentMachine.md](./AgentMachine.md) — orchestration calculus.  
