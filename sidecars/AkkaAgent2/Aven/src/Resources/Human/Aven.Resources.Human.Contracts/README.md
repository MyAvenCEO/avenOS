# Aven.Resources.Human.Contracts

## Purpose

Public contracts for human prompt registration, answer handling, and inspection state.

## Owns

- prompt commands, events, responses, answer DTOs, and state views

## Does not own

- human-prompt implementation logic, Akka integration

## Public contracts

- human prompt protocol contracts

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- `Aven.Contracts`, `Aven.Events`

## Used by

- `Aven.Resources.Human`, `Aven.Api`, tests

## Important rules

- Messages/events/views/ids only; no implementation references or Akka packages.

## Tests

- `Aven.Tests.Resources`, architecture tests
