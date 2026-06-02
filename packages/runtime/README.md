# runtime

Runtime/composition package for the tree-explorer backend.

## Purpose

This package owns the concrete actor implementations, shared runtime helpers, and
the composition root that wires the demo system together.

The app-local backend now consumes this package via thin compatibility wrappers,
leaving `apps/tree-explorer/backend` focused on API adapters, dev entrypoints, and
app glue.

## Structure

- `src/runtime/*` — actor registry and demo-system composition
- `src/schema/*` — schema implementation and bootstrap helpers
- `src/artifacts/*` — artifact subsystem implementation
- `src/human/*` — human subsystem implementation
- `src/intents/*` — intent domain and subsystem implementation
- `src/metadata/*` — metadata store and subsystem implementation
- `src/llm/*` — LLM client, config loading, and subsystem implementation
- `src/shared/*` — runtime-level helper utilities

## Validation

- `PATH="$HOME/.bun/bin:$PATH" bun run --cwd apps/tree-explorer typecheck`
- `PATH="$HOME/.bun/bin:$PATH" bun run --cwd apps/tree-explorer test`
