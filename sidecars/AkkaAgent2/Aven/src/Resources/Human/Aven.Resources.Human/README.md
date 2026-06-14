# Aven.Resources.Human

## Purpose

Implements durable human prompt ownership and answer handling.

## Owns

- `HumanPromptActor`, prompt identity/state, durable answer facts

## Does not own

- API composition, upstream workflow business facts

## Public contracts

- human prompt contracts from `Aven.Resources.Human.Contracts`

## Actor ownership / persistence

- Implements persistent human prompt ownership.

## Dependencies

- `Aven.ActorKernel`, `Aven.Capabilities`, `Aven.Contracts`, `Aven.Resources.Human.Contracts`, `Akka.Persistence`

## Used by

- `Aven.Api`, tests

## Important rules

- Human answers should return through actor-owned reply paths rather than direct endpoint mutation.

## Tests

- `Aven.Tests.Resources`, `Aven.Tests.E2E` indirectly
