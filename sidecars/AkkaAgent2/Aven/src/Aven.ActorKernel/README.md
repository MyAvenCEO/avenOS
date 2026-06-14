# Aven.ActorKernel

## Purpose

Shared persistent actor kernel, addressing abstractions, processed-command ledger helpers, and terminal-state helpers.

## Owns

- persistent actor infrastructure, processed-command idempotency helpers, terminal assignment primitives, actor addressing abstractions

## Does not own

- group-specific product facts, HTTP composition, role workflows

## Public contracts

- persistent actor base types, ledger/terminal helpers, actor addressing interfaces

## Actor ownership / persistence

- Owns shared persistence mechanics, not business facts.

## Dependencies

- `Aven.Contracts`, `Aven.Events`, `Aven.Serialization`, `Akka.Persistence`

## Used by

- Most actor implementation assemblies and tests

## Important rules

- Derive persistent actors from `AvenPersistentActor`; keep business ownership out of this assembly.

## Tests

- `Aven.Tests.ActorKernel`, plus many actor-focused suites indirectly
