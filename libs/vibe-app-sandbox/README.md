# `@avenos/vibe-app-sandbox`

Minimal host + **separate-origin sandbox** for running untrusted HTML/JS “vibe apps” using the **MCP Apps** shape (`AppBridge`, `PostMessageTransport`, tool input/result, model context).

This repo wraps [`@modelcontextprotocol/ext-apps`](https://www.npmjs.com/package/@modelcontextprotocol/ext-apps) with AvenOS-specific defaults (theme variables, logging prefix) and ships the **outer iframe proxy** (`sandbox/`) as a single-file bundle served by Bun on `:8081` by default (`VIBE_SANDBOX_PORT` / `PORT` override).

## Architecture (three layers)

```
Trusted host (e.g. SvelteKit on :5173)
    │  AppBridge + postMessage
    ▼
Outer iframe — sandbox proxy (this package, e.g. :8081/sandbox.html)
    │  validates referrer / origin, creates inner iframe, relays JSON-RPC-shaped messages
    ▼
Inner iframe — injected HTML/JS artifact (model- or Jazz-delivered bundle)
```

1. **Host (`src/host.ts`)** — Your product page constructs `AppBridge`, points an `<iframe>` at the sandbox URL, waits for `sandbox-proxy-ready`, then `connect`s over `PostMessageTransport`, sends `sandbox-resource-ready` (HTML + optional CSP/permissions), then `tool` input/result. Optional callbacks: model context, messages, display mode, etc. The MCP `Client` is currently `null`; you can swap in a real client when a server is involved.

2. **Sandbox proxy (`sandbox/sandbox.ts` + built `sandbox.html`)** — Runs on a **different origin** than the host. Forwards host → guest messages only from the expected parent origin; injects guest HTML via `document.write` / `srcdoc`; forwards guest → host messages back with an explicit `targetOrigin`.

3. **Guest artifact** — Plain browser UI (e.g. `@modelcontextprotocol/ext-apps` `App` SDK) that talks to the parent bridge. No direct access to the host origin’s cookies or DOM.

**HTTP server (`sandbox/serve.ts`)** — Serves the built `sandbox/dist/sandbox.html` and sets **`Content-Security-Policy` from the `?csp=` query** so the guest cannot weaken CSP via a meta tag.

## MCP Apps references

| Resource | URL |
|----------|-----|
| MCP Apps (overview) | [modelcontextprotocol.io/docs/extensions/apps](https://modelcontextprotocol.io/docs/extensions/apps) |
| Build guide | [modelcontextprotocol.io/extensions/apps/build](https://modelcontextprotocol.io/extensions/apps/build) |
| App Bridge API | [app-bridge module](https://apps.extensions.modelcontextprotocol.io/api/modules/app-bridge.html) |
| Wire protocol (spec source) | [ext-apps `apps.mdx`](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) |
| `ext-apps` repository | [github.com/modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps) |
| Extension docs site | [apps.extensions.modelcontextprotocol.io](https://apps.extensions.modelcontextprotocol.io) |

SDK on npm: [`@modelcontextprotocol/ext-apps`](https://www.npmjs.com/package/@modelcontextprotocol/ext-apps).

## Scripts

| Command | Purpose |
|---------|---------|
| `bun run build` | Vite single-file build → `sandbox/dist/sandbox.html` |
| `bun run serve` | `bun --watch sandbox/serve.ts` — dev server (default port **8081**, override with `VIBE_SANDBOX_PORT` or `PORT`; dev retries **8081–8086** if both unset) |

Monorepo entry point: **`bun dev:stack`** (see `projects/dev-stack/run-dev.ts`) builds `@avenos/vibe-apps` + this package, then runs the sandbox watcher.

## Host configuration

- **Sandbox URL** — Defaults to `http://localhost:8081/sandbox.html`. Override with `PUBLIC_VIBE_SANDBOX_URL` or `PUBLIC_MCP_SANDBOX_URL` in the host’s Vite env (see `resolveSandboxBase` in `src/host.ts`).
- **Listen port** — Set `VIBE_SANDBOX_PORT` (preferred) or `PORT` for `sandbox/serve.ts` (default **8081**); keep that origin aligned with `PUBLIC_VIBE_SANDBOX_URL` when not default.

## Related packages

- **`@avenos/vibe-apps`** (`libs/vibe-apps`) — Catalog of built single-file HTML bundles + demo `toolArguments` for each mini-app.

## Security notes

Isolation is **browser-grade** (cross-origin iframe, CSP, `sandbox` attributes, origin-checked `postMessage`). It **reduces** blast radius for untrusted UI; it does not make arbitrary code “safe.” Tighten CSP and referrer allowlists for production (see `sandbox/sandbox.ts`).
