---
title: Faces as vibes, actor code in QuickJS — recover aven-ui, sandbox the mesh
summary: Recover libs/aven-ui (JSON→HTML/CSS engine + brand.style.json) as the ONE face renderer; every actor carries a vibe (view/style/source/interface/logic) whose logic — including LLM-output shaping — runs in a QuickJS WASM sandbox; catalog reduced to the essentials with workitems as the full-CRUD proof
owner: Claude Code (build agent)
created: 2026-08-12
updated: 2026-08-12
tags: [actors, ui, sandbox, security, config-as-data]
goal: "`cd app && bun test tests/vibe-sandbox.test.ts` exits 0 — proving (1) RENDERER: every actor's vibe passes validateViewDef/validateStyleDef from @avenos/aven-ui and its logic produces the initial state from `source`; (2) SANDBOX FAIL-CLOSED: actor logic runs in a QuickJS WASM VM where fetch/import/process/require and any non-injected capability THROW and a `while(true)` reducer is killed by fuel; (3) SSOT PARITY: the workitems CRUD reducer in the sandbox produces byte-identical state for a UI event and for the equivalent voice/LLM path, and raw model text is shaped into ops INSIDE the sandbox (a host that receives malformed model output changes no state); (4) REDUCTION: `app/src/lib/actors/catalog.ts` declares only the essential actors (no calendar/habits/notes) and `rg -n 'FaceSpec|SpecFaceView|WorkItemsView' app/src` returns nothing; AND `cd app && bun test` plus `bun run check` (0 errors) stay green"
---

# Faces as vibes, actor code in QuickJS — recover aven-ui, sandbox the mesh

## Context

Two things existed before the 0121 strip (`53cfa8a6`) and are recoverable verbatim:

- **`libs/aven-ui`** (95 files at `53cfa8a6^`): a complete JSON→HTML/CSS face engine —
  `AvenUiEngine.mount(bundle)` renders a `ViewDef` + `StyleDef` into a **shadow root**,
  a `StateStore` re-renders on state change, `view-validator.ts` / `style-validator.ts`
  whitelist what may be rendered, `security.ts` gates it, `brand.style.json` +
  `brand-style.ts` carry the design tokens. Template mapping (`$each`, `$slot`, `$state`,
  `$$item`) and events (`$on: {click: {send, payload}}`) are already there, plus 15
  reference vibes (`view.ts` + `style.ts` + `logic.js` + `source.json` + `interface.json`).
- **`libs/tauri-plugin-sandbox-quickjs`**: the Rust QuickJS plugin with
  `session_mount` / `session_dispatch` / `session_unmount` / `run_tool`, and the app-side
  seam `app/src/lib/aven-ui/sandbox-qjs-session.ts`.

Today the actor mesh (0128/0129, after the composer removal) renders faces from a
hand-rolled `FaceSpec` through Svelte components (`SpecFaceView`, `WorkItemsView`,
`DefaultActorView`), and all actor behaviour is trusted TypeScript in the host.

Decision (Samuel, 2026-08-12), after comparing with **abject.world**:

- **The architecture stays abject-near** — actors with mailbox, contracts, `ask`, one
  message bus, capability-gated sandbox for untrusted code, "every abject paints its own
  face". Nothing about the mesh model changes.
- **From the vibes we take only the FACE layer**: the JSON→HTML/CSS rendering
  architecture replaces `FaceSpec` + Svelte face components. An actor **is** a vibe:
  manifest + `view` + `style` + `source` + `interface` + `logic`.
- **Everything the actor computes runs in QuickJS**, LLM-output processing included: the
  host never interprets model text, it hands it to the actor's sandboxed logic, which
  returns validated ops.
- **Runtime = `quickjs-emscripten` (WASM) inside the webview** — one path for browser dev
  and the native Mac app, no IPC round-trip, testable with `bun test`. The Rust plugin is
  recovered alongside for later cap-bearing/server-side actors but is NOT wired now.
- **The catalog shrinks to the essentials**: todos (= workitems) as the full-CRUD demo,
  the registry, and the speech/chat path. `calendar`, `habits`, `notes` are deleted.

Related: [[0111]] (the same "actor code as sandboxed data" decision on the retired
betterauth stack — its cap-injection and fail-closed test shape carry over), [[0129]]
(execution engine), [[0094]] (per-step vibe UI).

## Goal

One face renderer and one behaviour model: every actor is a vibe whose view/style are
validated JSON and whose logic — UI events, state, and LLM-output shaping — executes in a
QuickJS WASM sandbox; workitems proves it with full CRUD from both voice and mouse.

**Completion condition** (identical to frontmatter `goal`):

> `cd app && bun test tests/vibe-sandbox.test.ts` exits 0 — proving (1) RENDERER: every actor's vibe passes `validateViewDef`/`validateStyleDef` from `@avenos/aven-ui` and its logic produces the initial state from `source`; (2) SANDBOX FAIL-CLOSED: actor logic runs in a QuickJS WASM VM where `fetch`/`import`/`process`/`require` and any non-injected capability THROW and a `while(true)` reducer is killed by fuel; (3) SSOT PARITY: the workitems CRUD reducer in the sandbox produces byte-identical state for a UI event and for the equivalent voice/LLM path, and raw model text is shaped into ops INSIDE the sandbox (a host that receives malformed model output changes no state); (4) REDUCTION: `app/src/lib/actors/catalog.ts` declares only the essential actors (no calendar/habits/notes) and `rg -n 'FaceSpec|SpecFaceView|WorkItemsView' app/src` returns nothing; AND `cd app && bun test` plus `bun run check` (0 errors) stay green.

## Approach

**1 — Recover the renderer.** `git checkout 53cfa8a6^ -- libs/aven-ui` and reduce: keep
`src/engine/*`, `brand.style.json`, `brand-style.ts`, `index.ts`, `package.json`; keep ONE
legacy vibe (`chat`) as a reference fixture and delete the other 14. Wire it as a Bun
workspace package (`@avenos/aven-ui`) and add the worktree `node_modules` symlink noted in
memory, so lib edits show up in the app.

**2 — The sandbox.** New `app/src/lib/actors/sandbox.ts`: a `quickjs-emscripten` async VM
per actor session. The host evaluates the actor's `logic` string and calls three exported
entry points, all JSON-marshalled across the boundary:

- `initState(source)` → the state the face first renders,
- `reduce(state, {send, payload})` → the next state (UI events AND internal messages),
- `shape(state, rawModelText)` → `{ops, state}` — the ONLY place model output is parsed.

Capabilities are injected as host functions built strictly from the manifest's `caps`
list; nothing else exists in the VM. Fuel (interrupt deadline) + memory cap bound every
call. This is 0111's proven shape, ported to the client.

**3 — Actor = vibe.** `Manifest` loses `face`/`faces` and gains
`vibe: {view, style, source, interface, logic}` (and `vibes: [{key, name, …}]` for a second
view over the same actor — the list/board pattern). `SpecFaceView.svelte`,
`DefaultActorView.svelte` and `WorkItemsView.svelte` are replaced by ONE
`AvenUiView.svelte` (recovered): it mounts `AvenUiEngine` over a sandbox session, forwards
`UiEvent`s to `reduce`, and re-renders from the returned state.

**4 — workitems as the proving vibe.** The todos actor keeps its manifest, contracts and
tool methods, but its behaviour (create/update/delete/clear-done/spark switching) moves
into `logic.js` and its two faces (list, board) become `view.ts`/`style.ts` on brand
tokens. Voice path and click path both end in the same `reduce` — that is the parity the
test asserts.

**5 — Reduce the catalog.** Delete `calendar`, `habits`, `notes`. What remains: workitems
(todos), registry, and the speech/chat actors (chat, listener, speaker, windows).

Out of scope: wiring the Rust plugin (recovered, unused), server-side/cap-bearing actors,
dynamic actor creation (deliberately removed — code stays the source of truth), and
re-adding the other 14 legacy vibes.

## Steps

1. Recover + prune `libs/aven-ui`; workspace wiring; `bun run check` still green.
2. `sandbox.ts` + `tests/vibe-sandbox.test.ts` slice A: fail-closed + fuel (0111's shape).
3. `Manifest.vibe` + `AvenUiView.svelte`; one trivial actor renders through aven-ui.
4. Port workitems to a vibe (logic + list/board views); delete the Svelte face path.
5. `shape()` in the sandbox: the LLM lane hands raw text to the actor, never parses it.
6. Reduce the catalog; delete `FaceSpec`, `SpecFaceView`, `DefaultActorView`, `WorkItemsView`.
7. Full suite + check + native Mac app for the HITL look.

**Checkpoint after step 3** — stop and look: does a real window render from JSON through
the sandbox? Everything after that is porting.

## Files to touch

- `libs/aven-ui/**` (recovered, pruned) — engine, validators, brand tokens.
- `libs/tauri-plugin-sandbox-quickjs/**` (recovered, not wired).
- `app/src/lib/actors/sandbox.ts` (new) — QuickJS WASM sessions + cap injection.
- `app/src/lib/actors/AvenUiView.svelte` (new/recovered) — the one face component.
- `app/src/lib/actors/actor.ts` — `vibe`/`vibes` replace `face`/`faces`.
- `app/src/lib/actors/catalog.ts` — reduced to the essentials.
- `app/src/lib/actors/workitems.svelte.ts` + `vibes/workitems/*` — behaviour into logic.js.
- `app/src/lib/actors/windows.ts`, `bus.ts` (llm lane → `shape`), `records.ts`.
- Deleted: `SpecFaceView.svelte`, `DefaultActorView.svelte`, `WorkItemsView.svelte`.
- `app/tests/vibe-sandbox.test.ts` (new) — the proof.

## Acceptance criteria

- [ ] Every actor vibe validates: `validateViewDef` + `validateStyleDef` pass for all catalog vibes; `initState(source)` returns the rendered state. (test)
- [ ] Fail-closed: `fetch`, `import()`, `require`, `process` and any non-granted capability throw inside the VM; a runaway loop is killed by fuel. (test)
- [ ] Parity/SSOT: UI event and voice path produce identical workitems state; the same reducer serves both. (test)
- [ ] Model text is parsed only in the sandbox: malformed output leaves host state untouched. (test)
- [ ] Catalog reduced; `rg -n 'FaceSpec|SpecFaceView|WorkItemsView' app/src` is empty.
- [ ] `cd app && bun test` and `bun run check` (0 errors) green.
- [ ] **(HITL / review)** Native Mac app: the todos window renders through aven-ui with brand tokens, and add/toggle/delete work by voice AND by click.

## Verification

```bash
cd app && bun test tests/vibe-sandbox.test.ts
```

```bash
cd app && bun test && bun run check
```

```bash
rg -n 'FaceSpec|SpecFaceView|WorkItemsView' app/src || echo "face path retired"
```

## Hand-off

```
/aven-build 0130
```

## Progress log

Newest entry first.

- `2026-08-12` — Discovery with Samuel: recover `libs/aven-ui` as the ONE face renderer (JSON→HTML/CSS, brand.style.json, validators/whitelist) and drop `FaceSpec`; architecture stays abject.world-near (mesh, mailbox, ask, caps) — only the face layer is taken from the vibes. Actor = vibe; ALL actor logic incl. LLM-output shaping runs in a QuickJS **WASM** VM in the webview (`quickjs-emscripten`), the recovered Rust plugin stays unwired for later cap-bearing actors. Catalog reduced to the essentials — todos/workitems as the full-CRUD proof, plus registry and the speech path; calendar/habits/notes deleted. Measurable via `tests/vibe-sandbox.test.ts` (validation · fail-closed+fuel · voice/UI parity · sandbox-only model parsing) plus the retired-face-path grep. Written into `discover/`.
