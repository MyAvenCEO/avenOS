# Aven.Sidecar

The private stdio sidecar host that lets the Tauri desktop app drive the AkkaAgent2 runtime
without a localhost HTTP server. See `sidecar-docs/TAURI_DOTNET_INTEGRATION_MILESTONE_PLAN.md`
and `TAURI_DOTNET_INTEGRATION_BUILD_LOG.md`.

It reads `Content-Length` framed JSON requests from stdin, dispatches them into the existing
`RuntimeCompositionRoot` (preserving the durable actor submission/routing/work-intake/role-agent
path), and writes framed responses + live events to stdout. Logs go to stderr only; stdout is
kept protocol-only by redirecting `Console.Out` to stderr.

Contents:

- `SidecarHost` — startup, the framed read loop, lifecycle, stdout purity.
- `MethodDispatcher` — maps frozen methods (session/skills/roles/agents/messages/humanPrompts)
  to runtime calls; `SubmitInputMapper` + `ResultMappers` normalize requests/results.
- `RuntimeEventProjector` + `RuntimeEventCorrelation` — project durable run/operation/human-prompt
  events into correlated live UI events (keyed to the app reply id).
- `OutputChannel`, `SidecarLogger`, `SidecarConfiguration`, `SidecarError`.

Dev run: `dotnet run --project Aven/src/Aven.Sidecar/Aven.Sidecar.csproj`. Manual stdio smoke:
`Aven/src/Aven.Sidecar/smoke.py` (hello/ping/lists/shutdown) and `turn_smoke.py` (a live turn).
Tested by `Aven.Tests.Sidecar`.
