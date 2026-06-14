# Aven.Resources.Shell

Prototype host-shell resource implementation.

## Owns

- `ShellGatewayActor` as the shell resource authority.
- `ShellExecutionWorkerActor` as the per-command worker actor.
- `ShellCommandExecutor` as the low-level process adapter used only by workers.
- `ShellResourceModule` for runtime composition.

## Rules

- Roles never execute shell directly.
- The gateway only validates, admits, records durable intent, and spawns a worker.
- Each shell command gets its own worker actor.
- The shell is intentionally unsafe in this prototype, but it is still capability-gated, durable-delivered, and traceable.
