# Aven.SchemaRegistry

## Purpose

Implements immutable schema registration and validation.

## Owns

- `SchemaRegistryActor`, schema version facts, validation boundary

## Does not own

- HTTP composition, metadata ownership, provider composition

## Public contracts

- schema registry contracts and canonical serialization integration

## Actor ownership / persistence

- Implements persistent schema ownership.

## Dependencies

- `Aven.ActorKernel`, `Aven.Contracts`, `Aven.SchemaRegistry.Contracts`, `Aven.Serialization`, `Akka.Persistence`

## Used by

- resources, `Aven.Api`, tests

## Important rules

- Keep schema truth here; consumers should validate through this boundary rather than inlining schema decisions.

## Tests

- `Aven.Tests.SchemaRegistry`, `Aven.Tests.Resources`, architecture tests
